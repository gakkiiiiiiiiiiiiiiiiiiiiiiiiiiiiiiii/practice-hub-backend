const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const COS = require('cos-nodejs-sdk-v5');
const OSS = require('ali-oss');

const ROOT_DIR = path.resolve(__dirname, '..');
const REMOTE_ENV_FILE = path.join(ROOT_DIR, '.env.remote');
const REPORT_FILE = path.join(ROOT_DIR, 'exports', 'cos-delete-matches-report.json');
const DEFAULT_SOURCE_BUCKET = '7072-prod-d1gguk4ie589126ba-1424780330';
const DEFAULT_SOURCE_REGION = 'ap-shanghai';
const DEFAULT_TARGET_BUCKET = 'practice-hub-prod-1424780330';
const DEFAULT_TARGET_REGION = 'oss-cn-shanghai';
const MAX_RETRIES = 3;

function loadEnvFile(filePath) {
	if (!fs.existsSync(filePath)) return {};
	const result = {};
	for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const separator = line.indexOf('=');
		if (separator < 1) continue;
		const key = line.slice(0, separator).trim();
		const value = line.slice(separator + 1).trim();
		result[key] = value.replace(/^(['"])(.*)\1$/, '$2');
	}
	return result;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry(label, operation) {
	let lastError;
	for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;
			if (attempt < MAX_RETRIES) await sleep(500 * 2 ** (attempt - 1));
		}
	}
	throw new Error(`${label}: ${lastError?.message || lastError}`);
}

function loadWxcloudApi() {
	const executable = execFileSync('which', ['wxcloud'], { encoding: 'utf8' }).trim();
	const cliRoot = path.resolve(path.dirname(fs.realpathSync(executable)), '..');
	return {
		fetchApi: require(path.join(cliRoot, 'lib/api/base')).fetchApi,
		setApiCommonParameters: require(path.join(cliRoot, 'lib/api/common')).setApiCommonParameters,
	};
}

function createTencentCredentialProvider(sourceBucket, sourceRegion) {
	const { fetchApi, setApiCommonParameters } = loadWxcloudApi();
	setApiCommonParameters({ region: sourceRegion });
	let cached;
	return async () => {
		const now = Math.floor(Date.now() / 1000);
		if (cached && Number(cached.expired_time) - now > 60) return cached;
		cached = await retry('刷新 COS 临时凭证失败', () =>
			fetchApi('wxa-dev-qbase/gettcbtoken', {
				region: sourceRegion,
				source: sourceBucket,
				scene: 'TOKEN_SCENE_COS',
				service: 'cos',
			}),
		);
		if (!cached?.secretid || !cached?.secretkey || !cached?.token) {
			throw new Error('微信云服务未返回完整 COS 临时凭证');
		}
		return cached;
	};
}

async function createCosClient(getCredentials) {
	const credentials = await getCredentials();
	return new COS({
		SecretId: credentials.secretid,
		SecretKey: credentials.secretkey,
		SecurityToken: credentials.token,
	});
}

async function listOssSizes(client, prefix) {
	const sizes = new Map();
	let marker;
	do {
		const query = { marker, 'max-keys': 1000 };
		if (prefix) query.prefix = prefix;
		const result = await retry('列出 OSS 对象失败', () => client.list(query, {}));
		for (const object of result.objects || []) {
			sizes.set(object.name, Number(object.size) || 0);
		}
		marker = result.isTruncated ? result.nextMarker : undefined;
		if (sizes.size > 0 && sizes.size % 50_000 < 1000) {
			console.log(`[OSS 清单] ${sizes.size}`);
		}
	} while (marker);
	return sizes;
}

async function listCosObjects(getCredentials, sourceBucket, sourceRegion, prefix) {
	const objects = [];
	let marker = '';
	do {
		const client = await createCosClient(getCredentials);
		const result = await retry('列出 COS 对象失败', () =>
			client.getBucket({
				Bucket: sourceBucket,
				Region: sourceRegion,
				Prefix: prefix,
				Marker: marker,
				MaxKeys: 1000,
			}),
		);
		for (const object of result.Contents || []) {
			objects.push({ key: object.Key, size: Number(object.Size) || 0 });
		}
		marker = result.IsTruncated === 'true' ? result.NextMarker : '';
		if (objects.length > 0 && objects.length % 50_000 < 1000) {
			console.log(`[COS 清单] ${objects.length}`);
		}
	} while (marker);
	return objects;
}

function writeReport(report) {
	fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
	fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
}

async function run() {
	const fileEnv = loadEnvFile(REMOTE_ENV_FILE);
	const env = { ...fileEnv, ...process.env };
	const execute = process.argv.includes('--execute');
	const sourceBucket = env.COS_BUCKET || DEFAULT_SOURCE_BUCKET;
	const sourceRegion = env.COS_REGION || DEFAULT_SOURCE_REGION;
	const targetBucket = env.OSS_BUCKET || DEFAULT_TARGET_BUCKET;
	const targetRegion = env.OSS_REGION || DEFAULT_TARGET_REGION;
	const prefix = env.COS_DELETE_PREFIX || '';

	if (!env.OSS_ACCESS_KEY_ID || !env.OSS_ACCESS_KEY_SECRET) {
		throw new Error('缺少 OSS_ACCESS_KEY_ID 或 OSS_ACCESS_KEY_SECRET');
	}

	const oss = new OSS({
		region: targetRegion,
		bucket: targetBucket,
		accessKeyId: env.OSS_ACCESS_KEY_ID,
		accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
		timeout: 120_000,
	});
	const getCredentials = createTencentCredentialProvider(sourceBucket, sourceRegion);

	console.log('正在读取 OSS 和 COS 对象清单...');
	const ossSizes = await listOssSizes(oss, prefix);
	const cosObjects = await listCosObjects(getCredentials, sourceBucket, sourceRegion, prefix);
	const matches = [];
	const retained = [];
	let matchedBytes = 0;

	for (const object of cosObjects) {
		if (ossSizes.get(object.key) === object.size) {
			matches.push({ Key: object.key });
			matchedBytes += object.size;
		} else {
			retained.push({
				key: object.key,
				cosSize: object.size,
				ossSize: ossSizes.has(object.key) ? ossSizes.get(object.key) : null,
			});
		}
	}

	const report = {
		createdAt: new Date().toISOString(),
		execute,
		sourceBucket,
		targetBucket,
		prefix,
		scanned: cosObjects.length,
		matched: matches.length,
		matchedBytes,
		deleted: 0,
		retained,
	};
	writeReport(report);
	console.log(
		JSON.stringify(
			{
				phase: 'preflight',
				scanned: report.scanned,
				matched: report.matched,
				matchedBytes: report.matchedBytes,
				retained: report.retained.length,
				execute,
			},
			null,
			2,
		),
	);

	if (!execute) {
		console.log(`预检完成。确认后使用 --execute 执行删除，报告：${REPORT_FILE}`);
		return;
	}

	for (let offset = 0; offset < matches.length; offset += 1000) {
		const objects = matches.slice(offset, offset + 1000);
		const cos = await createCosClient(getCredentials);
		await retry(`删除 COS 对象失败（offset=${offset}）`, () =>
			cos.deleteMultipleObject({
				Bucket: sourceBucket,
				Region: sourceRegion,
				Objects: objects,
				Quiet: true,
			}),
		);
		report.deleted += objects.length;
		report.updatedAt = new Date().toISOString();
		writeReport(report);
		if (report.deleted % 10_000 === 0 || report.deleted === matches.length) {
			console.log(`[COS 删除] ${report.deleted}/${matches.length}`);
		}
	}

	console.log(
		JSON.stringify(
			{
				completed: true,
				deleted: report.deleted,
				retained: report.retained.length,
				reportFile: REPORT_FILE,
			},
			null,
			2,
		),
	);
}

run().catch((error) => {
	console.error(`[清理失败] ${error.message}`);
	process.exit(1);
});
