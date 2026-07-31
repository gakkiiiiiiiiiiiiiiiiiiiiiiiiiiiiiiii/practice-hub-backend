CREATE TABLE IF NOT EXISTS `user_category_bundle_access` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `category_id` int NOT NULL,
  `order_id` int NOT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_category_bundle_access_order` (`order_id`),
  KEY `idx_user_category_bundle_access_user_category` (`user_id`, `category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户类目套餐永久权限';

INSERT IGNORE INTO `user_category_bundle_access` (`user_id`, `category_id`, `order_id`, `create_time`)
SELECT
  `user_id`,
  CAST(JSON_UNQUOTE(JSON_EXTRACT(`pay_payload`, '$.category_bundle.category_id')) AS UNSIGNED),
  `id`,
  COALESCE(`paid_time`, `create_time`)
FROM `order`
WHERE `order_type` = 'category'
  AND `status` IN ('paid', 'after_sale')
  AND JSON_VALID(`pay_payload`)
  AND JSON_EXTRACT(`pay_payload`, '$.category_bundle.category_id') IS NOT NULL
  AND CAST(JSON_UNQUOTE(JSON_EXTRACT(`pay_payload`, '$.category_bundle.category_id')) AS UNSIGNED) > 0;
