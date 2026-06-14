-- 小程序首页弹窗默认配置（写入 system_config）
INSERT INTO `system_config` (`config_key`, `config_value`, `description`, `create_time`, `update_time`)
SELECT
  'home_popup_config',
  '{"enabled":false,"title":"","content":"","image":"","buttonText":"我知道了","showMode":"once","version":0}',
  '小程序首页弹窗配置',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `system_config` WHERE `config_key` = 'home_popup_config'
);
