import { EntityManager } from 'typeorm';

/**
 * 将用户当前获得访问权的文件资料加入完整预览生成队列。
 *
 * 上传文件本身会直接设置 full_preview_requested；这里负责购买、套餐和激活码
 * 授权事件，避免工作节点为了发现需求而反复扫描整个 OSS。
 */
export async function requestUserPreviewDemand(
  manager: Pick<EntityManager, 'query'>,
  userId: number,
): Promise<number> {
  const safeUserId = Number(userId);
  if (!Number.isInteger(safeUserId) || safeUserId <= 0) return 0;

  const result = await manager.query(
    `UPDATE course_file cf
     INNER JOIN course c
       ON c.id = cf.course_id
      AND c.status = 1
     SET cf.full_preview_requested = 1
     WHERE cf.status = 1
       AND cf.full_preview_requested = 0
       AND LOWER(cf.file_type) IN ('pdf', 'doc', 'docx')
       AND (
         EXISTS (
           SELECT 1
           FROM user_course_auth course_auth
           WHERE course_auth.user_id = ?
             AND course_auth.course_id = c.id
             AND (
               course_auth.expire_time IS NULL
               OR course_auth.expire_time > NOW()
             )
         )
         OR EXISTS (
           SELECT 1
           FROM user_package_subscription ups
           INNER JOIN package_section ps
             ON ps.id = ups.section_id
            AND ps.status = 1
           INNER JOIN package_section_scope pss
             ON pss.section_id = ps.id
           WHERE ups.user_id = ?
             AND ups.expire_time > NOW()
             AND (
               pss.scope_type = 'all'
               OR (
                 pss.scope_type = 'course'
                 AND CAST(TRIM(pss.scope_value) AS UNSIGNED) = c.id
               )
               OR (
                 pss.scope_type = 'category'
                 AND TRIM(pss.scope_value) COLLATE utf8mb4_unicode_ci
                   = TRIM(COALESCE(c.category, '')) COLLATE utf8mb4_unicode_ci
               )
               OR (
                 pss.scope_type = 'sub_category'
                 AND TRIM(pss.scope_value) COLLATE utf8mb4_unicode_ci
                   = TRIM(COALESCE(c.sub_category, '')) COLLATE utf8mb4_unicode_ci
               )
             )
         )
         OR EXISTS (
           SELECT 1
           FROM user_category_bundle_access category_access
           INNER JOIN course_category bundle_category
             ON bundle_category.id = category_access.category_id
           LEFT JOIN course_category parent_category
             ON parent_category.id = bundle_category.parent_id
           WHERE category_access.user_id = ?
             AND TRIM(COALESCE(c.category, '')) COLLATE utf8mb4_unicode_ci
               = TRIM(CASE
                   WHEN bundle_category.parent_id IS NULL THEN bundle_category.name
                   ELSE COALESCE(parent_category.name, '')
                 END) COLLATE utf8mb4_unicode_ci
             AND (
               bundle_category.parent_id IS NULL
               OR TRIM(COALESCE(c.sub_category, '')) COLLATE utf8mb4_unicode_ci
                 = TRIM(bundle_category.name) COLLATE utf8mb4_unicode_ci
             )
         )
       )`,
    [safeUserId, safeUserId, safeUserId],
  );

  return Number(result?.affectedRows || 0);
}
