/**
 * 测试微信登录功能
 * 模拟完整的登录流程，检查各个环节
 * 使用方法：node scripts/test-wechat-login.js [code]
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const axios = require('axios');
const https = require('https');

const appid = process.env.WECHAT_APPID;
const secret = process.env.WECHAT_SECRET;
const testCode = process.argv[2] || 'test_code_123456'; // 可以从命令行传入测试 code

console.log('========================================');
console.log('微信登录功能测试');
console.log('========================================\n');

// 1. 检查配置
console.log('1. 检查环境变量配置:');
console.log(`   WECHAT_APPID: ${appid ? '✅ 已设置' : '❌ 未设置'}`);
console.log(`   WECHAT_SECRET: ${secret ? '✅ 已设置' : '❌ 未设置'}\n`);

if (!appid || !secret) {
	console.error('❌ 配置不完整，无法继续测试');
	console.error('\n请在 .env 文件中设置:');
	console.error('  WECHAT_APPID=你的微信小程序AppID');
	console.error('  WECHAT_SECRET=你的微信小程序Secret\n');
	process.exit(1);
}

console.log(`   AppID: ${appid.substring(0, 10)}...${appid.substring(appid.length - 4)}`);
console.log(`   Secret: ${secret.substring(0, 10)}...${secret.substring(secret.length - 4)}\n`);

// 2. 测试网络连接
console.log('2. 测试网络连接:');
const httpsAgent = new https.Agent({
	rejectUnauthorized: false,
});

async function testNetwork() {
	try {
		const response = await axios.get('https://api.weixin.qq.com', {
			httpsAgent,
			timeout: 5000,
		});
		console.log('   ✅ 可以访问微信 API\n');
		return true;
	} catch (error) {
		if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
			console.log('   ❌ 无法连接到微信 API（网络问题）\n');
		} else if (error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
			console.log('   ⚠️  SSL 证书问题（已配置跳过验证）\n');
			return true; // 虽然有问题，但可以继续
		} else {
			console.log(`   ⚠️  网络错误: ${error.message}\n`);
		}
		return false;
	}
}

// 3. 测试微信 API 调用
async function testWechatAPI() {
	console.log('3. 测试微信 API 调用:');
	console.log(`   使用测试 code: ${testCode.substring(0, 10)}...\n`);

	try {
		const response = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
			params: {
				appid,
				secret,
				js_code: testCode,
				grant_type: 'authorization_code',
			},
			httpsAgent,
			timeout: 10000,
		});

		const { openid, session_key, errcode, errmsg } = response.data;

		if (errcode) {
			console.log(`   ⚠️  微信 API 返回错误:`);
			console.log(`      错误码: ${errcode}`);
			console.log(`      错误信息: ${errmsg}\n`);

			// 解释常见错误码
			const errorExplanations = {
				40013: '无效的 AppID',
				40125: '无效的 Secret',
				40029: '登录凭证已过期',
				45011: '登录请求过于频繁',
				40163: '登录凭证已被使用',
			};

			if (errorExplanations[errcode]) {
				console.log(`   💡 说明: ${errorExplanations[errcode]}\n`);
			}

			// 如果是配置错误，给出建议
			if (errcode === 40013 || errcode === 40125) {
				console.log('   🔧 建议:');
				console.log('      1. 检查 AppID 和 Secret 是否正确');
				console.log('      2. 确保 AppID 和 Secret 来自同一个微信小程序');
				console.log('      3. 确保 Secret 已启用（在微信公众平台中）\n');
			}

			return false;
		}

		if (openid) {
			console.log(`   ✅ 成功获取 openid: ${openid.substring(0, 10)}...\n`);
			return true;
		} else {
			console.log('   ❌ 未获取到 openid\n');
			return false;
		}
	} catch (error) {
		console.log(`   ❌ 请求失败: ${error.message}\n`);
		if (error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
			console.log('   💡 这是 SSL 证书问题，后端代码已配置跳过验证\n');
		}
		return false;
	}
}

// 4. 检查后端服务
async function testBackendService() {
	console.log('4. 检查后端服务:');
	const backendUrl = process.env.API_BASE_URL || 'http://localhost:3333';

	try {
		const response = await axios.get(`${backendUrl}/api/auth/app/login`, {
			data: { code: testCode },
			method: 'POST',
			timeout: 5000,
			validateStatus: () => true, // 接受所有状态码
		});

		if (response.status === 200) {
			console.log('   ✅ 后端服务可访问\n');
		} else if (response.status === 401) {
			console.log('   ⚠️  后端返回 401（可能是配置问题或 code 无效）\n');
		} else {
			console.log(`   ⚠️  后端返回状态码: ${response.status}\n`);
		}
	} catch (error) {
		if (error.code === 'ECONNREFUSED') {
			console.log('   ❌ 无法连接到后端服务（服务可能未启动）\n');
		} else {
			console.log(`   ⚠️  连接错误: ${error.message}\n`);
		}
	}
}

// 执行测试
async function runTests() {
	const networkOk = await testNetwork();
	if (!networkOk) {
		console.log('⚠️  网络连接有问题，但可以继续测试 API 调用\n');
	}

	await testWechatAPI();
	await testBackendService();

	console.log('========================================');
	console.log('测试完成');
	console.log('========================================\n');

	console.log('💡 提示:');
	console.log('  1. 如果微信 API 返回 40013 或 40125，检查 AppID 和 Secret');
	console.log('  2. 如果返回 40029，说明 code 已过期，需要从小程序重新获取');
	console.log('  3. 如果网络连接失败，检查服务器是否能访问外网');
	console.log('  4. 如果 SSL 证书错误，确保后端代码已配置 httpsAgent\n');
}

runTests().catch((error) => {
	console.error('测试执行失败:', error);
	process.exit(1);
});

