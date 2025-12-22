/**
 * 创建初始管理员账号脚本
 * 使用方法：npm run create-admin
 * 或：npx ts-node scripts/create-admin.ts
 */

import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { SysUser, AdminRole } from '../src/database/entities/sys-user.entity';

async function createAdmin() {
  // 创建数据库连接
  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || 'root123456',
    database: process.env.DB_DATABASE || 'practice_hub',
    entities: [__dirname + '/../src/**/*.entity{.ts,.js}'],
    synchronize: false,
    logging: true,
  });

  try {
    await dataSource.initialize();
    console.log('✅ 数据库连接成功');

    const userRepository = dataSource.getRepository(SysUser);

    // 检查是否已存在管理员
    const existingAdmin = await userRepository.findOne({
      where: { username: 'admin' },
    });

    if (existingAdmin) {
      console.log('⚠️  管理员账号已存在');
      console.log(`   用户名: ${existingAdmin.username}`);
      console.log(`   角色: ${existingAdmin.role}`);
      console.log(`   状态: ${existingAdmin.status === 1 ? '启用' : '禁用'}`);
      await dataSource.destroy();
      return;
    }

    // 创建默认管理员账号
    const hashedPassword = await bcrypt.hash('123456', 10);

    const admin = userRepository.create({
      username: 'admin',
      password: hashedPassword,
      role: AdminRole.SUPER_ADMIN,
      balance: 0,
      status: 1,
    });

    await userRepository.save(admin);
    console.log('✅ 管理员账号创建成功！');
    console.log('   用户名: admin');
    console.log('   密码: 123456');
    console.log('   角色: super_admin');

    // 创建内容管理员
    const contentAdmin = await userRepository.findOne({
      where: { username: 'content' },
    });

    if (!contentAdmin) {
      const contentAdminUser = userRepository.create({
        username: 'content',
        password: hashedPassword,
        role: AdminRole.CONTENT_ADMIN,
        balance: 0,
        status: 1,
      });
      await userRepository.save(contentAdminUser);
      console.log('✅ 内容管理员账号创建成功！');
      console.log('   用户名: content');
      console.log('   密码: 123456');
      console.log('   角色: content_admin');
    }

    // 创建代理商账号
    const agent = await userRepository.findOne({
      where: { username: 'agent' },
    });

    if (!agent) {
      const agentUser = userRepository.create({
        username: 'agent',
        password: hashedPassword,
        role: AdminRole.AGENT,
        balance: 10000,
        status: 1,
      });
      await userRepository.save(agentUser);
      console.log('✅ 代理商账号创建成功！');
      console.log('   用户名: agent');
      console.log('   密码: 123456');
      console.log('   角色: agent');
      console.log('   余额: 10000');
    }

    await dataSource.destroy();
    console.log('✅ 完成！');
  } catch (error) {
    console.error('❌ 创建失败:', error);
    await dataSource.destroy();
    process.exit(1);
  }
}

createAdmin();

