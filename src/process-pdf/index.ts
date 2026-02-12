/**
 * PDF 题目提取入口：委托 src/modules/process-pdf 核心，供 CLI 脚本使用
 */
export { extractQuestions as extractQuestionsFromPdf } from '../modules/process-pdf/core/extract-questions';
