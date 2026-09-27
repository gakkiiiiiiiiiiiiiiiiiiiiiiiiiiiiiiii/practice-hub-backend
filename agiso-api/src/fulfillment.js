'use strict';

const crypto = require('node:crypto');
const { ApiError } = require('./errors');
const { withTransaction } = require('./db');
const { generateActivationCode, hashClientSecret, signToken, verifyClientSecret } = require('./security');

const TARGET_TYPES = new Set(['course', 'package', 'category_bundle']);
const DUMMY_CLIENT_SECRET_HASH = hashClientSecret('invalid-client-secret-padding-value');

function requireString(body, field, maxLength) {
  const value = body?.[field];
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.length > maxLength) {
    throw new ApiError(400, 'INVALID_ARGUMENT', `${field} 必须是 1-${maxLength} 个字符且首尾不能有空格`);
  }
  return value;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function recomputePackageExpiry(baseline, events) {
  let expiry = baseline ? new Date(baseline) : null;
  for (const event of events) {
    if (event.revoked_at) continue;
    const grantedAt = new Date(event.granted_at);
    const durationDays = Number(event.duration_days);
    if (Number.isNaN(grantedAt.getTime()) || !Number.isInteger(durationDays) || durationDays <= 0) {
      throw new ApiError(409, 'ENTITLEMENT_INCONSISTENT', '套餐权益事件数据不完整，拒绝撤销和退款');
    }
    const base = expiry && expiry > grantedAt ? expiry : grantedAt;
    expiry = addDays(base, durationDays);
  }
  return expiry;
}

function formatOrder(order, activationCode, balance) {
  return {
    order_no: order.order_no,
    product_name: order.product_name_snapshot,
    status: order.status,
    activation_code: activationCode,
    supply_price: String(order.supply_price),
    balance: String(balance),
    issued_at: order.issued_at,
    revoked_at: order.revoked_at || null,
  };
}

async function lockPartner(connection, partnerId) {
  const [rows] = await connection.execute(
    'SELECT id, client_id, balance, status FROM agiso_partner WHERE id = ? FOR UPDATE',
    [partnerId],
  );
  const partner = rows[0];
  if (!partner || Number(partner.status) !== 1) {
    throw new ApiError(401, 'PARTNER_DISABLED', '调用方不存在或已禁用');
  }
  return partner;
}

async function assertTargetAvailable(connection, product) {
  let rows;
  if (product.target_type === 'course') {
    [rows] = await connection.execute(
      'SELECT id FROM course WHERE id = ? AND status = 1 AND is_free = 0 AND price > 0',
      [product.target_id],
    );
  } else if (product.target_type === 'package') {
    [rows] = await connection.execute(
      `SELECT p.id
         FROM package_plan p
         JOIN package_section s ON s.id = p.section_id
        WHERE p.id = ? AND p.status = 1 AND s.status = 1 AND p.price > 0`,
      [product.target_id],
    );
  } else if (product.target_type === 'category_bundle') {
    [rows] = await connection.execute(
      `SELECT id FROM course_category
        WHERE id = ? AND status = 1 AND bundle_enabled = 1 AND bundle_price > 0`,
      [product.target_id],
    );
  } else {
    throw new ApiError(409, 'PRODUCT_CONFIG_INVALID', '商品权益类型配置错误');
  }
  if (rows.length !== 1) throw new ApiError(409, 'PRODUCT_UNAVAILABLE', '商品对应权益已停用或不存在');
}

async function insertActivationCode(connection, partnerId, product) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateActivationCode();
    const batchId = `AGI${Date.now()}${crypto.randomBytes(5).toString('hex').toUpperCase()}`.slice(0, 50);
    try {
      const [result] = await connection.execute(
        `INSERT INTO activation_code
           (code, batch_id, agent_id, source_type, source_id, batch_prefix, course_id,
            target_type, target_id, reward_payload, status, used_by_uid, used_time,
            create_time, update_time)
         VALUES (?, ?, NULL, 'agiso', ?, 'AGISO', ?, ?, ?, NULL, 0, NULL, NULL, NOW(6), NOW(6))`,
        [
          code,
          batchId,
          partnerId,
          product.target_type === 'course' ? product.target_id : null,
          product.target_type,
          product.target_id,
        ],
      );
      return { id: Number(result.insertId), code };
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY' && attempt < 4) continue;
      throw error;
    }
  }
  throw new ApiError(503, 'CODE_GENERATION_FAILED', '激活码生成失败，请使用相同订单号重试');
}

async function issue(pool, partnerId, body) {
  const productName = requireString(body, 'product_name', 255);
  const orderNo = requireString(body, 'order_no', 128);

  return withTransaction(pool, async (connection) => {
    const partner = await lockPartner(connection, partnerId);
    const [existingRows] = await connection.execute(
      'SELECT * FROM agiso_order WHERE partner_id = ? AND order_no = ? FOR UPDATE',
      [partnerId, orderNo],
    );
    const existing = existingRows[0];
    if (existing) {
      if (existing.product_name_snapshot !== productName) {
        throw new ApiError(409, 'ORDER_CONFLICT', '同一订单号已用于其他商品');
      }
      if (existing.status !== 'issued') {
        throw new ApiError(409, 'ORDER_REVOKED', '该订单激活码已撤销，不能重新发码');
      }
      const [codeRows] = await connection.execute('SELECT code, status FROM activation_code WHERE id = ?', [existing.activation_code_id]);
      if (codeRows.length !== 1 || ![0, 1].includes(Number(codeRows[0].status))) {
        throw new ApiError(409, 'ORDER_INCONSISTENT', '订单激活码数据不完整');
      }
      const [ledgerRows] = await connection.execute(
        `SELECT balance_after FROM agiso_balance_ledger
          WHERE order_id = ? AND event_type = 'issue_debit'`,
        [existing.id],
      );
      if (ledgerRows.length !== 1) throw new ApiError(409, 'ORDER_INCONSISTENT', '订单扣款流水不完整');
      return formatOrder(existing, codeRows[0].code, ledgerRows[0].balance_after);
    }

    const [productRows] = await connection.execute(
      `SELECT id, product_name, target_type, target_id, supply_price, enabled
         FROM agiso_product
        WHERE product_name = ?
        FOR UPDATE`,
      [productName],
    );
    const product = productRows[0];
    if (!product || Number(product.enabled) !== 1) {
      throw new ApiError(404, 'PRODUCT_NOT_FOUND', '商品名未配置或尚未启用');
    }
    if (!TARGET_TYPES.has(product.target_type) || product.supply_price === null || Number(product.supply_price) <= 0) {
      throw new ApiError(409, 'PRODUCT_CONFIG_INVALID', '商品供货价或权益配置无效');
    }
    await assertTargetAvailable(connection, product);

    const [debitResult] = await connection.execute(
      `UPDATE agiso_partner
          SET balance = balance - ?
        WHERE id = ? AND status = 1 AND balance >= ?`,
      [product.supply_price, partnerId, product.supply_price],
    );
    if (debitResult.affectedRows !== 1) throw new ApiError(409, 'INSUFFICIENT_BALANCE', '预充值余额不足');

    const activationCode = await insertActivationCode(connection, partnerId, product);
    const [orderResult] = await connection.execute(
      `INSERT INTO agiso_order
         (partner_id, order_no, product_id, product_name_snapshot, target_type, target_id,
          supply_price, activation_code_id, status, issued_at, create_time, update_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'issued', NOW(6), NOW(6), NOW(6))`,
      [
        partnerId,
        orderNo,
        product.id,
        product.product_name,
        product.target_type,
        product.target_id,
        product.supply_price,
        activationCode.id,
      ],
    );
    const [balanceRows] = await connection.execute('SELECT balance FROM agiso_partner WHERE id = ?', [partnerId]);
    const balance = balanceRows[0].balance;
    await connection.execute(
      `INSERT INTO agiso_balance_ledger
         (partner_id, order_id, event_type, amount, balance_after, create_time)
       VALUES (?, ?, 'issue_debit', ?, ?, NOW(6))`,
      [partnerId, orderResult.insertId, product.supply_price, balance],
    );
    const [createdRows] = await connection.execute('SELECT * FROM agiso_order WHERE id = ?', [orderResult.insertId]);
    return formatOrder(createdRows[0], activationCode.code, balance);
  });
}

async function revokeCourseGrant(connection, grant, activationCodeId) {
  const [paidOrders] = await connection.execute(
    `SELECT id FROM \`order\`
      WHERE user_id = ? AND status = 'paid'
        AND (
          (order_type = 'course' AND course_id = ?)
          OR JSON_CONTAINS(
            COALESCE(JSON_EXTRACT(pay_payload, '$.cart_items'), JSON_ARRAY()),
            JSON_OBJECT('course_id', CAST(? AS UNSIGNED))
          )
        )
      LIMIT 1
      FOR UPDATE`,
    [grant.user_id, grant.target_id, grant.target_id],
  );
  const [otherCodes] = await connection.execute(
    `SELECT id FROM activation_code
      WHERE id <> ? AND used_by_uid = ? AND status = 1
        AND target_type = 'course' AND COALESCE(target_id, course_id) = ?
      LIMIT 1
      FOR UPDATE`,
    [activationCodeId, grant.user_id, grant.target_id],
  );
  if (paidOrders.length > 0 || otherCodes.length > 0) return;

  const [authRows] = await connection.execute(
    `SELECT id FROM user_course_auth
      WHERE user_id = ? AND course_id = ? AND source = 'code'
      FOR UPDATE`,
    [grant.user_id, grant.target_id],
  );
  if (authRows.length !== 1) {
    throw new ApiError(409, 'ENTITLEMENT_INCONSISTENT', '课程权益无法精确归因，拒绝撤销和退款');
  }
  await connection.execute('DELETE FROM user_course_auth WHERE id = ?', [authRows[0].id]);
}

async function revokeCategoryGrant(connection, grant, activationCodeId) {
  const [rows] = await connection.execute(
    `SELECT id FROM user_category_bundle_access
      WHERE activation_code_id = ? AND user_id = ? AND category_id = ?
      FOR UPDATE`,
    [activationCodeId, grant.user_id, grant.target_id],
  );
  if (rows.length !== 1) {
    throw new ApiError(409, 'ENTITLEMENT_INCONSISTENT', '类目套餐权益无法精确归因，拒绝撤销和退款');
  }
  await connection.execute('DELETE FROM user_category_bundle_access WHERE id = ?', [rows[0].id]);
}

async function revokePackageGrant(connection, grant, activationCodeId) {
  const [userRows] = await connection.execute('SELECT id FROM app_user WHERE id = ? FOR UPDATE', [grant.user_id]);
  if (userRows.length !== 1) throw new ApiError(409, 'ENTITLEMENT_INCONSISTENT', '核销用户不存在，拒绝撤销和退款');

  const [planRows] = await connection.execute(
    'SELECT id, section_id FROM package_plan WHERE id = ?',
    [grant.target_id],
  );
  if (planRows.length !== 1) throw new ApiError(409, 'ENTITLEMENT_INCONSISTENT', '套餐计划不存在，拒绝撤销和退款');
  const sectionId = Number(planRows[0].section_id);

  const [eventRows] = await connection.execute(
    `SELECT * FROM agiso_package_event
      WHERE source_type = 'code' AND source_id = ?
      FOR UPDATE`,
    [activationCodeId],
  );
  const event = eventRows[0];
  if (
    !event || event.revoked_at || Number(event.user_id) !== Number(grant.user_id) ||
    Number(event.section_id) !== sectionId || Number(event.duration_days) !== Number(grant.duration_days)
  ) {
    throw new ApiError(409, 'ENTITLEMENT_INCONSISTENT', '套餐权益事件缺失或不一致，拒绝撤销和退款');
  }

  const [stateRows] = await connection.execute(
    `SELECT * FROM agiso_package_state
      WHERE user_id = ? AND section_id = ?
      FOR UPDATE`,
    [grant.user_id, sectionId],
  );
  const state = stateRows[0];
  if (!state) throw new ApiError(409, 'ENTITLEMENT_INCONSISTENT', '套餐权益基线缺失，拒绝撤销和退款');

  await connection.execute('UPDATE agiso_package_event SET revoked_at = NOW(6) WHERE id = ? AND revoked_at IS NULL', [event.id]);
  const [events] = await connection.execute(
    `SELECT id, granted_at, duration_days, revoked_at
       FROM agiso_package_event
      WHERE user_id = ? AND section_id = ?
      ORDER BY granted_at, id
      FOR UPDATE`,
    [grant.user_id, sectionId],
  );
  const expiry = recomputePackageExpiry(state.baseline_expire_time, events);
  const [subscriptionRows] = await connection.execute(
    `SELECT id FROM user_package_subscription
      WHERE user_id = ? AND section_id = ?
      FOR UPDATE`,
    [grant.user_id, sectionId],
  );
  if (expiry) {
    if (subscriptionRows.length === 1) {
      await connection.execute(
        'UPDATE user_package_subscription SET expire_time = ?, order_id = NULL WHERE id = ?',
        [expiry, subscriptionRows[0].id],
      );
    } else if (subscriptionRows.length === 0) {
      await connection.execute(
        `INSERT INTO user_package_subscription
           (user_id, section_id, expire_time, order_id, create_time, update_time)
         VALUES (?, ?, ?, NULL, NOW(6), NOW(6))`,
        [grant.user_id, sectionId, expiry],
      );
    } else {
      throw new ApiError(409, 'ENTITLEMENT_INCONSISTENT', '套餐订阅记录不唯一，拒绝撤销和退款');
    }
  } else if (subscriptionRows.length === 1) {
    await connection.execute('DELETE FROM user_package_subscription WHERE id = ?', [subscriptionRows[0].id]);
  }

  const [maxRows] = await connection.execute(
    `SELECT MAX(expire_time) AS max_expire
       FROM user_package_subscription
      WHERE user_id = ? AND expire_time > NOW(6)`,
    [grant.user_id],
  );
  await connection.execute('UPDATE app_user SET package_expire_time = ? WHERE id = ?', [maxRows[0].max_expire, grant.user_id]);
}

async function revokeUsedCode(connection, order, code) {
  const [grantRows] = await connection.execute(
    'SELECT * FROM agiso_code_grant WHERE activation_code_id = ? FOR UPDATE',
    [code.id],
  );
  const grant = grantRows[0];
  if (!grant || grant.revoked_at) {
    throw new ApiError(409, 'ENTITLEMENT_INCONSISTENT', '激活码权益归因缺失或已异常撤销，拒绝退款');
  }
  if (
    Number(grant.user_id) !== Number(code.used_by_uid) || grant.target_type !== order.target_type ||
    Number(grant.target_id) !== Number(order.target_id)
  ) {
    throw new ApiError(409, 'ENTITLEMENT_INCONSISTENT', '激活码权益归因与订单不一致，拒绝退款');
  }

  if (grant.target_type === 'course') {
    await revokeCourseGrant(connection, grant, code.id);
  } else if (grant.target_type === 'category_bundle') {
    await revokeCategoryGrant(connection, grant, code.id);
  } else if (grant.target_type === 'package') {
    await revokePackageGrant(connection, grant, code.id);
  } else {
    throw new ApiError(409, 'ENTITLEMENT_INCONSISTENT', '不支持撤销该权益类型');
  }
  const [result] = await connection.execute(
    'UPDATE agiso_code_grant SET revoked_at = NOW(6) WHERE activation_code_id = ? AND revoked_at IS NULL',
    [code.id],
  );
  if (result.affectedRows !== 1) throw new ApiError(409, 'ENTITLEMENT_INCONSISTENT', '权益归因并发变化，拒绝退款');
}

async function revoke(pool, partnerId, body) {
  const orderNo = requireString(body, 'order_no', 128);
  return withTransaction(pool, async (connection) => {
    const partner = await lockPartner(connection, partnerId);
    const [orderRows] = await connection.execute(
      'SELECT * FROM agiso_order WHERE partner_id = ? AND order_no = ? FOR UPDATE',
      [partnerId, orderNo],
    );
    const order = orderRows[0];
    if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', '订单不存在');
    const [codeRows] = await connection.execute(
      'SELECT * FROM activation_code WHERE id = ? FOR UPDATE',
      [order.activation_code_id],
    );
    const code = codeRows[0];
    if (!code || code.source_type !== 'agiso' || Number(code.source_id) !== Number(partnerId)) {
      throw new ApiError(409, 'ORDER_INCONSISTENT', '订单激活码来源不一致');
    }

    if (order.status === 'revoked') {
      const [ledgerRows] = await connection.execute(
        `SELECT balance_after FROM agiso_balance_ledger
          WHERE order_id = ? AND event_type = 'revoke_refund'`,
        [order.id],
      );
      if (ledgerRows.length !== 1 || Number(code.status) !== 2) {
        throw new ApiError(409, 'ORDER_INCONSISTENT', '撤销订单数据不完整');
      }
      if (code.used_by_uid) {
        const [grantRows] = await connection.execute(
          'SELECT revoked_at FROM agiso_code_grant WHERE activation_code_id = ? FOR UPDATE',
          [code.id],
        );
        if (grantRows.length !== 1 || !grantRows[0].revoked_at) {
          throw new ApiError(409, 'ORDER_INCONSISTENT', '已核销订单的权益撤销记录不完整');
        }
      }
      return formatOrder(order, code.code, ledgerRows[0].balance_after);
    }
    if (order.status !== 'issued') throw new ApiError(409, 'ORDER_INCONSISTENT', '订单状态不支持撤销');

    if (Number(code.status) === 0) {
      if (code.used_by_uid || code.used_time) {
        throw new ApiError(409, 'ENTITLEMENT_INCONSISTENT', '未核销激活码包含异常核销信息');
      }
      const [grantRows] = await connection.execute(
        'SELECT id FROM agiso_code_grant WHERE activation_code_id = ? FOR UPDATE',
        [code.id],
      );
      if (grantRows.length > 0) throw new ApiError(409, 'ENTITLEMENT_INCONSISTENT', '未核销激活码存在异常权益记录');
    } else if (Number(code.status) === 1) {
      await revokeUsedCode(connection, order, code);
    } else {
      throw new ApiError(409, 'CODE_ALREADY_INVALID', '激活码已被其他流程作废，拒绝重复退款');
    }

    const [codeResult] = await connection.execute(
      'UPDATE activation_code SET status = 2, update_time = NOW(6) WHERE id = ? AND status IN (0, 1)',
      [code.id],
    );
    if (codeResult.affectedRows !== 1) throw new ApiError(409, 'ORDER_INCONSISTENT', '激活码状态并发变化');
    await connection.execute('UPDATE agiso_partner SET balance = balance + ? WHERE id = ?', [order.supply_price, partnerId]);
    const [balanceRows] = await connection.execute('SELECT balance FROM agiso_partner WHERE id = ?', [partnerId]);
    const balance = balanceRows[0].balance;
    await connection.execute(
      `INSERT INTO agiso_balance_ledger
         (partner_id, order_id, event_type, amount, balance_after, create_time)
       VALUES (?, ?, 'revoke_refund', ?, ?, NOW(6))`,
      [partnerId, order.id, order.supply_price, balance],
    );
    const [orderResult] = await connection.execute(
      `UPDATE agiso_order
          SET status = 'revoked', revoked_at = NOW(6), update_time = NOW(6)
        WHERE id = ? AND status = 'issued'`,
      [order.id],
    );
    if (orderResult.affectedRows !== 1) throw new ApiError(409, 'ORDER_INCONSISTENT', '订单状态并发变化');
    const [updatedRows] = await connection.execute('SELECT * FROM agiso_order WHERE id = ?', [order.id]);
    return formatOrder(updatedRows[0], code.code, balance);
  });
}

async function authenticate(pool, body, tokenSecret, tokenTtlSeconds) {
  const clientId = requireString(body, 'client_id', 80);
  const clientSecret = requireString(body, 'client_secret', 255);
  const [rows] = await pool.execute(
    'SELECT id, client_id, client_secret_hash, status FROM agiso_partner WHERE client_id = ?',
    [clientId],
  );
  const partner = rows[0];
  const secretMatches = verifyClientSecret(clientSecret, partner?.client_secret_hash || DUMMY_CLIENT_SECRET_HASH);
  const valid = partner && Number(partner.status) === 1 && secretMatches;
  if (!valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'client_id 或 client_secret 错误');
  return {
    access_token: signToken(partner, tokenSecret, tokenTtlSeconds),
    token_type: 'Bearer',
    expires_in: tokenTtlSeconds,
  };
}

module.exports = { authenticate, issue, recomputePackageExpiry, revoke };
