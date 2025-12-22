-- 插入测试推荐分类数据
-- 注意：执行前请确保 subject 表中有题库数据

-- 插入推荐分类
INSERT INTO `home_recommend_category` (`name`, `sort`, `status`, `create_time`, `update_time`) VALUES
('热门公共课', 0, 1, NOW(), NOW()),
('专业课推荐', 1, 1, NOW(), NOW()),
('真题专区', 2, 1, NOW(), NOW());

-- 插入推荐项（需要根据实际的 subject_id 调整）
-- 假设 subject 表中有 id 为 1, 2, 3, 4 的题库
INSERT INTO `home_recommend_item` (`category_id`, `subject_id`, `sort`, `create_time`) VALUES
(1, 1, 0, NOW()),  -- 热门公共课 - 题库1
(1, 2, 1, NOW()),  -- 热门公共课 - 题库2
(1, 3, 2, NOW()),  -- 热门公共课 - 题库3
(2, 4, 0, NOW()),  -- 专业课推荐 - 题库4
(2, 1, 1, NOW()),  -- 专业课推荐 - 题库1
(3, 1, 0, NOW()),  -- 真题专区 - 题库1
(3, 2, 1, NOW()),  -- 真题专区 - 题库2
(3, 3, 2, NOW()),  -- 真题专区 - 题库3
(3, 4, 3, NOW());  -- 真题专区 - 题库4

-- 查询验证
SELECT 
    c.id as category_id,
    c.name as category_name,
    c.status,
    i.id as item_id,
    i.subject_id,
    s.name as subject_name
FROM home_recommend_category c
LEFT JOIN home_recommend_item i ON c.id = i.category_id
LEFT JOIN subject s ON i.subject_id = s.id
WHERE c.status = 1
ORDER BY c.sort ASC, i.sort ASC;

