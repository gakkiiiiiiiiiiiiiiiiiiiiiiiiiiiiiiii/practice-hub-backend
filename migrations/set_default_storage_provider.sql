INSERT INTO `system_config` (`config_key`, `config_value`, `description`)
SELECT 'storage_provider', '"cos"', '当前对象存储服务（cos/oss）'
WHERE NOT EXISTS (
  SELECT 1 FROM `system_config` WHERE `config_key` = 'storage_provider'
);
