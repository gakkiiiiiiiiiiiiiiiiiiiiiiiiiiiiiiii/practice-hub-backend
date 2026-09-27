'use strict';

const { loadDatabaseConfig } = require('../src/config');
const { createPool, withTransaction } = require('../src/db');

function normalizeName(value, fallback) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  return name || fallback;
}

async function loadCatalog(pool) {
  const [courses] = await pool.execute(
    `SELECT id, name FROM course
      WHERE status = 1 AND is_free = 0 AND price > 0
      ORDER BY id`,
  );
  const [plans] = await pool.execute(
    `SELECT p.id, p.name AS plan_name, s.name AS section_name
       FROM package_plan p
       JOIN package_section s ON s.id = p.section_id
      WHERE p.status = 1 AND s.status = 1 AND p.price > 0
      ORDER BY p.id`,
  );
  const [bundles] = await pool.execute(
    `SELECT child.id, child.name, parent.name AS parent_name
       FROM course_category child
       LEFT JOIN course_category parent ON parent.id = child.parent_id
      WHERE child.status = 1 AND child.bundle_enabled = 1 AND child.bundle_price > 0
      ORDER BY child.id`,
  );

  return [
    ...courses.map((item) => ({
      productName: `${normalizeName(item.name, '课程')} [C${item.id}]`,
      targetType: 'course',
      targetId: Number(item.id),
    })),
    ...plans.map((item) => ({
      productName: `${normalizeName(item.section_name, '套餐')} - ${normalizeName(item.plan_name, '方案')} [P${item.id}]`,
      targetType: 'package',
      targetId: Number(item.id),
    })),
    ...bundles.map((item) => ({
      productName: `${item.parent_name ? `${normalizeName(item.parent_name, '分类')} / ` : ''}${normalizeName(item.name, '分类套餐')} [B${item.id}]`,
      targetType: 'category_bundle',
      targetId: Number(item.id),
    })),
  ];
}

async function main() {
  const apply = process.argv.includes('--apply');
  const pool = createPool(loadDatabaseConfig());
  try {
    const catalog = await loadCatalog(pool);
    if (!apply) {
      process.stdout.write(`${JSON.stringify({ mode: 'dry-run', count: catalog.length, products: catalog }, null, 2)}\n`);
      return;
    }

    await withTransaction(pool, async (connection) => {
      for (const product of catalog) {
        await connection.execute(
          `INSERT INTO agiso_product
             (product_name, target_type, target_id, supply_price, enabled)
           VALUES (?, ?, ?, NULL, 0)
           ON DUPLICATE KEY UPDATE product_name = VALUES(product_name)`,
          [product.productName, product.targetType, product.targetId],
        );
      }
    });
    process.stdout.write(`${JSON.stringify({ mode: 'apply', synced: catalog.length, priceOrStatusOverwritten: false })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ level: 'error', event: 'sync_products_failed', message: error.message })}\n`);
  process.exitCode = 1;
});
