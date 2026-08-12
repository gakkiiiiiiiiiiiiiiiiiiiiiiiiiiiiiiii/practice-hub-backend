import {
  calculatePaperMaterialPrice,
  inferPaperMaterialPageCount,
  resolvePaperMaterialPricing,
} from './paper-material-price.util';

describe('paper material pricing', () => {
  it('uses the within-250-page formula and rounds up to whole yuan', () => {
    expect(calculatePaperMaterialPrice(22)).toBe(10);
    expect(calculatePaperMaterialPrice(100)).toBe(15);
    expect(calculatePaperMaterialPrice(250)).toBe(25);
  });

  it('uses the over-250-page formula and rounds up to whole yuan', () => {
    expect(calculatePaperMaterialPrice(251)).toBe(25);
    expect(calculatePaperMaterialPrice(260)).toBe(26);
    expect(calculatePaperMaterialPrice(261)).toBe(27);
  });

  it('sums cached and filename-inferred page counts', () => {
    expect(
      resolvePaperMaterialPricing([
        { id: 1, file_type: 'pdf', file_page_count: 20 },
        { id: 2, file_type: 'pdf', display_name: '补充资料【30页】.pdf' },
      ]),
    ).toMatchObject({
      available: true,
      totalPages: 50,
      price: 12,
      missingFileIds: [],
    });
  });

  it('keeps paper purchasing unavailable while any printable file page count is missing', () => {
    expect(
      resolvePaperMaterialPricing([
        { id: 1, file_type: 'pdf', file_page_count: 20 },
        { id: 2, file_type: 'docx', display_name: '补充资料.docx' },
      ]),
    ).toMatchObject({
      available: false,
      totalPages: 20,
      price: null,
      missingFileIds: [2],
    });
  });

  it('does not infer unrelated numbers as page counts', () => {
    expect(inferPaperMaterialPageCount({ display_name: '2026 年第 10 版资料' })).toBeNull();
  });
});
