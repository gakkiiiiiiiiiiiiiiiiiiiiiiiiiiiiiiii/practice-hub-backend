INSERT INTO `system_config` (`config_key`, `config_value`, `description`, `create_time`, `update_time`)
SELECT
  'user_title_config',
  '{"enabled":true,"tiers":[{"id":"tier_1","name":"备考新兵","minDays":0,"tierStyle":"bronze","sort":1,"enabled":true},{"id":"tier_2","name":"筑基学士","minDays":7,"tierStyle":"silver","sort":2,"enabled":true},{"id":"tier_3","name":"刷题先锋","minDays":30,"tierStyle":"gold","sort":3,"enabled":true},{"id":"tier_4","name":"真题宗师","minDays":90,"tierStyle":"platinum","sort":4,"enabled":true},{"id":"tier_5","name":"过线战神","minDays":180,"tierStyle":"diamond","sort":5,"enabled":true},{"id":"tier_6","name":"研途王者","minDays":365,"tierStyle":"king","sort":6,"enabled":true}]}',
  '用户学习称号配置（按累计打卡学习天数发放）',
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM `system_config` WHERE `config_key` = 'user_title_config');
