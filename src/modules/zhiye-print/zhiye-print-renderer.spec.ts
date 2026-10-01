import { BadRequestException } from '@nestjs/common';
import { downloadPrintImage, renderQuestionsToPdf, validateRenderInput } from './zhiye-print-renderer';

describe('知页练习纸输入与图片边界', () => {
  const question = { prompt: '3 + 2 = ?', options: ['4', '5'], answer: 1 };
  it('拒绝空题、超限题量和非法选项索引', () => {
    expect(() => validateRenderInput({ questions: [] })).toThrow(BadRequestException);
    expect(() => validateRenderInput({ questions: Array(51).fill(question) })).toThrow(BadRequestException);
    expect(() => validateRenderInput({ questions: [{ ...question, answerIndices: [9] }] })).toThrow(BadRequestException);
  });
  it('所有非白名单与非HTTPS图片在发请求前拒绝', async () => {
    for (const url of ['file:///etc/passwd', 'http://127.0.0.1/a.png', 'https://evil.example/a.png', 'https://r1-ndr.ykt.cbern.com.cn:8443/a', 'https://user:secret@r1-ndr.ykt.cbern.com.cn/a']) {
      await expect(downloadPrintImage(url)).rejects.toThrow(BadRequestException);
    }
  });
  it('不把缺失图片或音视频题静默变成可付费打印稿', async () => {
    await expect(renderQuestionsToPdf({ questions: [{ ...question, rich: true, prompt: '<video src="https://example.com/a"></video>' }] })).rejects.toThrow('音视频或复杂公式');
    await expect(renderQuestionsToPdf({ questions: [{ ...question, rich: true, prompt: '<img>' }] })).rejects.toThrow('缺少地址');
    await expect(renderQuestionsToPdf({ questions: [{ ...question, rich: true, prompt: '<img src="file:///etc/passwd">' }] })).rejects.toThrow(BadRequestException);
  });
});
