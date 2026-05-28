import { Logger } from '@nestjs/common';

const defaultLogger = new Logger('DatabaseRetry');

export function isTransientDatabaseError(error: unknown): boolean {
	const err = error as { code?: string | number; errno?: string | number; message?: string };
	const code = err?.code ?? err?.errno;
	const message = String(err?.message || '');
	return (
		code === 'ECONNRESET' ||
		code === 'PROTOCOL_CONNECTION_LOST' ||
		code === 'ETIMEDOUT' ||
		code === 'ECONNREFUSED' ||
		message.includes('ECONNRESET') ||
		message.includes('Connection lost') ||
		message.includes('read ECONNRESET') ||
		message.includes('Pool is closed')
	);
}

export async function queryWithRetry<T>(
	queryFn: () => Promise<T>,
	options?: {
		action?: string;
		retries?: number;
		delayMs?: number;
		logger?: Logger;
	},
): Promise<T> {
	const logger = options?.logger ?? defaultLogger;
	const retries = options?.retries ?? 3;
	const delayMs = options?.delayMs ?? 300;
	const action = options?.action ?? '数据库查询';
	let lastError: unknown;

	for (let attempt = 1; attempt <= retries; attempt += 1) {
		try {
			return await queryFn();
		} catch (error) {
			lastError = error;
			if (!isTransientDatabaseError(error) || attempt >= retries) {
				throw error;
			}
			logger.warn(`${action}遇到连接中断，准备重试 (${attempt}/${retries}): ${(error as Error)?.message || error}`);
			await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
		}
	}

	throw lastError;
}
