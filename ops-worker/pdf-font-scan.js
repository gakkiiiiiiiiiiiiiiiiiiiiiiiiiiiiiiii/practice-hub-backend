const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const OSS = require('ali-oss');
const { loadEnv, required } = require('./env');

const execFileAsync = promisify(execFile);
const env = loadEnv();
const inventoryPath = process.argv[2];
const maxBytes = Math.max(1, Number(process.argv[3] || 10 * 1024 * 1024));
const concurrency = Math.min(16, Math.max(1, Number(process.argv[4] || 6)));
const fontWarningPattern =
  /Missing language pack|Unknown font tag|No font in show/iu;
const incompatibleFontPattern =
  /FzBookMaker|GBK-EUC-H\s+no\s+(?:no|yes)\s+no/iu;

if (!inventoryPath) {
  throw new Error('用法: node pdf-font-scan.js <inventory.json> [maxBytes] [concurrency]');
}

const client = new OSS({
  region: required(env, 'OSS_REGION'),
  accessKeyId: required(env, 'OSS_ACCESS_KEY_ID'),
  accessKeySecret: required(env, 'OSS_ACCESS_KEY_SECRET'),
  bucket: required(env, 'OSS_BUCKET'),
  internal: true,
  timeout: 120_000,
});

function objectKey(fileUrl) {
  const value = String(fileUrl || '').trim();
  if (!value) return '';
  try {
    return decodeURIComponent(new URL(value).pathname.replace(/^\/+/, ''));
  } catch (_) {
    return value.replace(/^\/+/, '');
  }
}

async function inspect(item, rootDir) {
  const key = objectKey(item.fileUrl);
  if (!key) return { outcome: 'skipped', reason: 'missing_key' };
  let head;
  try {
    head = await client.head(key);
  } catch (error) {
    return {
      outcome: 'skipped',
      reason: `oss_head_${error.status || error.code || 'failed'}`,
    };
  }
  const size = Number(head.res?.headers?.['content-length'] || item.fileSize || 0);
  if (size > maxBytes) return { outcome: 'oversize', size };

  const workDir = fs.mkdtempSync(path.join(rootDir, `pdf-${item.fileId}-`));
  const sourcePath = path.join(workDir, 'source.pdf');
  const outputBase = path.join(workDir, 'page');
  try {
    await client.get(key, sourcePath);
    let fontStructureWarning = '';
    try {
      const fonts = await execFileAsync(
        'pdffonts',
        [sourcePath],
        { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
      );
      const fontOutput = `${fonts.stdout || ''}\n${fonts.stderr || ''}`;
      if (incompatibleFontPattern.test(fontOutput)) {
        fontStructureWarning = fontOutput
          .split(/\r?\n/)
          .filter((line) => incompatibleFontPattern.test(line))
          .slice(0, 20)
          .join('\n');
      }
    } catch (_) {
      // 渲染测试会继续检查无法被 pdffonts 解析的文件。
    }
    try {
      const result = await execFileAsync(
        'pdftocairo',
        [
          '-jpeg',
          '-f',
          '1',
          '-l',
          '1',
          '-singlefile',
          '-scale-to',
          '400',
          sourcePath,
          outputBase,
        ],
        { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      );
      const stderr = String(result.stderr || '');
      return {
        outcome:
          fontStructureWarning || fontWarningPattern.test(stderr)
            ? 'suspect'
            : 'ok',
        size,
        warning: (fontStructureWarning || stderr).trim().slice(0, 2_000),
      };
    } catch (error) {
      const stderr = String(error.stderr || error.message || '');
      return {
        outcome:
          fontStructureWarning || fontWarningPattern.test(stderr)
            ? 'suspect'
            : 'render_error',
        size,
        warning: (fontStructureWarning || stderr).trim().slice(0, 2_000),
      };
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function run() {
  const items = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'practice-hub-pdf-scan-'));
  const summary = {
    total: items.length,
    scanned: 0,
    ok: 0,
    suspect: 0,
    renderError: 0,
    oversize: 0,
    skipped: 0,
  };
  let index = 0;
  try {
    const runNext = async () => {
      while (index < items.length) {
        const item = items[index];
        index += 1;
        const result = await inspect(item, rootDir);
        summary.scanned += 1;
        if (result.outcome === 'ok') summary.ok += 1;
        else if (result.outcome === 'suspect') summary.suspect += 1;
        else if (result.outcome === 'render_error') summary.renderError += 1;
        else if (result.outcome === 'oversize') summary.oversize += 1;
        else summary.skipped += 1;

        if (result.outcome === 'suspect' || result.outcome === 'render_error') {
          console.log(JSON.stringify({ ...item, ...result }));
        }
        if (summary.scanned % 100 === 0 || summary.scanned === items.length) {
          console.error(`[扫描进度] ${summary.scanned}/${items.length}`);
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => runNext()));
    console.error(`[扫描完成] ${JSON.stringify(summary)}`);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(`[扫描失败] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
