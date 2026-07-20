import { buildPdfViewerHtml } from './app-pdf-viewer.template';

describe('buildPdfViewerHtml', () => {
  it('binds the selected course file and preview ticket to the PDF request', () => {
    const html = buildPdfViewerHtml('42', 'ticket.with/slash', '7');

    expect(html).toContain(
      '/api/app/courses/42/file-preview?ticket=ticket.with%2Fslash&fileId=7',
    );
  });

  it('renders pages lazily at device pixel ratio for desktop clarity', () => {
    const html = buildPdfViewerHtml('42', 'ticket');

    expect(html).toContain('new IntersectionObserver');
    expect(html).toContain('window.devicePixelRatio');
    expect(html).toContain("document.createElement('section')");
    expect(html).toContain('适应宽度');
    expect(html).toContain("const PDF_JS_BASE = '/api/app/pdf-viewer-assets'");
    expect(html).not.toContain('cdn.jsdelivr.net');
  });
});
