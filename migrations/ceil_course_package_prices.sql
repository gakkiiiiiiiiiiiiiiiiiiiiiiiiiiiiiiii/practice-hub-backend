-- 代币 1:1 仅支持整数元：已有价格按进一法取整
-- 执行前请备份；执行后建议在管理端触发「同步微信虚拟道具价格」

UPDATE course
SET
  price = CEIL(price),
  agent_price = CEIL(agent_price)
WHERE price <> FLOOR(price) OR agent_price <> FLOOR(agent_price);

UPDATE package_plan
SET price = CEIL(price)
WHERE price <> FLOOR(price);

-- 业务零头字段若曾用于二级换算，重置为 0
UPDATE app_user SET coin_balance = 0 WHERE coin_balance <> 0;
