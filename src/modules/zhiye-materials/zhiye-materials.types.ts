export interface ZhiyeMaterialIndexEntry {
  id: string;
  title: string;
  format: string;
  localFile?: string;
  fileUrl?: string;
  bytes?: number;
  sha256?: string;
  metadata?: {
    page_count?: number;
    [key: string]: unknown;
  };
}

export interface ZhiyeMaterialDetails {
  id: string;
  title: string;
  pageCount: number | null;
  previewPageCount: number;
  printable: boolean;
  reason: string | null;
}

export interface ZhiyeMaterialPreview {
  buffer: Buffer;
  fileName: string;
  pageCount: number;
  previewPageCount: number;
  etag: string;
}
