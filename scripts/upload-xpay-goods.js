/**
 * 通过 xpay 接口批量上传并发布微信虚拟支付道具（推荐，勿用 Excel 批量导入）。
 *
 * 价格：数据库 course.price / agent_price 为「元」；接口 upload_item.price / 支付 goodsPrice 为「分」（元×100）。
 * Excel 模板里的「道具价格」才是「元」整数，与接口单位不同。
 *
 * 用法：
 *   npm run xpay:goods:remote
 *   node scripts/upload-xpay-goods.js --remote --dry-run
 *   node scripts/upload-xpay-goods.js --remote --type=package
 *   node scripts/upload-xpay-goods.js --remote --plan-id=3
 *   node scripts/upload-xpay-goods.js --remote --limit=10 --delay-ms=3000
 *   node scripts/upload-xpay-goods.js --remote --course-id=92 --refresh-token
 *   node scripts/upload-xpay-goods.js --remote --from-course-id=39
 *   node scripts/upload-xpay-goods.js --remote --from-course-id=105 --delay-ms=5000
 *   node scripts/upload-xpay-goods.js --remote --product-ids=course_105,activation_code_105
 *   node scripts/upload-xpay-goods.js --remote --only-failed-log=test-files/xpay-retry-from-105.log
 *   node scripts/upload-xpay-goods.js --remote --product-ids-file=test-files/xpay-failed-ids.txt
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const mysql = require('mysql2/promise');

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

function parseFailedIdsFromLog(logPath) {
	if (!logPath || !fs.existsSync(logPath)) {
		return [];
	}
	const content = fs.readFileSync(logPath, 'utf8');
	const ids = new Set();
	for (const line of content.split('\n')) {
		const match = line.match(/^\s*✗\s+(course_\d+|activation_code_\d+|package_\d+)\s+失败/);
		if (match) {
			ids.add(match[1]);
		}
	}
	return [...ids];
}

function loadProductIdsFromFile(filePath) {
	if (!filePath || !fs.existsSync(filePath)) {
		return [];
	}
	return fs
		.readFileSync(filePath, 'utf8')
		.split(/[\s,]+/)
		.map((item) => item.trim())
		.filter((item) => /^course_\d+$/.test(item) || /^activation_code_\d+$/.test(item) || /^package_\d+$/.test(item));
}

function getRequiredEnv(keys, label) {
	for (const key of keys) {
		if (process.env[key]) return process.env[key];
	}
	throw new Error(`缺少${label}，请配置 ${keys.join(' 或 ')}`);
}

function sign(endpoint, body, appKey) {
	return crypto.createHmac('sha256', appKey).update(`${endpoint}&${body}`).digest('hex');
}

/** 数据库「元」→ 微信 xpay 接口「分」 */
function yuanToCents(value) {
	const cents = Math.round(Number(value || 0) * 100);
	return Number.isFinite(cents) ? cents : 0;
}

function formatYuan(value) {
	const yuan = Number(value || 0);
	return Number.isFinite(yuan) ? yuan.toFixed(2) : '0.00';
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error) {
	return String(error?.response?.data?.errmsg || error?.message || error || '').trim();
}

function isSkippableError(error) {
	const message = getErrorMessage(error).toLowerCase();
	return (
		message.includes('exist') ||
		message.includes('already') ||
		message.includes('重复') ||
		message.includes('已存在') ||
		message.includes('已上传') ||
		message.includes('已发布') ||
		message.includes('频率限制') ||
		message.includes('rate limit') ||
		message.includes('too many requests')
	);
}

/** 微信报错「(0,40]」实测：恰好 40 字节会被拒，安全上限 39 字节 */
const WECHAT_VIRTUAL_PAY_NAME_MAX_BYTES = 39;
const WECHAT_VIRTUAL_PAY_REMARK_MAX_BYTES = 128;

function truncateUtf8Bytes(value, maxBytes) {
	const text = String(value || '').trim();
	if (!text || maxBytes <= 0) return '';
	let used = 0;
	let result = '';
	for (const char of text) {
		const size = Buffer.byteLength(char, 'utf8');
		if (used + size > maxBytes) break;
		used += size;
		result += char;
	}
	return result || text.slice(0, 1);
}

function buildVirtualPayGoodsName(courseName, suffix = '', courseId = '') {
	const source = String(courseName || '').trim() || `课程${courseId}`;
	const suffixText = suffix ? ` ${suffix}` : '';
	const suffixBytes = Buffer.byteLength(suffixText, 'utf8');
	const maxBaseBytes = Math.max(1, WECHAT_VIRTUAL_PAY_NAME_MAX_BYTES - suffixBytes);
	const base = truncateUtf8Bytes(source, maxBaseBytes);
	let name = truncateUtf8Bytes(`${base}${suffixText}`, WECHAT_VIRTUAL_PAY_NAME_MAX_BYTES);
	if (!name || Buffer.byteLength(name, 'utf8') < 1) {
		name = truncateUtf8Bytes(`课程${courseId}${suffixText}`, WECHAT_VIRTUAL_PAY_NAME_MAX_BYTES);
	}
	return name;
}

function buildVirtualPayGoodsRemark(prefix, courseName) {
	const label = `${prefix}：`;
	const labelBytes = Buffer.byteLength(label, 'utf8');
	const maxNameBytes = Math.max(1, WECHAT_VIRTUAL_PAY_REMARK_MAX_BYTES - labelBytes);
	const namePart = truncateUtf8Bytes(String(courseName || '').trim(), maxNameBytes);
	return truncateUtf8Bytes(`${label}${namePart}`, WECHAT_VIRTUAL_PAY_REMARK_MAX_BYTES);
}

function normalizeUrl(url) {
	const value = String(url || '').trim();
	if (/^https?:\/\//i.test(value)) return value;
	return '';
}

/** 进程内缓存，避免与其它服务抢刷 cgi-bin/token 导致 40001 */
let stableAccessTokenCache = null;

async function getStableAccessToken(appId, appSecret, { forceRefresh = false } = {}) {
	const now = Date.now();
	if (!forceRefresh && stableAccessTokenCache && stableAccessTokenCache.expireAt > now + 60_000) {
		return stableAccessTokenCache.token;
	}
	const response = await axios.post(
		'https://api.weixin.qq.com/cgi-bin/stable_token',
		{
			grant_type: 'client_credential',
			appid: appId,
			secret: appSecret,
			force_refresh: !!forceRefresh,
		},
		{
			timeout: 15000,
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		},
	);
	const data = response.data || {};
	if (data.errcode) {
		throw new Error(`获取 stable access_token 失败：${data.errcode} ${data.errmsg || ''}`);
	}
	if (!data.access_token) {
		throw new Error(`获取 stable access_token 失败：${JSON.stringify(data)}`);
	}
	stableAccessTokenCache = {
		token: data.access_token,
		expireAt: now + Math.max(60, Number(data.expires_in || 7200) - 300) * 1000,
	};
	return data.access_token;
}

function isInvalidAccessTokenError(error) {
	const message = getErrorMessage(error).toLowerCase();
	return (
		message.includes('40001') ||
		message.includes('invalid credential') ||
		message.includes('access_token is invalid') ||
		message.includes('not latest')
	);
}

async function callXpay(endpoint, payload, accessToken, appKey, env) {
	const body = JSON.stringify({ ...payload, env });
	const paySig = sign(endpoint, body, appKey);
	const response = await axios.post(`https://api.weixin.qq.com${endpoint}`, body, {
		params: {
			access_token: accessToken,
			pay_sig: paySig,
		},
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		timeout: 30000,
	});
	if (response.data?.errcode) {
		throw new Error(`${endpoint} 失败：${response.data.errcode} ${response.data.errmsg || ''}`);
	}
	return response.data || {};
}

async function callXpayWithTokenRetry(endpoint, payload, appId, appSecret, appKey, env, accessToken) {
	try {
		const data = await callXpay(endpoint, payload, accessToken, appKey, env);
		return { data, accessToken };
	} catch (error) {
		if (!isInvalidAccessTokenError(error)) {
			throw error;
		}
		console.warn('  access_token 失效，使用 stable_token 强制刷新后重试…');
		const freshToken = await getStableAccessToken(appId, appSecret, { forceRefresh: true });
		const data = await callXpay(endpoint, payload, freshToken, appKey, env);
		return { data, accessToken: freshToken };
	}
}

async function waitForGoodsTask(endpoint, listKey, idKey, statusKey, goodsId, appId, appSecret, accessToken, appKey, env) {
	let token = accessToken;
	for (let i = 0; i < 10; i += 1) {
		const { data: result, accessToken: nextToken } = await callXpayWithTokenRetry(
			endpoint,
			{},
			appId,
			appSecret,
			appKey,
			env,
			token,
		);
		token = nextToken;
		const items = Array.isArray(result[listKey]) ? result[listKey] : [];
		const item = items.find((entry) => String(entry[idKey]) === String(goodsId));
		if (item && item[statusKey] !== 0) {
			return { item, accessToken: token };
		}
		await new Promise((resolve) => setTimeout(resolve, 1500));
	}
	return { item: null, accessToken: token };
}

async function getPackagePlans(dbConfig, { planId = '' } = {}) {
	const conn = await mysql.createConnection(dbConfig);
	try {
		const params = [];
		let sql = `
			SELECT
				pp.id,
				pp.name,
				pp.price,
				pp.status,
				ps.id AS section_id,
				ps.name AS section_name
			FROM package_plan pp
			INNER JOIN package_section ps ON ps.id = pp.section_id
			WHERE pp.status = 1
			  AND ps.status = 1
			  AND pp.price > 0
		`;
		if (planId) {
			sql += ' AND pp.id = ?';
			params.push(Number(planId));
		}
		sql += ' ORDER BY pp.id ASC';
		const [rows] = await conn.query(sql, params);
		return rows;
	} finally {
		await conn.end();
	}
}

async function getCourses(dbConfig, { courseId = '', fromCourseId = '' } = {}) {
	const conn = await mysql.createConnection(dbConfig);
	try {
		const params = [];
		let sql = `
			SELECT id, name, price, agent_price, cover_img
			FROM course
			WHERE status = 1
			  AND is_free = 0
			  AND price > 0
		`;
		if (courseId) {
			sql += ' AND id = ?';
			params.push(Number(courseId));
		} else if (fromCourseId) {
			sql += ' AND id >= ?';
			params.push(Number(fromCourseId));
		}
		sql += ' ORDER BY id ASC';
		const [rows] = await conn.query(sql, params);
		return rows;
	} finally {
		await conn.end();
	}
}

function buildPackageGoodsItem(plan, defaultItemUrl) {
	const priceYuan = Number(plan.price || 0);
	const priceCents = Math.max(1, yuanToCents(priceYuan));
	const itemUrl = normalizeUrl(defaultItemUrl);
	if (!itemUrl || !itemUrl.includes('virtual-pay-goods-cover')) {
		throw new Error(
			`缺少 virtual-pay-goods-cover 商品图 URL，请配置 WECHAT_VIRTUAL_PAY_DEFAULT_ITEM_URL 或上传 images/virtual-pay-goods-cover.png 到 COS`,
		);
	}
	const label = `${String(plan.section_name || '套餐').trim()}-${String(plan.name || '规格').trim()}`;
	return {
		id: `package_${plan.id}`,
		name: buildVirtualPayGoodsName(label, '', plan.id),
		price: priceCents,
		priceYuan,
		remark: buildVirtualPayGoodsRemark('套餐', label),
		item_url: itemUrl,
	};
}

function buildGoodsItems(course, type, defaultItemUrl) {
	const priceYuan = type === 'activation' ? course.agent_price || course.price : course.price;
	const priceCents = Math.max(1, yuanToCents(priceYuan));
	const itemUrl = normalizeUrl(defaultItemUrl);
	if (!itemUrl || !itemUrl.includes('virtual-pay-goods-cover')) {
		throw new Error(
			`缺少 virtual-pay-goods-cover 商品图 URL，请配置 WECHAT_VIRTUAL_PAY_DEFAULT_ITEM_URL 或上传 images/virtual-pay-goods-cover.png 到 COS`,
		);
	}

	if (type === 'activation') {
		return {
			id: `activation_code_${course.id}`,
			name: buildVirtualPayGoodsName(course.name, '激活码', course.id),
			price: priceCents,
			priceYuan: Number(priceYuan || 0),
			remark: buildVirtualPayGoodsRemark('激活码', course.name),
			item_url: itemUrl,
		};
	}

	return {
		id: `course_${course.id}`,
		name: buildVirtualPayGoodsName(course.name, '', course.id),
		price: priceCents,
		priceYuan: Number(priceYuan || 0),
		remark: buildVirtualPayGoodsRemark('课程', course.name),
		item_url: itemUrl,
	};
}

async function main() {
	loadEnv();

	const isRemote = process.argv.includes('--remote');
	const dryRun = process.argv.includes('--dry-run');
	const skipPublish = process.argv.includes('--no-publish');
	const type = getArg('type', 'all');
	const courseId = getArg('course-id', '');
	const planId = getArg('plan-id', '');
	const fromCourseId = getArg('from-course-id', '');
	const onlyFailedLog = getArg('only-failed-log', '');
	const productIdsFile = getArg('product-ids-file', '');
	let productIds = getArg('product-ids', '')
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
	if (onlyFailedLog) {
		productIds = parseFailedIdsFromLog(path.resolve(onlyFailedLog));
	}
	if (productIdsFile) {
		productIds = loadProductIdsFromFile(path.resolve(productIdsFile));
	}
	const limit = Number(getArg('limit', '0'));
	const delayMs = Math.max(0, Number(getArg('delay-ms', '2500')) || 2500);
	const continueOnError = !process.argv.includes('--fail-fast');

	if (!['all', 'course', 'activation', 'package'].includes(type)) {
		throw new Error('--type 只能是 all、course、activation 或 package');
	}

	const appId = getRequiredEnv(['WECHAT_APPID', 'AppID'], '小程序 AppID');
	const appSecret = getRequiredEnv(['WECHAT_SECRET', 'AppSecret', 'WECHAT_APPSECRET'], '小程序 AppSecret');
	const env = Number(process.env.WECHAT_VIRTUAL_PAY_ENV || 0);
	const appKey =
		env === 1
			? getRequiredEnv(['WECHAT_VIRTUAL_PAY_SANDBOX_APPKEY', 'SandboxAppKey', 'WECHAT_VIRTUAL_PAY_APPKEY', 'AppKey', 'APP_KEY'], '微信虚拟支付沙箱 AppKey')
			: getRequiredEnv(['WECHAT_VIRTUAL_PAY_APPKEY', 'ProdAppKey', 'AppKey', 'APP_KEY'], '微信虚拟支付正式 AppKey');
	const bucket = process.env.COS_BUCKET || '';
	const cosDefaultItemUrl = bucket
		? `https://${bucket}.tcb.qcloud.la/images/virtual-pay-goods-cover.png`
		: '';
	const configuredDefaultItemUrl = process.env.WECHAT_VIRTUAL_PAY_DEFAULT_ITEM_URL || cosDefaultItemUrl;

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

	if (!dbConfig.host || !dbConfig.user) {
		throw new Error('缺少数据库配置');
	}

	const courses = type === 'package' ? [] : await getCourses(dbConfig, { courseId, fromCourseId });
	const packagePlans = type === 'course' || type === 'activation' ? [] : await getPackagePlans(dbConfig, { planId });
	const scopedCourses = limit > 0 ? courses.slice(0, limit) : courses;
	const scopedPlans = limit > 0 ? packagePlans.slice(0, limit) : packagePlans;
	const defaultItemUrl = normalizeUrl(configuredDefaultItemUrl);
	const courseGoods = scopedCourses.flatMap((course) => {
		const items = [];
		if (type === 'all' || type === 'course') {
			items.push(buildGoodsItems(course, 'course', defaultItemUrl));
		}
		if (type === 'all' || type === 'activation') {
			items.push(buildGoodsItems(course, 'activation', defaultItemUrl));
		}
		return items;
	});
	const packageGoods = scopedPlans.map((plan) => buildPackageGoodsItem(plan, defaultItemUrl));
	const goods = [...courseGoods, ...packageGoods];

	const targetGoods =
		productIds.length > 0 ? goods.filter((item) => productIds.includes(item.id)) : goods;
	if (productIds.length > 0 && targetGoods.length === 0) {
		throw new Error(`未匹配到 product-ids：${productIds.join(', ')}`);
	}

	console.log(`目标数据库：${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
	if (fromCourseId && !courseId) {
		console.log(`课程范围：id >= ${fromCourseId}（共 ${scopedCourses.length} 门）`);
	}
	if (type === 'package' || type === 'all') {
		console.log(`套餐规格：${scopedPlans.length} 个`);
	}
	if (productIds.length > 0) {
		console.log(`指定道具：${targetGoods.length} 个（product-ids）`);
	}
	console.log(
		`准备处理商品：${targetGoods.length} 个，环境：${env === 1 ? '沙箱' : '正式'}，发布：${skipPublish ? '否' : '是'}，间隔：${delayMs}ms`,
	);
	console.log('价格：数据库(元) → 接口(分)，例 0.50元→50分，9.99元→999分');
	if (dryRun) {
		console.table(
			targetGoods.slice(0, 20).map((item) => ({
				id: item.id,
				name: item.name,
				'名称字节': Buffer.byteLength(item.name, 'utf8'),
				'数据库(元)': formatYuan(item.priceYuan),
				'接口(分)': item.price,
			})),
		);
		if (targetGoods.length > 20) console.log(`... 还有 ${targetGoods.length - 20} 个未显示`);
		return;
	}

	const forceRefreshToken = process.argv.includes('--refresh-token');
	let accessToken = await getStableAccessToken(appId, appSecret, { forceRefresh: forceRefreshToken });
	if (forceRefreshToken) {
		console.log('已强制刷新 stable access_token');
	}
	const results = [];
	for (let index = 0; index < targetGoods.length; index += 1) {
		const item = targetGoods[index];
		const { priceYuan, ...uploadItem } = item;
		console.log(
			`\n[${index + 1}/${targetGoods.length}] ${uploadItem.id} ${uploadItem.name} (${Buffer.byteLength(uploadItem.name, 'utf8')}B) 数据库¥${formatYuan(priceYuan)} → 接口${uploadItem.price}分`,
		);
		try {
			const uploadStart = await callXpayWithTokenRetry(
				'/xpay/start_upload_goods',
				{ upload_item: [uploadItem] },
				appId,
				appSecret,
				appKey,
				env,
				accessToken,
			);
			accessToken = uploadStart.accessToken;
			const uploadWait = await waitForGoodsTask(
				'/xpay/query_upload_goods',
				'upload_item',
				'id',
				'upload_status',
				uploadItem.id,
				appId,
				appSecret,
				accessToken,
				appKey,
				env,
			);
			accessToken = uploadWait.accessToken;
			const uploadStatus = uploadWait.item;
			if (uploadStatus?.errmsg) {
				throw new Error(`上传任务失败：${uploadStatus.errmsg}`);
			}
			console.log(`  ✓ 上传任务已提交${uploadStatus ? `，状态：${uploadStatus.upload_status}` : ''}`);

			let publishStatus = null;
			if (!skipPublish) {
				const publishStart = await callXpayWithTokenRetry(
					'/xpay/start_publish_goods',
					{ publish_item: [{ id: uploadItem.id }] },
					appId,
					appSecret,
					appKey,
					env,
					accessToken,
				);
				accessToken = publishStart.accessToken;
				const publishWait = await waitForGoodsTask(
					'/xpay/query_publish_goods',
					'publish_item',
					'id',
					'publish_status',
					uploadItem.id,
					appId,
					appSecret,
					accessToken,
					appKey,
					env,
				);
				accessToken = publishWait.accessToken;
				publishStatus = publishWait.item;
				if (publishStatus?.errmsg) {
					throw new Error(`发布任务失败：${publishStatus.errmsg}`);
				}
				console.log(`  ✓ 发布任务已提交${publishStatus ? `，状态：${publishStatus.publish_status}` : ''}`);
			}

			results.push({ id: uploadItem.id, ok: true, uploadStatus, publishStatus });
		} catch (error) {
			const message = getErrorMessage(error);
			if (isSkippableError(error)) {
				console.warn(`  ⊘ ${uploadItem.id} 跳过：${message}`);
				results.push({ id: uploadItem.id, ok: true, skipped: true, error: message });
			} else {
				console.error(`  ✗ ${uploadItem.id} 失败：${message}`);
				results.push({ id: uploadItem.id, ok: false, error: message });
				if (!continueOnError) {
					break;
				}
			}
		}
		if (delayMs > 0 && index < targetGoods.length - 1) {
			await sleep(delayMs);
		}
	}

	const failed = results.filter((item) => !item.ok);
	console.log(`\n完成：成功 ${results.length - failed.length}，失败 ${failed.length}`);
	if (failed.length > 0) {
		console.table(failed);
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(error.message || error);
	process.exit(1);
});
