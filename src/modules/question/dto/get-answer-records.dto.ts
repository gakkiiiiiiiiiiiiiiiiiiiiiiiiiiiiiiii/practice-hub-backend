import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsArray, ValidateIf } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class GetAnswerRecordsDto {
	@ApiProperty({ description: '章节ID（可选）', example: 1, required: false })
	@IsOptional()
	@Transform(({ value }) => {
		// 使用 process.stdout.write 确保日志输出（console.log 在生产环境可能被抑制）
		process.stdout.write(`[DTO Transform] chapterId value: ${value}, type: ${typeof value}\n`);

		// 如果值为空，返回 undefined（可选参数）
		if (value === undefined || value === null || value === '') {
			process.stdout.write(`[DTO Transform] chapterId 为空，返回 undefined\n`);
			return undefined;
		}

		// 尝试转换为数字
		let num: number;
		if (typeof value === 'number') {
			// 已经是数字，检查是否是 NaN
			if (isNaN(value) || !Number.isFinite(value)) {
				process.stdout.write(`[DTO Transform] chapterId 是无效数字，返回 undefined\n`);
				return undefined;
			}
			num = value;
		} else if (typeof value === 'string') {
			// 字符串，使用 parseInt 转换
			const trimmed = value.trim();
			if (trimmed === '' || trimmed === 'undefined' || trimmed === 'null') {
				process.stdout.write(`[DTO Transform] chapterId 字符串为空，返回 undefined\n`);
				return undefined;
			}
			num = parseInt(trimmed, 10);
			process.stdout.write(`[DTO Transform] chapterId 字符串转换: "${trimmed}" -> ${num}\n`);
		} else {
			// 其他类型，尝试 Number 转换
			num = Number(value);
			process.stdout.write(`[DTO Transform] chapterId 其他类型转换: ${value} -> ${num}\n`);
		}

		// 严格验证转换结果
		if (isNaN(num) || !Number.isFinite(num) || num <= 0 || !Number.isInteger(num)) {
			process.stdout.write(`[DTO Transform] chapterId 验证失败: ${num}, 返回 undefined\n`);
			return undefined;
		}

		process.stdout.write(`[DTO Transform] chapterId 转换成功: ${num}\n`);
		return num;
	})
	@ValidateIf((o) => o.chapterId !== undefined && o.chapterId !== null)
	@IsNumber({}, { message: '章节ID必须是数字' })
	chapterId?: number;

	@ApiProperty({ description: '题目ID列表（可选）', example: [1, 2, 3], required: false })
	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		// 如果是数组，直接转换并过滤
		if (Array.isArray(value)) {
			return value.map((id) => Number(id)).filter((id) => Number.isSafeInteger(id) && id > 0);
		}
		// 如果是字符串（逗号分隔），转换为数组
		if (typeof value === 'string') {
			return value
				.split(',')
				.map((id) => Number(id.trim()))
				.filter((id) => Number.isSafeInteger(id) && id > 0);
		}
		return undefined;
	})
	@ValidateIf((o) => o.questionIds !== undefined && o.questionIds !== null)
	@IsArray({ message: '题目ID列表必须是数组' })
	questionIds?: number[];
}
