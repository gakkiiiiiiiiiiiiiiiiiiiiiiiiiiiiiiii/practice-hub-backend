-- 创建模拟考试相关表

-- 1. 考试配置表
CREATE TABLE IF NOT EXISTS `exam_config` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `course_id` INT NOT NULL COMMENT '课程ID',
    `name` VARCHAR(200) NOT NULL COMMENT '考试名称',
    `question_count` INT NOT NULL COMMENT '题目数量',
    `duration` INT NOT NULL COMMENT '考试时长（分钟）',
    `single_choice_score` DECIMAL(5, 2) NOT NULL COMMENT '单选题每题分数',
    `single_choice_count` INT NOT NULL COMMENT '单选题数量',
    `multiple_choice_score` DECIMAL(5, 2) NOT NULL COMMENT '多选题每题分数',
    `multiple_choice_count` INT NOT NULL COMMENT '多选题数量',
    `judge_score` DECIMAL(5, 2) NOT NULL COMMENT '判断题每题分数',
    `judge_count` INT NOT NULL COMMENT '判断题数量',
    `full_score` DECIMAL(5, 2) NOT NULL COMMENT '满分',
    `pass_score` DECIMAL(5, 2) NOT NULL COMMENT '及格分',
    `rules` TEXT NULL COMMENT '考试规则说明',
    `is_enabled` TINYINT NOT NULL DEFAULT 1 COMMENT '是否启用：0-禁用, 1-启用',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_course_id` (`course_id`),
    INDEX `idx_is_enabled` (`is_enabled`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '考试配置表';

-- 2. 考试记录表
CREATE TABLE IF NOT EXISTS `exam_record` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `user_id` INT NOT NULL COMMENT '用户ID',
    `exam_config_id` INT NOT NULL COMMENT '考试配置ID',
    `exam_name` VARCHAR(200) NOT NULL COMMENT '考试名称',
    `question_ids` JSON NOT NULL COMMENT '题目ID列表（按顺序）',
    `user_answers` JSON NOT NULL COMMENT '用户答案 { questionId: answer }',
    `question_scores` JSON NOT NULL COMMENT '题目得分 { questionId: score }',
    `total_score` DECIMAL(5, 2) NOT NULL COMMENT '总分',
    `correct_count` INT NOT NULL COMMENT '答对题目数',
    `accuracy` DECIMAL(5, 2) NOT NULL COMMENT '正确率（百分比）',
    `is_passed` TINYINT NOT NULL COMMENT '是否及格：0-不及格, 1-及格',
    `duration_seconds` INT NOT NULL COMMENT '考试用时（秒）',
    `start_time` DATETIME NOT NULL COMMENT '开始时间',
    `submit_time` DATETIME NOT NULL COMMENT '提交时间',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_user_exam` (`user_id`, `exam_config_id`),
    INDEX `idx_user_time` (`user_id`, `create_time`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '考试记录表';