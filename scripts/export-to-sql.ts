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
 * 转义SQL字符串
 */
function escapeSqlString(value: any): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (value instanceof Date) {
    return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
  }

  if (typeof value === 'object') {
    value = JSON.stringify(value);
  } else {
    value = String(value);
  }

  // 转义单引号和反斜杠
  value = value.replace(/\\/g, '\\\\').replace(/'/g, "''");
  return `'${value}'`;
}

/**
 * 导出表结构
 */
async function exportTableStructure(dataSource: DataSource, tableName: string): Promise<string> {
  const createTable = await dataSource.query(`SHOW CREATE TABLE \`${tableName}\``);
  if (createTable.length === 0) {
    return '';
  }
  return createTable[0]['Create Table'] + ';\n\n';
}

/**
 * 导出表数据为INSERT语句
 */
async function exportTableData(dataSource: DataSource, tableName: string): Promise<string> {
  const rows = await dataSource.query(`SELECT * FROM \`${tableName}\``);
  
  if (rows.length === 0) {
    return `-- 表 ${tableName} 没有数据\n\n`;
  }

  // 获取列名
  const columns = await dataSource.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION
  `, [tableName]);

  const columnNames = columns.map((col: any) => col.COLUMN_NAME);

  // 生成INSERT语句
  const inserts: string[] = [];
  inserts.push(`-- 表 ${tableName} 的数据 (${rows.length} 条记录)`);
  inserts.push(`INSERT INTO \`${tableName}\` (\`${columnNames.join('`, `')}\`) VALUES`);

  const values: string[] = [];
  for (const row of rows) {
    const rowValues = columnNames.map((colName) => {
      let value = row[colName];
      
      // 处理JSON字段
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        value = JSON.stringify(value);
      }
      
      return escapeSqlString(value);
    });
    values.push(`(${rowValues.join(', ')})`);
  }

  // 每1000条记录一个INSERT语句（避免SQL语句过长）
  const batchSize = 1000;
  const sqlParts: string[] = [];
  
  for (let i = 0; i < values.length; i += batchSize) {
    const batch = values.slice(i, i + batchSize);
    sqlParts.push(`INSERT INTO \`${tableName}\` (\`${columnNames.join('`, `')}\`) VALUES`);
    sqlParts.push(batch.join(',\n') + ';');
    sqlParts.push('');
  }

  return sqlParts.join('\n') + '\n';
}

/**
 * 导出所有表为SQL文件
 */
async function exportToSQL(): Promise<void> {
  const outputDir = path.resolve(__dirname, '../exports');
  const sqlFile = path.join(outputDir, 'database_export.sql');

  // 创建导出目录
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`SQL 文件: ${sqlFile}\n`);

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

  const sqlContent: string[] = [];

  try {
    // SQL文件头部
    sqlContent.push('-- 数据库导出SQL文件');
    sqlContent.push(`-- 导出时间: ${new Date().toLocaleString('zh-CN')}`);
    sqlContent.push(`-- 数据库: ${process.env.DB_DATABASE || 'practice_hub'}`);
    sqlContent.push('');
    sqlContent.push('SET FOREIGN_KEY_CHECKS=0;');
    sqlContent.push('SET NAMES utf8mb4;');
    sqlContent.push('SET sql_mode = \'NO_AUTO_VALUE_ON_ZERO\';');
    sqlContent.push('');

    // 导出每个表
    for (const tableName of TABLES) {
      console.log(`正在导出表: ${tableName}...`);

      try {
        // 导出表结构
        const structure = await exportTableStructure(dataSource, tableName);
        if (structure) {
          sqlContent.push(`-- ===========================================`);
          sqlContent.push(`-- 表结构: ${tableName}`);
          sqlContent.push(`-- ===========================================`);
          sqlContent.push('DROP TABLE IF EXISTS `' + tableName + '`;');
          sqlContent.push(structure);
        }

        // 导出表数据
        const data = await exportTableData(dataSource, tableName);
        sqlContent.push(data);

        console.log(`  ✓ 表 ${tableName} 导出完成`);
      } catch (error: any) {
        console.error(`  ✗ 表 ${tableName} 导出失败:`, error.message);
        sqlContent.push(`-- 表 ${tableName} 导出失败: ${error.message}\n`);
      }
    }

    // SQL文件尾部
    sqlContent.push('SET FOREIGN_KEY_CHECKS=1;');

    // 写入文件
    fs.writeFileSync(sqlFile, sqlContent.join('\n'), 'utf8');

    const fileSize = (fs.statSync(sqlFile).size / 1024 / 1024).toFixed(2);
    console.log(`\n✓ SQL文件已生成: ${sqlFile} (${fileSize} MB)`);
  } finally {
    await dataSource.destroy();
  }
}

// 执行导出
exportToSQL()
  .then(() => {
    console.log('\nSQL导出脚本执行完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nSQL导出失败:', error);
    process.exit(1);
  });

