/**
 * 快速导入数据库到外网服务器
 *
 * 使用方法：
 * 1. 设置环境变量或命令行参数
 * 2. npm run import:remote
 *
 * 环境变量：
 * REMOTE_DB_HOST=外网数据库地址
 * REMOTE_DB_PORT=3306
 * REMOTE_DB_USERNAME=用户名
 * REMOTE_DB_PASSWORD=密码
 * REMOTE_DB_DATABASE=practice_hub
 *
 * 或使用命令行参数：
 * npm run import:remote -- --host=xxx --port=3306 --user=xxx --password=xxx --database=xxx
 */

import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { execSync } from 'child_process';

// 加载环境变量（支持多个文件，使用 require 方式兼容性更好）
const dotenv = require('dotenv');
const envPath = path.resolve(__dirname, '../.env');
const envLocalPath = path.resolve(__dirname, '../.env.local');
const envRemotePath = path.resolve(__dirname, '../.env.remote');

// 按优先级加载：系统环境变量 > .env.remote > .env.local > .env
// 先加载 .env（基础配置）
if (fs.existsSync(envPath)) {
	const result = dotenv.config({ path: envPath });
	if (result.error) {
		console.warn(`警告: 加载 .env 文件失败: ${result.error.message}`);
	}
}

// 再加载 .env.local（本地覆盖）
if (fs.existsSync(envLocalPath)) {
	const result = dotenv.config({ path: envLocalPath, override: true });
	if (result.error) {
		console.warn(`警告: 加载 .env.local 文件失败: ${result.error.message}`);
	}
}

// 最后加载 .env.remote（远程配置，优先级最高）
if (fs.existsSync(envRemotePath)) {
	const result = dotenv.config({ path: envRemotePath, override: true });
	if (result.error) {
		console.warn(`警告: 加载 .env.remote 文件失败: ${result.error.message}`);
	} else {
		console.log('✓ 已加载环境变量文件: .env.remote');
	}
}

// 解析命令行参数
function parseArgs() {
	const args = process.argv.slice(2);
	const config: any = {};

	args.forEach((arg) => {
		if (arg.startsWith('--')) {
			const [key, value] = arg.substring(2).split('=');
			config[key] = value;
		}
	});

	return config;
}

// 数据库表列表（按依赖顺序）
const TABLES = [
	'sys_user',
	'app_user',
	'course', // 从 subject 改为 course
	'chapter',
	'question',
	'user_course_auth', // 从 user_subject_auth 改为 user_course_auth
	'activation_code',
	'order',
	'user_answer_log',
	'user_wrong_book',
	'user_collection',
	'sys_operation_log',
	'home_recommend_category',
	'home_recommend_item',
	'feedback', // 反馈表
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
	try {
		const createTable = await dataSource.query(`SHOW CREATE TABLE \`${tableName}\``);
		if (createTable.length === 0) {
			return '';
		}
		return createTable[0]['Create Table'] + ';\n\n';
	} catch (error: any) {
		console.error(`  获取表结构失败: ${error.message}`);
		return '';
	}
}

/**
 * 导出表数据为INSERT语句
 */
async function exportTableData(dataSource: DataSource, tableName: string): Promise<string> {
	try {
		const rows = await dataSource.query(`SELECT * FROM \`${tableName}\``);

		if (rows.length === 0) {
			return `-- 表 ${tableName} 没有数据\n\n`;
		}

		// 获取列名
		const columns = await dataSource.query(
			`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `,
			[tableName]
		);

		const columnNames = columns.map((col: any) => col.COLUMN_NAME);

		// 生成INSERT语句
		const inserts: string[] = [];
		inserts.push(`-- 表 ${tableName} 的数据 (${rows.length} 条记录)`);

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

		// 每1000条记录一个INSERT语句
		const batchSize = 1000;
		const sqlParts: string[] = [];

		for (let i = 0; i < values.length; i += batchSize) {
			const batch = values.slice(i, i + batchSize);
			sqlParts.push(`INSERT INTO \`${tableName}\` (\`${columnNames.join('`, `')}\`) VALUES`);
			sqlParts.push(batch.join(',\n') + ';');
			sqlParts.push('');
		}

		return sqlParts.join('\n') + '\n';
	} catch (error: any) {
		console.error(`  导出数据失败: ${error.message}`);
		return `-- 表 ${tableName} 导出失败: ${error.message}\n\n`;
	}
}

/**
 * 生成SQL文件
 */
async function generateSQLFile(localDataSource: DataSource, outputFile: string): Promise<void> {
	console.log('正在生成 SQL 文件...\n');

	const sqlContent: string[] = [];

	// SQL文件头部
	sqlContent.push('-- 数据库导出SQL文件');
	sqlContent.push(`-- 导出时间: ${new Date().toLocaleString('zh-CN')}`);
	sqlContent.push(`-- 数据库: ${process.env.DB_DATABASE || 'practice_hub'}`);
	sqlContent.push('');
	sqlContent.push('SET FOREIGN_KEY_CHECKS=0;');
	sqlContent.push('SET NAMES utf8mb4;');
	sqlContent.push("SET sql_mode = 'NO_AUTO_VALUE_ON_ZERO';");
	sqlContent.push('');

	// 导出每个表
	for (const tableName of TABLES) {
		console.log(`正在导出表: ${tableName}...`);

		try {
			// 导出表结构
			const structure = await exportTableStructure(localDataSource, tableName);
			if (structure) {
				sqlContent.push(`-- ===========================================`);
				sqlContent.push(`-- 表结构: ${tableName}`);
				sqlContent.push(`-- ===========================================`);
				sqlContent.push('DROP TABLE IF EXISTS `' + tableName + '`;');
				sqlContent.push(structure);
			}

			// 导出表数据
			const data = await exportTableData(localDataSource, tableName);
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
	fs.writeFileSync(outputFile, sqlContent.join('\n'), 'utf8');
	const fileSize = (fs.statSync(outputFile).size / 1024 / 1024).toFixed(2);
	console.log(`\n✓ SQL文件已生成: ${outputFile} (${fileSize} MB)\n`);
}

/**
 * 使用 mysql 命令行导入
 */
async function importWithMySQL(
	sqlFile: string,
	remoteConfig: {
		host: string;
		port: number;
		username: string;
		password: string;
		database: string;
	}
): Promise<void> {
	console.log('正在导入到外网数据库...\n');
	console.log(`数据库地址: ${remoteConfig.host}:${remoteConfig.port}`);
	console.log(`数据库名: ${remoteConfig.database}`);
	console.log(`用户: ${remoteConfig.username}\n`);

	try {
		// 构建 mysql 命令
		const mysqlCmd = `mysql -h ${remoteConfig.host} -P ${remoteConfig.port} -u ${remoteConfig.username} -p${remoteConfig.password} ${remoteConfig.database}`;

		console.log('执行导入命令...');
		execSync(`cat "${sqlFile}" | ${mysqlCmd}`, {
			stdio: 'inherit',
			shell: '/bin/bash',
		});

		console.log('\n✓ 导入成功！');
	} catch (error: any) {
		console.error('\n✗ 导入失败:', error.message);
		throw error;
	}
}

/**
 * 检查并修复远程数据库结构
 */
async function checkAndFixRemoteDatabase(remoteDataSource: DataSource): Promise<void> {
	console.log('检查远程数据库结构...\n');

	try {
		// 检查表是否存在
		const tables = await remoteDataSource.query('SHOW TABLES');
		const tableNames = tables.map((t: any) => Object.values(t)[0]);

		// 检查是否有旧表名
		const hasSubjectTable = tableNames.includes('subject');
		const hasCourseTable = tableNames.includes('course');
		const hasUserSubjectAuth = tableNames.includes('user_subject_auth');
		const hasUserCourseAuth = tableNames.includes('user_course_auth');

		// 检查字段
		const checkColumn = async (table: string, column: string): Promise<boolean> => {
			try {
				const [rows] = await remoteDataSource.query(
					`SELECT COUNT(*) as count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
					[table, column]
				);
				return rows[0].count > 0;
			} catch {
				return false;
			}
		};

		let needsMigration = false;

		// 检查需要迁移的表
		const tablesToCheck = [
			{ table: 'chapter', oldCol: 'subject_id', newCol: 'course_id' },
			{ table: 'user_wrong_book', oldCol: 'subject_id', newCol: 'course_id' },
			{ table: 'order', oldCol: 'subject_id', newCol: 'course_id' },
			{ table: 'activation_code', oldCol: 'subject_id', newCol: 'course_id' },
			{ table: 'home_recommend_item', oldCol: 'subject_id', newCol: 'course_id' },
		];

		for (const { table, oldCol, newCol } of tablesToCheck) {
			if (tableNames.includes(table)) {
				const hasOldCol = await checkColumn(table, oldCol);
				const hasNewCol = await checkColumn(table, newCol);

				if (hasOldCol && !hasNewCol) {
					console.log(`  ⚠️  ${table} 表需要迁移: ${oldCol} -> ${newCol}`);
					needsMigration = true;
				}
			}
		}

		if (hasSubjectTable && !hasCourseTable) {
			console.log('  ⚠️  需要将 subject 表重命名为 course');
			needsMigration = true;
		}

		if (hasUserSubjectAuth && !hasUserCourseAuth) {
			console.log('  ⚠️  需要将 user_subject_auth 表重命名为 user_course_auth');
			needsMigration = true;
		}

		if (needsMigration) {
			console.log('\n⚠️  远程数据库需要先执行迁移！');
			console.log('   请在远程数据库上执行以下命令之一：');
			console.log('   1. npm run migrate (如果远程服务器有代码)');
			console.log('   2. 手动执行 migrations/migrate_subject_to_course.sql');
			console.log('   3. 使用智能迁移脚本: node scripts/smart-migration.js\n');
			console.log('   或者，你可以先导入数据，然后手动执行迁移。\n');
		} else {
			console.log('  ✅ 远程数据库结构检查通过\n');
		}
	} catch (error: any) {
		console.warn(`  检查数据库结构时出错: ${error.message}`);
		console.warn('  将继续尝试导入...\n');
	}
}

/**
 * 使用 TypeORM 直接导入
 */
async function importWithTypeORM(
	sqlFile: string,
	remoteConfig: {
		host: string;
		port: number;
		username: string;
		password: string;
		database: string;
	}
): Promise<void> {
	console.log('正在导入到外网数据库...\n');
	console.log(`数据库地址: ${remoteConfig.host}:${remoteConfig.port}`);
	console.log(`数据库名: ${remoteConfig.database}`);
	console.log(`用户: ${remoteConfig.username}\n`);

	// 创建远程数据库连接
	const remoteDataSource = new DataSource({
		type: 'mysql',
		host: remoteConfig.host,
		port: remoteConfig.port,
		username: remoteConfig.username,
		password: remoteConfig.password,
		database: remoteConfig.database,
		entities: [__dirname + '/../src/**/*.entity{.ts,.js}'],
		synchronize: false,
		logging: false,
	});

	await remoteDataSource.initialize();
	console.log('远程数据库连接成功\n');

	// 检查并提示迁移
	await checkAndFixRemoteDatabase(remoteDataSource);

	try {
		// 读取SQL文件
		const sqlContent = fs.readFileSync(sqlFile, 'utf8');

		// 分割SQL语句（按分号分割，但要注意字符串中的分号）
		const statements = sqlContent
			.split(';')
			.map((s) => s.trim())
			.filter((s) => s && !s.startsWith('--') && s.length > 0);

		let successCount = 0;
		let errorCount = 0;

		for (const statement of statements) {
			try {
				await remoteDataSource.query(statement);
				successCount++;
			} catch (error: any) {
				errorCount++;
				// 忽略一些常见的错误（如表已存在等）
				const errorMsg = error.message || '';
				const shouldIgnore =
					errorMsg.includes('already exists') ||
					errorMsg.includes('Duplicate entry') ||
					(errorMsg.includes('Unknown column') && errorMsg.includes('course_id')); // 如果是 course_id 字段错误，可能是数据库结构问题

				if (!shouldIgnore) {
					console.error(`执行SQL失败: ${errorMsg.substring(0, 100)}`);
				} else if (errorMsg.includes('Unknown column') && errorMsg.includes('course_id')) {
					console.warn(`  ⚠️  跳过（数据库结构问题，需要先执行迁移）: ${errorMsg.substring(0, 80)}`);
				}
			}
		}

		console.log(`\n✓ 导入完成！成功: ${successCount} 条，失败: ${errorCount} 条`);
	} finally {
		await remoteDataSource.destroy();
	}
}

/**
 * 主函数
 */
async function main() {
	const args = parseArgs();

	// 调试：显示环境变量加载情况
	console.log('环境变量检查:');
	console.log(`  REMOTE_DB_HOST: ${process.env.REMOTE_DB_HOST ? '已设置' : '未设置'}`);
	console.log(`  REMOTE_DB_USERNAME: ${process.env.REMOTE_DB_USERNAME ? '已设置' : '未设置'}`);
	console.log(`  REMOTE_DB_PASSWORD: ${process.env.REMOTE_DB_PASSWORD ? '已设置' : '未设置'}`);
	console.log('');

	// 获取远程数据库配置（命令行参数优先级最高）
	const remoteConfig = {
		host: args.host || process.env.REMOTE_DB_HOST || '',
		port: parseInt(args.port || process.env.REMOTE_DB_PORT || '3306', 10),
		username: args.user || args.username || process.env.REMOTE_DB_USERNAME || '',
		password: args.password || process.env.REMOTE_DB_PASSWORD || '',
		database: args.database || args.db || process.env.REMOTE_DB_DATABASE || 'practice_hub',
	};

	// 验证配置
	if (!remoteConfig.host || !remoteConfig.username || !remoteConfig.password) {
		console.error('错误: 缺少远程数据库配置');
		console.error('\n当前环境变量值:');
		console.error(`  REMOTE_DB_HOST: ${process.env.REMOTE_DB_HOST || '(未设置)'}`);
		console.error(`  REMOTE_DB_PORT: ${process.env.REMOTE_DB_PORT || '(未设置)'}`);
		console.error(`  REMOTE_DB_USERNAME: ${process.env.REMOTE_DB_USERNAME || '(未设置)'}`);
		console.error(`  REMOTE_DB_PASSWORD: ${process.env.REMOTE_DB_PASSWORD ? '***' : '(未设置)'}`);
		console.error(`  REMOTE_DB_DATABASE: ${process.env.REMOTE_DB_DATABASE || '(未设置)'}`);
		console.error('\n请设置以下环境变量或命令行参数:');
		console.error('  方式一：创建 .env.remote 文件（推荐）');
		console.error('    REMOTE_DB_HOST=外网数据库地址');
		console.error('    REMOTE_DB_PORT=3306');
		console.error('    REMOTE_DB_USERNAME=用户名');
		console.error('    REMOTE_DB_PASSWORD=密码');
		console.error('    REMOTE_DB_DATABASE=practice_hub');
		console.error('\n  方式二：在 .env 文件中添加上述变量');
		console.error('\n  方式三：使用命令行参数:');
		console.error('    --host=xxx --port=3306 --user=xxx --password=xxx --database=xxx');
		console.error('\n  方式四：临时设置环境变量:');
		console.error('    REMOTE_DB_HOST=xxx REMOTE_DB_USERNAME=xxx REMOTE_DB_PASSWORD=xxx npm run import:remote');
		process.exit(1);
	}

	// 获取本地数据库配置
	const localConfig = {
		host: process.env.DB_HOST || 'localhost',
		port: parseInt(process.env.DB_PORT || '3306', 10),
		username: process.env.DB_USERNAME || 'root',
		password: process.env.DB_PASSWORD || '',
		database: process.env.DB_DATABASE || 'practice_hub',
	};

	console.log('========================================');
	console.log('数据库导入到外网服务器');
	console.log('========================================\n');
	console.log('本地数据库:', `${localConfig.host}:${localConfig.port}/${localConfig.database}`);
	console.log('远程数据库:', `${remoteConfig.host}:${remoteConfig.port}/${remoteConfig.database}`);
	console.log('');

	// 创建临时SQL文件
	const tempSqlFile = path.resolve(__dirname, '../exports/temp_import.sql');

	// 确保导出目录存在
	const exportsDir = path.dirname(tempSqlFile);
	if (!fs.existsSync(exportsDir)) {
		fs.mkdirSync(exportsDir, { recursive: true });
	}

	try {
		// 连接本地数据库
		console.log('正在连接本地数据库...');
		const localDataSource = new DataSource({
			type: 'mysql',
			host: localConfig.host,
			port: localConfig.port,
			username: localConfig.username,
			password: localConfig.password,
			database: localConfig.database,
			entities: [__dirname + '/../src/**/*.entity{.ts,.js}'],
			synchronize: false,
			logging: false,
		});

		await localDataSource.initialize();
		console.log('本地数据库连接成功\n');

		try {
			// 生成SQL文件
			await generateSQLFile(localDataSource, tempSqlFile);

			// 选择导入方式
			const useMySQL = process.env.USE_MYSQL_CLI === 'true' || args.mysql === 'true';

			if (useMySQL) {
				// 使用 mysql 命令行工具（更快）
				await importWithMySQL(tempSqlFile, remoteConfig);
			} else {
				// 使用 TypeORM（更灵活，不需要 mysql 命令行工具）
				await importWithTypeORM(tempSqlFile, remoteConfig);
			}

			console.log('\n========================================');
			console.log('✓ 导入完成！');
			console.log('========================================');
		} finally {
			await localDataSource.destroy();
		}
	} catch (error: any) {
		console.error('\n✗ 导入失败:', error.message);
		process.exit(1);
	} finally {
		// 清理临时文件（可选）
		if (process.env.KEEP_TEMP_FILE !== 'true' && fs.existsSync(tempSqlFile)) {
			// fs.unlinkSync(tempSqlFile);
			console.log(`\n提示: 临时SQL文件已保存: ${tempSqlFile}`);
		}
	}
}

// 执行
main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.error('执行失败:', error);
		process.exit(1);
	});
