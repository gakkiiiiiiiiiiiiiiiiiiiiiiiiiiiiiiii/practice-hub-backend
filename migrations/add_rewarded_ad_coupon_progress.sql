-- 激励视频优惠券活动：完整观看 5 次后发放 5 元优惠券
ALTER TABLE app_user
  ADD COLUMN rewarded_ad_watch_count INT NOT NULL DEFAULT 0 COMMENT '激励视频优惠券活动完成次数' AFTER points_balance,
  ADD COLUMN rewarded_ad_coupon_issued TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已领取激励视频优惠券' AFTER rewarded_ad_watch_count;
