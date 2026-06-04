INSERT INTO `system_config` (`config_key`, `config_value`, `description`, `create_time`, `update_time`)
SELECT
  'course_similarity_config',
  '{"threshold":0.82}',
  '课程同名/类似检测参数（编辑距离相似度阈值）',
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM `system_config` WHERE `config_key` = 'course_similarity_config');
