/**
 * 统计 output/extract.json 题型并打印前几题
 * 运行：npx ts-node -r tsconfig-paths/register src/modules/process-pdf/scripts/check-stats.ts
 * 或先 npm run build 后：node dist/modules/process-pdf/scripts/check-stats.js
 */
import * as fs from 'fs';
import * as path from 'path';

const extractFile = path.join(__dirname, '..', 'output', 'extract.json');

try {
  const rawData = fs.readFileSync(extractFile, 'utf-8');
  const data = JSON.parse(rawData) as { type: string }[];
  const types: Record<string, number> = {};
  for (const q of data) {
    types[q.type] = (types[q.type] || 0) + 1;
  }
  console.log(JSON.stringify(types, null, 2));
  console.log('\nFirst 3 questions:');
  for (let i = 0; i < 3 && i < data.length; i++) {
    console.log(JSON.stringify(data[i], null, 2));
  }
} catch (err) {
  console.error('Error reading stats:', err);
}
