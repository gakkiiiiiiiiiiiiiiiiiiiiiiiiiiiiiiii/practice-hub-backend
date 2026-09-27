import { EntityManager } from 'typeorm';
import { AppUser } from '../../database/entities/app-user.entity';
import { UserPackageSubscription } from '../../database/entities/user-package-subscription.entity';

export type PackageEntitlementSource = 'code' | 'order';

type PackageStateRow = { baseline_expire_time: Date | string | null };
type PackageEventRow = { granted_at: Date | string; duration_days: number };

export function calculatePackageExpiry(
  baseline: Date | string | null,
  events: PackageEventRow[],
): Date | null {
  let expiry = baseline ? new Date(baseline) : null;
  for (const event of events) {
    const grantedAt = new Date(event.granted_at);
    const base = expiry && expiry > grantedAt ? expiry : grantedAt;
    expiry = new Date(base.getTime() + Number(event.duration_days) * 86_400_000);
  }
  return expiry;
}

/**
 * The pre-existing subscription is the baseline. Every grant made after the first
 * tracked grant is an event, so removing one code never deletes another purchase.
 * All callers must run this function inside a database transaction.
 */
export async function grantTrackedPackageDuration(
  manager: EntityManager,
  input: {
    userId: number;
    sectionId: number;
    durationDays: number;
    sourceType: PackageEntitlementSource;
    sourceId: number;
  },
): Promise<void> {
  if (!Number.isInteger(input.durationDays) || input.durationDays <= 0) {
    throw new Error('套餐权益时长无效');
  }
  await lockPackageUser(manager, input.userId);
  const subscriptions = await lockSubscriptions(manager, input.userId, input.sectionId);
  if (subscriptions.length > 1) {
    throw new Error('套餐订阅数据存在重复记录，无法安全发放');
  }

  const priorEvent = await manager.query(
    'SELECT id FROM agiso_package_event WHERE source_type = ? AND source_id = ? LIMIT 1 FOR UPDATE',
    [input.sourceType, input.sourceId],
  );
  if (priorEvent.length > 0) return;

  const states = await manager.query(
    'SELECT baseline_expire_time FROM agiso_package_state WHERE user_id = ? AND section_id = ? FOR UPDATE',
    [input.userId, input.sectionId],
  ) as PackageStateRow[];
  if (states.length === 0) {
    await manager.query(
      'INSERT INTO agiso_package_state (user_id, section_id, baseline_expire_time, tracking_started_at) VALUES (?, ?, ?, NOW())',
      [input.userId, input.sectionId, subscriptions[0]?.expire_time ?? null],
    );
  }

  await manager.query(
    'INSERT INTO agiso_package_event (user_id, section_id, source_type, source_id, granted_at, duration_days, revoked_at) VALUES (?, ?, ?, ?, NOW(), ?, NULL)',
    [input.userId, input.sectionId, input.sourceType, input.sourceId, input.durationDays],
  );
  await rebuildTrackedPackageSubscription(manager, input.userId, input.sectionId);
}

/** Returns false for legacy grants that predate the event ledger. */
export async function revokeTrackedPackageDuration(
  manager: EntityManager,
  input: { userId: number; sectionId: number; sourceType: PackageEntitlementSource; sourceId: number },
): Promise<boolean> {
  await lockPackageUser(manager, input.userId);
  const events = await manager.query(
    'SELECT id, user_id, section_id, revoked_at FROM agiso_package_event WHERE source_type = ? AND source_id = ? FOR UPDATE',
    [input.sourceType, input.sourceId],
  );
  if (events.length === 0) return false;
  if (Number(events[0].user_id) !== input.userId || Number(events[0].section_id) !== input.sectionId) {
    throw new Error('套餐权益来源与用户不匹配');
  }
  if (!events[0].revoked_at) {
    await manager.query('UPDATE agiso_package_event SET revoked_at = NOW() WHERE id = ?', [events[0].id]);
    await rebuildTrackedPackageSubscription(manager, input.userId, input.sectionId);
  }
  return true;
}

async function lockPackageUser(manager: EntityManager, userId: number): Promise<void> {
  const user = await manager.findOne(AppUser, { where: { id: userId }, lock: { mode: 'pessimistic_write' } });
  if (!user) throw new Error('套餐用户不存在');
}

async function lockSubscriptions(manager: EntityManager, userId: number, sectionId: number): Promise<UserPackageSubscription[]> {
  return manager.find(UserPackageSubscription, {
    where: { user_id: userId, section_id: sectionId },
    lock: { mode: 'pessimistic_write' },
  });
}

async function rebuildTrackedPackageSubscription(manager: EntityManager, userId: number, sectionId: number): Promise<void> {
  const states = await manager.query(
    'SELECT baseline_expire_time FROM agiso_package_state WHERE user_id = ? AND section_id = ? FOR UPDATE',
    [userId, sectionId],
  ) as PackageStateRow[];
  if (states.length !== 1) throw new Error('套餐权益基线缺失');

  const events = await manager.query(
    'SELECT granted_at, duration_days FROM agiso_package_event WHERE user_id = ? AND section_id = ? AND revoked_at IS NULL ORDER BY granted_at, id FOR UPDATE',
    [userId, sectionId],
  ) as PackageEventRow[];
  const expiry = calculatePackageExpiry(states[0].baseline_expire_time, events);

  const subscriptions = await lockSubscriptions(manager, userId, sectionId);
  if (subscriptions.length > 1) throw new Error('套餐订阅数据存在重复记录，无法安全重算');
  if (expiry) {
    const subscription = subscriptions[0] ?? manager.create(UserPackageSubscription, {
      user_id: userId,
      section_id: sectionId,
      order_id: null,
    });
    subscription.expire_time = expiry;
    subscription.order_id = null;
    await manager.save(UserPackageSubscription, subscription);
  } else if (subscriptions[0]) {
    await manager.delete(UserPackageSubscription, subscriptions[0].id);
  }

  const remaining = await manager.find(UserPackageSubscription, { where: { user_id: userId } });
  const now = new Date();
  const maxExpiry = remaining.reduce<Date | null>((max, item) => {
    const value = new Date(item.expire_time);
    return value > now && (!max || value > max) ? value : max;
  }, null);
  await manager.update(AppUser, userId, { package_expire_time: maxExpiry });
}
