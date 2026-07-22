#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const ROOT_DIR = path.resolve(__dirname, '..');

function loadRemoteEnvironment() {
  const envPath = path.join(ROOT_DIR, '.env.remote');
  if (!fs.existsSync(envPath)) {
    throw new Error('未找到 .env.remote');
  }
  return { ...dotenv.parse(fs.readFileSync(envPath)), ...process.env };
}

function required(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) throw new Error(`缺少环境变量 ${key}`);
  return value;
}

function parseDefaultParams(currentValue) {
  const fallback = {
    subject: '',
    school: '',
    major: '',
    exam_year: '',
    answer_year: '',
    price: 1,
    agent_price: 1,
    is_free: 0,
    validity_days: null,
    allow_source_file: 0,
    trial_preview_page_count: 3,
    content_type: 'normal',
    status: 0,
  };
  if (!currentValue) return fallback;
  try {
    return { ...fallback, ...JSON.parse(currentValue) };
  } catch (error) {
    throw new Error(`线上 course_default_params 不是合法 JSON: ${error.message}`);
  }
}

function buildDefaultParams(currentValue) {
  return { ...parseDefaultParams(currentValue), validity_days: null };
}

function createBackup(courses, systemConfig, database) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const exportDir = path.join(ROOT_DIR, 'exports');
  const backupPath = path.join(exportDir, `paid-course-validity-backup-${timestamp}.json`);
  fs.mkdirSync(exportDir, { recursive: true });
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        database,
        course_count: courses.length,
        courses,
        course_default_params: systemConfig || null,
      },
      null,
      2,
    ),
    'utf8',
  );
  return backupPath;
}

async function getAuditData(connection) {
  const [courses] = await connection.query(
    `SELECT id, name, price, is_free, status, validity_days
       FROM course
      WHERE is_free = 0
      ORDER BY id ASC`,
  );
  const [configRows] = await connection.query(
    `SELECT id, config_key, config_value, description, create_time, update_time
       FROM system_config
      WHERE config_key = 'course_default_params'
      LIMIT 1`,
  );
  return { courses, systemConfig: configRows[0] || null };
}

async function main() {
  const env = loadRemoteEnvironment();
  const database = required(env, 'REMOTE_DB_DATABASE');
  const connection = await mysql.createConnection({
    host: required(env, 'REMOTE_DB_HOST'),
    port: Number(env.REMOTE_DB_PORT || 3306),
    user: required(env, 'REMOTE_DB_USERNAME'),
    password: required(env, 'REMOTE_DB_PASSWORD'),
    database,
    charset: 'utf8mb4',
  });

  try {
    const { courses, systemConfig } = await getAuditData(connection);
    const needsUpdate = courses.filter((course) => course.validity_days !== null);
    console.table([
      {
        database,
        paid_courses: courses.length,
        already_permanent: courses.length - needsUpdate.length,
        needs_update: needsUpdate.length,
      },
    ]);
    console.log(
      `线上默认有效期: ${parseDefaultParams(systemConfig?.config_value).validity_days === null ? '长期有效' : '非长期有效'}`,
    );

    if (!APPLY) {
      console.log('当前为只读审计；确认后使用 --apply 执行备份和事务更新。');
      return;
    }

    const backupPath = createBackup(courses, systemConfig, database);
    const nextConfig = buildDefaultParams(systemConfig?.config_value);
    await connection.beginTransaction();
    try {
      const [updateResult] = await connection.query(
        `UPDATE course
            SET validity_days = NULL
          WHERE is_free = 0
            AND validity_days IS NOT NULL`,
      );
      await connection.query(
        `INSERT INTO system_config (config_key, config_value, description, create_time, update_time)
         VALUES ('course_default_params', ?, '新增课程默认参数', NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           config_value = VALUES(config_value),
           description = VALUES(description),
           update_time = NOW()`,
        [JSON.stringify(nextConfig)],
      );

      const [[remainingRow]] = await connection.query(
        `SELECT COUNT(*) AS count
           FROM course
          WHERE is_free = 0
            AND validity_days IS NOT NULL`,
      );
      const [[savedConfig]] = await connection.query(
        `SELECT config_value
           FROM system_config
          WHERE config_key = 'course_default_params'
          LIMIT 1`,
      );
      const remaining = Number(remainingRow?.count || 0);
      const savedDefaults = parseDefaultParams(savedConfig?.config_value);
      if (remaining !== 0 || savedDefaults.validity_days !== null) {
        throw new Error(`事务校验失败：剩余非长期付费课程 ${remaining} 个`);
      }

      await connection.commit();
      console.log(`已更新 ${Number(updateResult.affectedRows || 0)} 个付费课程为长期有效。`);
      console.log('线上新增课程默认有效期已设置为长期有效。');
      console.log(`修改前备份：${backupPath}`);
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`付费课程有效期迁移失败: ${error.message}`);
  process.exit(1);
});
