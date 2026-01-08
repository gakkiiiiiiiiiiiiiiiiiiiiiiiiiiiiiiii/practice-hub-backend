# 模拟考试功能说明

## 功能概述

模拟考试功能允许管理员为每个课程配置考试规则，用户可以在小程序端进行模拟考试，系统会自动评分并记录考试历史。

## 数据库表结构

### 1. exam_config（考试配置表）
- `id`: 主键
- `course_id`: 课程ID
- `name`: 考试名称
- `question_count`: 题目数量（自动计算）
- `duration`: 考试时长（分钟）
- `single_choice_score`: 单选题每题分数
- `single_choice_count`: 单选题数量
- `multiple_choice_score`: 多选题每题分数
- `multiple_choice_count`: 多选题数量
- `judge_score`: 判断题每题分数
- `judge_count`: 判断题数量
- `full_score`: 满分（自动计算）
- `pass_score`: 及格分
- `rules`: 考试规则说明
- `is_enabled`: 是否启用（0-禁用, 1-启用）

### 2. exam_record（考试记录表）
- `id`: 主键
- `user_id`: 用户ID
- `exam_config_id`: 考试配置ID
- `exam_name`: 考试名称
- `question_ids`: 题目ID列表（JSON）
- `user_answers`: 用户答案（JSON）
- `question_scores`: 题目得分（JSON）
- `total_score`: 总分
- `correct_count`: 答对题目数
- `accuracy`: 正确率（百分比）
- `is_passed`: 是否及格（0-不及格, 1-及格）
- `duration_seconds`: 考试用时（秒）
- `start_time`: 开始时间
- `submit_time`: 提交时间

## 数据库迁移

### 本地数据库
```bash
npm run migrate:exam
```

### 远程数据库
```bash
npm run migrate:exam:remote
```

## API接口

### 管理端接口（需要管理员权限）

1. **获取考试配置列表**
   - `GET /admin/exam/config/list?courseId={courseId}`
   - 可选参数：courseId（课程ID）

2. **获取考试配置详情**
   - `GET /admin/exam/config/{id}`

3. **创建考试配置**
   - `POST /admin/exam/config`
   - 请求体：CreateExamConfigDto

4. **更新考试配置**
   - `PUT /admin/exam/config/{id}`
   - 请求体：CreateExamConfigDto

5. **删除考试配置**
   - `DELETE /admin/exam/config/{id}`

### 小程序端接口（需要用户登录）

1. **获取课程的考试配置列表**
   - `GET /app/exam/config/{courseId}`

2. **获取考试配置详情**
   - `GET /app/exam/config/detail/{id}`

3. **开始考试**
   - `POST /app/exam/start`
   - 请求体：`{ exam_config_id: number }`
   - 返回：题目列表、考试配置信息

4. **提交考试**
   - `POST /app/exam/submit`
   - 请求体：`{ exam_config_id: number, user_answers: Object, start_time: string }`
   - 返回：考试结果（总分、正确率等）

5. **获取考试记录列表**
   - `GET /app/exam/records?examConfigId={examConfigId}`
   - 可选参数：examConfigId（考试配置ID）

6. **获取考试记录详情**
   - `GET /app/exam/records/{id}`

## 前端页面

### 管理端
- `/system/exam` - 考试管理页面
  - 考试配置列表
  - 创建/编辑考试配置
  - 删除考试配置

### 小程序端
- `/pages/exam/info` - 考试信息页面
  - 显示考试规则、题目数量、时长等
  - 开始考试按钮
  - 查看考试记录按钮

- `/pages/answer/index?mode=exam` - 答题页面（考试模式）
  - 显示倒计时
  - 交卷按钮（代替收藏按钮）
  - 时间到自动交卷

- `/pages/exam/result` - 考试结果页面
  - 显示总分、正确率、用时等
  - 查看详情按钮
  - 再次考试按钮

- `/pages/exam/records` - 考试记录列表页面
  - 显示历史考试记录

## 业务流程

1. **管理员配置考试**
   - 在管理端创建考试配置
   - 设置题目数量、分数、时长等

2. **用户开始考试**
   - 用户在小程序端选择考试
   - 查看考试信息
   - 点击"开始答题"
   - 系统随机抽取题目

3. **用户答题**
   - 在答题页面答题
   - 显示倒计时
   - 可以提前交卷或时间到自动交卷

4. **提交考试**
   - 系统自动评分
   - 保存考试记录
   - 跳转到结果页面

5. **查看结果**
   - 显示总分、正确率、用时等
   - 可以查看详情或再次考试

## 注意事项

1. **题目类型限制**
   - 考试只包含选择题（单选、多选）和判断题
   - 不包含填空题、简答题、阅读理解等

2. **题目数量检查**
   - 开始考试时会检查题库中是否有足够的题目
   - 如果题目数量不足，会提示错误

3. **时间管理**
   - 考试开始后开始倒计时
   - 时间到自动交卷
   - 可以提前交卷

4. **答案格式**
   - 单选题：`['A']`
   - 多选题：`['A', 'B']`
   - 判断题：`['A']` 或 `['B']`

5. **评分规则**
   - 单选题和判断题：完全匹配才得分
   - 多选题：答案数量和内容都完全匹配才得分

## 后续优化建议

1. 添加考试详情页面，显示每道题的答案和解析
2. 添加考试排行榜功能
3. 添加考试统计分析（平均分、通过率等）
4. 支持自定义考试规则（如允许查看解析、允许返回修改等）
5. 添加考试提醒功能
