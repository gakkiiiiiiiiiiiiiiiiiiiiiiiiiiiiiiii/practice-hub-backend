/**
 * 将远程数据库导入到本地数据库
 *
 * 使用方法：
 * 1. 配置 .env.remote（远程库）和 .env / .env.local（本地库）
 * 2. npm run import:from-remote
 *
 * 环境变量：
 * 远程（数据源）：REMOTE_DB_HOST, REMOTE_DB_PORT, REMOTE_DB_USERNAME, REMOTE_DB_PASSWORD, REMOTE_DB_DATABASE
 * 本地（目标）：DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE
 */

import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';

const dotenv = require('dotenv');
const envPath = path.resolve(__dirname, '../.env');
const envLocalPath = path.resolve(__dirname, '../.env.local');
const envRemotePath = path.resolve(__dirname, '../.env.remote');

if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
if (fs.existsSync(envLocalPath)) dotenv.config({ path: envLocalPath, override: true });
if (fs.existsSync(envRemotePath)) {
	dotenv.config({ path: envRemotePath, override: true });
	console.log('✓ 已加载 .env.remote');
}

// 表列表（按外键依赖顺序）；若远程无某表会跳过结构导出，不影响其他表
const TABLES = [
	'sys_user',
	'role',
	'role_permission',
	'app_user',
	'course',
	'course_category',
	'chapter',
	'question',
	'user_course_auth',
	'activation_code',
	'order',
	'order_after_sale',
	'user_answer_log',
	'user_wrong_book',
	'user_collection',
	'user_note',
	'user_checkin',
	'sys_operation_log',
	'home_recommend_category',
	'home_recommend_item',
	'feedback',
	'distributor',
	'distribution_relation',
	'distribution_config',
	'distribution_order',
	'banner',
	'page_route',
	'exam_config',
	'exam_record',
	'system_config',
	'course_recommendation',
];

function escapeSqlString(value: any): string {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'boolean') return value ? '1' : '0';
	if (typeof value === 'number') return String(value);
	if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
	if (typeof value === 'object') value = JSON.stringify(value);
	else value = String(value);
	value = value.replace(/\\/g, '\\\\').replace(/'/g, "''");
	return `'${value}'`;
}

async function exportTableStructure(dataSource: DataSource, tableName: string): Promise<string> {
	try {
		const createTable = await dataSource.query(`SHOW CREATE TABLE \`${tableName}\``);
		if (createTable.length === 0) return '';
		return createTable[0]['Create Table'] + ';\n\n';
	} catch (e: any) {
		console.error(`  获取表结构失败: ${tableName}`, e.message);
		return '';
	}
}

async function exportTableData(dataSource: DataSource, tableName: string): Promise<string> {
	try {
		const rows = await dataSource.query(`SELECT * FROM \`${tableName}\``);
		if (rows.length === 0) return `-- 表 ${tableName} 无数据\n\n`;
		const columns = await dataSource.query(
			`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
			[tableName]
		);
		const columnNames = columns.map((c: any) => c.COLUMN_NAME);
		const inserts: string[] = [];
		inserts.push(`-- ${tableName} (${rows.length} 条)`);
		const batchSize = 1000;
		for (let i = 0; i < rows.length; i += batchSize) {
			const batch = rows.slice(i, i + batchSize);
			const values = batch.map((row: any) => {
				const rowValues = columnNames.map((col: string) => escapeSqlString(row[col]));
				return `(${rowValues.join(', ')})`;
			});
			inserts.push(`INSERT INTO \`${tableName}\` (\`${columnNames.join('`, `')}\`) VALUES\n${values.join(',\n')};`);
			inserts.push('');
		}
		return inserts.join('\n') + '\n';
	} catch (e: any) {
		console.error(`  导出数据失败: ${tableName}`, e.message);
		return `-- ${tableName} 导出失败\n\n`;
	}
}

async function generateSQLFile(dataSource: DataSource, outputFile: string): Promise<void> {
	const sql: string[] = [];
	sql.push('-- 从远程数据库导出');
	sql.push(`-- ${new Date().toISOString()}`);
	sql.push('');
	sql.push('SET FOREIGN_KEY_CHECKS=0;');
	sql.push('SET NAMES utf8mb4;');
	sql.push('');
	for (const tableName of TABLES) {
		console.log(`  导出表: ${tableName}...`);
		const structure = await exportTableStructure(dataSource, tableName);
		if (!structure) {
			sql.push(`-- 表 ${tableName} 在远程不存在，跳过\n`);
			continue;
		}
		sql.push(`DROP TABLE IF EXISTS \`${tableName}\`;`);
		sql.push(structure);
		sql.push(await exportTableData(dataSource, tableName));
	}
	sql.push('SET FOREIGN_KEY_CHECKS=1;');
	fs.writeFileSync(outputFile, sql.join('\n'), 'utf8');
	console.log(`  ✓ SQL 已写入: ${outputFile}\n`);
}

async function runSqlOnLocal(sqlFile: string, localConfig: { host: string; port: number; username: string; password: string; database: string }): Promise<void> {
	console.log('正在导入到本地数据库...\n');
	const localDataSource = new DataSource({
		type: 'mysql',
		host: localConfig.host,
		port: localConfig.port,
		username: localConfig.username,
		password: localConfig.password,
		database: localConfig.database,
		synchronize: false,
		logging: false,
		extra: { multipleStatements: true },
	});
	await localDataSource.initialize();
	try {
		await localDataSource.query('SET FOREIGN_KEY_CHECKS=0;');
		const content = fs.readFileSync(sqlFile, 'utf8');
		await localDataSource.query(content);
		await localDataSource.query('SET FOREIGN_KEY_CHECKS=1;');
		console.log('  执行完成\n');
	} catch (e: any) {
		await localDataSource.query('SET FOREIGN_KEY_CHECKS=1;').catch(() => {});
		throw e;
	} finally {
		await localDataSource.destroy();
	}
}

/** 清理孤立外键引用（子表引用不存在的主表 id），避免应用启动时 ADD CONSTRAINT 报错 */
async function cleanOrphanedRows(localConfig: { host: string; port: number; username: string; password: string; database: string }): Promise<void> {
	const ds = new DataSource({
		type: 'mysql',
		host: localConfig.host,
		port: localConfig.port,
		username: localConfig.username,
		password: localConfig.password,
		database: localConfig.database,
		synchronize: false,
		logging: false,
	});
	await ds.initialize();
	const cleanups: [string, string][] = [
		['activation_code', 'course_id'],
		['chapter', 'course_id'],
		['user_course_auth', 'course_id'],
		['order', 'course_id'],
		['user_wrong_book', 'course_id'],
		['home_recommend_item', 'course_id'],
		['question', 'chapter_id'],
		['user_answer_log', 'question_id'],
		['user_wrong_book', 'question_id'],
		['user_collection', 'question_id'],
		['home_recommend_item', 'category_id'],
		['sys_operation_log', 'admin_id'],
	];
	console.log('清理孤立外键引用...');
	const parentTableMap: Record<string, string> = {
		course_id: 'course',
		chapter_id: 'chapter',
		question_id: 'question',
		category_id: 'home_recommend_category',
		admin_id: 'sys_user',
	};
	for (const [table, fkCol] of cleanups) {
		const parentTable = parentTableMap[fkCol];
		if (!parentTable) continue;
		try {
			const raw = await ds.query(
				`DELETE t FROM \`${table}\` t LEFT JOIN \`${parentTable}\` p ON t.\`${fkCol}\` = p.id WHERE t.\`${fkCol}\` IS NOT NULL AND p.id IS NULL`
			);
			const affected = (Array.isArray(raw) ? (raw[0] as any)?.affectedRows : (raw as any)?.affectedRows) ?? 0;
			if (affected > 0) console.log(`  ${table}.${fkCol}: 删除 ${affected} 条`);
		} catch (e: any) {
			if (!e.message?.includes("doesn't exist")) console.warn(`  ${table}.${fkCol}: ${e.message?.slice(0, 50)}`);
		}
	}
	await ds.destroy();
	console.log('  清理完成\n');
}

async function main() {
	const remoteConfig = {
		host: process.env.REMOTE_DB_HOST || '',
		port: parseInt(process.env.REMOTE_DB_PORT || '3306', 10),
		username: process.env.REMOTE_DB_USERNAME || '',
		password: process.env.REMOTE_DB_PASSWORD || '',
		database: process.env.REMOTE_DB_DATABASE || 'practice_hub',
	};
	const localConfig = {
		host: process.env.DB_HOST || 'localhost',
		port: parseInt(process.env.DB_PORT || '3306', 10),
		username: process.env.DB_USERNAME || 'root',
		password: process.env.DB_PASSWORD || '',
		database: process.env.DB_DATABASE || 'practice_hub',
	};

	if (!remoteConfig.host || !remoteConfig.username || !remoteConfig.password) {
		console.error('错误: 缺少远程数据库配置');
		console.error('请配置 .env.remote 或环境变量: REMOTE_DB_HOST, REMOTE_DB_USERNAME, REMOTE_DB_PASSWORD');
		process.exit(1);
	}

	console.log('========================================');
	console.log('远程数据库 → 本地数据库');
	console.log('========================================\n');
	console.log('远程(源):', `${remoteConfig.host}:${remoteConfig.port}/${remoteConfig.database}`);
	console.log('本地(目标):', `${localConfig.host}:${localConfig.port}/${localConfig.database}`);
	console.log('');

	const exportsDir = path.resolve(__dirname, '../exports');
	if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
	const tempSql = path.join(exportsDir, 'remote_to_local.sql');

	const remoteDataSource = new DataSource({
		type: 'mysql',
		host: remoteConfig.host,
		port: remoteConfig.port,
		username: remoteConfig.username,
		password: remoteConfig.password,
		database: remoteConfig.database,
		synchronize: false,
		logging: false,
	});

	try {
		console.log('连接远程数据库并导出...');
		await remoteDataSource.initialize();
		await generateSQLFile(remoteDataSource, tempSql);
		await remoteDataSource.destroy();
		await runSqlOnLocal(tempSql, localConfig);
		await cleanOrphanedRows(localConfig);
		console.log('========================================');
		console.log('✓ 导入完成');
		console.log('========================================');
	} catch (e: any) {
		console.error('失败:', e.message);
		process.exit(1);
	}
}

main();
