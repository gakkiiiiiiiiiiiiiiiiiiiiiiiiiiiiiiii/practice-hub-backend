-- ============================================
-- 数据库迁移脚本：将 subject 重构为 course
-- 执行前请务必备份数据库！
-- ============================================

-- 1. 重命名表 subject 为 course
ALTER TABLE `subject` RENAME TO `course`;

-- 2. 添加新字段到 course 表
ALTER TABLE `course` 
  ADD COLUMN `subject` VARCHAR(100) NULL COMMENT '科目（如：数学、英语、政治等）' AFTER `name`,
  ADD COLUMN `school` VARCHAR(100) NULL COMMENT '学校（如：北京大学、清华大学等）' AFTER `subject`,
  ADD COLUMN `major` VARCHAR(100) NULL COMMENT '专业（如：计算机科学与技术、软件工程等）' AFTER `school`,
  ADD COLUMN `exam_year` VARCHAR(20) NULL COMMENT '真题年份（如：2024、2023等）' AFTER `major`,
  ADD COLUMN `answer_year` VARCHAR(20) NULL COMMENT '答案年份（如：2024、2023等）' AFTER `exam_year`;

-- 3. 更新 chapter 表：将 subject_id 改为 course_id
ALTER TABLE `chapter` CHANGE `subject_id` `course_id` INT NOT NULL COMMENT '课程ID';

-- 4. 重命名表 user_subject_auth 为 user_course_auth
ALTER TABLE `user_subject_auth` RENAME TO `user_course_auth`;

-- 5. 更新 user_course_auth 表：将 subject_id 改为 course_id
ALTER TABLE `user_course_auth` CHANGE `subject_id` `course_id` INT NOT NULL COMMENT '课程ID';

-- 6. 更新 user_wrong_book 表：将 subject_id 改为 course_id
ALTER TABLE `user_wrong_book` CHANGE `subject_id` `course_id` INT NOT NULL COMMENT '课程ID';

-- 7. 更新 order 表：将 subject_id 改为 course_id
ALTER TABLE `order` CHANGE `subject_id` `course_id` INT NOT NULL COMMENT '课程ID';

-- 8. 更新 activation_code 表：将 subject_id 改为 course_id
ALTER TABLE `activation_code` CHANGE `subject_id` `course_id` INT NOT NULL COMMENT '课程ID';

-- 9. 更新 home_recommend_item 表：将 subject_id 改为 course_id
ALTER TABLE `home_recommend_item` CHANGE `subject_id` `course_id` INT NOT NULL COMMENT '课程ID';

-- ============================================
-- 迁移完成
-- ============================================

