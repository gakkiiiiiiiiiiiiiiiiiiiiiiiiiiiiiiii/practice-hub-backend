/**
 * PDF 题目提取核心（pdf-parse 本地解析）
 */
import * as fs from 'fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdf = require('pdf-parse');

export interface ExtractedQuestion {
  type: string;
  question: string;
  options: Record<string, string>;
  answer: string;
  explanation: string;
}

/** 获取 PDF 页数（供 OCR 等按页处理使用） */
export async function getPdfPageCount(pdfPath: string): Promise<number> {
  const dataBuffer = fs.readFileSync(pdfPath);
  const data = await pdf(dataBuffer);
  return data.numpages || 0;
}

export async function extractQuestions(pdfPath: string): Promise<ExtractedQuestion[]> {
  const dataBuffer = fs.readFileSync(pdfPath);
  const stats = fs.statSync(pdfPath);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`File size: ${stats.size} bytes`);
  }

  const pages: string[] = [];

  const renderPage = async (pageData: {
    getTextContent: (opts: object) => Promise<{ items: { str: string; transform: number[] }[] }>;
    pageIndex: number;
  }) => {
    const renderOptions = {
      normalizeWhitespace: false,
      disableCombineTextItems: false,
    };
    const textContent = await pageData.getTextContent(renderOptions);
    let lastY: number | undefined;
    let text = '';
    for (const item of textContent.items) {
      const y = item.transform[5];
      if (lastY === y || lastY === undefined) {
        text += item.str;
      } else {
        text += '\n' + item.str;
      }
      lastY = y;
    }
    pages[pageData.pageIndex] = text;
    return text;
  };

  const data = await pdf(dataBuffer, { pagerender: renderPage });
  const totalPages = data.numpages;
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Total pages: ${totalPages}`);
  }

  let allQuestions: ExtractedQuestion[] = [];
  const step = 2;
  const windowSize = 3;

  for (let startPage = 0; startPage < totalPages; startPage += step) {
    const endPage = Math.min(startPage + windowSize, totalPages);
    if (startPage >= totalPages) break;

    let windowText = '';
    for (let i = startPage; i < endPage; i++) {
      if (pages[i]) {
        windowText += '\n' + pages[i];
      }
    }
    const questions = parseTextBlock(windowText);
    allQuestions = allQuestions.concat(questions);
    if (endPage === totalPages) break;
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`Total raw questions found: ${allQuestions.length}`);
  }

  const uniqueQuestions: Record<string, ExtractedQuestion> = {};
  for (const q of allQuestions) {
    const qBody = q.question.replace(/^\d+[.．、]\s*/, '').trim();
    const qKey = qBody.replace(/\s+/g, '');
    if (!qKey) continue;
    if (!uniqueQuestions[qKey]) {
      uniqueQuestions[qKey] = q;
    } else {
      const oldQ = uniqueQuestions[qKey];
      if (!oldQ.explanation && q.explanation) {
        uniqueQuestions[qKey] = q;
      } else if (!oldQ.answer && q.answer) {
        uniqueQuestions[qKey] = q;
      } else if (q.answer && oldQ.answer && q.answer.length > oldQ.answer.length) {
        uniqueQuestions[qKey] = q;
      }
    }
  }
  return Object.values(uniqueQuestions);
}

/**
 * 从纯文本解析题目（与 PDF 解析同一规则：题号、【答案】、【解析】、选项 A-D）
 * 供 Word 解析或 OCR 后的文本使用
 */
export function parseQuestionsFromText(text: string): ExtractedQuestion[] {
  const step = 1;
  const windowSize = 3;
  const lines = text.split(/\n/);
  let allQuestions: ExtractedQuestion[] = [];
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(start + windowSize * 80, lines.length); // 约 80 行一窗
    const windowText = lines.slice(start, end).join('\n');
    const questions = parseTextBlock(windowText);
    allQuestions = allQuestions.concat(questions);
    if (end >= lines.length) break;
  }
  const uniqueQuestions: Record<string, ExtractedQuestion> = {};
  for (const q of allQuestions) {
    const qBody = q.question.replace(/^\d+[.．、]\s*/, '').trim();
    const qKey = qBody.replace(/\s+/g, '');
    if (!qKey) continue;
    if (!uniqueQuestions[qKey]) {
      uniqueQuestions[qKey] = q;
    } else {
      const oldQ = uniqueQuestions[qKey];
      if (!oldQ.explanation && q.explanation) uniqueQuestions[qKey] = q;
      else if (!oldQ.answer && q.answer) uniqueQuestions[qKey] = q;
      else if (q.answer && oldQ.answer && q.answer.length > oldQ.answer.length) uniqueQuestions[qKey] = q;
    }
  }
  return Object.values(uniqueQuestions);
}

function parseTextBlock(text: string): ExtractedQuestion[] {
  const parts = text.split(/\n\s*(\d+[.．、])/g);
  const parsed: ExtractedQuestion[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const numberStr = parts[i];
    const contentStr = parts[i + 1] || '';
    const fullQBlock = numberStr + contentStr;
    const qData = extractComponents(fullQBlock);
    if (qData) parsed.push(qData);
  }
  return parsed;
}

/** 去除 OCR 模型可能输出的定位 token，避免出现在题干/选项/答案中 */
function stripLocTokens(s: string): string {
  return s.replace(/<\|LOC_\d+\|>/g, '').trim();
}

function extractComponents(block: string): ExtractedQuestion | null {
  block = stripLocTokens(block);
  const answerMatch = block.match(/【答案】([\s\S]*?)(?=【解析】|$)/);
  if (!answerMatch) return null;

  let answer = stripLocTokens(answerMatch[1]);
  const explanationMatch = block.match(/【解析】([\s\S]*?)$/);
  const explanation = explanationMatch ? stripLocTokens(explanationMatch[1]) : '';

  let endIdx = block.length;
  if (answerMatch.index !== undefined) endIdx = Math.min(endIdx, answerMatch.index);
  if (explanationMatch?.index !== undefined) endIdx = Math.min(endIdx, explanationMatch.index);

  const questionAndOptions = block.substring(0, endIdx).trim();
  const options: Record<string, string> = {};
  const optPattern = /\n\s*([A-D])[.．、]\s*/g;
  const optMatches: { key: string; index: number; endIndex: number }[] = [];
  let match;
  while ((match = optPattern.exec(questionAndOptions)) !== null) {
    optMatches.push({
      key: match[1],
      index: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  let questionText = '';
  if (optMatches.length > 0) {
    questionText = stripLocTokens(questionAndOptions.substring(0, optMatches[0].index));
    for (let j = 0; j < optMatches.length; j++) {
      const current = optMatches[j];
      const next = optMatches[j + 1];
      const start = current.endIndex;
      const end = next ? next.index : questionAndOptions.length;
      options[current.key] = stripLocTokens(questionAndOptions.substring(start, end));
    }
  } else {
    questionText = stripLocTokens(questionAndOptions);
  }

  if (!questionText || !answer) return null;

  let qType = '简答';
  const hasOptions = Object.keys(options).length > 0;

  if (hasOptions) {
    const ansClean = answer.toUpperCase().replace(/[^A-D]/g, '');
    const ansUnique = [...new Set(ansClean.split(''))].filter(Boolean).join(',');
    if (ansUnique.length === 1) {
      qType = Object.keys(options).length === 2 ? '判断' : '单选';
    } else if (ansUnique.length > 1) {
      qType = '多选';
    } else {
      qType = '单选';
    }
    if (['单选', '多选', '判断'].includes(qType) && ansUnique) {
      answer = ansUnique;
    }
  } else {
    if (/____|（）|\(\)/.test(questionText)) qType = '填空';
    if (/阅读下列材料|结合材料/.test(questionText)) qType = '阅读理解';
  }

  return { type: qType, question: questionText, options, answer, explanation };
}
