/**
 * 批量上传并发布微信虚拟支付道具。
 *
 * 用法：
 *   node scripts/upload-xpay-goods.js --remote
 *   node scripts/upload-xpay-goods.js --remote --type=course
 *   node scripts/upload-xpay-goods.js --remote --type=activation
 *   node scripts/upload-xpay-goods.js --remote --course-id=3
 *   node scripts/upload-xpay-goods.js --remote --dry-run
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

function getRequiredEnv(keys, label) {
	for (const key of keys) {
		if (process.env[key]) return process.env[key];
	}
	throw new Error(`缺少${label}，请配置 ${keys.join(' 或 ')}`);
}

function sign(endpoint, body, appKey) {
	return crypto.createHmac('sha256', appKey).update(`${endpoint}&${body}`).digest('hex');
}

function toCents(value) {
	const cents = Math.round(Number(value || 0) * 100);
	return Number.isFinite(cents) ? cents : 0;
}

function truncateText(value, maxLength) {
	const text = String(value || '').trim();
	return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeUrl(url) {
	const value = String(url || '').trim();
	if (/^https?:\/\//i.test(value)) return value;
	return '';
}

async function getAccessToken(appId, appSecret) {
	const response = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
		params: {
			grant_type: 'client_credential',
			appid: appId,
			secret: appSecret,
		},
		timeout: 15000,
	});
	if (response.data?.errcode) {
		throw new Error(`获取 access_token 失败：${response.data.errcode} ${response.data.errmsg || ''}`);
	}
	if (!response.data?.access_token) {
		throw new Error(`获取 access_token 失败：${JSON.stringify(response.data)}`);
	}
	return response.data.access_token;
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

async function waitForGoodsTask(endpoint, listKey, idKey, statusKey, goodsId, accessToken, appKey, env) {
	for (let i = 0; i < 10; i += 1) {
		const result = await callXpay(endpoint, {}, accessToken, appKey, env);
		const items = Array.isArray(result[listKey]) ? result[listKey] : [];
		const item = items.find((entry) => String(entry[idKey]) === String(goodsId));
		if (item && item[statusKey] !== 0) {
			return item;
		}
		await new Promise((resolve) => setTimeout(resolve, 1500));
	}
	return null;
}

async function getCourses(dbConfig, courseId) {
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
		}
		sql += ' ORDER BY id ASC';
		const [rows] = await conn.query(sql, params);
		return rows;
	} finally {
		await conn.end();
	}
}

function buildGoodsItems(course, type, defaultItemUrl) {
	const coursePrice = toCents(course.price);
	const agentPrice = toCents(course.agent_price || course.price);
	const itemUrl = normalizeUrl(defaultItemUrl);
	if (!itemUrl || !itemUrl.includes('virtual-pay-goods-cover')) {
		throw new Error(
			`缺少 virtual-pay-goods-cover 商品图 URL，请配置 WECHAT_VIRTUAL_PAY_DEFAULT_ITEM_URL 或上传 images/virtual-pay-goods-cover.png 到 COS`,
		);
	}

	if (type === 'activation') {
		return {
			id: `activation_code_${course.id}`,
			name: truncateText(`${course.name} 激活码`, 32),
			price: Math.max(1, agentPrice),
			remark: truncateText(`激活码：${course.name}`, 128),
			item_url: itemUrl,
		};
	}

	return {
		id: `course_${course.id}`,
		name: truncateText(course.name, 32),
		price: Math.max(1, coursePrice),
		remark: truncateText(`课程：${course.name}`, 128),
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
	const limit = Number(getArg('limit', '0'));

	if (!['all', 'course', 'activation'].includes(type)) {
		throw new Error('--type 只能是 all、course 或 activation');
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

	const courses = await getCourses(dbConfig, courseId);
	const scopedCourses = limit > 0 ? courses.slice(0, limit) : courses;
	const defaultItemUrl = normalizeUrl(configuredDefaultItemUrl);
	const goods = scopedCourses.flatMap((course) => {
		const items = [];
		if (type === 'all' || type === 'course') {
			items.push(buildGoodsItems(course, 'course', defaultItemUrl));
		}
		if (type === 'all' || type === 'activation') {
			items.push(buildGoodsItems(course, 'activation', defaultItemUrl));
		}
		return items;
	});

	console.log(`目标数据库：${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
	console.log(`准备处理商品：${goods.length} 个，环境：${env === 1 ? '沙箱' : '正式'}，发布：${skipPublish ? '否' : '是'}`);
	if (dryRun) {
		console.table(goods.slice(0, 20));
		if (goods.length > 20) console.log(`... 还有 ${goods.length - 20} 个未显示`);
		return;
	}

	const accessToken = await getAccessToken(appId, appSecret);
	const results = [];
	for (const item of goods) {
		console.log(`\n上传 ${item.id} ${item.name} ¥${(item.price / 100).toFixed(2)}`);
		try {
			await callXpay('/xpay/start_upload_goods', { upload_item: [item] }, accessToken, appKey, env);
			const uploadStatus = await waitForGoodsTask(
				'/xpay/query_upload_goods',
				'upload_item',
				'id',
				'upload_status',
				item.id,
				accessToken,
				appKey,
				env,
			);
			if (uploadStatus?.errmsg) {
				throw new Error(`上传任务失败：${uploadStatus.errmsg}`);
			}
			console.log(`  ✓ 上传任务已提交${uploadStatus ? `，状态：${uploadStatus.upload_status}` : ''}`);

			let publishStatus = null;
			if (!skipPublish) {
				await callXpay('/xpay/start_publish_goods', { publish_item: [{ id: item.id }] }, accessToken, appKey, env);
				publishStatus = await waitForGoodsTask(
					'/xpay/query_publish_goods',
					'publish_item',
					'id',
					'publish_status',
					item.id,
					accessToken,
					appKey,
					env,
				);
				if (publishStatus?.errmsg) {
					throw new Error(`发布任务失败：${publishStatus.errmsg}`);
				}
				console.log(`  ✓ 发布任务已提交${publishStatus ? `，状态：${publishStatus.publish_status}` : ''}`);
			}

			results.push({ id: item.id, ok: true, uploadStatus, publishStatus });
		} catch (error) {
			console.error(`  ✗ ${item.id} 失败：${error.message}`);
			results.push({ id: item.id, ok: false, error: error.message });
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
