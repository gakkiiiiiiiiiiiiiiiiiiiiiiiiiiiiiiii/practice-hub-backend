ALTER TABLE `distributor`
  ADD COLUMN `commission_debt_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0
  COMMENT '退款产生、待后续佣金抵扣的欠款（元）'
  AFTER `frozen_amount`;

UPDATE `distributor` distributors
SET distributors.`subordinate_count` = (
  SELECT COUNT(*)
  FROM `distribution_relation` relations
  WHERE relations.`distributor_id` = distributors.`id`
);
