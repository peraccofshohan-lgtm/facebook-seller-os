/**
 * orderPromotions.test.ts — promotions through the real order pipeline.
 *
 * These tests run the whole path the app runs: create a product and a customer, save a
 * promotion, place an order, and then read back what was stored. That is the only way to
 * be sure the engine, the order service and the reports agree with each other.
 */

import { describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { parseMoney } from '@/lib/money';
import { fromDateInputValue } from '@/lib/date';
import type { PromotionInput } from '@/domain/schemas';
import { createOrder, updateOrder, changeOrderStatus } from '@/services/orderService';
import { totalsForOrder } from '@/services/paymentService';
import { createPromotion, getPromotion, promotionPerformance, usagesForPromotion, releaseUsage, addLoyaltyEntry } from '@/services/promotionService';
import { orderProfit } from '@/finance/profit';
import { orderInput, seedProductWithStock, seedCustomer } from '../helpers/factories';

const tk = parseMoney;
const DHACA_TODAY = fromDateInputValue('2026-11-08') ?? Date.now();

function promotionInput(partial: Partial<PromotionInput> & { type: PromotionInput['type'] }): PromotionInput {
  return {
    name: partial.name ?? 'অফার',
    description: '',
    type: partial.type,
    status: 'active',
    startsAt: partial.startsAt ?? DHACA_TODAY - 86_400_000,
    endsAt: partial.endsAt ?? null,
    percentOff: partial.percentOff ?? 0,
    amountOff: partial.amountOff ?? 0,
    buyQuantity: partial.buyQuantity ?? 0,
    getQuantity: partial.getQuantity ?? 0,
    bundleItems: partial.bundleItems ?? [],
    bundlePrice: partial.bundlePrice ?? 0,
    giftItems: partial.giftItems ?? [],
    productIds: partial.productIds ?? [],
    categoryIds: partial.categoryIds ?? [],
    minOrderAmount: partial.minOrderAmount ?? 0,
    maxDiscount: partial.maxDiscount ?? 0,
    usageLimit: partial.usageLimit ?? null,
    perCustomerLimit: partial.perCustomerLimit ?? null,
    customerEligibility: partial.customerEligibility ?? 'all',
    customerSegments: partial.customerSegments ?? [],
    couponCode: partial.couponCode ?? '',
    stackable: partial.stackable ?? true,
    priority: partial.priority ?? 10,
    combinationGroup: partial.combinationGroup ?? '',
    terms: partial.terms ?? '',
  } as PromotionInput;
}

async function placeOrder(lines: { productId: string; quantity: number; unitPrice: string; unitCost?: string }[], extra: {
  customerId?: string | null;
  deliveryCharge?: number;
  discount?: number;
  couponCode?: string;
  pointsToRedeem?: number;
} = {}) {
  return createOrder(
    orderInput({
      orderDate: DHACA_TODAY,
      customerId: extra.customerId ?? null,
      items: lines.map((l) => ({
        productId: l.productId,
        variantId: null,
        name: 'পণ্য',
        sku: '',
        unit: 'পিস',
        quantity: l.quantity,
        unitPrice: tk(l.unitPrice),
        unitCost: tk(l.unitCost ?? '400'),
        discount: 0,
      })),
      deliveryCharge: extra.deliveryCharge ?? 0,
      discount: extra.discount ?? 0,
      status: 'confirmed',
      couponCode: extra.couponCode ?? '',
      pointsToRedeem: extra.pointsToRedeem ?? 0,
    }),
  );
}

describe('orders with promotions', () => {
  it('writes the promotion discount onto the order and onto the lines', async () => {
    const product = await seedProductWithStock(20, '400', '1000');
    await createPromotion(promotionInput({ type: 'percent', name: '১০% ছাড়', percentOff: 10 }));

    const order = await placeOrder([{ productId: product.id, quantity: 2, unitPrice: '1000' }]);

    // 2 × 1,000 = 2,000, less 10% = 200 off.
    expect(order.subtotal).toBe(tk('1800'));
    expect(order.promotionDiscount).toBe(tk('200'));
    expect(order.promotionIds).toHaveLength(1);
    // The discount lives on the line, so per-line reporting stays correct.
    expect(order.items[0].discount).toBe(tk('200'));
    expect(order.items[0].lineTotal).toBe(tk('1800'));
    // COGS is untouched by a discount — the goods still cost what they cost.
    expect(order.cogs).toBe(tk('800'));
  });

  it('records the usage so the performance report measures what happened', async () => {
    const product = await seedProductWithStock(20, '400', '1000');
    const promo = await createPromotion(promotionInput({ type: 'percent', name: 'রিপোর্ট অফার', percentOff: 10 }));

    const order = await placeOrder([{ productId: product.id, quantity: 3, unitPrice: '1000' }]);

    const usages = await usagesForPromotion(promo.id);
    expect(usages).toHaveLength(1);
    expect(usages[0].totalDiscount).toBe(tk('300'));
    expect(usages[0].orderTotal).toBe(order.total);
    expect(usages[0].orderNumber).toBe(order.orderNumber);

    const [row] = await promotionPerformance();
    expect(row.usageCount).toBe(1);
    expect(row.totalDiscount).toBe(tk('300'));
    expect((await getPromotion(promo.id))?.usageCount).toBe(1);
  });

  it('waives the delivery charge without touching the sale value', async () => {
    const product = await seedProductWithStock(20, '400', '1000');
    await createPromotion(promotionInput({ type: 'free_delivery', name: 'ফ্রি ডেলিভারি' }));

    const order = await placeOrder(
      [{ productId: product.id, quantity: 1, unitPrice: '1000' }],
      { deliveryCharge: tk('120') },
    );

    expect(order.deliveryCharge).toBe(0);
    expect(order.subtotal).toBe(tk('1000'));
    expect(order.total).toBe(tk('1000'));
    expect(order.promotionDiscount).toBe(tk('120'));
  });

  it('adds a BOGO free unit and keeps it out of paid sales', async () => {
    const product = await seedProductWithStock(20, '400', '1000');
    await createPromotion(promotionInput({ type: 'bogo', name: '১ কিনলে ১ ফ্রি' }));

    const order = await placeOrder([{ productId: product.id, quantity: 2, unitPrice: '1000' }]);

    // One of the two units is free: 1,000 charged, 1,000 given away.
    expect(order.subtotal).toBe(tk('1000'));
    expect(order.promotionDiscount).toBe(tk('1000'));
    // …but the customer still took two units, so COGS reflects both.
    expect(order.cogs).toBe(tk('800'));
  });

  it('adds a free gift as a zero-priced line that still costs money', async () => {
    const product = await seedProductWithStock(20, '400', '1000');
    const gift = await seedProductWithStock(20, '150', '0');
    await createPromotion(
      promotionInput({
        type: 'free_gift',
        name: 'উপহার',
        minOrderAmount: tk('500'),
        giftItems: [{ productId: gift.id, variantId: null, name: 'মাথার স্কার্ফ', quantity: 1 }],
      }),
    );

    const order = await placeOrder([{ productId: product.id, quantity: 1, unitPrice: '1000' }]);

    expect(order.items).toHaveLength(2);
    const giftLine = order.items.find((i) => i.isFreeGift);
    expect(giftLine).toBeTruthy();
    expect(giftLine?.unitPrice).toBe(0);
    expect(giftLine?.lineTotal).toBe(0);
    // A gift is not a sale…
    expect(order.subtotal).toBe(tk('1000'));
    // …but it did cost 150 taka, and that is real money in COGS.
    expect(order.cogs).toBe(tk('550'));
  });

  it('applies a coupon only when the code is typed', async () => {
    const product = await seedProductWithStock(20, '400', '1000');
    await createPromotion(promotionInput({ type: 'coupon', name: 'কুপন', percentOff: 25, couponCode: 'EID25' }));

    const without = await placeOrder([{ productId: product.id, quantity: 1, unitPrice: '1000' }]);
    expect(without.promotionIds).toHaveLength(0);
    expect(without.subtotal).toBe(tk('1000'));

    const withCode = await placeOrder(
      [{ productId: product.id, quantity: 1, unitPrice: '1000' }],
      { couponCode: 'eid25' },
    );
    expect(withCode.promotionIds).toHaveLength(1);
    expect(withCode.subtotal).toBe(tk('750'));
    expect(withCode.couponCode).toBe('eid25');
  });

  it('recomputes the profit after a discount', async () => {
    const product = await seedProductWithStock(20, '400', '1000');
    await createPromotion(promotionInput({ type: 'percent', percentOff: 30 }));

    const order = await placeOrder([{ productId: product.id, quantity: 1, unitPrice: '1000' }]);
    const profit = orderProfit(order);

    expect(profit.grossSales).toBe(tk('1000'));
    expect(profit.discounts).toBe(tk('300'));
    expect(profit.netSales).toBe(tk('700'));
    expect(profit.cogs).toBe(tk('400'));
    // 700 − 400 = 300, not the 600 an undiscounted order would have made.
    expect(profit.grossProfit).toBe(tk('300'));
    expect(profit.estimatedProfit).toBe(tk('300'));
  });

  it('re-evaluates promotions when the order is edited, and does not double-count usage', async () => {
    const product = await seedProductWithStock(20, '400', '1000');
    const promo = await createPromotion(promotionInput({ type: 'percent', name: 'এডিট অফার', percentOff: 10 }));

    const order = await placeOrder([{ productId: product.id, quantity: 1, unitPrice: '1000' }]);
    expect((await getPromotion(promo.id))?.usageCount).toBe(1);
    expect(order.promotionDiscount).toBe(tk('100'));

    const updated = await updateOrder(order.id, {
      id: order.id,
      items: [
        { productId: product.id, variantId: null, name: 'পণ্য', sku: '', unit: 'পিস', quantity: 4, unitPrice: tk('1000'), unitCost: tk('400'), discount: 0 },
      ],
    });

    // 4 × 1,000 = 4,000, less 10% = 400 off.
    expect(updated.subtotal).toBe(tk('3600'));
    expect(updated.promotionDiscount).toBe(tk('400'));
    // Still exactly one redemption for one order.
    expect((await getPromotion(promo.id))?.usageCount).toBe(1);
    expect(await usagesForPromotion(promo.id)).toHaveLength(1);
  });

  it('frees the usage allowance when an order is cancelled', async () => {
    const product = await seedProductWithStock(20, '400', '1000');
    const promo = await createPromotion(promotionInput({ type: 'percent', percentOff: 10, usageLimit: 1 }));

    const order = await placeOrder([{ productId: product.id, quantity: 1, unitPrice: '1000' }]);
    expect((await getPromotion(promo.id))?.usageCount).toBe(1);

    // The offer is now exhausted…
    const second = await placeOrder([{ productId: product.id, quantity: 1, unitPrice: '1000' }]);
    expect(second.promotionIds).toHaveLength(0);

    // …but cancelling gives the allowance back, which is what a seller would expect.
    await changeOrderStatus({ id: order.id, status: 'cancelled', reason: 'কাস্টমার বাতিল করেছেন' });
    await releaseUsage(order.id);
    expect((await getPromotion(promo.id))?.usageCount).toBe(0);
  });

  it('credits loyalty points to the customer on the order', async () => {
    const product = await seedProductWithStock(20, '400', '1000');
    const customer = await seedCustomer({ name: 'লয়্যাল কাস্টমার', phone: '01755555555' });
    await createPromotion(promotionInput({ type: 'loyalty_points', name: 'পয়েন্ট' }));

    const order = await placeOrder(
      [{ productId: product.id, quantity: 3, unitPrice: '1000' }],
      { customerId: customer.id },
    );

    // 3,000 taka at 1 point per 100 taka = 30 points.
    expect(order.loyaltyPointsEarned).toBe(30);
    expect((await db.customers.get(customer.id))?.loyaltyPoints).toBe(30);
  });

  it('takes money off when the customer redeems points', async () => {
    const product = await seedProductWithStock(20, '400', '1000');
    const customer = await seedCustomer({ name: 'রিডিম কাস্টমার', phone: '01766666666' });
    // Points are seeded through the ledger, not by editing the balance: the balance is
    // always derived from the ledger, so a hand-written number would be rewritten.
    await addLoyaltyEntry({
      customerId: customer.id, type: 'earn', points: 200,
      orderId: null, promotionId: null, note: 'শুরুর ব্যালেন্স', date: DHACA_TODAY,
    });
    expect((await db.customers.get(customer.id))?.loyaltyPoints).toBe(200);

    const order = await placeOrder(
      [{ productId: product.id, quantity: 1, unitPrice: '1000' }],
      { customerId: customer.id, pointsToRedeem: 150 },
    );

    // 150 points at the default 1 taka per point = 150 taka off a 1,000 taka order.
    expect(order.loyaltyDiscount).toBe(tk('150'));
    expect(order.total).toBe(tk('850'));
    // 200 earned − 150 spent = 50 left, and the balance comes from the ledger.
    expect((await db.customers.get(customer.id))?.loyaltyPoints).toBe(50);
  });

  it('leaves an order alone when no promotion applies', async () => {
    const product = await seedProductWithStock(20, '400', '1000');
    const order = await placeOrder([{ productId: product.id, quantity: 2, unitPrice: '1000' }]);

    expect(order.promotionIds).toEqual([]);
    expect(order.promotionDiscount).toBe(0);
    expect(order.subtotal).toBe(tk('2000'));
    expect(await db.promotionUsages.count()).toBe(0);
  });

  it('keeps the due amount consistent with the discounted total', async () => {
    const product = await seedProductWithStock(20, '400', '1000');
    await createPromotion(promotionInput({ type: 'percent', percentOff: 50 }));

    const order = await placeOrder(
      [{ productId: product.id, quantity: 2, unitPrice: '1000' }],
      { deliveryCharge: tk('60') },
    );

    expect(order.total).toBe(tk('1060')); // 1,000 discounted + 60 delivery
    const totals = await totalsForOrder(order.id);
    expect(totals.due).toBe(tk('1060'));
  });
});
