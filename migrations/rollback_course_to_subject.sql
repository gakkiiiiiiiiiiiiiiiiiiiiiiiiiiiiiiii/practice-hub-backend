-- ============================================
-- 回滚脚本：将 course 回滚为 subject（谨慎使用！）
-- 执行前请务必备份数据库！
-- ============================================

-- 1. 删除 course 表的新字段
ALTER TABLE `course` 
  DROP COLUMN `subject`,
  DROP COLUMN `school`,
  DROP COLUMN `major`,
  DROP COLUMN `exam_year`,
  DROP COLUMN `answer_year`;

-- 2. 重命名表 course 为 subject
ALTER TABLE `course` RENAME TO `subject`;

-- 3. 更新 chapter 表：将 course_id 改回 subject_id
ALTER TABLE `chapter` CHANGE `course_id` `subject_id` INT NOT NULL COMMENT '科目ID';

-- 4. 重命名表 user_course_auth 为 user_subject_auth
ALTER TABLE `user_course_auth` RENAME TO `user_subject_auth`;

-- 5. 更新 user_subject_auth 表：将 course_id 改回 subject_id
ALTER TABLE `user_subject_auth` CHANGE `course_id` `subject_id` INT NOT NULL COMMENT '科目ID';

-- 6. 更新 user_wrong_book 表：将 course_id 改回 subject_id
ALTER TABLE `user_wrong_book` CHANGE `course_id` `subject_id` INT NOT NULL COMMENT '科目ID';

-- 7. 更新 order 表：将 course_id 改回 subject_id
ALTER TABLE `order` CHANGE `course_id` `subject_id` INT NOT NULL COMMENT '科目ID';

-- 8. 更新 activation_code 表：将 course_id 改回 subject_id
ALTER TABLE `activation_code` CHANGE `course_id` `subject_id` INT NOT NULL COMMENT '科目ID';

-- 9. 更新 home_recommend_item 表：将 course_id 改回 subject_id
ALTER TABLE `home_recommend_item` CHANGE `course_id` `subject_id` INT NOT NULL COMMENT '科目ID';

-- ============================================
-- 回滚完成
-- ============================================

