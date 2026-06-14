/**
 * 微信云托管 CLI 登录
 * 文档: https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/guide/cli/
 *
 * 在 .env.remote 配置:
 *   CLI_KEY=控制台生成的 CLI 密钥
 *   WECHAT_APPID=小程序 AppID（可选，默认 wxbf8bf945e2da8af5）
 *
 * 用法: npm run wxcloud:login
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function loadEnvRemote() {
	const remotePath = path.resolve(__dirname, '../.env.remote');
	if (!fs.existsSync(remotePath)) {
		console.error('未找到 .env.remote');
		process.exit(1);
	}
	require('dotenv').config({ path: remotePath });
}

loadEnvRemote();

const privateKey = process.env.CLI_KEY;
const appId = process.env.WECHAT_APPID || 'wxbf8bf945e2da8af5';

if (!privateKey) {
	console.error('请在 .env.remote 中配置 CLI_KEY（微信云托管控制台 → 设置 → CLI密钥）');
	process.exit(1);
}

console.log('使用 wxcloud 登录微信云托管...');
console.log('AppID:', appId);

const result = spawnSync('wxcloud', ['login', '--appId', appId, '--privateKey', privateKey], {
	stdio: 'inherit',
	encoding: 'utf8',
});

if (result.status !== 0) {
	console.error('登录失败，请确认 CLI_KEY 有效且 wxcloud 已安装: npm i -g @wxcloud/cli');
	process.exit(result.status || 1);
}

console.log('登录成功，可执行: wxcloud env:list --json');
