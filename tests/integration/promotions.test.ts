/**
 * promotions.test.ts — the promotion service against a real IndexedDB.
 *
 * The engine tests (tests/unit/promotions.test.ts) prove the arithmetic. These prove the
 * parts that touch the database: that an offer built from real products and customers
 * produces the discount it should, that what was applied is recorded, that the
 * performance report is measured from those records rather than re-derived, and that
 * cancelling an order gives the usage allowance back.
 */

import { describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { parseMoney } from '@/lib/money';
import { nowMs } from '@/lib/date';
import type { PromotionInput } from '@/domain/schemas';
import {
  archivePromotion,
  createPromotion,
  deletePromotion,
  evaluateForBasket,
  getPromotion,
  listPromotions,
  promotionPerformance,
  recordUsage,
  releaseUsage,
  addLoyaltyEntry,
  recomputeLoyaltyBalance,
  createReferral,
  rewardReferral,
  listReferrals,
  loyaltyHistory,
  totalDiscountInRange,
  usagesForPromotion,
} from '@/services/promotionService';
import { updateSettings } from '@/services/settingsService';
import { seedCustomer, seedProduct } from '../helpers/factories';

const tk = parseMoney;
const DAY = 86_400_000;

function promotionInput(partial: Partial<PromotionInput> & { type: PromotionInput['type'] }): PromotionInput {
  return {
    name: partial.name ?? 'টেস্ট অফার',
    description: '',
    type: partial.type,
    status: partial.status ?? 'active',
    startsAt: partial.startsAt ?? nowMs() - DAY,
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
    ...(partial.mechanism ? { mechanism: partial.mechanism } : {}),
  } as PromotionInput;
}

describe('promotion CRUD', () => {
  it('creates, reads back and lists a promotion', async () => {
    const created = await createPromotion(promotionInput({ type: 'percent', name: 'ঈদ অফার', percentOff: 15 }));
    expect(created.id).toBeTruthy();
    expect(created.mechanism).toBe('percent_off');

    const fetched = await getPromotion(created.id);
    expect(fetched?.name).toBe('ঈদ অফার');

    const { rows, total } = await listPromotions({});
    expect(total).toBe(1);
    expect(rows[0].name).toBe('ঈদ অফার');
  });

  it('hides archived promotions by default', async () => {
    const promo = await createPromotion(promotionInput({ type: 'percent', percentOff: 5 }));
    await archivePromotion(promo.id);

    expect((await listPromotions({})).total).toBe(0);
    expect((await listPromotions({ includeArchived: true })).total).toBe(1);
  });

  it('refuses to delete a promotion that has been used', async () => {
    const promo = await createPromotion(promotionInput({ type: 'percent', percentOff: 10 }));
    await db.promotionUsages.add({
      id: 'u1',
      promotionId: promo.id,
      promotionName: promo.name,
      promotionType: promo.type,
      orderId: 'o1',
      orderNumber: 'ORD-00001',
      customerId: null,
      customerName: '',
      date: nowMs(),
      itemDiscount: 1000,
      orderDiscount: 0,
      deliveryDiscount: 0,
      totalDiscount: 1000,
      orderTotal: 10000,
      orderNetSales: 9000,
      createdAt: nowMs(),
      updatedAt: nowMs(),
      archivedAt: null,
    });

    await expect(deletePromotion(promo.id)).rejects.toThrow(/আর্কাইভ/);
    // The record is still there — deleting it would orphan the order's explanation.
    expect(await getPromotion(promo.id)).toBeTruthy();
  });

  it('allows deleting an unused promotion', async () => {
    const promo = await createPromotion(promotionInput({ type: 'percent', percentOff: 10 }));
    await expect(deletePromotion(promo.id)).resolves.toBeUndefined();
    expect(await getPromotion(promo.id)).toBeUndefined();
  });

  it('defaults BOGO to buy 1 get 1', async () => {
    const promo = await createPromotion(promotionInput({ type: 'bogo' }));
    expect(promo.buyQuantity).toBe(1);
    expect(promo.getQuantity).toBe(1);
    expect(promo.mechanism).toBe('free_items');
  });

  it('filters by type and by search text', async () => {
    await createPromotion(promotionInput({ type: 'percent', name: 'ঈদ বিশেষ', percentOff: 10 }));
    await createPromotion(promotionInput({ type: 'fixed', name: 'নগদ ছাড়', amountOff: tk('100') }));

    expect((await listPromotions({ type: 'fixed' })).total).toBe(1);
    expect((await listPromotions({ search: 'ঈদ' })).rows[0].name).toBe('ঈদ বিশেষ');
  });
});

describe('evaluating promotions against real records', () => {
  it('applies a percentage offer built from a real product', async () => {
    const product = await seedProduct({ sellingPrice: '1000' });
    await createPromotion(promotionInput({ type: 'percent', percentOff: 20 }));

    const result = await evaluateForBasket({
      lines: [{ productId: product.id, variantId: null, quantity: 2, unitPrice: tk('1000'), unitCost: tk('400'), lineDiscount: 0, name: product.name, unit: 'পিস' }],
      deliveryCharge: tk('60'),
      otherCharge: 0,
      customerId: null,
      couponCode: '',
      pointsToRedeem: 0,
    });

    // 20% of 2,000 taka.
    expect(result.itemDiscount).toBe(tk('400'));
    expect(result.applied).toHaveLength(1);
  });

  it('reads the customer order count so a first-order offer knows what to do', async () => {
    const customer = await seedCustomer();
    await createPromotion(promotionInput({ type: 'first_order', percentOff: 10, customerEligibility: 'first_order' }));

    const first = await evaluateForBasket({
      lines: [{ productId: null, variantId: null, quantity: 1, unitPrice: tk('1000'), unitCost: 0, lineDiscount: 0, name: 'পণ্য', unit: 'পিস' }],
      deliveryCharge: 0,
      otherCharge: 0,
      customerId: customer.id,
      couponCode: '',
      pointsToRedeem: 0,
    });
    expect(first.itemDiscount).toBe(tk('100'));

    // Now the same customer has a real order behind them.
    await db.orders.add({
      id: 'o-existing',
      orderNumber: 'ORD-00001',
      orderDate: nowMs(),
      channel: 'facebook',
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      deliveryAddress: '',
      items: [],
      subtotal: tk('1000'),
      discount: 0,
      deliveryCharge: 0,
      otherCharge: 0,
      total: tk('1000'),
      cogs: 0,
      status: 'delivered',
      paymentStatus: 'paid',
      paymentMethod: 'cash',
      courierProviderId: null,
      courierName: '',
      trackingNumber: '',
      notes: '',
      customerInstructions: '',
      cancelReason: '',
      stockCommitted: true,
      returnRestocked: false,
      codAmount: 0,
      promotionIds: [],
      promotionDiscount: 0,
      couponCode: '',
      loyaltyPointsEarned: 0,
      loyaltyPointsRedeemed: 0,
      loyaltyDiscount: 0,
      referralId: null,
      createdAt: nowMs(),
      updatedAt: nowMs(),
      archivedAt: null,
    });

    const second = await evaluateForBasket({
      lines: [{ productId: null, variantId: null, quantity: 1, unitPrice: tk('1000'), unitCost: 0, lineDiscount: 0, name: 'পণ্য', unit: 'পিস' }],
      deliveryCharge: 0,
      otherCharge: 0,
      customerId: customer.id,
      couponCode: '',
      pointsToRedeem: 0,
    });
    expect(second.applied).toHaveLength(0);
  });

  it('stops honouring an offer once its usage limit is reached', async () => {
    const promo = await createPromotion(promotionInput({ type: 'percent', percentOff: 10, usageLimit: 1 }));
    await db.promotionUsages.add({
      id: 'u1',
      promotionId: promo.id,
      promotionName: promo.name,
      promotionType: promo.type,
      orderId: 'o1',
      orderNumber: 'ORD-00001',
      customerId: null,
      customerName: '',
      date: nowMs(),
      itemDiscount: 1000,
      orderDiscount: 0,
      deliveryDiscount: 0,
      totalDiscount: 1000,
      orderTotal: 10000,
      orderNetSales: 9000,
      createdAt: nowMs(),
      updatedAt: nowMs(),
      archivedAt: null,
    });

    const result = await evaluateForBasket({
      lines: [{ productId: null, variantId: null, quantity: 1, unitPrice: tk('1000'), unitCost: 0, lineDiscount: 0, name: 'পণ্য', unit: 'পিস' }],
      deliveryCharge: 0,
      otherCharge: 0,
      customerId: null,
      couponCode: '',
      pointsToRedeem: 0,
    });
    expect(result.applied).toHaveLength(0);
  });

  it('does nothing when promotions are switched off in settings', async () => {
    await createPromotion(promotionInput({ type: 'percent', percentOff: 50 }));
    const settings = await updateSettings({
      promotions: { enabled: false, allowStacking: false, loyaltyEnabled: true, pointsPerHundredTaka: 1, paisaPerPoint: 100, referralEnabled: true, referralPoints: 50 },
    });
    expect(settings.promotions.enabled).toBe(false);

    const result = await evaluateForBasket({
      lines: [{ productId: null, variantId: null, quantity: 1, unitPrice: tk('1000'), unitCost: 0, lineDiscount: 0, name: 'পণ্য', unit: 'পিস' }],
      deliveryCharge: 0,
      otherCharge: 0,
      customerId: null,
      couponCode: '',
      pointsToRedeem: 0,
    });
    expect(result.applied).toHaveLength(0);
  });
});

describe('recording usage', () => {
  it('writes one usage row per applied promotion and bumps the counter', async () => {
    const promo = await createPromotion(promotionInput({ type: 'percent', percentOff: 10 }));
    const evaluation = await evaluateForBasket({
      lines: [{ productId: null, variantId: null, quantity: 1, unitPrice: tk('1000'), unitCost: 0, lineDiscount: 0, name: 'পণ্য', unit: 'পিস' }],
      deliveryCharge: 0,
      otherCharge: 0,
      customerId: null,
      couponCode: '',
      pointsToRedeem: 0,
    });

    const order = {
      id: 'o-1',
      orderNumber: 'ORD-00001',
      orderDate: nowMs(),
      subtotal: tk('1000'),
      discount: tk('100'),
      total: tk('900'),
      customerId: null,
      customerName: '',
    } as never;

    await recordUsage(order, evaluation);

    const usages = await usagesForPromotion(promo.id);
    expect(usages).toHaveLength(1);
    // The recorded figure is the discount actually given, not a re-derivation.
    expect(usages[0].totalDiscount).toBe(tk('100'));
    expect(usages[0].orderTotal).toBe(tk('900'));
    expect((await getPromotion(promo.id))?.usageCount).toBe(1);
  });

  it('gives the usage allowance back when an order is released', async () => {
    const promo = await createPromotion(promotionInput({ type: 'percent', percentOff: 10 }));
    const evaluation = await evaluateForBasket({
      lines: [{ productId: null, variantId: null, quantity: 1, unitPrice: tk('1000'), unitCost: 0, lineDiscount: 0, name: 'পণ্য', unit: 'পিস' }],
      deliveryCharge: 0,
      otherCharge: 0,
      customerId: null,
      couponCode: '',
      pointsToRedeem: 0,
    });
    const order = { id: 'o-2', orderNumber: 'ORD-00002', orderDate: nowMs(), subtotal: tk('1000'), discount: tk('100'), total: tk('900'), customerId: null, customerName: '' } as never;

    await recordUsage(order, evaluation);
    expect((await getPromotion(promo.id))?.usageCount).toBe(1);

    await releaseUsage('o-2');
    expect((await getPromotion(promo.id))?.usageCount).toBe(0);
    expect(await usagesForPromotion(promo.id)).toHaveLength(0);
  });
});

describe('promotion performance report', () => {
  it('reports usage, discount totals and the sales the offer appeared on', async () => {
    const promo = await createPromotion(promotionInput({ type: 'percent', name: 'শীতকালীন অফার', percentOff: 10 }));
    expect(promo.id).toBeTruthy();
    const evaluation = await evaluateForBasket({
      lines: [{ productId: null, variantId: null, quantity: 2, unitPrice: tk('1000'), unitCost: 0, lineDiscount: 0, name: 'পণ্য', unit: 'পিস' }],
      deliveryCharge: 0,
      otherCharge: 0,
      customerId: null,
      couponCode: '',
      pointsToRedeem: 0,
    });
    const order = { id: 'o-3', orderNumber: 'ORD-00003', orderDate: nowMs(), subtotal: tk('2000'), discount: tk('200'), total: tk('1800'), customerId: null, customerName: '' } as never;
    await recordUsage(order, evaluation);

    const [row] = await promotionPerformance();
    expect(row.name).toBe('শীতকালীন অফার');
    expect(row.usageCount).toBe(1);
    expect(row.totalDiscount).toBe(tk('200'));
    expect(row.orderValue).toBe(tk('1800'));
    expect(row.netSales).toBe(tk('1800'));
    expect(row.averageDiscount).toBe(tk('200'));
    expect(row.firstUsedAt).toBeTruthy();
  });

  it('counts each customer once and respects the date range', async () => {
    const customer = await seedCustomer();
    const promo = await createPromotion(promotionInput({ type: 'percent', percentOff: 10 }));
    const now = nowMs();
    expect(promo.id).toBeTruthy();

    await db.promotionUsages.bulkAdd([
      {
        id: 'u1', promotionId: promo.id, promotionName: promo.name, promotionType: promo.type,
        orderId: 'o1', orderNumber: 'A', customerId: customer.id, customerName: customer.name,
        date: now - 3 * DAY, itemDiscount: 1000, orderDiscount: 0, deliveryDiscount: 0,
        totalDiscount: 1000, orderTotal: 10000, orderNetSales: 9000,
        createdAt: now, updatedAt: now, archivedAt: null,
      },
      {
        id: 'u2', promotionId: promo.id, promotionName: promo.name, promotionType: promo.type,
        orderId: 'o2', orderNumber: 'B', customerId: customer.id, customerName: customer.name,
        date: now - 30 * DAY, itemDiscount: 500, orderDiscount: 0, deliveryDiscount: 0,
        totalDiscount: 500, orderTotal: 5000, orderNetSales: 4500,
        createdAt: now, updatedAt: now, archivedAt: null,
      },
    ]);

    const all = await promotionPerformance();
    expect(all[0].usageCount).toBe(2);
    expect(all[0].uniqueCustomers).toBe(1);

    const recent = await promotionPerformance({ from: now - 7 * DAY, to: now + DAY });
    expect(recent[0].usageCount).toBe(1);
    expect(recent[0].totalDiscount).toBe(1000);

    expect(await totalDiscountInRange(now - 7 * DAY, now + DAY)).toBe(1000);
  });

  it('still reports an offer that has since been deleted', async () => {
    const promo = await createPromotion(promotionInput({ type: 'percent', name: 'পুরনো অফার', percentOff: 10 }));
    await db.promotionUsages.add({
      id: 'u1', promotionId: promo.id, promotionName: promo.name, promotionType: promo.type,
      orderId: 'o1', orderNumber: 'A', customerId: null, customerName: '', date: nowMs(),
      itemDiscount: 700, orderDiscount: 0, deliveryDiscount: 0, totalDiscount: 700,
      orderTotal: 7000, orderNetSales: 6300, createdAt: nowMs(), updatedAt: nowMs(), archivedAt: null,
    });
    await db.promotions.delete(promo.id);

    const [row] = await promotionPerformance();
    // The name is kept on the usage row precisely so history survives a deletion.
    expect(row.name).toBe('পুরনো অফার');
    expect(row.status).toBe('deleted');
  });
});

describe('loyalty ledger', () => {
  it('derives the balance from the ledger, not by accumulating', async () => {
    const customer = await seedCustomer();

    await addLoyaltyEntry({ customerId: customer.id, type: 'earn', points: 30, orderId: null, promotionId: null, note: '', date: nowMs() });
    await addLoyaltyEntry({ customerId: customer.id, type: 'earn', points: 20, orderId: null, promotionId: null, note: '', date: nowMs() });
    expect((await db.customers.get(customer.id))?.loyaltyPoints).toBe(50);

    await addLoyaltyEntry({ customerId: customer.id, type: 'redeem', points: -15, orderId: null, promotionId: null, note: '', date: nowMs() });
    expect((await db.customers.get(customer.id))?.loyaltyPoints).toBe(35);

    // Reversing a mistake brings the balance back — an accumulated counter could not.
    await addLoyaltyEntry({ customerId: customer.id, type: 'adjust', points: -20, orderId: null, promotionId: null, note: 'ভুল সংশোধন', date: nowMs() });
    expect((await db.customers.get(customer.id))?.loyaltyPoints).toBe(15);
  });

  it('recomputes a balance from scratch', async () => {
    const customer = await seedCustomer();
    await addLoyaltyEntry({ customerId: customer.id, type: 'earn', points: 40, orderId: null, promotionId: null, note: '', date: nowMs() });
    await db.customers.update(customer.id, { loyaltyPoints: 9999 });

    expect(await recomputeLoyaltyBalance(customer.id)).toBe(40);
    expect((await db.customers.get(customer.id))?.loyaltyPoints).toBe(40);
  });

  it('keeps a readable history per customer', async () => {
    const customer = await seedCustomer();
    await addLoyaltyEntry({ customerId: customer.id, type: 'earn', points: 10, orderId: null, promotionId: null, note: 'প্রথম অর্ডার', date: nowMs() });
    const history = await loyaltyHistory(customer.id);
    expect(history).toHaveLength(1);
    expect(history[0].note).toBe('প্রথম অর্ডার');
  });
});

describe('referrals', () => {
  it('records a referral and credits the referrer when rewarded', async () => {
    const referrer = await seedCustomer({ name: 'রেফারকারী', phone: '01711111111' });
    const referred = await seedCustomer({ name: 'নতুন কাস্টমার', phone: '01722222222' });

    const referral = await createReferral({
      referrerCustomerId: referrer.id,
      referredCustomerId: referred.id,
      referredName: '',
      rewardType: 'points',
      rewardPoints: 50,
      rewardAmount: 0,
      note: 'ফেসবুক পেজ থেকে এসেছেন',
      date: nowMs(),
    });

    expect(referral.status).toBe('pending');
    expect(referral.referrerName).toBe('রেফারকারী');
    expect(referral.referredName).toBe('নতুন কাস্টমার');

    await rewardReferral(referral.id);
    const after = (await listReferrals(referrer.id))[0];
    expect(after.status).toBe('rewarded');
    expect(after.rewardedAt).toBeTruthy();
    // The reward is a real loyalty entry, so it shows in the customer's balance.
    expect((await db.customers.get(referrer.id))?.loyaltyPoints).toBe(50);
  });

  it('does not credit the same reward twice', async () => {
    const referrer = await seedCustomer({ name: 'A', phone: '01733333333' });
    const referral = await createReferral({
      referrerCustomerId: referrer.id, referredCustomerId: null, referredName: 'লিড',
      rewardType: 'points', rewardPoints: 20, rewardAmount: 0, note: '', date: nowMs(),
    });
    await rewardReferral(referral.id);
    await rewardReferral(referral.id);

    expect((await db.customers.get(referrer.id))?.loyaltyPoints).toBe(20);
  });
});
