-- 检查推荐分类数据
SELECT * FROM home_recommend_category;

-- 检查启用的推荐分类
SELECT * FROM home_recommend_category WHERE status = 1;

-- 检查推荐项数据
SELECT * FROM home_recommend_item;

-- 检查题库数据
SELECT id, name FROM subject LIMIT 10;

-- 检查完整的推荐数据（关联查询）
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

