import { describe, expect, it } from 'vitest';
import { customerInputSchema, orderInputSchema, productInputSchema } from '@/domain/schemas';
import { parseMoney } from '@/lib/money';

/**
 * Regression guard for the worst defect found in the V1 audit:
 *
 * `MoneyInput` hands the form a price in PAISA (typing 400 gives 40000). The
 * form validates it with `productInputSchema`, whose money field used to call
 * `parseMoney`, which reads a NUMBER as TAKA — so 40000 became 4,000,000 and
 * every price entered through the UI was stored a hundred times too large.
 * That inflated order totals, profit, stock value and every report.
 */
describe('money fields in the schemas', () => {
  const base = {
    name: 'টি-শার্ট',
    sku: 'TS-1',
    description: '',
    categoryId: null,
    brand: '',
    costPrice: 0,
    sellingPrice: 0,
    discountPrice: null,
    unit: 'পিস',
    barcode: '',
    imageDataUrl: null,
    hasVariants: false,
    lowStockThreshold: 5,
    isActive: true,
  };

  it('leaves a number that is already in paisa alone', () => {
    // Exactly what MoneyInput produces after the seller types 400 / 700 taka.
    const parsed = productInputSchema.parse({ ...base, costPrice: 40000, sellingPrice: 70000 });
    expect(parsed.costPrice).toBe(40000); // 400.00 BDT
    expect(parsed.sellingPrice).toBe(70000); // 700.00 BDT
  });

  it('still converts seller/CSV text in taka', () => {
    const parsed = productInputSchema.parse({ ...base, costPrice: '400', sellingPrice: '1,200.50' });
    expect(parsed.costPrice).toBe(40000);
    expect(parsed.sellingPrice).toBe(120050);
  });

  it('accepts Bengali digits typed by the seller', () => {
    const parsed = productInputSchema.parse({ ...base, costPrice: '৪০০', sellingPrice: '৭০০' });
    expect(parsed.costPrice).toBe(40000);
    expect(parsed.sellingPrice).toBe(70000);
  });

  it('treats a number and the equivalent text as the same amount', () => {
    const fromNumber = productInputSchema.parse({ ...base, costPrice: parseMoney('400') });
    const fromText = productInputSchema.parse({ ...base, costPrice: '400' });
    expect(fromNumber.costPrice).toBe(fromText.costPrice);
  });

  it('rejects a paisa value that is not a whole number', () => {
    const result = productInputSchema.safeParse({ ...base, costPrice: 40000.5 });
    expect(result.success).toBe(false);
  });

  it('rejects amounts beyond the safe-integer range', () => {
    const result = productInputSchema.safeParse({ ...base, costPrice: Number.MAX_SAFE_INTEGER + 2 });
    expect(result.success).toBe(false);
  });

  it('keeps a numeric discount price in paisa but allows null', () => {
    expect(productInputSchema.parse({ ...base, discountPrice: 5000 }).discountPrice).toBe(5000);
    expect(productInputSchema.parse({ ...base, discountPrice: null }).discountPrice).toBeNull();
    expect(productInputSchema.parse({ ...base, discountPrice: '50' }).discountPrice).toBe(5000);
  });
});

describe('the same rule holds for orders', () => {
  const orderBase = {
    orderDate: Date.now(),
    channel: 'facebook',
    customerId: null,
    customerName: 'রিমা আক্তার',
    customerPhone: '01712345678',
    deliveryAddress: '',
    items: [
      {
        productId: 'p1',
        variantId: null,
        name: 'টি-শার্ট',
        sku: 'TS-1',
        unit: 'পিস',
        quantity: 2,
        unitPrice: 70000,
        unitCost: 40000,
        discount: 0,
      },
    ],
    discount: 0,
    deliveryCharge: 6000,
    otherCharge: 0,
    status: 'confirmed',
    paymentMethod: 'cash',
    courierProviderId: null,
    courierName: '',
    trackingNumber: '',
    notes: '',
    customerInstructions: '',
    cancelReason: '',
    advancePayment: 50000,
    advanceMethod: 'cash',
  };

  it('does not re-scale the order money the form already holds in paisa', () => {
    const parsed = orderInputSchema.parse(orderBase);
    expect(parsed.deliveryCharge).toBe(6000); // 60.00 BDT
    expect(parsed.advancePayment).toBe(50000); // 500.00 BDT
    expect(parsed.items[0]!.unitPrice).toBe(70000); // 700.00 BDT
  });

  it('still converts CSV/import text', () => {
    const parsed = orderInputSchema.parse({ ...orderBase, deliveryCharge: '60', advancePayment: '500' });
    expect(parsed.deliveryCharge).toBe(6000);
    expect(parsed.advancePayment).toBe(50000);
  });
});

describe('customer validation', () => {
  it('normalises a Bangladeshi phone number', () => {
    const parsed = customerInputSchema.parse({ name: 'রিমা আক্তার', phone: '০১৭১২৩৪৫৬৭৮' });
    expect(parsed.phone).toBe('01712345678');
  });

  it('refuses a nonsense phone number', () => {
    expect(customerInputSchema.safeParse({ name: 'রিমা', phone: '123' }).success).toBe(false);
  });
});
