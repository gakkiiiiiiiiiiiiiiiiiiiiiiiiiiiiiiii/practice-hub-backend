import { ValidationPipe } from '@nestjs/common';
import { CreatePaperCartOrderDto } from './create-paper-cart-order.dto';

describe('CreatePaperCartOrderDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true,
    transformOptions: { enableImplicitConversion: false } });
  const validate = (overrides: Record<string, any>) => pipe.transform({
    items: [{ course_id: 9, quantity: 2 }], expected_amount: 20,
    shipping_address: { name: '测试', phone: '13800138000' }, ...overrides,
  }, { type: 'body', metatype: CreatePaperCartOrderDto });

  it('preserves explicit numeric IDs and quantities', async () => {
    const dto = await validate({});
    expect(dto.items[0]).toEqual({ course_id: 9, quantity: 2 });
  });

  it.each([undefined, [], Array.from({ length: 21 }, (_, i) => ({ course_id: i + 1, quantity: 1 })),
    [{ course_id: 9, quantity: 1 }, { course_id: 9, quantity: 2 }],
    [null], [{ course_id: 0, quantity: 1 }], [{ course_id: 1.5, quantity: 1 }],
    [{ course_id: '9', quantity: 1 }], [{ course_id: 9, quantity: '2' }],
    [{ course_id: 9, quantity: 0 }], [{ course_id: 9, quantity: 100 }],
    [{ course_id: 9, quantity: 1.5 }], [{ course_id: 9, quantity: NaN }],
  ].map((items) => ({ items })))('rejects malformed item selection %# without coercion', async ({ items }) => {
    await expect(validate({ items })).rejects.toThrow();
  });

  it.each([undefined, '20', 0, -1, NaN, Infinity, 1.111])('rejects invalid expected amount %s', async (expected_amount) => {
    await expect(validate({ expected_amount })).rejects.toThrow();
  });

  it('requires an address and rejects electronic coupons/unknown prices', async () => {
    await expect(validate({ shipping_address: undefined })).rejects.toThrow();
    await expect(validate({ coupon_id: 8 })).rejects.toThrow();
    await expect(validate({ items: [{ course_id: 9, quantity: 2, unit_price: 1 }] })).rejects.toThrow();
  });
});
