import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

/**
 * 小程序 web-view 内嵌 PDF 预览：返回一个 H5 页面，用 PDF.js 渲染课程 PDF。
 * 小程序打开 web-view src="/api/app/pdf-viewer?courseId=xxx&ticket=xxx" 即可在小程序内查看。
 */
@ApiTags('课程')
@Controller('app')
export class AppPdfViewerController {
  @Get('pdf-viewer')
  @ApiOperation({ summary: 'PDF 内嵌预览页（供小程序 web-view 加载）' })
  getPdfViewerHtml(
    @Query('courseId') courseId: string,
    @Query('ticket') ticket: string,
    @Res() res: Response,
  ) {
    const cid = courseId?.trim();
    const t = ticket?.trim();
    if (!cid || !t) {
      res.status(400).send('缺少 courseId 或 ticket');
      return;
    }
    const html = this.buildViewerHtml(cid, t);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  private buildViewerHtml(courseId: string, ticket: string): string {
    const pdfUrl = `/api/app/courses/${courseId}/file-preview?ticket=${encodeURIComponent(ticket)}`;
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=2.0, user-scalable=yes" />
  <title>PDF 预览</title>
  <script src="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.mjs" type="module"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1a1a1a; color: #eee; min-height: 100vh; padding: 12px; }
    #toolbar { position: sticky; top: 0; z-index: 10; background: #2a2a2a; padding: 8px 12px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    #toolbar button { padding: 8px 14px; border: none; border-radius: 6px; background: #4a9eff; color: #fff; font-size: 14px; cursor: pointer; }
    #toolbar button:disabled { opacity: 0.5; cursor: not-allowed; }
    #toolbar span { font-size: 14px; }
    #container { margin-top: 12px; }
    #container canvas { display: block; margin: 0 auto 16px; max-width: 100%; height: auto; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
    #loading { text-align: center; padding: 40px; font-size: 16px; }
    #error { color: #f44; padding: 20px; }
  </style>
</head>
<body>
  <div id="toolbar" style="display:none">
    <button id="prev">上一页</button>
    <button id="next">下一页</button>
    <span id="pageInfo">- / -</span>
  </div>
  <div id="loading">加载中…</div>
  <div id="container"></div>
  <div id="error"></div>
  <script type="module">
    const pdfUrl = ${JSON.stringify(pdfUrl)};
    const container = document.getElementById('container');
    const loading = document.getElementById('loading');
    const toolbar = document.getElementById('toolbar');
    const errorEl = document.getElementById('error');
    const prevBtn = document.getElementById('prev');
    const nextBtn = document.getElementById('next');
    const pageInfo = document.getElementById('pageInfo');

    const { getDocument, GlobalWorkerOptions } = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.mjs');
    GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.mjs';

    try {
      const pdf = await getDocument({ url: pdfUrl, withCredentials: true }).promise;
      const numPages = pdf.numPages;
      loading.style.display = 'none';
      toolbar.style.display = 'flex';

      let currentPage = 1;
      function renderPage(num) {
        pdf.getPage(num).then(page => {
          const scale = Math.min(2, (window.innerWidth - 24) / page.getViewport({ scale: 1 }).width);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          container.innerHTML = '';
          container.appendChild(canvas);
          page.render({ canvasContext: ctx, viewport }).promise.then(() => {});
        });
        pageInfo.textContent = num + ' / ' + numPages;
        prevBtn.disabled = num <= 1;
        nextBtn.disabled = num >= numPages;
        currentPage = num;
      }

      prevBtn.onclick = () => renderPage(currentPage - 1);
      nextBtn.onclick = () => renderPage(currentPage + 1);
      renderPage(1);
    } catch (e) {
      loading.style.display = 'none';
      errorEl.textContent = '加载失败：' + (e.message || String(e));
    }
  </script>
</body>
</html>`;
  }
}
