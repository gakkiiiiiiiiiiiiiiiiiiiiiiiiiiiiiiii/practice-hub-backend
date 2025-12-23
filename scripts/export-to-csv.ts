import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';

// 加载环境变量
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// 数据库表列表
const TABLES = [
  'sys_user',
  'app_user',
  'subject',
  'chapter',
  'question',
  'user_answer_log',
  'user_wrong_book',
  'user_collection',
  'user_subject_auth',
  'activation_code',
  'order',
  'sys_operation_log',
  'home_recommend_category',
  'home_recommend_item',
];

/**
 * 将值转换为CSV格式（处理特殊字符）
 */
function escapeCsvValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }

  // 如果是对象或数组，转换为JSON字符串
  if (typeof value === 'object') {
    value = JSON.stringify(value);
  } else {
    value = String(value);
  }

  // 如果包含逗号、引号或换行符，需要用引号包裹并转义引号
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    value = `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

/**
 * 导出单个表为CSV
 */
async function exportTable(dataSource: DataSource, tableName: string, outputDir: string): Promise<void> {
  console.log(`正在导出表: ${tableName}...`);

  try {
    // 查询表结构
    const columns = await dataSource.query(`
      SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `, [tableName]);

    if (columns.length === 0) {
      console.log(`  表 ${tableName} 不存在或为空，跳过`);
      return;
    }

    const columnNames = columns.map((col: any) => col.COLUMN_NAME);

    // 查询数据
    const rows = await dataSource.query(`SELECT * FROM \`${tableName}\``);

    if (rows.length === 0) {
      console.log(`  表 ${tableName} 没有数据，创建空文件`);
    }

    // 创建CSV内容
    const csvLines: string[] = [];

    // 添加表头
    csvLines.push(columnNames.map(escapeCsvValue).join(','));

    // 添加数据行
    for (const row of rows) {
      const values = columnNames.map((colName) => {
        let value = row[colName];

        // 处理JSON字段
        if (value && typeof value === 'object') {
          value = JSON.stringify(value);
        }

        // 处理日期
        if (value instanceof Date) {
          value = value.toISOString().replace('T', ' ').substring(0, 19);
        }

        return escapeCsvValue(value);
      });
      csvLines.push(values.join(','));
    }

    // 写入文件
    const filePath = path.join(outputDir, `${tableName}.csv`);
    fs.writeFileSync(filePath, csvLines.join('\n'), 'utf8');

    console.log(`  ✓ 已导出 ${rows.length} 条记录到 ${filePath}`);
  } catch (error) {
    console.error(`  ✗ 导出表 ${tableName} 失败:`, error.message);
  }
}

/**
 * 导出所有表
 */
async function exportAllTables(): Promise<void> {
  const outputDir = path.resolve(__dirname, '../exports');
  
  // 创建导出目录
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`导出目录: ${outputDir}\n`);

  // 创建数据库连接
  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'practice_hub',
    entities: [__dirname + '/../src/**/*.entity{.ts,.js}'],
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();
  console.log('数据库连接成功\n');

  try {
    // 导出每个表
    for (const tableName of TABLES) {
      await exportTable(dataSource, tableName, outputDir);
    }

    // 生成导出摘要
    const summaryPath = path.join(outputDir, 'export_summary.txt');
    const summary = [
      `数据库导出摘要`,
      `================`,
      `导出时间: ${new Date().toLocaleString('zh-CN')}`,
      `数据库: ${process.env.DB_DATABASE || 'practice_hub'}`,
      `导出目录: ${outputDir}`,
      ``,
      `已导出表:`,
      ...TABLES.map((table) => {
        const filePath = path.join(outputDir, `${table}.csv`);
        const exists = fs.existsSync(filePath);
        const size = exists ? fs.statSync(filePath).size : 0;
        const rowCount = exists
          ? fs.readFileSync(filePath, 'utf8').split('\n').length - 1
          : 0;
        return `  - ${table}.csv (${rowCount} 行, ${(size / 1024).toFixed(2)} KB)`;
      }),
    ].join('\n');

    fs.writeFileSync(summaryPath, summary, 'utf8');
    console.log(`\n导出摘要已保存到: ${summaryPath}`);

    console.log('\n✓ 所有表导出完成！');
  } finally {
    await dataSource.destroy();
  }
}

// 执行导出
exportAllTables()
  .then(() => {
    console.log('\n导出脚本执行完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n导出失败:', error);
    process.exit(1);
  });

