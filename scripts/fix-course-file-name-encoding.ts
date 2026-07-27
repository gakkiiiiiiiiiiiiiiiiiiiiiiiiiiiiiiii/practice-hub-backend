#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import {
  createConnection,
  Connection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { normalizeUploadedFileName } from "../src/common/utils/file-name-encoding";

const APPLY = process.argv.includes("--apply");
const REMOTE = process.argv.includes("--remote");
const ROOT_DIR = path.resolve(__dirname, "..");

type CourseRow = RowDataPacket & {
  id: number;
  name: string;
  file_name: string | null;
};

type CourseFileRow = RowDataPacket & {
  id: number;
  course_id: number;
  display_name: string;
  file_name: string | null;
};

type CourseChange = CourseRow & {
  next_file_name: string;
};

type CourseFileChange = CourseFileRow & {
  next_display_name: string;
  next_file_name: string | null;
};

function loadEnvironment() {
  const envPath = path.join(ROOT_DIR, REMOTE ? ".env.remote" : ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error(`未找到 ${path.basename(envPath)}`);
  }
  return { ...dotenv.parse(fs.readFileSync(envPath)), ...process.env };
}

function required(env: Record<string, string | undefined>, key: string) {
  const value = String(env[key] || "").trim();
  if (!value) throw new Error(`缺少环境变量 ${key}`);
  return value;
}

function getDatabaseOptions(env: Record<string, string | undefined>) {
  const prefix = REMOTE ? "REMOTE_" : "";
  return {
    host: required(env, `${prefix}DB_HOST`),
    port: Number(env[`${prefix}DB_PORT`] || 3306),
    user: required(env, `${prefix}DB_USERNAME`),
    password: required(env, `${prefix}DB_PASSWORD`),
    database: required(env, `${prefix}DB_DATABASE`),
    charset: "utf8mb4",
  };
}

async function collectChanges(connection: Connection) {
  const [courses] = await connection.query<CourseRow[]>(
    `SELECT id, name, file_name
       FROM course
      WHERE file_name IS NOT NULL
        AND file_name <> ''
      ORDER BY id ASC`,
  );
  const [courseFiles] = await connection.query<CourseFileRow[]>(
    `SELECT id, course_id, display_name, file_name
       FROM course_file
      ORDER BY id ASC`,
  );

  const courseChanges: CourseChange[] = courses.flatMap((row) => {
    const nextFileName = normalizeUploadedFileName(row.file_name);
    return nextFileName !== row.file_name
      ? [{ ...row, next_file_name: nextFileName }]
      : [];
  });

  const courseFileChanges: CourseFileChange[] = courseFiles.flatMap((row) => {
    const nextDisplayName = normalizeUploadedFileName(row.display_name);
    const nextFileName =
      row.file_name === null ? null : normalizeUploadedFileName(row.file_name);
    return nextDisplayName !== row.display_name ||
      nextFileName !== row.file_name
      ? [
          {
            ...row,
            next_display_name: nextDisplayName,
            next_file_name: nextFileName,
          },
        ]
      : [];
  });

  return { courseChanges, courseFileChanges };
}

function writeBackup(
  database: string,
  courseChanges: CourseChange[],
  courseFileChanges: CourseFileChange[],
) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const exportDir = path.join(ROOT_DIR, "exports");
  const backupPath = path.join(
    exportDir,
    `course-file-name-encoding-backup-${timestamp}.json`,
  );
  fs.mkdirSync(exportDir, { recursive: true });
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        database,
        course_changes: courseChanges,
        course_file_changes: courseFileChanges,
      },
      null,
      2,
    ),
    "utf8",
  );
  return backupPath;
}

async function applyChanges(
  connection: Connection,
  courseChanges: CourseChange[],
  courseFileChanges: CourseFileChange[],
) {
  for (const row of courseChanges) {
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE course
          SET file_name = ?
        WHERE id = ?
          AND file_name = ?`,
      [row.next_file_name, row.id, row.file_name],
    );
    if (result.affectedRows !== 1) {
      throw new Error(`课程 ${row.id} 在修复过程中发生并发变更`);
    }
  }

  for (const row of courseFileChanges) {
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE course_file
          SET display_name = ?,
              file_name = ?
        WHERE id = ?
          AND display_name = ?
          AND file_name <=> ?`,
      [
        row.next_display_name,
        row.next_file_name,
        row.id,
        row.display_name,
        row.file_name,
      ],
    );
    if (result.affectedRows !== 1) {
      throw new Error(`课程文件 ${row.id} 在修复过程中发生并发变更`);
    }
  }
}

async function verifyChanges(
  connection: Connection,
  courseChanges: CourseChange[],
  courseFileChanges: CourseFileChange[],
) {
  const {
    courseChanges: remainingCourses,
    courseFileChanges: remainingCourseFiles,
  } = await collectChanges(connection);
  const targetCourseIds = new Set(courseChanges.map((row) => row.id));
  const targetCourseFileIds = new Set(courseFileChanges.map((row) => row.id));
  const failedCourses = remainingCourses.filter((row) =>
    targetCourseIds.has(row.id),
  );
  const failedCourseFiles = remainingCourseFiles.filter((row) =>
    targetCourseFileIds.has(row.id),
  );
  if (failedCourses.length || failedCourseFiles.length) {
    throw new Error(
      `事务校验失败：仍有 ${failedCourses.length} 个课程字段和 ${failedCourseFiles.length} 个课程文件字段未修复`,
    );
  }
}

async function main() {
  const env = loadEnvironment();
  const options = getDatabaseOptions(env);
  const connection = await createConnection(options);
  try {
    const { courseChanges, courseFileChanges } =
      await collectChanges(connection);
    console.table([
      {
        target: REMOTE ? "remote" : "local",
        database: options.database,
        course_rows: courseChanges.length,
        course_file_rows: courseFileChanges.length,
      },
    ]);
    console.table(
      courseFileChanges.slice(0, 10).map((row) => ({
        file_id: row.id,
        course_id: row.course_id,
        before: row.display_name.slice(0, 36),
        after: row.next_display_name.slice(0, 36),
      })),
    );

    if (!courseChanges.length && !courseFileChanges.length) {
      console.log("没有发现可安全修复的文件名乱码。");
      return;
    }
    if (!APPLY) {
      console.log(
        "当前为只读审计；确认结果后追加 --apply 执行备份和事务更新。",
      );
      return;
    }

    const backupPath = writeBackup(
      options.database,
      courseChanges,
      courseFileChanges,
    );
    await connection.beginTransaction();
    try {
      await applyChanges(connection, courseChanges, courseFileChanges);
      await verifyChanges(connection, courseChanges, courseFileChanges);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }

    console.log(
      `已修复 ${courseChanges.length} 个课程字段和 ${courseFileChanges.length} 个课程文件记录。`,
    );
    console.log(`修改前备份：${backupPath}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`课程文件名编码修复失败: ${error.message}`);
  process.exit(1);
});
