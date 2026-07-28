ALTER TABLE app_user
  ADD COLUMN rewarded_ad_activity_date DATE NULL COMMENT '激励视频每日奖励统计日期' AFTER rewarded_ad_coupon_issued,
  ADD COLUMN rewarded_ad_daily_coupon_count INT NOT NULL DEFAULT 0 COMMENT '激励视频当日已领取优惠券张数' AFTER rewarded_ad_activity_date;

UPDATE app_user AS user
LEFT JOIN (
  SELECT user_id, COUNT(*) AS claimed_count
  FROM user_coupon
  WHERE source = 'rewarded_ad'
    AND create_time >= CURDATE()
    AND create_time < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
  GROUP BY user_id
) AS reward ON reward.user_id = user.id
SET user.rewarded_ad_activity_date = CURDATE(),
    user.rewarded_ad_daily_coupon_count = LEAST(10, COALESCE(reward.claimed_count, 0));
