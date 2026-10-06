-- 支持课程填写多个年份或年份区间，避免超过旧 VARCHAR(20) 限制。
ALTER TABLE `course`
  MODIFY COLUMN `exam_year` VARCHAR(100) NULL COMMENT '真题年份（支持多个年份或年份区间）',
  MODIFY COLUMN `answer_year` VARCHAR(100) NULL COMMENT '答案年份（支持多个年份或年份区间）';
