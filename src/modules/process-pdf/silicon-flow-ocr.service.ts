import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const SILICON_FLOW_BASE = 'https://api.siliconflow.cn/v1';
const OCR_MODEL = 'PaddlePaddle/PaddleOCR-VL-1.5';
const OCR_PROMPT = '<image>\n<|grounding|>请对图片进行OCR识别，保留原文排版和换行，直接输出识别出的文字，不要额外说明。';

@Injectable()
export class SiliconFlowOcrService {
  constructor(private readonly configService: ConfigService) {}

  getApiKey(): string | undefined {
    return this.configService.get<string>('SILICON_FLOW_API_KEY');
  }

  /**
   * 调用硅基流动 PaddleOCR-VL-1.5 对单张图片（base64）进行 OCR
   */
  async ocrImageBase64(imageBase64: string): Promise<string> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('未配置 SILICON_FLOW_API_KEY，无法使用图片 PDF OCR 功能');
    }
    const url = `${SILICON_FLOW_BASE}/chat/completions`;
    const imageUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/png;base64,${imageBase64}`;
    const res = await axios.post(
      url,
      {
        model: OCR_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
              { type: 'text', text: OCR_PROMPT },
            ],
          },
        ],
        max_tokens: 4096,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      },
    );
    const content = res.data?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content.trim() : '';
  }
}
