export function buildPdfViewerHtml(courseId: string, ticket: string, fileId = ''): string {
  const params = [`ticket=${encodeURIComponent(ticket)}`];
  if (fileId) params.push(`fileId=${encodeURIComponent(fileId)}`);
  const pdfUrl = `/api/app/courses/${encodeURIComponent(courseId)}/file-preview?${params.join('&')}`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes" />
  <title>课程资料</title>
  <style>
    :root { --toolbar-height: 64px; --sidebar-width: 184px; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; background: #eef1f5; }
    button, input { font: inherit; }
    button { cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: .4; }
    .viewer { width: 100%; height: 100%; display: flex; flex-direction: column; }
    .toolbar {
      height: var(--toolbar-height); flex: 0 0 auto; display: grid;
      grid-template-columns: minmax(250px, 1fr) auto minmax(360px, 1fr);
      align-items: center; gap: 18px; padding: 0 20px; z-index: 20;
      border-bottom: 1px solid #dfe4ea; background: rgba(255,255,255,.97);
      box-shadow: 0 2px 12px rgba(17,31,53,.06);
    }
    .group { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .group.end { justify-content: flex-end; }
    .title { margin-left: 6px; overflow: hidden; font-size: 16px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .btn, .icon-btn, .zoom-value {
      height: 36px; display: inline-flex; align-items: center; justify-content: center;
      padding: 0 14px; border: 1px solid #ccd4df; border-radius: 8px;
      color: #27364d; background: #fff; font-size: 14px;
    }
    .btn:hover, .icon-btn:hover, .zoom-value:hover { border-color: #1767f2; color: #1767f2; }
    .btn.quiet { border-color: transparent; background: #f4f6f9; }
    .btn.primary { border-color: #1767f2; color: #fff; background: #1767f2; }
    .icon-btn { width: 36px; padding: 0; font-size: 20px; }
    .zoom-value { min-width: 64px; padding: 0 8px; }
    .page-control { justify-content: center; }
    .page-input { width: 54px; height: 36px; border: 1px solid #ccd4df; border-radius: 8px; text-align: center; }
    .page-total { min-width: 42px; color: #66758c; font-size: 14px; }
    .body { min-height: 0; flex: 1; display: flex; }
    .sidebar {
      width: var(--sidebar-width); height: 100%; flex: 0 0 auto; overflow: auto;
      padding: 18px 14px 28px; border-right: 1px solid #dfe4ea; background: #fff;
    }
    .sidebar.hidden { display: none; }
    .sidebar-title { display: block; margin: 0 6px 12px; color: #718096; font-size: 13px; font-weight: 700; }
    .page-nav {
      width: 100%; margin: 0 0 12px; padding: 8px; display: flex; flex-direction: column;
      align-items: center; gap: 6px; border: 1px solid transparent; border-radius: 10px;
      color: #607086; background: transparent; font-size: 12px;
    }
    .page-nav.active { border-color: #8eb8ff; color: #1767f2; background: #edf4ff; }
    .nav-sheet {
      width: 76px; height: 100px; display: flex; align-items: center; justify-content: center;
      border: 1px solid #d7dde6; color: #a0aabc; background: #fff;
      box-shadow: 0 2px 8px rgba(20,36,58,.08); font-size: 22px; font-weight: 700;
    }
    .document-scroll { position: relative; min-width: 0; height: 100%; flex: 1; overflow: auto; overscroll-behavior: contain; }
    .pages { width: max-content; min-width: 100%; padding: 32px 36px 80px; display: flex; flex-direction: column; align-items: center; gap: 24px; }
    .pdf-page {
      position: relative; flex: 0 0 auto; overflow: hidden; background: #fff;
      box-shadow: 0 6px 24px rgba(23,32,51,.14); scroll-margin-top: 24px;
    }
    .pdf-page.current { box-shadow: 0 0 0 2px rgba(23,103,242,.42), 0 8px 28px rgba(23,32,51,.16); }
    .pdf-page canvas { display: block; width: 100%; height: 100%; background: #fff; }
    .page-placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #97a3b5; }
    .state { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; color: #67758a; }
    .state[hidden] { display: none; }
    .state-title { color: #27364d; font-size: 20px; font-weight: 700; }
    .spinner { width: 30px; height: 30px; border: 3px solid #d7e3f7; border-top-color: #1767f2; border-radius: 50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 1100px) {
      :root { --sidebar-width: 150px; }
      .toolbar { grid-template-columns: 1fr auto; }
      .page-control { position: absolute; left: 50%; transform: translateX(-50%); }
      .title, #sidebarToggle { display: none; }
    }
    @media (max-width: 820px) {
      .sidebar { display: none; }
      .toolbar { padding: 0 10px; }
      .btn { padding: 0 10px; }
      #fullscreen, #fitWidth { display: none; }
    }
  </style>
</head>
<body>
  <main class="viewer" id="viewer">
    <header class="toolbar">
      <div class="group">
        <button class="btn quiet" id="back">返回课程</button>
        <button class="btn quiet" id="sidebarToggle">隐藏导航</button>
        <span class="title">课程资料</span>
      </div>
      <div class="group page-control">
        <button class="icon-btn" id="prev" aria-label="上一页">‹</button>
        <input class="page-input" id="pageInput" type="number" value="1" min="1" />
        <span class="page-total" id="pageTotal">/ -</span>
        <button class="icon-btn" id="next" aria-label="下一页">›</button>
      </div>
      <div class="group end">
        <button class="icon-btn" id="zoomOut" aria-label="缩小">−</button>
        <button class="zoom-value" id="fitWidth">适应宽度</button>
        <button class="icon-btn" id="zoomIn" aria-label="放大">＋</button>
        <button class="btn" id="fullscreen">全屏</button>
      </div>
    </header>
    <section class="body">
      <aside class="sidebar" id="sidebar"><span class="sidebar-title">页面</span></aside>
      <div class="document-scroll" id="documentScroll">
        <div class="pages" id="pages"></div>
        <div class="state" id="loading"><span class="spinner"></span><span>正在打开课程资料…</span></div>
        <div class="state" id="error" hidden><span class="state-title">资料加载失败</span><span id="errorMessage"></span><button class="btn primary" id="retry">重新加载</button></div>
      </div>
    </section>
  </main>
  <script type="module">
    const pdfUrl = ${JSON.stringify(pdfUrl)};
    const PDF_JS_BASE = '/api/app/pdf-viewer-assets';
    const { getDocument, GlobalWorkerOptions } = await import(PDF_JS_BASE + '/pdf.min.mjs');
    GlobalWorkerOptions.workerSrc = PDF_JS_BASE + '/pdf.worker.min.mjs';

    const elements = {
      viewer: document.getElementById('viewer'), sidebar: document.getElementById('sidebar'),
      sidebarToggle: document.getElementById('sidebarToggle'), scroll: document.getElementById('documentScroll'),
      pages: document.getElementById('pages'), loading: document.getElementById('loading'),
      error: document.getElementById('error'), errorMessage: document.getElementById('errorMessage'),
      pageInput: document.getElementById('pageInput'), pageTotal: document.getElementById('pageTotal'),
      prev: document.getElementById('prev'), next: document.getElementById('next'),
      zoomOut: document.getElementById('zoomOut'), zoomIn: document.getElementById('zoomIn'),
      fitWidth: document.getElementById('fitWidth'), fullscreen: document.getElementById('fullscreen'),
    };
    const state = { pdf: null, current: 1, zoom: 1, minZoom: .75, maxZoom: 2.5, rendered: new Set(), rendering: new Set(), ratios: new Map() };
    let observer = null;
    let resizeTimer = null;
    let scrollFrame = null;

    function basePageWidth() { return Math.max(560, Math.min(1040, elements.scroll.clientWidth - 72)); }
    function pageWidth() { return Math.round(basePageWidth() * state.zoom); }
    function pageRatio(num) { return state.ratios.get(num) || 1.414; }
    function updateShellSize(shell, num) {
      const width = pageWidth();
      shell.style.width = width + 'px';
      shell.style.height = Math.round(width * pageRatio(num)) + 'px';
    }
    function updateControls() {
      elements.pageInput.value = String(state.current);
      elements.prev.disabled = state.current <= 1;
      elements.next.disabled = !state.pdf || state.current >= state.pdf.numPages;
      elements.zoomOut.disabled = state.zoom <= state.minZoom;
      elements.zoomIn.disabled = state.zoom >= state.maxZoom;
      document.querySelectorAll('.page-nav').forEach((item) => item.classList.toggle('active', Number(item.dataset.page) === state.current));
      document.querySelectorAll('.pdf-page').forEach((item) => item.classList.toggle('current', Number(item.dataset.page) === state.current));
    }
    function notifyPageChange() {
      const payload = { type: 'practice-hub-pdf-page', page: state.current, totalPages: state.pdf?.numPages || 0 };
      try { window.parent?.postMessage(payload, '*'); } catch (_) {}
      try { window.wx?.miniProgram?.postMessage({ data: payload }); } catch (_) {}
    }
    function setCurrent(num) {
      const next = Math.min(state.pdf?.numPages || 1, Math.max(1, Number(num) || 1));
      if (next === state.current) return;
      state.current = next;
      updateControls();
      notifyPageChange();
    }
    function goToPage(num, smooth = true) {
      const next = Math.min(state.pdf?.numPages || 1, Math.max(1, Number(num) || 1));
      const shell = elements.pages.querySelector('[data-page="' + next + '"]');
      if (!shell) return;
      elements.scroll.scrollTo({ top: shell.offsetTop - 24, behavior: smooth ? 'smooth' : 'auto' });
      setCurrent(next);
      renderPage(next);
    }
    async function renderPage(num, force = false) {
      if (!state.pdf || state.rendering.has(num) || (state.rendered.has(num) && !force)) return;
      const shell = elements.pages.querySelector('[data-page="' + num + '"]');
      const canvas = shell?.querySelector('canvas');
      if (!shell || !canvas) return;
      state.rendering.add(num);
      try {
        const page = await state.pdf.getPage(num);
        const unit = page.getViewport({ scale: 1 });
        state.ratios.set(num, unit.height / unit.width);
        updateShellSize(shell, num);
        const cssWidth = pageWidth();
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: (cssWidth / unit.width) * outputScale });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = cssWidth + 'px';
        canvas.style.height = Math.round(cssWidth * pageRatio(num)) + 'px';
        await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
        shell.querySelector('.page-placeholder')?.remove();
        state.rendered.add(num);
      } finally {
        state.rendering.delete(num);
      }
    }
    function rerenderLoadedPages() {
      document.querySelectorAll('.pdf-page').forEach((shell) => updateShellSize(shell, Number(shell.dataset.page)));
      [...state.rendered].forEach((num) => { state.rendered.delete(num); renderPage(num, true); });
    }
    function buildPages() {
      elements.pages.innerHTML = '';
      elements.sidebar.querySelectorAll('.page-nav').forEach((item) => item.remove());
      for (let num = 1; num <= state.pdf.numPages; num += 1) {
        const shell = document.createElement('section');
        shell.className = 'pdf-page'; shell.dataset.page = String(num); updateShellSize(shell, num);
        const canvas = document.createElement('canvas');
        const placeholder = document.createElement('div'); placeholder.className = 'page-placeholder'; placeholder.textContent = '第 ' + num + ' 页';
        shell.append(canvas, placeholder); elements.pages.appendChild(shell);
        const nav = document.createElement('button'); nav.className = 'page-nav'; nav.dataset.page = String(num);
        nav.innerHTML = '<span class="nav-sheet">' + num + '</span><span>第 ' + num + ' 页</span>';
        nav.onclick = () => goToPage(num); elements.sidebar.appendChild(nav);
      }
      observer?.disconnect();
      observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) renderPage(Number(entry.target.dataset.page));
      }), { root: elements.scroll, rootMargin: '900px 0px', threshold: .01 });
      document.querySelectorAll('.pdf-page').forEach((shell) => observer.observe(shell));
    }
    async function loadPdf() {
      elements.loading.hidden = false; elements.error.hidden = true;
      try {
        state.pdf = await getDocument({ url: pdfUrl, withCredentials: true }).promise;
        elements.pageTotal.textContent = '/ ' + state.pdf.numPages;
        elements.pageInput.max = String(state.pdf.numPages);
        buildPages(); updateControls(); elements.loading.hidden = true; goToPage(1, false);
      } catch (error) {
        elements.loading.hidden = true; elements.error.hidden = false;
        elements.errorMessage.textContent = error?.message || '无法读取 PDF 文件';
      }
    }
    function changeZoom(delta) {
      state.zoom = Math.min(state.maxZoom, Math.max(state.minZoom, Number((state.zoom + delta).toFixed(2))));
      elements.fitWidth.textContent = Math.round(state.zoom * 100) + '%'; updateControls(); rerenderLoadedPages();
    }
    elements.scroll.addEventListener('scroll', () => {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => {
        const rootTop = elements.scroll.getBoundingClientRect().top + 96;
        let closest = state.current, distance = Infinity;
        document.querySelectorAll('.pdf-page').forEach((shell) => {
          const next = Math.abs(shell.getBoundingClientRect().top - rootTop);
          if (next < distance) { distance = next; closest = Number(shell.dataset.page) || closest; }
        });
        setCurrent(closest);
      });
    }, { passive: true });
    elements.prev.onclick = () => goToPage(state.current - 1);
    elements.next.onclick = () => goToPage(state.current + 1);
    elements.pageInput.onchange = () => goToPage(elements.pageInput.value);
    elements.pageInput.onkeydown = (event) => { if (event.key === 'Enter') goToPage(elements.pageInput.value); };
    elements.zoomOut.onclick = () => changeZoom(-.25);
    elements.zoomIn.onclick = () => changeZoom(.25);
    elements.fitWidth.onclick = () => { state.zoom = 1; elements.fitWidth.textContent = '适应宽度'; rerenderLoadedPages(); updateControls(); };
    elements.sidebarToggle.onclick = () => {
      elements.sidebar.classList.toggle('hidden');
      elements.sidebarToggle.textContent = elements.sidebar.classList.contains('hidden') ? '页面导航' : '隐藏导航';
      setTimeout(() => { rerenderLoadedPages(); }, 0);
    };
    elements.fullscreen.onclick = async () => document.fullscreenElement ? document.exitFullscreen?.() : elements.viewer.requestFullscreen?.();
    document.getElementById('back').onclick = () => history.back();
    document.getElementById('retry').onclick = loadPdf;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(rerenderLoadedPages, 180); });
    window.addEventListener('keydown', (event) => {
      if (event.target?.matches?.('input')) return;
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); goToPage(state.current - 1); }
      if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); goToPage(state.current + 1); }
      if ((event.ctrlKey || event.metaKey) && ['+', '='].includes(event.key)) { event.preventDefault(); changeZoom(.25); }
      if ((event.ctrlKey || event.metaKey) && event.key === '-') { event.preventDefault(); changeZoom(-.25); }
    });
    loadPdf();
  </script>
</body>
</html>`;
}
