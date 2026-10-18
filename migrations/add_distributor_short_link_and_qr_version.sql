ALTER TABLE `distributor`
  ADD COLUMN `qr_code_version` TINYINT NOT NULL DEFAULT 0 COMMENT '小程序二维码版本，头像更新后按版本重新生成',
  ADD COLUMN `short_link` VARCHAR(512) NULL COMMENT '专属小程序短链接';
