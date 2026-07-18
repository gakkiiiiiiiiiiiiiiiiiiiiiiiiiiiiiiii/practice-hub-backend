const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');
const COS = require('cos-nodejs-sdk-v5');
const OSS = require('ali-oss');

const ROOT_DIR = path.resolve(__dirname, '..');
const REMOTE_ENV_FILE = path.join(ROOT_DIR, '.env.remote');
const STATE_FILE = path.join(ROOT_DIR, 'exports', 'oss-migration-state.json');
const DEFAULT_SOURCE_BUCKET = '7072-prod-d1gguk4ie589126ba-1424780330';
const DEFAULT_SOURCE_REGION = 'ap-shanghai';
const DEFAULT_TARGET_BUCKET = 'practice-hub-prod-1424780330';
const DEFAULT_TARGET_REGION = 'oss-cn-shanghai';
const MAX_RETRIES = 3;

function loadEnvFile(filePath) {
	if (!fs.existsSync(filePath)) return {};
	const result = {};
	const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index].trim();
		if (!line || line.startsWith('#')) continue;
		const separator = line.indexOf('=');
		if (separator < 0) continue;
		const key = line.slice(0, separator).trim();
		let value = line.slice(separator + 1).trim();
		result[key] = value.replace(/^(['"])(.*)\1$/, '$2');
	}
	if (!result.OSS_ACCESS_KEY_ID) {
		const continuation = lines.map((line) => line.trim()).find((line) => /^LTAI[A-Za-z0-9]+$/.test(line));
		if (continuation) result.OSS_ACCESS_KEY_ID = continuation;
	}
	return result;
}

function isSensitiveObject(key) {
	return (
		/(^|\/)([^/]*_cert|certs?|secrets?|private)(\/|$)/i.test(key) ||
		/\.(pem|p12|pfx|key|jks|keystore)$/i.test(key)
	);
}

function encodeObjectKey(key) {
	return key.split('/').map(encodeURIComponent).join('/');
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
			if (attempt < MAX_RETRIES) {
				await sleep(500 * 2 ** (attempt - 1));
			}
		}
	}
	throw new Error(`${label}: ${lastError?.message || lastError}`);
}

async function mapConcurrent(items, concurrency, worker) {
	let cursor = 0;
	async function run() {
		while (cursor < items.length) {
			const item = items[cursor];
			cursor += 1;
			await worker(item);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

function loadWxcloudApi() {
	const executable = execFileSync('which', ['wxcloud'], { encoding: 'utf8' }).trim();
	const cliRoot = path.resolve(path.dirname(fs.realpathSync(executable)), '..');
	if (!fs.existsSync(cliRoot)) {
		throw new Error('未安装 @wxcloud/cli，请先安装并执行 wxcloud login');
	}
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
		if (cached && Number(cached.expired_time) - now > 300) return cached;
		const credentials = await fetchApi('wxa-dev-qbase/gettcbtoken', {
			region: sourceRegion,
			source: sourceBucket,
			scene: 'TOKEN_SCENE_COS',
			service: 'cos',
		});
		if (!credentials?.secretid || !credentials?.secretkey || !credentials?.token) {
			throw new Error('微信云服务未返回完整 COS 临时凭证，请重新执行 wxcloud login');
		}
		cached = credentials;
		return credentials;
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

async function destinationHasSameSize(client, key, expectedSize) {
	try {
		const result = await client.head(key);
		const actualSize = Number(result.res?.headers?.['content-length']);
		return actualSize === expectedSize;
	} catch (error) {
		if (error.status === 404 || error.code === 'NoSuchKey') return false;
		throw error;
	}
}

function copyResponseHeaders(response) {
	const headers = {};
	for (const name of ['content-type', 'cache-control', 'content-encoding', 'content-disposition', 'content-language', 'expires']) {
		const value = response.headers.get(name);
		if (value) headers[name] = value;
	}
	return headers;
}

async function run() {
	const fileEnv = loadEnvFile(REMOTE_ENV_FILE);
	const env = { ...fileEnv, ...process.env };
	const sourceBucket = env.COS_BUCKET || DEFAULT_SOURCE_BUCKET;
	const sourceRegion = env.COS_REGION || DEFAULT_SOURCE_REGION;
	const targetBucket = env.OSS_BUCKET || DEFAULT_TARGET_BUCKET;
	const targetRegion = env.OSS_REGION || DEFAULT_TARGET_REGION;
	const sourcePrefix = env.OSS_MIGRATION_PREFIX || '';
	const concurrency = Math.max(1, Math.min(32, Number(env.OSS_MIGRATION_CONCURRENCY) || 8));
	const verifyOnly = process.argv.includes('--verify');
	const dryRun = process.argv.includes('--dry-run');

	if (!env.OSS_ACCESS_KEY_ID || !env.OSS_ACCESS_KEY_SECRET) {
		throw new Error('请在 .env.remote 配置 OSS_ACCESS_KEY_ID 和 OSS_ACCESS_KEY_SECRET');
	}

	const oss = new OSS({
		region: targetRegion,
		bucket: targetBucket,
		accessKeyId: env.OSS_ACCESS_KEY_ID,
		accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
		timeout: 10 * 60 * 1000,
	});
	const getCredentials = createTencentCredentialProvider(sourceBucket, sourceRegion);
	let marker = '';
	let page = 0;
	const stats = { scanned: 0, copied: 0, skipped: 0, excluded: 0, failed: 0, bytesCopied: 0 };
	const startedAt = new Date().toISOString();

	do {
		const cos = await createCosClient(getCredentials);
		const result = await retry('列出 COS 对象失败', () =>
			cos.getBucket({ Bucket: sourceBucket, Region: sourceRegion, Prefix: sourcePrefix, Marker: marker, MaxKeys: 1000 }),
		);
		page += 1;
		const objects = result.Contents || [];
		marker = result.IsTruncated === 'true' ? result.NextMarker : '';

		await mapConcurrent(objects, concurrency, async (object) => {
			const key = object.Key;
			const size = Number(object.Size) || 0;
			stats.scanned += 1;
			if (isSensitiveObject(key)) {
				stats.excluded += 1;
				return;
			}
			try {
				const exists = await retry(`检查 OSS 对象失败 (${key})`, () => destinationHasSameSize(oss, key, size));
				if (exists) {
					stats.skipped += 1;
					return;
				}
				if (verifyOnly || dryRun) {
					stats.failed += 1;
					return;
				}
				await retry(`复制对象失败 (${key})`, async () => {
					const url = `https://${sourceBucket}.tcb.qcloud.la/${encodeObjectKey(key)}`;
					const response = await fetch(url);
					if (!response.ok || !response.body) throw new Error(`源端 HTTP ${response.status}`);
					const sourceLength = Number(response.headers.get('content-length'));
					if (Number.isFinite(sourceLength) && sourceLength !== size) {
						throw new Error(`源端大小不一致，清单=${size}，下载=${sourceLength}`);
					}
					await oss.putStream(key, Readable.fromWeb(response.body), {
						contentLength: size || undefined,
						headers: copyResponseHeaders(response),
					});
					const verified = await destinationHasSameSize(oss, key, size);
					if (!verified) throw new Error('上传后大小校验失败');
				});
				stats.copied += 1;
				stats.bytesCopied += size;
			} catch (error) {
				stats.failed += 1;
				console.error(`[失败] ${key}: ${error.message}`);
			}
		});

		fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
		fs.writeFileSync(
			STATE_FILE,
			JSON.stringify(
				{ startedAt, updatedAt: new Date().toISOString(), sourceBucket, sourcePrefix, targetBucket, page, marker, stats },
				null,
				2,
			),
		);
		console.log(
			`[进度] 页=${page} 扫描=${stats.scanned} 复制=${stats.copied} 跳过=${stats.skipped} 排除=${stats.excluded} 失败=${stats.failed}`,
		);
	} while (marker);

	console.log(JSON.stringify({ completed: true, verifyOnly, dryRun, sourceBucket, sourcePrefix, targetBucket, stats }, null, 2));
	if (stats.failed > 0) process.exitCode = 2;
}

run().catch((error) => {
	console.error(`[迁移终止] ${error.message}`);
	process.exit(1);
});
