const fs = require('fs');

function loadEnv(filePath = process.env.WORKER_ENV_FILE || '/etc/practice-hub-worker.env') {
  if (!fs.existsSync(filePath)) return process.env;
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
    values[key] = value;
  }
  return { ...values, ...process.env };
}

function required(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) throw new Error(`缺少环境变量 ${key}`);
  return value;
}

module.exports = { loadEnv, required };
