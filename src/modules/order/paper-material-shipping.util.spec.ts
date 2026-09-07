import {
  PAPER_MATERIAL_REGIONAL_SHIPPING_FEE,
  resolvePaperMaterialRegionalShipping,
} from './paper-material-shipping.util';

describe('paper material regional shipping', () => {
  it.each([
    ['新疆维吾尔自治区', '新疆'],
    ['西藏自治区', '西藏'],
    ['内蒙古自治区', '内蒙古'],
    ['青海省', '青海'],
    ['宁夏回族自治区', '宁夏'],
    ['甘肃省', '甘肃'],
  ])('charges one additional fee for %s', (province, region) => {
    expect(resolvePaperMaterialRegionalShipping({ province })).toEqual({
      fee: PAPER_MATERIAL_REGIONAL_SHIPPING_FEE,
      region,
    });
  });

  it.each(['上海市', '广东省', '', undefined])('does not charge other provinces: %s', (province) => {
    expect(resolvePaperMaterialRegionalShipping({ province })).toEqual({ fee: 0, region: null });
  });
});
