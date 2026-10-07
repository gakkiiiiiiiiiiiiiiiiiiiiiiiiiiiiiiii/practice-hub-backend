import {
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { constants as fsConstants } from 'fs';
import {
  FileHandle,
  open,
  readFile,
  realpath,
  stat,
} from 'fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'path';
import { PDFDocument } from 'pdf-lib';
import { ZhiyePrintService } from '../zhiye-print/zhiye-print.service';
import {
  ZhiyeMaterialDetails,
  ZhiyeMaterialIndexEntry,
  ZhiyeMaterialPreview,
} from './zhiye-materials.types';

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_INDEX_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 2000;
const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;
const MAX_PREVIEW_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_CACHED_PREVIEW_BYTES = 8 * 1024 * 1024;
const MAX_CONCURRENT_PDF_JOBS = 2;
const CATALOG_TTL_MS = 30_000;
const VALIDATION_TTL_MS = 5 * 60_000;
const PREVIEW_TTL_MS = 10 * 60_000;
const MATERIAL_PATH_PREFIX = '/data/official/';

interface CatalogCache {
  loadedAt: number;
  indexSignature: string;
  rootRealPath: string;
  items: Map<string, ZhiyeMaterialIndexEntry>;
}

interface ValidatedMaterial {
  entry: ZhiyeMaterialIndexEntry;
  filePath: string;
  fileSignature: string;
  pageCount: number;
  sha256: string;
}

interface ValidationCacheEntry extends ValidatedMaterial {
  expiresAt: number;
}

interface PreviewCacheEntry {
  value: ZhiyeMaterialPreview;
  fileSignature: string;
  expiresAt: number;
  size: number;
}

@Injectable()
export class ZhiyeMaterialsService {
  private catalogCache: CatalogCache | null = null;
  private readonly validationCache = new Map<string, ValidationCacheEntry>();
  private readonly previewCache = new Map<string, PreviewCacheEntry>();
  private readonly previewInflight = new Map<string, Promise<ZhiyeMaterialPreview>>();
  private previewCacheBytes = 0;
  private activePdfJobs = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly zhiyePrintService: ZhiyePrintService,
  ) {}

  async getDetails(materialId: string): Promise<ZhiyeMaterialDetails> {
    const entry = await this.getCatalogEntry(materialId);
    const base = this.baseDetails(entry);
    if (entry.format.toLowerCase() !== 'pdf') {
      return { ...base, printable: false, reason: '当前仅支持 PDF 试卷预览和打印' };
    }

    try {
      const validated = await this.validateMaterial(entry);
      return {
        ...base,
        pageCount: validated.pageCount,
        previewPageCount: Math.min(3, validated.pageCount),
        printable: true,
        reason: null,
      };
    } catch (error) {
      if (
        error instanceof PayloadTooLargeException ||
        error instanceof UnprocessableEntityException ||
        error instanceof ServiceUnavailableException
      ) {
        return { ...base, printable: false, reason: this.exceptionMessage(error) };
      }
      throw error;
    }
  }

  async getPreview(materialId: string): Promise<ZhiyeMaterialPreview> {
    const entry = await this.getCatalogEntry(materialId);
    this.assertPdf(entry);
    const resolved = await this.resolveMaterialFile(entry);
    const cached = this.previewCache.get(entry.id);
    if (
      cached &&
      cached.fileSignature === resolved.fileSignature &&
      cached.expiresAt > Date.now()
    ) {
      return cached.value;
    }
    if (cached) this.removePreviewCache(entry.id, cached);

    const inflightKey = `${entry.id}:${resolved.fileSignature}`;
    const existing = this.previewInflight.get(inflightKey);
    if (existing) return existing;

    const operation = this.withPdfSlot(async () => {
      const { validated, buffer } = await this.loadAndValidate(entry, resolved);
      const source = await this.loadPdf(buffer);
      const preview = await PDFDocument.create();
      const pageIndexes = Array.from(
        { length: Math.min(3, validated.pageCount) },
        (_, index) => index,
      );
      const pages = await preview.copyPages(source, pageIndexes);
      pages.forEach((page) => preview.addPage(page));
      // The preview must not expose metadata from the original material.
      delete preview.context.trailerInfo.Info;
      const previewBuffer = Buffer.from(await preview.save({
        addDefaultPage: false,
        useObjectStreams: true,
      }));
      if (previewBuffer.length > MAX_PREVIEW_BYTES) {
        throw new PayloadTooLargeException('前三页预览文件超过 20MB，暂不支持在线预览');
      }
      const value: ZhiyeMaterialPreview = {
        buffer: previewBuffer,
        fileName: `${entry.id}-preview.pdf`,
        pageCount: validated.pageCount,
        previewPageCount: pageIndexes.length,
        etag: `\"${createHash('sha256').update(previewBuffer).digest('hex')}\"`,
      };
      this.storePreviewCache(entry.id, resolved.fileSignature, value);
      return value;
    });
    this.previewInflight.set(inflightKey, operation);
    try {
      return await operation;
    } finally {
      this.previewInflight.delete(inflightKey);
    }
  }

  async createPrintDraft(userId: number, materialId: string) {
    const entry = await this.getCatalogEntry(materialId);
    this.assertPdf(entry);
    const resolved = await this.resolveMaterialFile(entry);
    return this.withPdfSlot(async () => {
      const { validated, buffer } = await this.loadAndValidate(entry, resolved);
      const draft = await this.zhiyePrintService.createDraftFromPdfBuffer(
        userId,
        buffer,
        basename(validated.filePath),
        entry.title,
      );
      return {
        draft,
        material: {
          ...this.baseDetails(entry),
          pageCount: validated.pageCount,
          previewPageCount: Math.min(3, validated.pageCount),
          printable: true,
          reason: null,
        } satisfies ZhiyeMaterialDetails,
      };
    });
  }

  private async validateMaterial(entry: ZhiyeMaterialIndexEntry) {
    const resolved = await this.resolveMaterialFile(entry);
    const cached = this.validationCache.get(entry.id);
    if (
      cached &&
      cached.fileSignature === resolved.fileSignature &&
      cached.expiresAt > Date.now()
    ) {
      return cached;
    }
    return this.withPdfSlot(async () => (await this.loadAndValidate(entry, resolved)).validated);
  }

  private async loadAndValidate(
    entry: ZhiyeMaterialIndexEntry,
    resolved: { filePath: string; fileSignature: string },
  ): Promise<{ validated: ValidatedMaterial; buffer: Buffer }> {
    const buffer = await this.readBoundedFile(resolved.filePath);
    if (!buffer.subarray(0, Math.min(1024, buffer.length)).includes(Buffer.from('%PDF-'))) {
      throw new UnprocessableEntityException('试卷文件不是有效 PDF');
    }
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const expectedSha = String(entry.sha256 || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedSha)) {
      throw new ServiceUnavailableException('试卷目录缺少有效的文件校验值');
    }
    if (sha256 !== expectedSha) {
      throw new UnprocessableEntityException('试卷文件校验失败，请联系管理员更新资料');
    }
    const pdf = await this.loadPdf(buffer);
    const pageCount = pdf.getPageCount();
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PDF_PAGES) {
      throw new UnprocessableEntityException(`PDF 页数必须为 1-${MAX_PDF_PAGES} 页`);
    }
    const validated: ValidatedMaterial = {
      entry,
      filePath: resolved.filePath,
      fileSignature: resolved.fileSignature,
      pageCount,
      sha256,
    };
    this.validationCache.set(entry.id, {
      ...validated,
      expiresAt: Date.now() + VALIDATION_TTL_MS,
    });
    return { validated, buffer };
  }

  private async resolveMaterialFile(entry: ZhiyeMaterialIndexEntry) {
    const catalog = await this.loadCatalog();
    const configuredPath = String(entry.localFile || entry.fileUrl || '');
    if (!configuredPath.startsWith(MATERIAL_PATH_PREFIX) || configuredPath.includes('\\')) {
      throw new ServiceUnavailableException('试卷目录中的文件路径无效');
    }
    const relativePath = configuredPath.slice(MATERIAL_PATH_PREFIX.length);
    if (!relativePath || isAbsolute(relativePath)) {
      throw new ServiceUnavailableException('试卷目录中的文件路径无效');
    }
    const candidate = resolve(catalog.rootRealPath, relativePath);
    if (!this.isWithinRoot(catalog.rootRealPath, candidate)) {
      throw new ServiceUnavailableException('试卷文件路径越界');
    }

    let targetRealPath: string;
    try {
      targetRealPath = await realpath(candidate);
    } catch {
      throw new ServiceUnavailableException('试卷原始文件暂不可用');
    }
    if (!this.isWithinRoot(catalog.rootRealPath, targetRealPath)) {
      throw new ServiceUnavailableException('试卷文件路径越界');
    }
    let fileStat;
    try {
      fileStat = await stat(targetRealPath, { bigint: true });
    } catch {
      throw new ServiceUnavailableException('试卷原始文件暂不可用');
    }
    if (!fileStat.isFile()) {
      throw new ServiceUnavailableException('试卷原始文件不是普通文件');
    }
    const fileSize = Number(fileStat.size);
    if (!Number.isSafeInteger(fileSize) || fileSize < 1) {
      throw new UnprocessableEntityException('试卷文件为空或大小无效');
    }
    if (fileSize > MAX_SOURCE_BYTES) {
      throw new PayloadTooLargeException('试卷文件超过 50MB，暂不支持预览和打印');
    }
    return {
      filePath: targetRealPath,
      fileSignature: `${fileStat.dev}:${fileStat.ino}:${fileStat.size}:${fileStat.mtimeNs}`,
    };
  }

  private async readBoundedFile(filePath: string): Promise<Buffer> {
    let handle: FileHandle | undefined;
    try {
      handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
      const fileStat = await handle.stat();
      if (!fileStat.isFile() || fileStat.size < 1) {
        throw new UnprocessableEntityException('试卷文件为空或类型无效');
      }
      if (fileStat.size > MAX_SOURCE_BYTES) {
        throw new PayloadTooLargeException('试卷文件超过 50MB，暂不支持预览和打印');
      }
      return await handle.readFile();
    } catch (error) {
      if (
        error instanceof PayloadTooLargeException ||
        error instanceof UnprocessableEntityException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException('试卷原始文件读取失败');
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private async loadPdf(buffer: Buffer): Promise<PDFDocument> {
    try {
      return await PDFDocument.load(buffer, {
        ignoreEncryption: false,
        updateMetadata: false,
      });
    } catch {
      throw new UnprocessableEntityException('PDF 无法解析、已加密或文件已损坏');
    }
  }

  private async getCatalogEntry(materialId: string) {
    const normalizedId = String(materialId || '');
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalizedId)) {
      throw new NotFoundException('未找到该试卷资料');
    }
    const catalog = await this.loadCatalog();
    const entry = catalog.items.get(normalizedId);
    if (!entry) throw new NotFoundException('未找到该试卷资料');
    return entry;
  }

  private async loadCatalog(): Promise<CatalogCache> {
    const configuredRoot = String(this.configService.get('ZHIYE_MATERIALS_ROOT') || '').trim();
    if (!configuredRoot || !isAbsolute(configuredRoot)) {
      throw new ServiceUnavailableException('知页试卷资料目录尚未配置');
    }
    let rootRealPath: string;
    try {
      rootRealPath = await realpath(configuredRoot);
    } catch {
      throw new ServiceUnavailableException('知页试卷资料目录不可用');
    }
    const indexPath = join(rootRealPath, 'materials.json');
    let indexStat;
    try {
      indexStat = await stat(indexPath, { bigint: true });
    } catch {
      throw new ServiceUnavailableException('知页试卷目录文件不可用');
    }
    if (!indexStat.isFile() || indexStat.size < 1n || indexStat.size > BigInt(MAX_INDEX_BYTES)) {
      throw new ServiceUnavailableException('知页试卷目录文件大小无效');
    }
    const indexSignature = `${indexStat.dev}:${indexStat.ino}:${indexStat.size}:${indexStat.mtimeNs}`;
    if (
      this.catalogCache &&
      this.catalogCache.rootRealPath === rootRealPath &&
      this.catalogCache.indexSignature === indexSignature &&
      this.catalogCache.loadedAt + CATALOG_TTL_MS > Date.now()
    ) {
      return this.catalogCache;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(await readFile(indexPath, 'utf8'));
    } catch {
      throw new ServiceUnavailableException('知页试卷目录文件无法解析');
    }
    if (!Array.isArray(parsed?.items)) {
      throw new ServiceUnavailableException('知页试卷目录格式无效');
    }
    const items = new Map<string, ZhiyeMaterialIndexEntry>();
    for (const raw of parsed.items) {
      const id = String(raw?.id || '');
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id) || items.has(id)) {
        throw new ServiceUnavailableException('知页试卷目录包含无效或重复 ID');
      }
      items.set(id, {
        id,
        title: String(raw?.title || '').trim().slice(0, 200) || '未命名试卷',
        format: String(raw?.format || extname(String(raw?.localFile || '')).slice(1)).toLowerCase(),
        localFile: typeof raw?.localFile === 'string' ? raw.localFile : undefined,
        fileUrl: typeof raw?.fileUrl === 'string' ? raw.fileUrl : undefined,
        bytes: Number(raw?.bytes) || undefined,
        sha256: typeof raw?.sha256 === 'string' ? raw.sha256 : undefined,
        metadata: raw?.metadata && typeof raw.metadata === 'object' ? raw.metadata : undefined,
      });
    }
    this.catalogCache = {
      loadedAt: Date.now(),
      indexSignature,
      rootRealPath,
      items,
    };
    return this.catalogCache;
  }

  private baseDetails(entry: ZhiyeMaterialIndexEntry): ZhiyeMaterialDetails {
    return {
      id: entry.id,
      title: entry.title,
      pageCount: null,
      previewPageCount: 0,
      printable: false,
      reason: null,
    };
  }

  private assertPdf(entry: ZhiyeMaterialIndexEntry) {
    if (entry.format.toLowerCase() !== 'pdf') {
      throw new UnsupportedMediaTypeException('当前仅支持 PDF 试卷预览和打印');
    }
  }

  private isWithinRoot(root: string, target: string) {
    const pathFromRoot = relative(root, target);
    return pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot);
  }

  private async withPdfSlot<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activePdfJobs >= MAX_CONCURRENT_PDF_JOBS) {
      throw new ServiceUnavailableException('试卷处理任务较多，请稍后重试');
    }
    this.activePdfJobs += 1;
    try {
      return await operation();
    } finally {
      this.activePdfJobs -= 1;
    }
  }

  private storePreviewCache(
    id: string,
    fileSignature: string,
    value: ZhiyeMaterialPreview,
  ) {
    if (value.buffer.length > MAX_CACHED_PREVIEW_BYTES) return;
    const existing = this.previewCache.get(id);
    if (existing) this.removePreviewCache(id, existing);
    while (
      this.previewCache.size > 0 &&
      this.previewCacheBytes + value.buffer.length > MAX_PREVIEW_CACHE_BYTES
    ) {
      const oldest = this.previewCache.entries().next().value as
        | [string, PreviewCacheEntry]
        | undefined;
      if (!oldest) break;
      this.removePreviewCache(oldest[0], oldest[1]);
    }
    this.previewCache.set(id, {
      value,
      fileSignature,
      expiresAt: Date.now() + PREVIEW_TTL_MS,
      size: value.buffer.length,
    });
    this.previewCacheBytes += value.buffer.length;
  }

  private removePreviewCache(id: string, entry: PreviewCacheEntry) {
    this.previewCache.delete(id);
    this.previewCacheBytes = Math.max(0, this.previewCacheBytes - entry.size);
  }

  private exceptionMessage(error: unknown) {
    const response = (error as any)?.getResponse?.();
    if (typeof response === 'string') return response;
    if (typeof response?.message === 'string') return response.message;
    return '试卷资料暂不可用';
  }
}
