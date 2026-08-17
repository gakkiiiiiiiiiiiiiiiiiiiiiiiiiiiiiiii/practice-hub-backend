import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { SysErrorLog } from '../../database/entities/sys-error-log.entity';
import { ReportClientErrorDto } from './dto/report-client-error.dto';

export interface ClientErrorRequestMeta {
	ip?: string;
	requestId?: string;
	userAgent?: string;
	userId?: number;
}

@Injectable()
export class ClientErrorService {
	private readonly logger = new Logger(ClientErrorService.name);
	private readonly rateWindows = new Map<string, { startedAt: number; count: number }>();
	private readonly recentFingerprints = new Map<string, number>();
	private readonly rateWindowMs = 60_000;
	private readonly rateLimit = 20;
	private readonly deduplicateMs = 60_000;

	constructor(
		@InjectRepository(SysErrorLog)
		private readonly errorLogRepository: Repository<SysErrorLog>,
	) {}

	async report(dto: ReportClientErrorDto, meta: ClientErrorRequestMeta = {}) {
		const tracker = meta.userId ? `user:${meta.userId}` : `ip:${meta.ip || 'unknown'}`;
		const now = Date.now();
		this.pruneTrackingState(now);

		if (!this.consumeRateLimit(tracker, now)) {
			this.logger.warn(JSON.stringify({ event: 'mini_program_error_rate_limited', tracker }));
			return { accepted: false, reason: 'rate_limited' };
		}

		const fingerprint = this.getFingerprint(dto);
		const fingerprintKey = `${tracker}:${fingerprint}`;
		const lastReportedAt = this.recentFingerprints.get(fingerprintKey) || 0;
		if (now - lastReportedAt < this.deduplicateMs) {
			return { accepted: true, deduplicated: true };
		}
		this.recentFingerprints.set(fingerprintKey, now);

		const runtime = this.sanitizeRecord(dto.runtime);
		const context = this.sanitizeRecord(dto.context);
		const numericCode = Number(dto.code);
		const log = await this.errorLogRepository.save(
			this.errorLogRepository.create({
				method: 'CLIENT',
				url: this.truncate(dto.page || 'unknown', 1000),
				status: 400,
				code: Number.isFinite(numericCode) ? numericCode : 0,
				message: this.truncate(dto.message, 1000) || '小程序客户端错误',
				errorName: this.truncate(`MiniProgram:${dto.eventType}`, 100),
				stack: this.truncate(dto.stack, 20000),
				requestId: this.truncate(meta.requestId, 100),
				ip: this.truncate(meta.ip, 100),
				userId: meta.userId || null,
				userAgent: this.truncate(meta.userAgent || this.buildRuntimeUserAgent(runtime), 500),
				params: {
					source: 'mini_program',
					level: dto.level || 'error',
					fingerprint,
					occurredAt: dto.occurredAt || null,
				},
				query: runtime,
				body: context,
			}),
		);

		this.logger.error(
			JSON.stringify({
				event: 'mini_program_client_error',
				logId: log.id,
				eventType: dto.eventType,
				code: dto.code || '',
				page: dto.page || 'unknown',
				userId: meta.userId || null,
				fingerprint,
			}),
		);

		return { accepted: true, id: log.id };
	}

	private consumeRateLimit(tracker: string, now: number) {
		const current = this.rateWindows.get(tracker);
		if (!current || now - current.startedAt >= this.rateWindowMs) {
			this.rateWindows.set(tracker, { startedAt: now, count: 1 });
			return true;
		}
		if (current.count >= this.rateLimit) return false;
		current.count += 1;
		return true;
	}

	private getFingerprint(dto: ReportClientErrorDto) {
		if (dto.fingerprint) return dto.fingerprint;
		return createHash('sha256')
			.update([dto.eventType, dto.code || '', dto.message, dto.page || ''].join('|'))
			.digest('hex')
			.slice(0, 32);
	}

	private sanitizeRecord(value: unknown): Record<string, unknown> | null {
		if (!value || typeof value !== 'object') return null;
		const sanitized = this.sanitizeValue(value, 0) as Record<string, unknown>;
		const serialized = JSON.stringify(sanitized);
		if (serialized.length <= 20000) return sanitized;
		return { _truncated: true, preview: serialized.slice(0, 20000) };
	}

	private sanitizeValue(value: unknown, depth: number): unknown {
		if (depth >= 5) return '[max-depth]';
		if (typeof value === 'string') return this.truncate(value, 2000);
		if (Array.isArray(value)) {
			return value.slice(0, 20).map((item) => this.sanitizeValue(item, depth + 1));
		}
		if (!value || typeof value !== 'object') return value;

		const sensitiveFragments = [
			'password',
			'token',
			'authorization',
			'secret',
			'cookie',
			'openid',
			'session',
			'signature',
			'paysig',
			'signdata',
		];
		return Object.entries(value as Record<string, unknown>)
			.slice(0, 50)
			.reduce<Record<string, unknown>>((result, [key, item]) => {
				const normalizedKey = key.toLowerCase();
				result[key] = sensitiveFragments.some((fragment) => normalizedKey.includes(fragment))
					? '***'
					: this.sanitizeValue(item, depth + 1);
				return result;
			}, {});
	}

	private buildRuntimeUserAgent(runtime: Record<string, unknown> | null) {
		if (!runtime) return '';
		return [runtime.brand, runtime.model, runtime.system, runtime.wechatVersion].filter(Boolean).join(' / ');
	}

	private pruneTrackingState(now: number) {
		if (this.rateWindows.size > 2000) {
			for (const [key, value] of this.rateWindows) {
				if (now - value.startedAt >= this.rateWindowMs) this.rateWindows.delete(key);
			}
		}
		if (this.recentFingerprints.size > 5000) {
			for (const [key, reportedAt] of this.recentFingerprints) {
				if (now - reportedAt >= this.deduplicateMs) this.recentFingerprints.delete(key);
			}
		}
	}

	private truncate(value: unknown, maxLength: number): string | null {
		if (value === undefined || value === null) return null;
		const text = String(value);
		return text.length > maxLength ? text.slice(0, maxLength) : text;
	}
}
