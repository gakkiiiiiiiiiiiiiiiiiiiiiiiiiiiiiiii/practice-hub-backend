import { BadRequestException } from '@nestjs/common';

/** 价格进一取整（元） */
export function ceilIntegerYuanPrice(value: number): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return 0;
  }
  return Math.max(0, Math.ceil(amount));
}

/** 是否为整数元价格（0 视为合法） */
export function isIntegerYuanPrice(value: number): boolean {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && Number.isInteger(amount);
}

export function assertIntegerYuanPrice(value: number, fieldName = '价格') {
  if (value === undefined || value === null) {
    return;
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new BadRequestException(`${fieldName}无效`);
  }
  if (!Number.isInteger(amount)) {
    throw new BadRequestException(`${fieldName}必须为整数元`);
  }
}

/** 支付金额：整数元，非整数时进一（兼容优惠券等产生的尾数） */
export function normalizePayAmountYuan(value: number): number {
  return ceilIntegerYuanPrice(value);
}

/** 优惠券门槛：保留两位小数，非负 */
export function normalizeThresholdYuan(value: number | null | undefined): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    return 0;
  }
  return Math.round(amount * 100) / 100;
}

/** 金额展示：整数不带小数，否则最多两位并去掉尾零 */
export function formatYuanDisplay(value: number): string {
  const amount = normalizeThresholdYuan(value);
  if (Number.isInteger(amount)) {
    return String(amount);
  }
  return amount.toFixed(2).replace(/\.?0+$/, '');
}
