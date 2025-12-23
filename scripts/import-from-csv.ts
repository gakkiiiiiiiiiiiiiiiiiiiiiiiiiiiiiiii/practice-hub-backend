import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
// 简单的CSV解析（不依赖外部库）
function parseCSV(content: string): any[] {
	const lines = content.split('\n').filter((line) => line.trim());
	if (lines.length === 0) return [];

	// 解析表头
	const headers = parseCSVLine(lines[0]);
	const records: any[] = [];

	// 解析数据行
	for (let i = 1; i < lines.length; i++) {
		const values = parseCSVLine(lines[i]);
		const record: any = {};
		headers.forEach((header, index) => {
			record[header] = values[index] || '';
		});
		records.push(record);
	}

	return records;
}

function parseCSVLine(line: string): string[] {
	const values: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];

		if (char === '"') {
			if (inQuotes && line[i + 1] === '"') {
				current += '"';
				i++; // 跳过下一个引号
			} else {
				inQuotes = !inQuotes;
			}
		} else if (char === ',' && !inQuotes) {
			values.push(current.trim());
			current = '';
		} else {
			current += char;
		}
	}

	values.push(current.trim());
	return values;
}

// 加载环境变量
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// 数据库表列表（按依赖顺序）
const TABLES = [
	'sys_user',
	'app_user',
	'subject',
	'chapter',
	'question',
	'user_subject_auth',
	'activation_code',
	'order',
	'user_answer_log',
	'user_wrong_book',
	'user_collection',
	'sys_operation_log',
	'home_recommend_category',
	'home_recommend_item',
];

/**
 * 解析CSV值（处理JSON、日期等）
 */
function parseCsvValue(value: string, dataType: string): any {
	if (!value || value === '') {
		return null;
	}

	// 尝试解析JSON
	if (value.startsWith('[') || value.startsWith('{')) {
		try {
			return JSON.parse(value);
		} catch (e) {
			// 解析失败，返回原值
		}
	}

	// 处理数字类型
	if (dataType === 'int' || dataType === 'bigint' || dataType === 'tinyint') {
		const num = parseInt(value, 10);
		return isNaN(num) ? null : num;
	}

	if (dataType === 'decimal' || dataType === 'float' || dataType === 'double') {
		const num = parseFloat(value);
		return isNaN(num) ? null : num;
	}

	// 处理日期时间
	if (dataType === 'datetime' || dataType === 'timestamp') {
		if (value && value !== '') {
			return new Date(value);
		}
		return null;
	}

	// 处理布尔值
	if (dataType === 'tinyint' && (value === '0' || value === '1')) {
		return value === '1';
	}

	return value;
}

/**
 * 从CSV文件导入单个表
 */
async function importTable(
	dataSource: DataSource,
	tableName: string,
	csvFilePath: string,
	skipErrors: boolean = true
): Promise<void> {
	console.log(`正在导入表: ${tableName}...`);

	if (!fs.existsSync(csvFilePath)) {
		console.log(`  ⚠ CSV 文件不存在: ${csvFilePath}，跳过`);
		return;
	}

	try {
		// 读取CSV文件
		const csvContent = fs.readFileSync(csvFilePath, 'utf8');
		const records = parseCSV(csvContent);

		if (records.length === 0) {
			console.log(`  ⚠ CSV 文件为空，跳过`);
			return;
		}

		// 获取表结构
		const columns: Array<{
			COLUMN_NAME: string;
			DATA_TYPE: string;
			IS_NULLABLE: string;
			COLUMN_DEFAULT: any;
		}> = await dataSource.query(
			`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `,
			[tableName]
		);

		if (columns.length === 0) {
			console.log(`  ⚠ 表 ${tableName} 不存在，跳过`);
			return;
		}

		const columnMap = new Map(columns.map((col) => [col.COLUMN_NAME.toLowerCase(), col]));

		// 清空表（可选，根据需求决定）
		const clearTable = process.env.CLEAR_TABLE === 'true';
		if (clearTable) {
			await dataSource.query(`TRUNCATE TABLE \`${tableName}\``);
			console.log(`  ✓ 已清空表 ${tableName}`);
		}

		// 准备插入数据
		let successCount = 0;
		let errorCount = 0;

		for (const record of records) {
			try {
				// 构建字段和值
				const fields: string[] = [];
				const values: any[] = [];
				const placeholders: string[] = [];

				for (const [key, value] of Object.entries(record)) {
					const col = columnMap.get(key.toLowerCase());
					if (!col) {
						continue; // 跳过不存在的字段
					}

					const parsedValue = parseCsvValue(value as string, col.DATA_TYPE);

					// 处理NULL值
					if (parsedValue === null && col.IS_NULLABLE === 'NO' && !col.COLUMN_DEFAULT) {
						// 必填字段且无默认值，跳过这条记录或使用默认值
						if (col.COLUMN_DEFAULT !== null) {
							continue;
						}
					}

					fields.push(`\`${col.COLUMN_NAME}\``);
					values.push(parsedValue);
					placeholders.push('?');
				}

				if (fields.length === 0) {
					continue;
				}

				// 执行插入
				const sql = `INSERT INTO \`${tableName}\` (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`;
				await dataSource.query(sql, values);

				successCount++;
			} catch (error: any) {
				errorCount++;
				if (skipErrors) {
					console.error(`  ⚠ 插入记录失败: ${error.message}`);
				} else {
					throw error;
				}
			}
		}

		console.log(`  ✓ 成功导入 ${successCount} 条记录${errorCount > 0 ? `，失败 ${errorCount} 条` : ''}`);
	} catch (error: any) {
		console.error(`  ✗ 导入表 ${tableName} 失败:`, error.message);
		if (!skipErrors) {
			throw error;
		}
	}
}

/**
 * 从CSV目录导入所有表
 */
async function importAllTables(
	csvDir: string,
	targetDbConfig?: {
		host: string;
		port: number;
		username: string;
		password: string;
		database: string;
	}
): Promise<void> {
	console.log(`CSV 目录: ${csvDir}\n`);

	if (!fs.existsSync(csvDir)) {
		console.error(`错误: CSV 目录不存在: ${csvDir}`);
		process.exit(1);
	}

	// 使用目标数据库配置或环境变量
	const dbConfig = targetDbConfig || {
		host: process.env.TARGET_DB_HOST || process.env.DB_HOST || 'localhost',
		port: parseInt(process.env.TARGET_DB_PORT || process.env.DB_PORT || '3306', 10),
		username: process.env.TARGET_DB_USERNAME || process.env.DB_USERNAME || 'root',
		password: process.env.TARGET_DB_PASSWORD || process.env.DB_PASSWORD || '',
		database: process.env.TARGET_DB_DATABASE || process.env.DB_DATABASE || 'practice_hub',
	};

	console.log(`目标数据库: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
	console.log(`用户: ${dbConfig.username}\n`);

	// 创建数据库连接
	const dataSource = new DataSource({
		type: 'mysql',
		host: dbConfig.host,
		port: dbConfig.port,
		username: dbConfig.username,
		password: dbConfig.password,
		database: dbConfig.database,
		entities: [__dirname + '/../src/**/*.entity{.ts,.js}'],
		synchronize: false, // 不自动同步，手动导入
		logging: false,
	});

	await dataSource.initialize();
	console.log('数据库连接成功\n');

	try {
		// 导入每个表
		for (const tableName of TABLES) {
			const csvFilePath = path.join(csvDir, `${tableName}.csv`);
			await importTable(dataSource, tableName, csvFilePath);
		}

		console.log('\n✓ 所有表导入完成！');
	} finally {
		await dataSource.destroy();
	}
}

// 命令行参数处理
const args = process.argv.slice(2);
const csvDir = args[0] || path.resolve(__dirname, '../exports');
const skipErrors = !args.includes('--strict');

// 执行导入
importAllTables(csvDir)
	.then(() => {
		console.log('\n导入脚本执行完成');
		process.exit(0);
	})
	.catch((error) => {
		console.error('\n导入失败:', error);
		process.exit(1);
	});
