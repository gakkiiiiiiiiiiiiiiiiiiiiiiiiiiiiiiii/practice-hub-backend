const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// 检查是否使用远程数据库
const isRemote = process.argv.includes('--remote');

// 加载环境变量
const envPath = path.join(__dirname, '../.env');
const envRemotePath = path.join(__dirname, '../.env.remote');
if (isRemote && fs.existsSync(envRemotePath)) {
	dotenv.config({ path: envRemotePath });
	console.log('✓ 已加载环境变量文件: .env.remote');
} else if (fs.existsSync(envPath)) {
	dotenv.config({ path: envPath });
}

// 从环境变量读取数据库配置
const dbConfig = {
	host: isRemote ? process.env.REMOTE_DB_HOST || process.env.REMOTE_DB_HOSTNAME || 'localhost' : process.env.DB_HOST || process.env.DB_HOSTNAME || 'localhost',
	port: isRemote ? parseInt(process.env.REMOTE_DB_PORT || '3306', 10) : parseInt(process.env.DB_PORT || '3306', 10),
	user: isRemote ? process.env.REMOTE_DB_USER || process.env.REMOTE_DB_USERNAME || 'root' : process.env.DB_USER || process.env.DB_USERNAME || 'root',
	password: isRemote ? process.env.REMOTE_DB_PASSWORD || '' : process.env.DB_PASSWORD || '',
	database: isRemote ? process.env.REMOTE_DB_DATABASE || process.env.REMOTE_DB_NAME || 'practice_hub' : process.env.DB_DATABASE || process.env.DB_NAME || 'practice_hub',
	multipleStatements: true,
};

async function checkColumnExists(connection, tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [dbConfig.database, tableName, columnName]
  );
  return rows[0].count > 0;
}

async function checkIndexExists(connection, tableName, indexName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.STATISTICS 
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [dbConfig.database, tableName, indexName]
  );
  return rows[0].count > 0;
}

async function updateCourseRecommendationStructure() {
  let connection;
  try {
    console.log(`正在连接到 ${isRemote ? '远程' : '本地'}数据库...`);
    connection = await mysql.createConnection(dbConfig);
    console.log('数据库连接成功！');

    // 1. 在 course 表中添加 recommended_course_ids 字段
    const columnExists = await checkColumnExists(connection, 'course', 'recommended_course_ids');
    if (!columnExists) {
      console.log('正在添加 recommended_course_ids 字段到 course 表...');
      await connection.query(`
        ALTER TABLE \`course\` 
        ADD COLUMN \`recommended_course_ids\` json DEFAULT NULL COMMENT '推荐课程ID列表（JSON数组）' AFTER \`introduction\`
      `);
      console.log('✓ recommended_course_ids 字段添加成功');
    } else {
      console.log('✓ recommended_course_ids 字段已存在，跳过');
    }

    // 2. 检查并删除 course_recommendation 表中的索引和字段
    const ukExists = await checkIndexExists(connection, 'course_recommendation', 'uk_course_id');
    if (ukExists) {
      console.log('正在删除 uk_course_id 唯一索引...');
      await connection.query(`ALTER TABLE \`course_recommendation\` DROP INDEX \`uk_course_id\``);
      console.log('✓ uk_course_id 索引删除成功');
    } else {
      console.log('✓ uk_course_id 索引不存在，跳过');
    }

    const idxExists = await checkIndexExists(connection, 'course_recommendation', 'idx_course_id');
    if (idxExists) {
      console.log('正在删除 idx_course_id 索引...');
      await connection.query(`ALTER TABLE \`course_recommendation\` DROP INDEX \`idx_course_id\``);
      console.log('✓ idx_course_id 索引删除成功');
    } else {
      console.log('✓ idx_course_id 索引不存在，跳过');
    }

    const courseIdColumnExists = await checkColumnExists(connection, 'course_recommendation', 'course_id');
    if (courseIdColumnExists) {
      console.log('正在删除 course_id 字段...');
      await connection.query(`ALTER TABLE \`course_recommendation\` DROP COLUMN \`course_id\``);
      console.log('✓ course_id 字段删除成功');
    } else {
      console.log('✓ course_id 字段不存在，跳过');
    }

    // 3. 清空 course_recommendation 表（因为结构改变了）
    console.log('正在清空 course_recommendation 表...');
    await connection.query(`TRUNCATE TABLE \`course_recommendation\``);
    console.log('✓ course_recommendation 表已清空');

    // 4. 创建默认的公共配置数据（空数组）
    console.log('正在创建默认的公共配置数据...');
    const [result] = await connection.query(
      `INSERT INTO \`course_recommendation\` (\`recommended_course_ids\`, \`create_time\`, \`update_time\`) 
       VALUES (?, NOW(), NOW())`,
      [JSON.stringify([])]
    );
    console.log('✓ 默认公共配置数据创建成功');

    console.log('\n✅ 所有操作完成！');
    console.log('\n结构变更说明：');
    console.log('1. course 表已添加 recommended_course_ids 字段（用于存储课程级别的推荐配置）');
    console.log('2. course_recommendation 表已移除 course_id 字段（现在只用于存储公共配置）');
    console.log('3. 已创建默认的公共配置数据（空数组）');
  } catch (error) {
    console.error('❌ 执行失败:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n数据库连接已关闭');
    }
  }
}

// 执行迁移
updateCourseRecommendationStructure();
