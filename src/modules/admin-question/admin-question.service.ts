import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
  constructor(
    @InjectRepository(Question)
    private questionRepository: Repository<Question>,
    @InjectRepository(Chapter)
    private chapterRepository: Repository<Chapter>,
  ) {}

  /**
   * 新增/编辑题目
   */
  async saveQuestion(dto: CreateQuestionDto | UpdateQuestionDto, id?: number) {
    // 处理 options 字段，确保格式正确
    const processedDto: any = { ...dto };
    
    if (processedDto.options) {
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
      
      console.log('保存时的 options:', JSON.stringify(processedDto.options, null, 2));
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
    const queryBuilder = this.questionRepository.createQueryBuilder('question')
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
      console.log('开始处理 options，类型:', typeof question.options, '是否为数组:', Array.isArray(question.options));
      
      // 如果 options 是数组格式 [{label: "A", text: "aaaa"}]
      if (Array.isArray(question.options)) {
        console.log('options 是数组，长度:', question.options.length);
        
        // 检查是否是嵌套数组格式 [[], []]（错误格式）
        const firstItem = question.options[0];
        if (Array.isArray(firstItem) && firstItem.length === 0) {
          console.log('检测到错误格式：嵌套空数组，返回空数组');
          processedOptions = [];
        } else {
          processedOptions = question.options
            .map((opt: any, index: number) => {
              console.log(`处理选项 ${index}:`, JSON.stringify(opt));
              
              // 如果是空数组，跳过
              if (Array.isArray(opt) && opt.length === 0) {
                console.log(`选项 ${index} 是空数组，跳过`);
                return null;
              }
              
              // 如果已经是正确格式 {label, text}，直接返回
              if (opt && typeof opt === 'object' && opt !== null && !Array.isArray(opt) && 'label' in opt && 'text' in opt) {
                console.log(`选项 ${index} 格式正确`);
                return {
                  label: String(opt.label || ''),
                  text: String(opt.text || ''),
                };
              }
              
              // 如果是对象格式但没有 label 和 text，可能是单个对象
              if (typeof opt === 'object' && opt !== null && !Array.isArray(opt)) {
                const keys = Object.keys(opt);
                console.log(`选项 ${index} 是对象，键:`, keys);
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
                console.log(`选项 ${index} 是字符串，尝试解析`);
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
                  console.log(`解析选项 ${index} 失败:`, e);
                }
              }
              
              console.log(`选项 ${index} 无法处理，返回 null`);
              return null;
            })
            .filter((item: any) => item !== null) // 过滤掉 null 值
            .flat(); // 扁平化数组（处理嵌套情况）
        }
      } 
      // 如果是对象格式 {A: "aaaa", B: "bbbb"}
      else if (typeof question.options === 'object' && question.options !== null && !Array.isArray(question.options)) {
        console.log('options 是对象格式');
        processedOptions = Object.keys(question.options).map((key) => ({
          label: key,
          text: String((question.options as any)[key] || ''),
        }));
      } 
      // 如果是字符串，尝试解析 JSON
      else if (typeof question.options === 'string') {
        console.log('options 是字符串，尝试解析 JSON');
        try {
          const parsed = JSON.parse(question.options);
          console.log('解析后的数据:', JSON.stringify(parsed, null, 2));
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
          console.log('解析 JSON 失败:', e, '原始字符串:', question.options);
        }
      } else {
        console.log('options 类型未知:', typeof question.options);
      }
    } else {
      console.log('question.options 为空或未定义');
    }
    
    console.log('处理后的 options:', JSON.stringify(processedOptions, null, 2));
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
    const buffer = Buffer.isBuffer(dto.file.buffer) 
      ? dto.file.buffer 
      : Buffer.from(new Uint8Array(dto.file.buffer));
    await workbook.xlsx.load(buffer as any);

    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) {
      throw new BadRequestException('Excel 文件格式错误');
    }

    const questions = [];

    // 跳过表头，从第二行开始
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // 跳过表头

      const type = this.parseQuestionType(row.getCell(1).value?.toString() || '');
      const stem = row.getCell(2).value?.toString() || '';
      const options = this.parseOptions(row, 3, 6); // 选项A-D
      const answer = this.parseAnswer(row.getCell(7).value?.toString() || '');
      const analysis = row.getCell(8).value?.toString() || '';
      const difficulty = this.parseDifficulty(row.getCell(9).value?.toString() || '');

      if (stem) {
        questions.push({
          chapter_id: dto.chapterId,
          parent_id: 0, // 默认，阅读理解需要特殊处理
          type,
          stem: this.escapeLatex(stem),
          options,
          answer,
          analysis: this.escapeLatex(analysis),
          difficulty,
        });
      }
    });

    // 批量插入（异步处理，避免阻塞）
    if (questions.length > 0) {
      await this.questionRepository.save(questions);
    }

    return {
      success: true,
      count: questions.length,
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

  private parseOptions(row: ExcelJS.Row, startCol: number, endCol: number) {
    const options = [];
    for (let i = startCol; i <= endCol; i++) {
      const value = row.getCell(i).value?.toString();
      if (value) {
        options.push({
          label: String.fromCharCode(65 + i - startCol), // A, B, C, D
          text: value,
        });
      }
    }
    return options;
  }

  private parseAnswer(answerStr: string): string[] {
    return answerStr.split(',').map((a) => a.trim()).filter(Boolean);
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
}
