import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PDFDocument } from 'pdf-lib';
import { ZhiyePrintService } from '../zhiye-print/zhiye-print.service';
import { ZhiyeMaterialsService } from './zhiye-materials.service';

describe('ZhiyeMaterialsService', () => {
  let root: string;
  let service: ZhiyeMaterialsService;
  let printService: { createDraftFromPdfBuffer: jest.Mock };
  let items: any[];

  const makePdf = async (pageCount: number, title = 'source metadata') => {
    const pdf = await PDFDocument.create();
    pdf.setTitle(title);
    pdf.setAuthor('private source author');
    for (let index = 0; index < pageCount; index += 1) {
      const page = pdf.addPage([300, 400]);
      page.drawText(`page ${index + 1}`);
    }
    return Buffer.from(await pdf.save());
  };

  const addMaterial = async (
    id: string,
    format: string,
    buffer: Buffer,
    relativeFile = `files/${id}.${format}`,
  ) => {
    await writeFile(join(root, relativeFile), buffer);
    const item = {
      id,
      title: `${id} title`,
      format,
      localFile: `/data/official/${relativeFile}`,
      bytes: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
    items.push(item);
    return item;
  };

  const saveCatalog = async () => {
    await writeFile(join(root, 'materials.json'), JSON.stringify({ items }));
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'zhiye-materials-'));
    await mkdir(join(root, 'files'));
    items = [];
    printService = { createDraftFromPdfBuffer: jest.fn() };
    const testingModule = await Test.createTestingModule({
      providers: [
        ZhiyeMaterialsService,
        { provide: ConfigService, useValue: { get: jest.fn(() => root) } },
        { provide: ZhiyePrintService, useValue: printService },
      ],
    }).compile();
    service = testingModule.get(ZhiyeMaterialsService);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns a real three-page PDF without the source metadata for a five-page material', async () => {
    await addMaterial('five-page', 'pdf', await makePdf(5));
    await saveCatalog();

    const result = await service.getPreview('five-page');
    const preview = await PDFDocument.load(result.buffer, { updateMetadata: false });

    expect(preview.getPageCount()).toBe(3);
    expect(result.pageCount).toBe(5);
    expect(result.previewPageCount).toBe(3);
    expect(preview.getTitle()).toBeUndefined();
    expect(preview.getAuthor()).toBeUndefined();
  });

  it('returns all pages when a PDF has fewer than three pages', async () => {
    await addMaterial('short-paper', 'pdf', await makePdf(2));
    await saveCatalog();

    const result = await service.getPreview('short-paper');
    const preview = await PDFDocument.load(result.buffer);

    expect(preview.getPageCount()).toBe(2);
    expect(result.previewPageCount).toBe(2);
  });

  it('rejects unknown IDs and traversal-like IDs without resolving a user path', async () => {
    await saveCatalog();

    await expect(service.getPreview('missing')).rejects.toThrow('未找到该试卷资料');
    await expect(service.getPreview('../materials.json')).rejects.toThrow('未找到该试卷资料');
  });

  it('rejects a trusted catalog entry that attempts to escape the configured root', async () => {
    const outsidePdf = await makePdf(1);
    await writeFile(join(root, 'outside.pdf'), outsidePdf);
    items.push({
      id: 'traversal-entry',
      title: 'traversal',
      format: 'pdf',
      localFile: '/data/official/../outside.pdf',
      sha256: createHash('sha256').update(outsidePdf).digest('hex'),
    });
    await saveCatalog();

    await expect(service.getPreview('traversal-entry')).rejects.toThrow('试卷文件路径越界');
  });

  it('rejects a symlink that resolves outside the configured root', async () => {
    const outsideRoot = await mkdtemp(join(tmpdir(), 'zhiye-materials-outside-'));
    try {
      const outsideFile = join(outsideRoot, 'outside.pdf');
      const outsidePdf = await makePdf(1);
      await writeFile(outsideFile, outsidePdf);
      await symlink(outsideFile, join(root, 'files', 'linked.pdf'));
      items.push({
        id: 'linked-paper',
        title: 'linked',
        format: 'pdf',
        localFile: '/data/official/files/linked.pdf',
        sha256: createHash('sha256').update(outsidePdf).digest('hex'),
      });
      await saveCatalog();

      await expect(service.getPreview('linked-paper')).rejects.toThrow('试卷文件路径越界');
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('reports non-PDF material as unsupported and refuses its preview', async () => {
    await addMaterial('word-paper', 'docx', Buffer.from('not a pdf'));
    await saveCatalog();

    await expect(service.getDetails('word-paper')).resolves.toEqual(expect.objectContaining({
      printable: false,
      pageCount: null,
      previewPageCount: 0,
      reason: '当前仅支持 PDF 试卷预览和打印',
    }));
    await expect(service.getPreview('word-paper')).rejects.toThrow(
      '当前仅支持 PDF 试卷预览和打印',
    );
  });

  it('passes the complete original PDF to the private print-draft service', async () => {
    const original = await makePdf(5);
    await addMaterial('print-paper', 'pdf', original);
    await saveCatalog();
    printService.createDraftFromPdfBuffer.mockResolvedValue({ id: 41, status: 'draft' });

    const result = await service.createPrintDraft(9, 'print-paper');
    const passedBuffer = printService.createDraftFromPdfBuffer.mock.calls[0][1] as Buffer;
    const passedPdf = await PDFDocument.load(passedBuffer);

    expect(passedPdf.getPageCount()).toBe(5);
    expect(printService.createDraftFromPdfBuffer).toHaveBeenCalledWith(
      9,
      expect.any(Buffer),
      'print-paper.pdf',
      'print-paper title',
    );
    expect(result).toEqual({
      draft: { id: 41, status: 'draft' },
      material: {
        id: 'print-paper',
        title: 'print-paper title',
        pageCount: 5,
        previewPageCount: 3,
        printable: true,
        reason: null,
      },
    });
  });

  it('invalidates a cached preview when the exact source file changes and verifies its checksum', async () => {
    const original = await makePdf(5);
    const item = await addMaterial('changed-paper', 'pdf', original);
    await saveCatalog();
    await service.getPreview('changed-paper');

    const changed = await makePdf(2, 'changed');
    await writeFile(join(root, 'files', 'changed-paper.pdf'), changed);
    item.sha256 = createHash('sha256').update(changed).digest('hex');
    item.bytes = changed.length;
    await saveCatalog();

    const result = await service.getPreview('changed-paper');
    expect(result.pageCount).toBe(2);
    expect(result.previewPageCount).toBe(2);
  });
});
