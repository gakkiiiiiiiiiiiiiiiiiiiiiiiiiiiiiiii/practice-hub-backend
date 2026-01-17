import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Question, QuestionType } from '../../database/entities/question.entity';
import { Chapter } from '../../database/entities/chapter.entity';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { ImportQuestionDto } from './dto/import-question.dto';

@Injectable()
export class AdminQuestionService {
	private readonly logger = new Logger(AdminQuestionService.name);

	constructor(
		@InjectRepository(Question)
		private questionRepository: Repository<Question>,
		@InjectRepository(Chapter)
		private chapterRepository: Repository<Chapter>
	) {}

	/**
	 * 新增/编辑题目
	 */
	async saveQuestion(dto: CreateQuestionDto | UpdateQuestionDto, id?: number) {
		// 处理 options 字段，确保格式正确
		const processedDto: any = { ...dto };

		// 简答题和填空题不需要选项，设置为 null
		if (processedDto.type === QuestionType.SHORT_ANSWER || processedDto.type === QuestionType.FILL_BLANK) {
			processedDto.options = null;
		} else if (processedDto.options) {
			// 确保 options 是 [{label: string, text: string}[]] 格式
			if (Array.isArray(processedDto.options)) {
				processedDto.options = processedDto.options
					.filter((opt: any) => opt && typeof opt === 'object')
					.map((opt: any) => {
						// 如果已经是正确格式
						if ('label' in opt && 'text' in opt) {
							return {
								label: String(opt.label || ''),
								text: String(opt.text || ''),
							};
						}
						// 如果是其他格式，尝试转换
						return null;
					})
					.filter((item: any) => item !== null);
			} else {
				processedDto.options = [];
			}

			// 调试信息：仅在开发环境输出
			if (process.env.NODE_ENV === 'development') {
				console.log('保存时的 options:', JSON.stringify(processedDto.options, null, 2));
			}
		}

		if (id) {
			const question = await this.questionRepository.findOne({ where: { id } });
			if (!question) {
				throw new NotFoundException('题目不存在');
			}
			Object.assign(question, processedDto);
			return await this.questionRepository.save(question);
		} else {
			const question = this.questionRepository.create(processedDto);
			return await this.questionRepository.save(question);
		}
	}

	/**
	 * 获取题目列表
	 */
	async getQuestionList(courseId?: number, chapterId?: number, type?: QuestionType) {
		// 添加重试机制，防止数据库连接错误
		const maxRetries = 3;
		let lastError: any;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				const queryBuilder = this.questionRepository
					.createQueryBuilder('question')
					.leftJoinAndSelect('question.chapter', 'chapter')
					.leftJoinAndSelect('chapter.course', 'course');

				if (chapterId) {
					queryBuilder.where('question.chapter_id = :chapterId', { chapterId });
				} else if (courseId) {
					queryBuilder.where('chapter.course_id = :courseId', { courseId });
				}

				if (type) {
					queryBuilder.andWhere('question.type = :type', { type });
				}

				const questions = await queryBuilder.orderBy('question.id', 'ASC').getMany();

				// 格式化返回数据，添加课程和章节名称
				return questions.map((q: any) => ({
					...q,
					courseName: q.chapter?.course?.name || '',
					chapterName: q.chapter?.name || '',
				}));
			} catch (error: any) {
				lastError = error;
				this.logger.warn(`[获取题目列表] 第 ${attempt} 次尝试失败: ${error.message}`);

				// 如果是连接错误，等待后重试
				if (
					error.code === 'ECONNRESET' ||
					error.code === 'PROTOCOL_CONNECTION_LOST' ||
					error.message?.includes('ECONNRESET')
				) {
					if (attempt < maxRetries) {
						await new Promise((resolve) => setTimeout(resolve, 1000 * attempt)); // 递增延迟
						continue;
					}
				}

				// 如果不是连接错误，或者已经重试3次，直接抛出错误
				throw error;
			}
		}

		// 如果所有重试都失败，抛出最后一个错误
		throw lastError;
	}

	/**
	 * 获取题目详情
	 */
	async getQuestionDetail(id: number) {
		const question = await this.questionRepository.findOne({
			where: { id },
			relations: ['chapter', 'chapter.course'],
		});

		if (!question) {
			throw new NotFoundException('题目不存在');
		}

		// 调试：打印原始 options 数据
		console.log('=== 获取题目详情调试信息 ===');
		console.log('题目ID:', id);
		console.log('原始 question.options:', JSON.stringify(question.options, null, 2));
		console.log('question.options 类型:', typeof question.options);
		console.log('question.options 是否为数组:', Array.isArray(question.options));
		console.log('question.options 是否为 null:', question.options === null);
		console.log('question.options 是否为 undefined:', question.options === undefined);

		// 格式化返回数据，确保 options 是 {label: string, text: string}[] 格式
		const result: any = {
			id: question.id,
			chapter_id: question.chapter_id,
			parent_id: question.parent_id,
			type: question.type,
			stem: question.stem,
			answer: question.answer,
			analysis: question.analysis,
			difficulty: question.difficulty,
			create_time: question.create_time,
			update_time: question.update_time,
		};

		// 处理 options 字段，确保格式正确：[{label: "A", text: "aaaa"}]
		let processedOptions: Array<{ label: string; text: string }> = [];

		if (question.options !== null && question.options !== undefined) {
			// 调试信息：仅在开发环境输出
			if (process.env.NODE_ENV === 'development') {
				console.log('开始处理 options，类型:', typeof question.options, '是否为数组:', Array.isArray(question.options));
			}

			// 如果 options 是数组格式 [{label: "A", text: "aaaa"}]
			if (Array.isArray(question.options)) {
				if (process.env.NODE_ENV === 'development') {
					console.log('options 是数组，长度:', question.options.length);
				}

				// 检查是否是嵌套数组格式 [[], []]（错误格式）
				const firstItem = question.options[0];
				if (Array.isArray(firstItem) && firstItem.length === 0) {
					if (process.env.NODE_ENV === 'development') {
						console.log('检测到错误格式：嵌套空数组，返回空数组');
					}
					processedOptions = [];
				} else {
					processedOptions = question.options
						.map((opt: any, index: number) => {
							if (process.env.NODE_ENV === 'development') {
								console.log(`处理选项 ${index}:`, JSON.stringify(opt));
							}

							// 如果是空数组，跳过
							if (Array.isArray(opt) && opt.length === 0) {
								if (process.env.NODE_ENV === 'development') {
									console.log(`选项 ${index} 是空数组，跳过`);
								}
								return null;
							}

							// 如果已经是正确格式 {label, text}，直接返回
							if (
								opt &&
								typeof opt === 'object' &&
								opt !== null &&
								!Array.isArray(opt) &&
								'label' in opt &&
								'text' in opt
							) {
								if (process.env.NODE_ENV === 'development') {
									console.log(`选项 ${index} 格式正确`);
								}
								return {
									label: String(opt.label || ''),
									text: String(opt.text || ''),
								};
							}

							// 如果是对象格式但没有 label 和 text，可能是单个对象
							if (typeof opt === 'object' && opt !== null && !Array.isArray(opt)) {
								const keys = Object.keys(opt);
								if (process.env.NODE_ENV === 'development') {
									console.log(`选项 ${index} 是对象，键:`, keys);
								}
								// 如果是单个键值对，转换为选项
								if (keys.length === 1) {
									return {
										label: keys[0],
										text: String(opt[keys[0]] || ''),
									};
								}
								// 如果是多个键值对，转换为多个选项（这种情况不应该出现在数组中）
								return Object.keys(opt).map((key) => ({
									label: key,
									text: String(opt[key] || ''),
								}));
							}

							// 如果是字符串，尝试解析
							if (typeof opt === 'string') {
								if (process.env.NODE_ENV === 'development') {
									console.log(`选项 ${index} 是字符串，尝试解析`);
								}
								try {
									const parsed = JSON.parse(opt);
									if (Array.isArray(parsed)) {
										return parsed.map((item: any) => ({
											label: String(item.label || ''),
											text: String(item.text || ''),
										}));
									} else if (typeof parsed === 'object' && parsed !== null) {
										return Object.keys(parsed).map((key) => ({
											label: key,
											text: String(parsed[key] || ''),
										}));
									}
								} catch (e) {
									if (process.env.NODE_ENV === 'development') {
										console.log(`解析选项 ${index} 失败:`, e);
									}
								}
							}

							if (process.env.NODE_ENV === 'development') {
								console.log(`选项 ${index} 无法处理，返回 null`);
							}
							return null;
						})
						.filter((item: any) => item !== null) // 过滤掉 null 值
						.flat(); // 扁平化数组（处理嵌套情况）
				}
			}
			// 如果是对象格式 {A: "aaaa", B: "bbbb"}
			else if (typeof question.options === 'object' && question.options !== null && !Array.isArray(question.options)) {
				if (process.env.NODE_ENV === 'development') {
					console.log('options 是对象格式');
				}
				processedOptions = Object.keys(question.options).map((key) => ({
					label: key,
					text: String((question.options as any)[key] || ''),
				}));
			}
			// 如果是字符串，尝试解析 JSON
			else if (typeof question.options === 'string') {
				if (process.env.NODE_ENV === 'development') {
					console.log('options 是字符串，尝试解析 JSON');
				}
				try {
					const parsed = JSON.parse(question.options);
					if (process.env.NODE_ENV === 'development') {
						console.log('解析后的数据:', JSON.stringify(parsed, null, 2));
					}
					if (Array.isArray(parsed)) {
						processedOptions = parsed.map((item: any) => ({
							label: String(item.label || ''),
							text: String(item.text || ''),
						}));
					} else if (typeof parsed === 'object' && parsed !== null) {
						processedOptions = Object.keys(parsed).map((key) => ({
							label: key,
							text: String(parsed[key] || ''),
						}));
					}
				} catch (e) {
					if (process.env.NODE_ENV === 'development') {
						console.log('解析 JSON 失败:', e);
					}
				}
			} else {
				if (process.env.NODE_ENV === 'development') {
					console.log('options 类型未知:', typeof question.options);
				}
			}
		} else {
			if (process.env.NODE_ENV === 'development') {
				console.log('question.options 为空或未定义');
			}
		}

		if (process.env.NODE_ENV === 'development') {
			console.log('处理后的 options:', JSON.stringify(processedOptions, null, 2));
		}
		result.options = processedOptions;

		// 添加章节和科目信息
		if (question.chapter) {
			result.chapter = {
				id: question.chapter.id,
				name: question.chapter.name,
			};
			if (question.chapter.course) {
				result.course = {
					id: question.chapter.course.id,
					name: question.chapter.course.name,
				};
			}
		}

		return result;
	}

	/**
	 * 删除题目
	 */
	async deleteQuestion(id: number) {
		const question = await this.questionRepository.findOne({ where: { id } });

		if (!question) {
			throw new NotFoundException('题目不存在');
		}

		await this.questionRepository.remove(question);
		return { success: true };
	}

	/**
	 * 批量删除题目
	 */
	async batchDeleteQuestions(ids: number[]) {
		if (!ids || ids.length === 0) {
			throw new BadRequestException('请选择要删除的题目');
		}

		// 查找所有要删除的题目
		const questions = await this.questionRepository.find({
			where: { id: In(ids) },
		});

		if (questions.length === 0) {
			throw new NotFoundException('未找到要删除的题目');
		}

		// 批量删除
		await this.questionRepository.remove(questions);

		return {
			success: true,
			deletedCount: questions.length,
		};
	}

	/**
	 * 批量导入题目
	 */
	async importQuestions(dto: ImportQuestionDto) {
		const chapter = await this.chapterRepository.findOne({ where: { id: dto.chapterId } });

		if (!chapter) {
			throw new NotFoundException('章节不存在');
		}

		if (!dto.file || !dto.file.buffer) {
			throw new BadRequestException('文件不能为空');
		}

		// 解析 Excel 文件
		const workbook = new ExcelJS.Workbook();
		// 确保 buffer 是正确的类型 - Multer 返回的 buffer 需要转换为标准 Buffer
		const buffer = Buffer.isBuffer(dto.file.buffer) ? dto.file.buffer : Buffer.from(new Uint8Array(dto.file.buffer));
		await workbook.xlsx.load(buffer as any);

		const questions = [];

		// 工作表名称到题目类型的映射
		const sheetNameToType: Record<string, QuestionType> = {
			单选题模板: QuestionType.SINGLE_CHOICE,
			多选题模板: QuestionType.MULTIPLE_CHOICE,
			判断题模板: QuestionType.JUDGE,
			填空题模板: QuestionType.FILL_BLANK,
			阅读理解模板: QuestionType.READING_COMPREHENSION,
			简答题模板: QuestionType.SHORT_ANSWER,
		};

		// 获取所有工作表
		const worksheets = workbook.worksheets;
		this.logger.log(`[导入] 找到 ${worksheets.length} 个工作表`);

		// 遍历所有工作表
		for (const worksheet of worksheets) {
			const sheetName = worksheet.name;
			const questionType = sheetNameToType[sheetName];

			this.logger.log(`[导入] 处理工作表: ${sheetName}, 类型: ${questionType || '未识别'}`);

			if (!questionType) {
				// 跳过未识别的工作表
				this.logger.warn(`[导入] 跳过未识别的工作表: ${sheetName}`);
				continue;
			}

			// 找到说明行的位置（通常包含"填写说明"）
			// 说明行之后可能还有数据行，所以需要更智能地识别
			let noteRowIndex = -1;
			let maxRow = worksheet.rowCount;

			this.logger.log(`[导入] 工作表 ${sheetName} 共有 ${maxRow} 行`);

			// 先找到说明行（从第2行开始查找，因为第1行是表头）
			// 说明行通常在第3行（示例数据在第2行），但之后可能还有数据行
			for (let rowNum = 2; rowNum <= maxRow && rowNum <= 10; rowNum++) {
				const row = worksheet.getRow(rowNum);
				const firstCellValue = row.getCell(1).value?.toString() || '';
				// 说明行的特征：包含"填写说明"或"1. 题干"等，且通常跨多列合并
				if (
					(firstCellValue.includes('填写说明') ||
						firstCellValue.includes('说明：') ||
						firstCellValue.includes('1. 题干')) &&
					rowNum <= 5 // 说明行通常在前5行内
				) {
					noteRowIndex = rowNum;
					this.logger.log(`[导入] 找到说明行: 第 ${noteRowIndex} 行, 内容: ${firstCellValue.substring(0, 100)}`);
					// 不立即break，继续查找是否有更后面的说明行
					// 但实际上说明行通常只有一个，找到后可以break
					break;
				}
			}

			// 示例数据的完整内容（根据模板中的示例数据）
			const exampleStems = [
				'下列哪个选项是正确的？',
				'以下哪些选项是正确的？（多选）',
				'这个说法是否正确？',
				'请填写空白处：中国的首都是______。',
				'请简述某个概念的主要内容。',
				'阅读以下材料，回答问题。\n材料内容...',
			];

			let parsedCount = 0;
			let skippedCount = 0;

			// 解析该工作表的数据
			for (let rowNumber = 2; rowNumber <= maxRow; rowNumber++) {
				// 跳过表头（第1行）
				if (rowNumber === 1) continue;

				// 跳过说明行本身
				if (noteRowIndex > 0 && rowNumber === noteRowIndex) {
					this.logger.log(`[导入] 跳过说明行: 第 ${rowNumber} 行`);
					continue;
				}

				// 说明行之后的行需要检查：如果第一列包含"填写说明"相关关键词，跳过
				// 但如果是正常的数据行（第一列是题干内容），应该处理
				if (noteRowIndex > 0 && rowNumber > noteRowIndex) {
					const row = worksheet.getRow(rowNumber);
					const firstCellValue = row.getCell(1).value?.toString() || '';
					// 如果第一列仍然包含说明相关关键词，说明是说明行的延续，跳过
					if (
						firstCellValue.includes('填写说明') ||
						firstCellValue.includes('说明：') ||
						firstCellValue.includes('1. 题干') ||
						firstCellValue.includes('2. ')
					) {
						this.logger.log(`[导入] 跳过说明行延续: 第 ${rowNumber} 行`);
						continue;
					}
					// 否则，说明行之后的行可能是数据行，继续处理
				}

				const row = worksheet.getRow(rowNumber);

				// 检查是否是示例数据行（第2行且内容完全匹配示例数据）
				// 只检查第2行，因为模板中示例数据固定在第2行
				if (rowNumber === 2) {
					const firstCellValue = row.getCell(1).value?.toString() || '';
					// 检查是否完全匹配示例数据的完整内容
					const exactExampleStems = [
						'下列哪个选项是正确的？',
						'以下哪些选项是正确的？（多选）',
						'这个说法是否正确？',
						'请填写空白处：中国的首都是______。',
						'请简述某个概念的主要内容。',
						'阅读以下材料，回答问题。\n材料内容...',
					];

					// 只有完全匹配示例数据时才跳过
					const isExactExample = exactExampleStems.some((exampleStem) => {
						// 去除换行符和多余空格后比较
						const normalizedExample = exampleStem.replace(/\s+/g, '').replace(/\n/g, '');
						const normalizedValue = firstCellValue.replace(/\s+/g, '').replace(/\n/g, '');
						return (
							normalizedValue === normalizedExample || normalizedValue.includes(normalizedExample.substring(0, 10))
						);
					});

					if (isExactExample) {
						this.logger.log(`[导入] 跳过示例数据行: 第 ${rowNumber} 行, 内容: ${firstCellValue.substring(0, 50)}`);
						skippedCount++;
						continue;
					} else {
						this.logger.log(`[导入] 第2行不是示例数据，作为数据行处理: ${firstCellValue.substring(0, 50)}`);
					}
				}

				// 检查是否是空行（第一列必须不为空，因为题干是必填的）
				const firstCellValue = row.getCell(1).value?.toString()?.trim();
				if (!firstCellValue || firstCellValue === '') {
					skippedCount++;
					this.logger.log(`[导入] 跳过空行: 第 ${rowNumber} 行（第一列为空）`);
					continue;
				}

				// 根据题目类型解析数据
				try {
					const parsedQuestion = this.parseQuestionByType(row, questionType, dto.chapterId);

					if (parsedQuestion && parsedQuestion.stem && parsedQuestion.stem.trim() !== '') {
						questions.push(parsedQuestion);
						parsedCount++;
						this.logger.log(`[导入] 解析成功: 第 ${rowNumber} 行, 题干: ${parsedQuestion.stem.substring(0, 50)}`);
					} else {
						skippedCount++;
						this.logger.warn(
							`[导入] 跳过无效行: 第 ${rowNumber} 行, 题干: ${firstCellValue.substring(0, 50)}, 解析结果: ${JSON.stringify(parsedQuestion)}`
						);
					}
				} catch (error: any) {
					// 捕获解析错误（如答案为空等），记录错误并跳过该行
					skippedCount++;
					const errorMessage = error.message || '解析失败';
					this.logger.error(`[导入] 第 ${rowNumber} 行解析失败: ${errorMessage}`);
					throw new BadRequestException(`第 ${rowNumber} 行导入失败：${errorMessage}`);
				}
			}

			this.logger.log(`[导入] 工作表 ${sheetName} 解析完成: 成功 ${parsedCount} 条, 跳过 ${skippedCount} 行`);
		}

		this.logger.log(`[导入] 总共解析到 ${questions.length} 条题目`);

		// 批量插入（异步处理，避免阻塞）
		if (questions.length > 0) {
			await this.questionRepository.save(questions);
		}

		return {
			success: true,
			count: questions.length,
		};
	}

	/**
	 * 根据题目类型解析题目数据
	 */
	private parseQuestionByType(row: ExcelJS.Row, type: QuestionType, chapterId: number): any {
		let stem = '';
		let options: Array<{ label: string; text: string }> = [];
		let answer: string[] = [];
		let analysis = '';
		let difficulty = 2;

		switch (type) {
			case QuestionType.SINGLE_CHOICE:
			case QuestionType.MULTIPLE_CHOICE:
				// 单选题/多选题：题干、选项A、选项B、选项C、选项D、答案、解析、难度
				// 注意：选项可以为空，为空的不计入选项
				stem = row.getCell(1).value?.toString() || '';
				options = this.parseOptions(row, 2, 5); // 选项A-D（列2-5），空选项会被自动过滤
				answer = this.parseAnswer(row.getCell(6).value?.toString() || '', false, options); // 验证答案对应的选项必须存在
				analysis = row.getCell(7).value?.toString() || '';
				difficulty = this.parseDifficulty(row.getCell(8).value?.toString() || '');
				break;

			case QuestionType.JUDGE:
				// 判断题：题干、选项A、选项B、答案、解析、难度
				// 注意：判断题的选项内容不需要填写，系统会自动使用"正确"/"错误"
				stem = row.getCell(1).value?.toString() || '';
				// 判断题固定使用"正确"和"错误"作为选项，不读取Excel中的选项内容
				options = [
					{ label: 'A', text: '正确' },
					{ label: 'B', text: '错误' },
				];
				answer = this.parseAnswer(row.getCell(4).value?.toString() || '', true); // 判断题答案必须是小写a或b
				analysis = row.getCell(5).value?.toString() || '';
				difficulty = this.parseDifficulty(row.getCell(6).value?.toString() || '');
				break;

			case QuestionType.FILL_BLANK:
				// 填空题：题干、答案、解析、难度
				stem = row.getCell(1).value?.toString() || '';
				answer = this.parseAnswer(row.getCell(2).value?.toString() || '', false); // 填空题答案不能为空
				analysis = row.getCell(3).value?.toString() || '';
				difficulty = this.parseDifficulty(row.getCell(4).value?.toString() || '');
				break;

			case QuestionType.SHORT_ANSWER:
				// 简答题：题干、参考答案、解析、难度
				stem = row.getCell(1).value?.toString() || '';
				answer = this.parseAnswer(row.getCell(2).value?.toString() || ''); // 参考答案作为答案
				analysis = row.getCell(3).value?.toString() || '';
				difficulty = this.parseDifficulty(row.getCell(4).value?.toString() || '');
				break;

			case QuestionType.READING_COMPREHENSION:
				// 阅读理解：题干（阅读材料）、子题1题干、子题1选项A-D、子题1答案、子题1解析、子题2题干、子题2选项A-D、子题2答案、子题2解析、难度
				// 注意：阅读理解需要特殊处理，这里只解析材料，子题需要单独处理
				stem = row.getCell(1).value?.toString() || '';
				difficulty = this.parseDifficulty(row.getCell(14).value?.toString() || '');
				// 阅读理解暂时只保存材料，子题需要手动添加
				break;

			default:
				return null;
		}

		// 如果题干为空，跳过
		if (!stem || stem.trim() === '') {
			return null;
		}

		return {
			chapter_id: chapterId,
			parent_id: 0, // 默认，阅读理解需要特殊处理
			type,
			stem: this.escapeLatex(stem),
			options: options.length > 0 ? options : null,
			answer,
			analysis: this.escapeLatex(analysis),
			difficulty,
		};
	}

	private parseQuestionType(typeStr: string): QuestionType {
		const typeMap: Record<string, QuestionType> = {
			单选: QuestionType.SINGLE_CHOICE,
			多选: QuestionType.MULTIPLE_CHOICE,
			判断: QuestionType.JUDGE,
			填空: QuestionType.FILL_BLANK,
			阅读理解: QuestionType.READING_COMPREHENSION,
			简答: QuestionType.SHORT_ANSWER,
			简答题: QuestionType.SHORT_ANSWER,
		};
		return typeMap[typeStr] || QuestionType.SINGLE_CHOICE;
	}

	/**
	 * 解析选项
	 * @param row Excel行对象
	 * @param startCol 起始列号（从1开始）
	 * @param endCol 结束列号（从1开始）
	 * @returns 选项数组，空选项会被过滤掉
	 */
	private parseOptions(row: ExcelJS.Row, startCol: number, endCol: number) {
		const options = [];
		for (let i = startCol; i <= endCol; i++) {
			const value = row.getCell(i).value?.toString()?.trim();
			// 只添加非空选项，空选项不计入
			if (value && value !== '') {
				options.push({
					label: String.fromCharCode(65 + i - startCol), // A, B, C, D
					text: value,
				});
			}
		}
		return options;
	}

	/**
	 * 解析答案
	 * @param answerStr 答案字符串
	 * @param isJudge 是否为判断题（判断题答案需要转换为大写）
	 * @param options 选项数组（用于验证答案对应的选项是否存在）
	 * @returns 答案数组
	 * @throws BadRequestException 如果答案为空或答案对应的选项不存在
	 */
	private parseAnswer(
		answerStr: string,
		isJudge: boolean = false,
		options?: Array<{ label: string; text: string }>
	): string[] {
		const trimmedAnswer = answerStr.trim();

		// 答案不能为空
		if (!trimmedAnswer || trimmedAnswer === '') {
			throw new BadRequestException('答案不能为空，请填写答案');
		}

		// 解析答案（支持逗号分隔的多选答案）
		const answers = trimmedAnswer
			.split(',')
			.map((a) => {
				const trimmed = a.trim().toUpperCase(); // 转换为大写
				if (isJudge) {
					// 判断题：只接受A或B，不区分大小写
					if (trimmed === 'A' || trimmed === 'B') {
						return trimmed;
					}
					throw new BadRequestException(`判断题答案只能填写 A 或 B，当前填写的是：${a.trim()}`);
				}
				return trimmed;
			})
			.filter(Boolean);

		// 验证答案不能为空数组
		if (answers.length === 0) {
			throw new BadRequestException('答案不能为空，请填写答案');
		}

		// 如果有选项数组，验证答案对应的选项必须存在
		if (options && options.length > 0) {
			const availableLabels = options.map((opt) => opt.label);
			const invalidAnswers = answers.filter((ans) => !availableLabels.includes(ans));
			if (invalidAnswers.length > 0) {
				throw new BadRequestException(
					`答案中包含不存在的选项：${invalidAnswers.join(', ')}。当前可用选项：${availableLabels.join(', ')}`
				);
			}
		}

		return answers;
	}

	private parseDifficulty(difficultyStr: string): number {
		const difficultyMap: Record<string, number> = {
			简单: 1,
			中等: 2,
			困难: 3,
		};
		return difficultyMap[difficultyStr] || 2;
	}

	private escapeLatex(text: string): string {
		// 简单的 LaTeX 转义处理
		// 实际项目中可能需要更复杂的处理
		return text.replace(/\$\$/g, '$$');
	}

	/**
	 * 生成题目导入模板 Excel 文件
	 */
	async generateTemplate(): Promise<Buffer> {
		const workbook = new ExcelJS.Workbook();
		const worksheet = workbook.addWorksheet('题目导入模板');

		// 设置列宽
		worksheet.columns = [
			{ width: 12 }, // 题型
			{ width: 50 }, // 题干
			{ width: 30 }, // 选项A
			{ width: 30 }, // 选项B
			{ width: 30 }, // 选项C
			{ width: 30 }, // 选项D
			{ width: 20 }, // 答案
			{ width: 50 }, // 解析
		];

		// 设置表头
		const headerRow = worksheet.getRow(1);
		headerRow.values = ['题型', '题干', '选项A', '选项B', '选项C', '选项D', '答案', '解析'];

		// 设置表头样式
		headerRow.font = { bold: true, size: 12 };
		headerRow.fill = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: 'FFE0E0E0' },
		};
		headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
		headerRow.height = 25;

		// 添加示例数据行
		const exampleRows = [
			{
				题型: '单选',
				题干: '下列哪个选项是正确的？',
				选项A: '选项A的内容',
				选项B: '选项B的内容',
				选项C: '选项C的内容',
				选项D: '选项D的内容',
				答案: 'A',
				解析: '这是解析内容',
			},
			{
				题型: '多选',
				题干: '以下哪些选项是正确的？（多选）',
				选项A: '选项A的内容',
				选项B: '选项B的内容',
				选项C: '选项C的内容',
				选项D: '选项D的内容',
				答案: 'A,B',
				解析: '这是解析内容',
			},
			{
				题型: '判断',
				题干: '这个说法是否正确？',
				选项A: '正确',
				选项B: '错误',
				选项C: '',
				选项D: '',
				答案: 'A',
				解析: '这是解析内容',
			},
			{
				题型: '填空',
				题干: '请填写空白处：中国的首都是______。',
				选项A: '',
				选项B: '',
				选项C: '',
				选项D: '',
				答案: '北京',
				解析: '这是解析内容',
			},
		];

		exampleRows.forEach((row, index) => {
			const dataRow = worksheet.addRow([
				row.题型,
				row.题干,
				row.选项A,
				row.选项B,
				row.选项C,
				row.选项D,
				row.答案,
				row.解析,
			]);
			dataRow.height = 20;

			// 设置数据行样式
			if (index % 2 === 0) {
				dataRow.fill = {
					type: 'pattern',
					pattern: 'solid',
					fgColor: { argb: 'FFF9F9F9' },
				};
			}
		});

		// 添加说明行
		const noteRow = worksheet.addRow([]);
		noteRow.height = 30;
		worksheet.mergeCells(`A${noteRow.number}:H${noteRow.number}`);
		const noteCell = worksheet.getCell(`A${noteRow.number}`);
		noteCell.value =
			'填写说明：\n' +
			'1. 题型：单选、多选、判断、填空、阅读理解、简答\n' +
			'2. 题干：题目的主要内容，支持HTML格式\n' +
			'3. 选项A-D：选择题的选项内容（判断题只需填写A和B，填空和简答题可不填）\n' +
			'4. 答案：单选题填单个选项（如A），多选题填多个选项用逗号分隔（如A,B），判断题填A或B，填空题填答案内容\n' +
			'5. 解析：题目的解析说明，支持HTML格式';
		noteCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
		noteCell.font = { size: 10, color: { argb: 'FF666666' } };
		noteCell.fill = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: 'FFFFF9E6' },
		};

		// 设置所有单元格的边框
		worksheet.eachRow((row, rowNumber) => {
			row.eachCell((cell) => {
				cell.border = {
					top: { style: 'thin' },
					left: { style: 'thin' },
					bottom: { style: 'thin' },
					right: { style: 'thin' },
				};
				if (rowNumber > 1 && rowNumber <= exampleRows.length + 1) {
					cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
				}
			});
		});

		// 生成 Buffer
		const buffer = await workbook.xlsx.writeBuffer();
		return Buffer.from(buffer);
	}
}
