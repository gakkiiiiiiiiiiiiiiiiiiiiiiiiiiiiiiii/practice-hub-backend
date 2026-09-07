export const PAPER_MATERIAL_REGIONAL_SHIPPING_FEE = 8;

const PAPER_MATERIAL_REGIONAL_SHIPPING_REGIONS = new Set([
  '新疆',
  '西藏',
  '内蒙古',
  '青海',
  '宁夏',
  '甘肃',
]);

const normalizeProvince = (value: unknown) => String(value || '')
  .trim()
  .replace(/\s+/g, '')
  .replace(/(?:维吾尔自治区|回族自治区|自治区|省|市)$/u, '');

export type PaperMaterialRegionalShipping = {
  fee: number;
  region: string | null;
};

export function resolvePaperMaterialRegionalShipping(
  addressOrProvince: Record<string, any> | string | null | undefined,
): PaperMaterialRegionalShipping {
  const province = typeof addressOrProvince === 'string'
    ? addressOrProvince
    : addressOrProvince?.province ?? addressOrProvince?.provinceName;
  const region = normalizeProvince(province);
  if (!PAPER_MATERIAL_REGIONAL_SHIPPING_REGIONS.has(region)) {
    return { fee: 0, region: null };
  }
  return { fee: PAPER_MATERIAL_REGIONAL_SHIPPING_FEE, region };
}
