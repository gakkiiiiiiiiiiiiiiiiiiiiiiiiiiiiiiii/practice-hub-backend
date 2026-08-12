export const PAPER_MATERIAL_PAGE_THRESHOLD = 250;
export const PAPER_MATERIAL_BASE_FEE = 6.28;
export const PAPER_MATERIAL_PER_PAGE_FEE = 0.05;
export const PAPER_MATERIAL_OVER_THRESHOLD_BASE_FEE = 15;
export const PAPER_MATERIAL_OVER_THRESHOLD_PER_PAGE_FEE = 0.1;
export const PAPER_MATERIAL_BINDING_FEE = 3;
export const PAPER_MATERIAL_SHIPPING_FEE = 1;
export const PAPER_MATERIAL_PRICE_MULTIPLIER = 1.3;

type PrintableCourseFile = {
  id?: number | null;
  display_name?: string | null;
  file_name?: string | null;
  file_type?: string | null;
  file_page_count?: number | null;
};

export type PaperMaterialPricing = {
  available: boolean;
  totalPages: number;
  price: number | null;
  missingFileIds: number[];
  baseFee: number;
  perPageFee: number;
  pageThreshold: number;
  overThresholdBaseFee: number;
  overThresholdPerPageFee: number;
  bindingFee: number;
  shippingFee: number;
  multiplier: number;
  roundingMode: 'ceil_yuan';
};

export function inferPaperMaterialPageCount(
  file: Pick<PrintableCourseFile, 'display_name' | 'file_name'>,
): number | null {
  const text = `${file.display_name || ''} ${file.file_name || ''}`;
  const patterns = [
    /[【\[]\s*(\d{1,5})\s*页?\s*[】\]]/,
    /(?:共|合计)\s*(\d{1,5})\s*页/i,
    /[-—]\s*(\d{1,5})\s*页(?:\s|$)/i,
  ];
  for (const pattern of patterns) {
    const count = Number.parseInt(text.match(pattern)?.[1] || '', 10);
    if (Number.isInteger(count) && count > 0 && count <= 20000) {
      return count;
    }
  }
  return null;
}

export function calculatePaperMaterialPrice(totalPages: number): number {
  const pages = Math.max(0, Math.trunc(Number(totalPages) || 0));
  if (pages <= 0) return 0;
  if (pages <= PAPER_MATERIAL_PAGE_THRESHOLD) {
    // Convert to integer cents before applying the 1.3 multiplier to avoid
    // floating-point noise accidentally rounding an exact integer upward.
    const subtotalInCents = Math.round(PAPER_MATERIAL_BASE_FEE * 100)
      + pages * Math.round(PAPER_MATERIAL_PER_PAGE_FEE * 100);
    return Math.ceil((subtotalInCents * 13) / 1000);
  }
  const subtotalInTenths = Math.round((
    PAPER_MATERIAL_OVER_THRESHOLD_BASE_FEE
    + PAPER_MATERIAL_BINDING_FEE
    + PAPER_MATERIAL_SHIPPING_FEE
  ) * 10) + (pages - PAPER_MATERIAL_PAGE_THRESHOLD)
    * Math.round(PAPER_MATERIAL_OVER_THRESHOLD_PER_PAGE_FEE * 10);
  return Math.ceil((subtotalInTenths * 13) / 100);
}

export function resolvePaperMaterialPricing(files: PrintableCourseFile[]): PaperMaterialPricing {
  const printableFiles = (files || []).filter((file) =>
    ['pdf', 'doc', 'docx'].includes(String(file.file_type || '').toLowerCase()),
  );
  let totalPages = 0;
  const missingFileIds: number[] = [];
  let hasMissingPageCount = false;

  for (const file of printableFiles) {
    const cachedCount = Number(file.file_page_count || 0);
    const pageCount = Number.isInteger(cachedCount) && cachedCount > 0
      ? cachedCount
      : inferPaperMaterialPageCount(file);
    if (!pageCount) {
      hasMissingPageCount = true;
      if (Number(file.id) > 0) missingFileIds.push(Number(file.id));
      continue;
    }
    totalPages += pageCount;
  }

  const available = printableFiles.length > 0 && !hasMissingPageCount && totalPages > 0;
  return {
    available,
    totalPages,
    price: available ? calculatePaperMaterialPrice(totalPages) : null,
    missingFileIds,
    baseFee: PAPER_MATERIAL_BASE_FEE,
    perPageFee: PAPER_MATERIAL_PER_PAGE_FEE,
    pageThreshold: PAPER_MATERIAL_PAGE_THRESHOLD,
    overThresholdBaseFee: PAPER_MATERIAL_OVER_THRESHOLD_BASE_FEE,
    overThresholdPerPageFee: PAPER_MATERIAL_OVER_THRESHOLD_PER_PAGE_FEE,
    bindingFee: PAPER_MATERIAL_BINDING_FEE,
    shippingFee: PAPER_MATERIAL_SHIPPING_FEE,
    multiplier: PAPER_MATERIAL_PRICE_MULTIPLIER,
    roundingMode: 'ceil_yuan',
  };
}
