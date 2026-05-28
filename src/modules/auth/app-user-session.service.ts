import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import {
  AppUserSession,
  AppUserSessionLoginMethod,
} from '../../database/entities/app-user-session.entity';

const MAX_PASSWORD_DEVICES = 3;

@Injectable()
export class AppUserSessionService {
  constructor(
    @InjectRepository(AppUserSession)
    private readonly sessionRepository: Repository<AppUserSession>,
    private readonly configService: ConfigService,
  ) {}

  private resolveExpiresAt(): Date {
    const raw = String(this.configService.get('JWT_EXPIRE') || '7d').trim();
    const match = raw.match(/^(\d+)([dhms])$/i);
    const now = Date.now();
    if (!match) {
      return new Date(now + 7 * 24 * 60 * 60 * 1000);
    }
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const unitMs =
      unit === 'd'
        ? 24 * 60 * 60 * 1000
        : unit === 'h'
          ? 60 * 60 * 1000
          : unit === 'm'
            ? 60 * 1000
            : 1000;
    return new Date(now + amount * unitMs);
  }

  private async countActivePasswordSessions(userId: number): Promise<number> {
    const now = new Date();
    return this.sessionRepository.count({
      where: {
        user_id: userId,
        login_method: AppUserSessionLoginMethod.PASSWORD,
        revoked_at: IsNull(),
        expires_at: MoreThan(now),
      },
    });
  }

  async createPasswordSession(
    userId: number,
    deviceId: string,
    deviceName?: string,
    platform?: string,
  ): Promise<string> {
    const normalizedDeviceId = String(deviceId || '').trim();
    if (!normalizedDeviceId) {
      throw new BadRequestException('设备标识不能为空');
    }

    const now = new Date();
    const expiresAt = this.resolveExpiresAt();

    const existing = await this.sessionRepository.findOne({
      where: {
        user_id: userId,
        device_id: normalizedDeviceId,
        login_method: AppUserSessionLoginMethod.PASSWORD,
        revoked_at: IsNull(),
      },
      order: { id: 'DESC' },
    });

    if (existing) {
      existing.session_id = randomUUID();
      existing.expires_at = expiresAt;
      existing.last_active_at = now;
      if (deviceName?.trim()) existing.device_name = deviceName.trim().slice(0, 100);
      if (platform?.trim()) existing.platform = platform.trim().slice(0, 50);
      await this.sessionRepository.save(existing);
      return existing.session_id;
    }

    const activeCount = await this.countActivePasswordSessions(userId);
    if (activeCount >= MAX_PASSWORD_DEVICES) {
      throw new BadRequestException('该账号已在3台设备登录，请先在其它设备退出后再试');
    }

    const session = this.sessionRepository.create({
      user_id: userId,
      session_id: randomUUID(),
      device_id: normalizedDeviceId,
      device_name: deviceName?.trim()?.slice(0, 100) || null,
      platform: platform?.trim()?.slice(0, 50) || null,
      login_method: AppUserSessionLoginMethod.PASSWORD,
      expires_at: expiresAt,
      last_active_at: now,
      revoked_at: null,
    });
    await this.sessionRepository.save(session);
    return session.session_id;
  }

  async isSessionActive(sessionId: string, userId: number): Promise<boolean> {
    if (!sessionId || !userId) return false;
    const session = await this.sessionRepository.findOne({
      where: {
        session_id: sessionId,
        user_id: userId,
        login_method: AppUserSessionLoginMethod.PASSWORD,
        revoked_at: IsNull(),
      },
    });
    if (!session) return false;
    return session.expires_at.getTime() > Date.now();
  }

  async revokeSession(sessionId: string, userId: number): Promise<boolean> {
    const session = await this.sessionRepository.findOne({
      where: { session_id: sessionId, user_id: userId },
    });
    if (!session || session.revoked_at) return false;
    session.revoked_at = new Date();
    await this.sessionRepository.save(session);
    return true;
  }

  async cleanupExpiredSessions(): Promise<void> {
    const now = new Date();
    await this.sessionRepository.update(
      {
        revoked_at: IsNull(),
        expires_at: LessThan(now),
      },
      { revoked_at: now },
    );
  }
}
