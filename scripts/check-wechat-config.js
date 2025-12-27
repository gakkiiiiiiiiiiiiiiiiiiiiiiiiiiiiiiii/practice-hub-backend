/**
 * 检查微信登录配置
 * 使用方法：node scripts/check-wechat-config.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const appid = process.env.WECHAT_APPID;
const secret = process.env.WECHAT_SECRET;

console.log('========================================');
console.log('微信登录配置检查');
console.log('========================================\n');

console.log('环境变量检查:');
console.log(`  WECHAT_APPID: ${appid ? '✅ 已设置' : '❌ 未设置'}`);
console.log(`  WECHAT_SECRET: ${secret ? '✅ 已设置' : '❌ 未设置'}\n`);

if (appid) {
	console.log(`  AppID 值: ${appid.substring(0, 10)}...${appid.substring(appid.length - 4)}`);
	console.log(`  AppID 长度: ${appid.length} (应该是18位)\n`);
}

if (secret) {
	console.log(`  Secret 值: ${secret.substring(0, 10)}...${secret.substring(secret.length - 4)}`);
	console.log(`  Secret 长度: ${secret.length} (应该是32位)\n`);
}

if (!appid || !secret) {
	console.log('❌ 配置不完整！\n');
	console.log('请在 .env 文件中设置:');
	console.log('  WECHAT_APPID=你的微信小程序AppID');
	console.log('  WECHAT_SECRET=你的微信小程序Secret\n');
	console.log('获取方式:');
	console.log('  1. 登录微信公众平台: https://mp.weixin.qq.com');
	console.log('  2. 进入"开发" -> "开发管理" -> "开发设置"');
	console.log('  3. 查看"AppID(小程序ID)"和"AppSecret(小程序密钥)"\n');
	process.exit(1);
}

// 验证格式
if (appid.length !== 18) {
	console.log('⚠️  警告: AppID 长度不正确（应该是18位）');
}

if (secret.length !== 32) {
	console.log('⚠️  警告: Secret 长度不正确（应该是32位）');
}

console.log('✅ 配置检查通过！\n');

console.log('常见问题排查:');
console.log('  1. 确保 AppID 和 Secret 来自同一个微信小程序');
console.log('  2. 确保 Secret 已启用（在微信公众平台中）');
console.log('  3. 确保小程序已发布或已添加体验者');
console.log('  4. 检查服务器是否能访问 api.weixin.qq.com');
console.log('  5. 如果使用微信云托管，确保环境变量已正确配置\n');

