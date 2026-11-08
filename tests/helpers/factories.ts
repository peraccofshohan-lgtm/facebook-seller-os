import { createProduct } from '@/services/productService';
import { createCustomer } from '@/services/customerService';
import { adjustStock } from '@/services/inventoryService';
import { parseMoney } from '@/lib/money';
import { fromDateInputValue, nowMs } from '@/lib/date';
import type { OrderInput } from '@/domain/schemas';

const tk = parseMoney;

export async function seedProduct(partial: { name?: string; costPrice?: string; sellingPrice?: string; sku?: string } = {}) {
  return createProduct(
    {
      name: partial.name ?? 'টি-শার্ট',
      sku: partial.sku ?? '',
      description: '',
      categoryId: null,
      brand: '',
      costPrice: tk(partial.costPrice ?? '400'),
      sellingPrice: tk(partial.sellingPrice ?? '700'),
      discountPrice: null,
      unit: 'পিস',
      barcode: '',
      imageDataUrl: null,
      hasVariants: false,
      lowStockThreshold: 5,
      isActive: true,
    },
    { openingStock: 0 },
  );
}

export async function seedProductWithStock(quantity: number, costPrice = '400', sellingPrice = '700') {
  const product = await seedProduct({ costPrice, sellingPrice });
  await adjustStock({
    productId: product.id,
    variantId: null,
    quantity,
    type: 'purchase',
    unitCost: tk(costPrice),
    reason: 'টেস্ট স্টক',
  });
  return product;
}

export function customerInput(partial: { name?: string; phone?: string; tags?: string[] } = {}) {
  return {
    name: partial.name ?? 'রিমা আক্তার',
    phone: partial.phone ?? '01712345678',
    altPhone: '',
    address: 'টাঙ্গাইল',
    district: '',
    area: '',
    notes: '',
    tags: partial.tags ?? [],
    status: 'active' as const,
  };
}

export async function seedCustomer(partial: { name?: string; phone?: string } = {}) {
  return createCustomer(customerInput(partial));
}

export function orderInput(overrides: Partial<OrderInput> & { items: OrderInput['items'] }): OrderInput {
  return {
    orderDate: fromDateInputValue('2026-11-08') ?? nowMs(),
    channel: 'facebook',
    customerId: null,
    customerName: '',
    customerPhone: '',
    deliveryAddress: '',
    discount: 0,
    deliveryCharge: 0,
    otherCharge: 0,
    status: 'confirmed',
    paymentMethod: 'cash',
    courierProviderId: null,
    courierName: '',
    trackingNumber: '',
    notes: '',
    customerInstructions: '',
    cancelReason: '',
    advancePayment: 0,
    advanceMethod: 'cash',
    ...overrides,
  } as OrderInput;
}

export function line(productId: string | null, quantity: number, unitPrice: string, unitCost = '400') {
  return {
    productId,
    variantId: null,
    name: 'পণ্য',
    sku: '',
    unit: 'পিস',
    quantity,
    unitPrice: tk(unitPrice),
    unitCost: tk(unitCost),
    discount: 0,
  };
}
