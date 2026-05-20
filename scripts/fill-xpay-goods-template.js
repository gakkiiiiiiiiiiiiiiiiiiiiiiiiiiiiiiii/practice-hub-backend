/**
 * 按微信虚拟支付 Excel 批量导入模板填表（不推荐，易踩校验规则）。
 * 模板「道具价格」单位为「元」整数；接口上传请用 scripts/upload-xpay-goods.js（价格为「分」）。
 * 微信后台单次批量导入上限 200 条，超出会自动拆成多个 xls（part01、part02…）。
 *
 * 用法：
 *   node scripts/fill-xpay-goods-template.js --remote
 *   node scripts/fill-xpay-goods-template.js --remote --output=test-files/xpay-goods-filled.xls
 *   node scripts/fill-xpay-goods-template.js --remote --batch-size=200
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const mysql = require('mysql2/promise');

const DEFAULT_TEMPLATE = path.join(
	__dirname,
	'../test-files/WL4AnS7O0RpEJNI6PAI0i_lE5XkTaVl7eietFZuLjkQEOgj_XGEOyrbjiXsr2oegDlqQQ7HVV6YcE5Ne3ZW4hA.xls',
);
const DEFAULT_OUTPUT = path.join(__dirname, '../test-files/xpay-goods-import-filled.xls');

/** 微信虚拟支付后台批量导入单次上限 */
const WECHAT_BATCH_IMPORT_MAX = 200;

/** 模板说明：道具名称不超过 10 个字，备注不超过 50 字节；价格为元（整数） */
const EXCEL_NAME_MAX_CHARS = 10;
/** 批量导入备注按 UTF-8 字节计（与 xpay API 一致，中文约 16 字） */
const EXCEL_REMARK_MAX_BYTES = 50;
/** 与微信官方模板示例一致：激活码名称用两个空格再接「激活码」 */
const EXCEL_ACTIVATION_SUFFIX = '  激活码';

function loadEnv() {
	const dotenv = require('dotenv');
	const root = path.resolve(__dirname, '..');
	for (const file of ['.env', '.env.pay']) {
		const filePath = path.join(root, file);
		if (fs.existsSync(filePath)) {
			dotenv.config({ path: filePath, override: true });
		}
	}
	if (process.argv.includes('--remote')) {
		const remotePath = path.join(root, '.env.remote');
		if (fs.existsSync(remotePath)) {
			dotenv.config({ path: remotePath, override: true });
			console.log('✓ 已加载 .env.remote');
		}
	}
}

function getArg(name, fallback = '') {
	const prefix = `--${name}=`;
	const arg = process.argv.find((item) => item.startsWith(prefix));
	return arg ? arg.slice(prefix.length) : fallback;
}

function truncateChars(value, maxChars) {
	const text = String(value || '').trim();
	return [...text].slice(0, maxChars).join('');
}

function truncateUtf8Bytes(value, maxBytes) {
	const text = String(value || '').trim();
	if (!text || maxBytes <= 0) {
		return '';
	}
	let used = 0;
	let result = '';
	for (const char of text) {
		const size = Buffer.byteLength(char, 'utf8');
		if (used + size > maxBytes) {
			break;
		}
		used += size;
		result += char;
	}
	return result || text.slice(0, 1);
}

function sanitizeNameSource(value) {
	return String(value || '')
		.trim()
		.replace(/\s+/g, ' ');
}

/** 截断后《》不配对会被微信判为参数有误，去掉残留书名号 */
function stripUnbalancedBookQuotes(text) {
	const open = (text.match(/《/g) || []).length;
	const close = (text.match(/》/g) || []).length;
	if (open !== close) {
		return text.replace(/[《》]/g, '');
	}
	return text;
}

function finalizeExcelGoodsName(value) {
	return stripUnbalancedBookQuotes(truncateChars(sanitizeNameSource(value), EXCEL_NAME_MAX_CHARS));
}

/**
 * 名称加课程 id 前缀保证 10 字内唯一；激活码行使用「  激活码」双空格（与官方模板一致）
 */
function buildExcelGoodsName(courseName, courseId, kind = 'course') {
	const clean = stripUnbalancedBookQuotes(sanitizeNameSource(courseName));
	const idPrefix = `${courseId}·`;
	const idPrefixLen = [...idPrefix].length;

	if (kind === 'activation') {
		const suffix = EXCEL_ACTIVATION_SUFFIX;
		const suffixLen = [...suffix].length;
		const maxBase = Math.max(1, EXCEL_NAME_MAX_CHARS - idPrefixLen - suffixLen);
		const base = truncateChars(clean, maxBase);
		return finalizeExcelGoodsName(`${idPrefix}${base}${suffix}`);
	}

	const maxBase = Math.max(1, EXCEL_NAME_MAX_CHARS - idPrefixLen);
	const base = truncateChars(clean, maxBase);
	return finalizeExcelGoodsName(`${idPrefix}${base}`);
}

function sanitizeRemarkSource(value) {
	return String(value || '')
		.trim()
		.replace(/【/g, '[')
		.replace(/】/g, ']')
		.replace(/＋/g, '+');
}

function buildExcelRemark(prefix, courseName) {
	const label = `${prefix}：`;
	const labelBytes = Buffer.byteLength(label, 'utf8');
	const maxNameBytes = Math.max(1, EXCEL_REMARK_MAX_BYTES - labelBytes);
	const namePart = truncateUtf8Bytes(sanitizeRemarkSource(courseName), maxNameBytes);
	return truncateUtf8Bytes(`${label}${namePart}`, EXCEL_REMARK_MAX_BYTES);
}

function resolveDefaultItemUrl() {
	const bucket = process.env.COS_BUCKET || '';
	const configured =
		process.env.WECHAT_VIRTUAL_PAY_DEFAULT_ITEM_URL ||
		(bucket ? `https://${bucket}.tcb.qcloud.la/images/virtual-pay-goods-cover.png` : '');
	const value = String(configured || '').trim();
	if (!value) {
		throw new Error('请配置 WECHAT_VIRTUAL_PAY_DEFAULT_ITEM_URL 或 COS_BUCKET');
	}
	try {
		const url = new URL(value);
		url.search = '';
		return url.toString();
	} catch {
		return value.split('?')[0];
	}
}

/** Excel 批量模板：道具价格为「元」的整数（0.5 元 → 1，9.99 元 → 10） */
function toPriceInYuan(yuanPrice) {
	const yuan = Number(yuanPrice || 0);
	if (!Number.isFinite(yuan) || yuan <= 0) {
		return 1;
	}
	return Math.min(10000, Math.max(1, Math.round(yuan)));
}

async function getCourses(dbConfig) {
	const conn = await mysql.createConnection(dbConfig);
	try {
		const [rows] = await conn.query(`
			SELECT id, name, price, agent_price
			FROM course
			WHERE status = 1
			  AND is_free = 0
			  AND price > 0
			ORDER BY id ASC
		`);
		return rows;
	} finally {
		await conn.end();
	}
}

function buildRows(courses, itemUrl) {
	const rows = [];
	for (const course of courses) {
		const courseName = String(course.name || `课程${course.id}`);
		rows.push({
			id: `course_${course.id}`,
			name: buildExcelGoodsName(courseName, course.id, 'course'),
			image: itemUrl,
			price: toPriceInYuan(course.price),
			remark: buildExcelRemark('课程', courseName),
		});
		rows.push({
			id: `activation_code_${course.id}`,
			name: buildExcelGoodsName(courseName, course.id, 'activation'),
			image: itemUrl,
			price: toPriceInYuan(course.agent_price || course.price),
			remark: buildExcelRemark('激活码', courseName),
		});
	}
	return rows;
}

function chunkRows(rows, batchSize) {
	const size = Math.max(1, Math.min(WECHAT_BATCH_IMPORT_MAX, Number(batchSize) || WECHAT_BATCH_IMPORT_MAX));
	const chunks = [];
	for (let i = 0; i < rows.length; i += size) {
		chunks.push(rows.slice(i, i + size));
	}
	return chunks;
}

function resolveBatchOutputPath(baseOutput, partIndex, partCount) {
	if (partCount <= 1) {
		return baseOutput;
	}
	const ext = path.extname(baseOutput);
	const base = path.basename(baseOutput, ext);
	const dir = path.dirname(baseOutput);
	return path.join(dir, `${base}-part${String(partIndex + 1).padStart(2, '0')}${ext}`);
}

async function loadTemplateHeader(templatePath) {
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.readFile(templatePath);
	const sheet = workbook.worksheets[0];
	if (!sheet) {
		throw new Error('模板中未找到工作表');
	}
	const header = [];
	sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
		header[colNumber] = cell.value;
	});
	return { sheetName: sheet.name || 'Sheet1', header };
}

/** 仅复制表头并写入本批数据，避免在已填满的模板上 splice 失败导致残留行 */
async function writeBatchWorkbook(templateMeta, outputPath, goodsRows) {
	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet(templateMeta.sheetName);
	templateMeta.header.forEach((value, colNumber) => {
		if (colNumber > 0 && value !== undefined && value !== null) {
			sheet.getRow(1).getCell(colNumber).value = value;
		}
	});

	goodsRows.forEach((item, index) => {
		const row = sheet.getRow(index + 2);
		row.getCell(1).value = item.id;
		row.getCell(2).value = item.name;
		row.getCell(3).value = item.image;
		row.getCell(4).value = item.price;
		row.getCell(5).value = item.remark;
		row.commit();
	});

	await workbook.xlsx.writeFile(outputPath);
}

async function main() {
	loadEnv();

	const templatePath = path.resolve(getArg('template', DEFAULT_TEMPLATE));
	const outputPath = path.resolve(getArg('output', DEFAULT_OUTPUT));
	const batchSize = Number(getArg('batch-size', String(WECHAT_BATCH_IMPORT_MAX))) || WECHAT_BATCH_IMPORT_MAX;
	const isRemote = process.argv.includes('--remote');

	const dbConfig = isRemote
		? {
				host: process.env.REMOTE_DB_HOST || process.env.DB_HOST,
				port: Number(process.env.REMOTE_DB_PORT || process.env.DB_PORT || 3306),
				user: process.env.REMOTE_DB_USERNAME || process.env.DB_USERNAME,
				password: process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD,
				database: process.env.REMOTE_DB_DATABASE || process.env.DB_DATABASE || 'practice_hub',
		  }
		: {
				host: process.env.DB_HOST || 'localhost',
				port: Number(process.env.DB_PORT || 3306),
				user: process.env.DB_USERNAME || 'root',
				password: process.env.DB_PASSWORD || '',
				database: process.env.DB_DATABASE || 'practice_hub',
		  };

	if (!fs.existsSync(templatePath)) {
		throw new Error(`模板不存在: ${templatePath}`);
	}

	const itemUrl = resolveDefaultItemUrl();
	const courses = await getCourses(dbConfig);
	const goodsRows = buildRows(courses, itemUrl);
	const batches = chunkRows(goodsRows, batchSize);
	const templateMeta = await loadTemplateHeader(templatePath);
	const writtenPaths = [];

	for (let i = 0; i < batches.length; i++) {
		const batchOutput = resolveBatchOutputPath(outputPath, i, batches.length);
		await writeBatchWorkbook(templateMeta, batchOutput, batches[i]);
		writtenPaths.push({ path: batchOutput, count: batches[i].length });
	}

	// 避免误用旧版单文件（超过 200 条）
	if (batches.length > 1 && fs.existsSync(outputPath) && outputPath !== writtenPaths[0].path) {
		fs.unlinkSync(outputPath);
	}

	console.log(`数据库：${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
	console.log(`付费课程：${courses.length} 门，道具行：${goodsRows.length} 条（含课程+激活码）`);
	console.log(`道具图片：${itemUrl}`);
	console.log('道具价格单位：元（整数，仅 Excel 批量导入；接口上传请用 npm run xpay:goods:remote）');
	if (batches.length > 1) {
		console.log(`微信单次批量上限 ${WECHAT_BATCH_IMPORT_MAX} 条，已拆成 ${batches.length} 个文件（每批最多 ${batchSize} 条）：`);
	}
	for (const item of writtenPaths) {
		console.log(`  - ${item.path}（${item.count} 条）`);
	}
	if (batches.length > 1) {
		console.log('请按 part01 → part02 顺序分别在微信后台导入，每批间隔片刻避免限流。');
	}
}

main().catch((error) => {
	console.error('填充失败:', error.message || error);
	process.exit(1);
});
