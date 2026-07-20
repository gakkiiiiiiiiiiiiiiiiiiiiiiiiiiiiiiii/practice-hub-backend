import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { buildPdfViewerHtml } from './app-pdf-viewer.template';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

const PDF_JS_PATH = require.resolve('pdfjs-dist/build/pdf.min.mjs');
const PDF_WORKER_PATH = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs');

/**
 * 小程序 web-view 内嵌 PDF 预览：返回一个 H5 页面，用 PDF.js 渲染课程 PDF。
 * 小程序打开 web-view src="/api/app/pdf-viewer?courseId=xxx&ticket=xxx" 即可在小程序内查看。
 */
@ApiTags('课程')
@Controller('app')
export class AppPdfViewerController {
  @Get('pdf-viewer-assets/pdf.min.mjs')
  getPdfJs(@Res() res: Response) {
    this.sendViewerAsset(res, PDF_JS_PATH);
  }

  @Get('pdf-viewer-assets/pdf.worker.min.mjs')
  getPdfWorker(@Res() res: Response) {
    this.sendViewerAsset(res, PDF_WORKER_PATH);
  }

  @Get('pdf-viewer')
  @ApiOperation({ summary: 'PDF 内嵌预览页（供小程序 web-view 加载）' })
  getPdfViewerHtml(
    @Query('courseId') courseId: string,
    @Query('ticket') ticket: string,
    @Query('fileId') fileId: string | undefined,
    @Res() res: Response,
  ) {
    const cid = courseId?.trim();
    const t = ticket?.trim();
    if (!cid || !t) {
      res.status(400).send('缺少 courseId 或 ticket');
      return;
    }
    const normalizedFileId = Number.isInteger(Number(fileId)) && Number(fileId) > 0
      ? String(Number(fileId))
      : '';
    const html = buildPdfViewerHtml(cid, t, normalizedFileId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  }

  private sendViewerAsset(res: Response, assetPath: string) {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(assetPath);
  }
}
