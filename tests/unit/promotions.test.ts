/**
 * promotions.test.ts — the money rules of the V2 promotion engine.
 *
 * Every figure here is paisa and every expectation is an exact integer, not a
 * "close to". The tests are grouped the way the brief lists the requirements:
 * discount calculation, BOGO / Buy X Get Y, free gifts, free delivery, eligibility and
 * expiry, stacking prevention, and the totals/profit that come out the other side.
 */

import { describe, expect, it } from 'vitest';
import {
  applyCombinationRules,
  evaluatePromotions,
  previewPromotion,
  type BasketContext,
  type BasketLineInput,
} from '@/finance/promotions';
import { defaultPromotions } from '@/db/defaults';
import type { Promotion, PromotionSettings, PromotionType } from '@/domain/types';
import { mechanismForType } from '@/finance/promotions';
import { DEFAULT_MECHANISM } from '@/domain/constants';
import { addMoney, subMoney } from '@/lib/money';

const NOW = Date.UTC(2026, 5, 1, 6, 0, 0); // 1 June 2026, noon Dhaka
const DAY = 86_400_000;

/** 1 BDT = 100 paisa. Reading `tk(1200)` is much clearer than `120000`. */
function tk(taka: number): number {
  return Math.round(taka * 100);
}

let seq = 0;
function line(partial: Partial<BasketLineInput> & { unitPrice: number }): BasketLineInput {
  seq += 1;
  return {
    id: partial.id ?? `line-${seq}`,
    productId: partial.productId ?? `p${seq}`,
    variantId: null,
    categoryId: partial.categoryId ?? null,
    name: partial.name ?? `পণ্য ${seq}`,
    unit: partial.unit ?? 'পিস',
    quantity: partial.quantity ?? 1,
    unitPrice: partial.unitPrice,
    unitCost: partial.unitCost ?? 0,
    lineDiscount: partial.lineDiscount ?? 0,
    isFreeGift: partial.isFreeGift ?? false,
  };
}

function promotion(partial: Partial<Promotion> & { type: PromotionType }): Promotion {
  const type = partial.type;
  const mechanism = partial.mechanism ?? DEFAULT_MECHANISM[type];
  return {
    id: partial.id ?? `promo-${type}`,
    name: partial.name ?? `${type} অফার`,
    description: '',
    type,
    mechanism,
    status: partial.status ?? 'active',
    percentOff: partial.percentOff ?? 0,
    amountOff: partial.amountOff ?? 0,
    buyQuantity: partial.buyQuantity ?? 0,
    getQuantity: partial.getQuantity ?? 0,
    bundleItems: partial.bundleItems ?? [],
    bundlePrice: partial.bundlePrice ?? 0,
    giftItems: partial.giftItems ?? [],
    startsAt: partial.startsAt ?? NOW - DAY,
    endsAt: partial.endsAt ?? null,
    productIds: partial.productIds ?? [],
    categoryIds: partial.categoryIds ?? [],
    minOrderAmount: partial.minOrderAmount ?? 0,
    maxDiscount: partial.maxDiscount ?? 0,
    usageLimit: partial.usageLimit ?? null,
    usageCount: partial.usageCount ?? 0,
    perCustomerLimit: partial.perCustomerLimit ?? null,
    customerEligibility: partial.customerEligibility ?? 'all',
    customerSegments: partial.customerSegments ?? [],
    couponCode: partial.couponCode ?? '',
    stackable: partial.stackable ?? true,
    priority: partial.priority ?? 10,
    combinationGroup: partial.combinationGroup ?? '',
    terms: partial.terms ?? '',
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
  };
}

function context(partial: Partial<BasketContext> & { lines: BasketLineInput[] }): BasketContext {
  const settings: PromotionSettings = { ...defaultPromotions(), ...(partial.settings ?? {}) };
  return {
    lines: partial.lines,
    deliveryCharge: partial.deliveryCharge ?? 0,
    otherCharge: partial.otherCharge ?? 0,
    now: partial.now ?? NOW,
    couponCode: partial.couponCode ?? '',
    customerId: partial.customerId ?? 'cus-1',
    customerOrderCount: partial.customerOrderCount ?? 0,
    customerSegment: partial.customerSegment ?? '',
    loyaltyPointsAvailable: partial.loyaltyPointsAvailable ?? 0,
    pointsToRedeem: partial.pointsToRedeem ?? 0,
    settings,
    usageByPromotion: partial.usageByPromotion ?? {},
    usageByPromotionForCustomer: partial.usageByPromotionForCustomer ?? {},
    unitCostOf: partial.unitCostOf,
  };
}

/* ------------------------------------------------------------------ */

describe('promotion mechanisms', () => {
  it('maps every one of the 17 types to a real mechanism', () => {
    const types: PromotionType[] = [
      'percent', 'fixed', 'bogo', 'buy_x_get_y', 'free_gift', 'free_delivery', 'bundle',
      'coupon', 'min_purchase', 'first_order', 'repeat_customer', 'seasonal',
      'limited_time', 'product_specific', 'category_specific', 'loyalty_points', 'referral',
    ];
    expect(types).toHaveLength(17);
    for (const type of types) {
      expect(mechanismForType(type)).toBe(DEFAULT_MECHANISM[type]);
      expect(mechanismForType(type)).toBeTruthy();
    }
  });
});

describe('percentage discounts', () => {
  it('takes a percentage off the whole basket', () => {
    const promo = promotion({ type: 'percent', percentOff: 10 });
    const result = evaluatePromotions([promo], context({ lines: [line({ unitPrice: tk(1000), quantity: 2 })] }));

    expect(result.itemDiscount).toBe(tk(200)); // 10% of 2,000
    expect(result.totalDiscount).toBe(tk(200));
  });

  it('splits the discount across lines so the parts sum exactly', () => {
    const lines = [
      line({ id: 'a', unitPrice: tk(333), quantity: 1 }),
      line({ id: 'b', unitPrice: tk(333), quantity: 1 }),
      line({ id: 'c', unitPrice: tk(334), quantity: 1 }),
    ];
    const result = evaluatePromotions([promotion({ type: 'percent', percentOff: 15 })], context({ lines }));

    const summed = Object.values(result.lineDiscounts).reduce((s, v) => s + v, 0);
    // 15% of 1,000 = 150 taka exactly, and no paisa may be lost or invented.
    expect(summed).toBe(result.itemDiscount);
    expect(summed).toBe(tk(150));
  });

  it('never discounts more than the line is worth', () => {
    const result = evaluatePromotions(
      [promotion({ type: 'percent', percentOff: 150 })],
      context({ lines: [line({ unitPrice: tk(500), quantity: 1 })] }),
    );
    expect(result.itemDiscount).toBe(tk(500));
    expect(result.itemDiscount).toBeLessThanOrEqual(tk(500));
  });

  it('honours maxDiscount as a hard ceiling', () => {
    const result = evaluatePromotions(
      [promotion({ type: 'percent', percentOff: 50, maxDiscount: tk(100) })],
      context({ lines: [line({ unitPrice: tk(1000), quantity: 1 })] }),
    );
    expect(result.itemDiscount).toBe(tk(100)); // would have been 500
  });
});

describe('fixed amount discounts', () => {
  it('takes a fixed amount off', () => {
    const result = evaluatePromotions(
      [promotion({ type: 'fixed', amountOff: tk(250) })],
      context({ lines: [line({ unitPrice: tk(1000), quantity: 1 })] }),
    );
    expect(result.itemDiscount).toBe(tk(250));
  });

  it('clamps to the basket when the fixed amount is larger', () => {
    const result = evaluatePromotions(
      [promotion({ type: 'fixed', amountOff: tk(5000) })],
      context({ lines: [line({ unitPrice: tk(300), quantity: 1 })] }),
    );
    expect(result.itemDiscount).toBe(tk(300));
  });

  it('only discounts the products it targets', () => {
    const lines = [
      line({ id: 'a', productId: 'p1', unitPrice: tk(1000), quantity: 1 }),
      line({ id: 'b', productId: 'p2', unitPrice: tk(1000), quantity: 1 }),
    ];
    const result = evaluatePromotions(
      [promotion({ type: 'product_specific', percentOff: 20, productIds: ['p1'] })],
      context({ lines }),
    );
    expect(result.itemDiscount).toBe(tk(200)); // p1 only
    expect(result.lineDiscounts.a).toBe(tk(200));
    expect(result.lineDiscounts.b).toBeUndefined();
  });

  it('only discounts the categories it targets', () => {
    const lines = [
      line({ id: 'a', productId: 'p1', categoryId: 'c1', unitPrice: tk(1000), quantity: 1 }),
      line({ id: 'b', productId: 'p2', categoryId: 'c2', unitPrice: tk(1000), quantity: 1 }),
    ];
    const result = evaluatePromotions(
      [promotion({ type: 'category_specific', percentOff: 10, categoryIds: ['c2'] })],
      context({ lines }),
    );
    expect(result.itemDiscount).toBe(tk(100));
    expect(result.lineDiscounts.b).toBe(tk(100));
  });
});

describe('BOGO and Buy X Get Y', () => {
  it('BOGO: 1 paid, 1 free on 2 units', () => {
    const result = evaluatePromotions(
      [promotion({ type: 'bogo', buyQuantity: 1, getQuantity: 1 })],
      context({ lines: [line({ unitPrice: tk(700), quantity: 2 })] }),
    );
    expect(result.itemDiscount).toBe(tk(700));
    expect(result.applied[0].freeItems[0].quantity).toBe(1);
  });

  it('BOGO: 4 units give 2 free', () => {
    const result = evaluatePromotions(
      [promotion({ type: 'bogo', buyQuantity: 1, getQuantity: 1 })],
      context({ lines: [line({ unitPrice: tk(700), quantity: 4 })] }),
    );
    expect(result.itemDiscount).toBe(tk(1400));
  });

  it('BOGO: an odd quantity leaves the remainder paid', () => {
    const result = evaluatePromotions(
      [promotion({ type: 'bogo', buyQuantity: 1, getQuantity: 1 })],
      context({ lines: [line({ unitPrice: tk(700), quantity: 3 })] }),
    );
    // floor(3 / 2) = 1 group → 1 free, not 1.5
    expect(result.itemDiscount).toBe(tk(700));
  });

  it('Buy 2 Get 1: 6 units give 2 free', () => {
    const result = evaluatePromotions(
      [promotion({ type: 'buy_x_get_y', buyQuantity: 2, getQuantity: 1 })],
      context({ lines: [line({ unitPrice: tk(500), quantity: 6 })] }),
    );
    expect(result.itemDiscount).toBe(tk(1000)); // floor(6/3) = 2 groups × 1 free
  });

  it('Buy 2 Get 1: 5 units give only 1 free', () => {
    const result = evaluatePromotions(
      [promotion({ type: 'buy_x_get_y', buyQuantity: 2, getQuantity: 1 })],
      context({ lines: [line({ unitPrice: tk(500), quantity: 5 })] }),
    );
    expect(result.itemDiscount).toBe(tk(500));
  });

  it('frees the CHEAPEST units across lines, not the dearest', () => {
    const lines = [
      line({ id: 'cheap', unitPrice: tk(300), quantity: 1 }),
      line({ id: 'dear', unitPrice: tk(900), quantity: 1 }),
    ];
    const result = evaluatePromotions(
      [promotion({ type: 'bogo', buyQuantity: 1, getQuantity: 1 })],
      context({ lines }),
    );
    expect(result.itemDiscount).toBe(tk(300));
    expect(result.lineDiscounts.cheap).toBe(tk(300));
    expect(result.lineDiscounts.dear).toBeUndefined();
  });

  it('does nothing when the quantity cannot make a group', () => {
    const result = evaluatePromotions(
      [promotion({ type: 'buy_x_get_y', buyQuantity: 2, getQuantity: 1 })],
      context({ lines: [line({ unitPrice: tk(500), quantity: 2 })] }),
    );
    expect(result.applied).toHaveLength(0);
    expect(result.itemDiscount).toBe(0);
  });

  it('respects maxDiscount by dropping free units', () => {
    const result = evaluatePromotions(
      [promotion({ type: 'bogo', buyQuantity: 1, getQuantity: 1, maxDiscount: tk(400) })],
      context({ lines: [line({ unitPrice: tk(700), quantity: 4 })] }),
    );
    // 2 free units = 1,400 but the cap is 400, so no whole unit fits under it.
    expect(result.itemDiscount).toBe(0);
  });
});

describe('free gifts', () => {
  it('adds a gift line at zero price but real cost', () => {
    const result = evaluatePromotions(
      [
        promotion({
          type: 'free_gift',
          giftItems: [{ productId: 'gift-1', variantId: null, name: 'মাথার স্কার্ফ', quantity: 1 }],
        }),
      ],
      context({
        lines: [line({ unitPrice: tk(1000), quantity: 1 })],
        unitCostOf: () => tk(120),
      }),
    );

    expect(result.giftLines).toHaveLength(1);
    expect(result.giftLines[0].unitPrice).toBe(0);
    // The gift cost real money, so it must land in COGS.
    expect(result.giftLines[0].unitCost).toBe(tk(120));
    // …but it is never counted as a sale.
    expect(result.itemDiscount).toBe(0);
  });

  it('a free gift does not reduce the sale value of the order', () => {
    const lines = [line({ unitPrice: tk(1000), quantity: 2 })];
    const result = evaluatePromotions(
      [
        promotion({
          type: 'free_gift',
          giftItems: [{ productId: 'gift-1', variantId: null, name: 'উপহার', quantity: 1 }],
        }),
      ],
      context({ lines, unitCostOf: () => tk(50) }),
    );
    const netSales = subMoney(tk(2000), result.itemDiscount + result.orderDiscount);
    expect(netSales).toBe(tk(2000));
  });
});

describe('free delivery', () => {
  it('waives the whole delivery charge', () => {
    const result = evaluatePromotions(
      [promotion({ type: 'free_delivery' })],
      context({ lines: [line({ unitPrice: tk(1000), quantity: 1 })], deliveryCharge: tk(60) }),
    );
    expect(result.deliveryDiscount).toBe(tk(60));
    expect(result.itemDiscount).toBe(0);
  });

  it('never waives more than the delivery charge that was billed', () => {
    const result = evaluatePromotions(
      [promotion({ type: 'free_delivery', maxDiscount: tk(500) })],
      context({ lines: [line({ unitPrice: tk(1000), quantity: 1 })], deliveryCharge: tk(60) }),
    );
    expect(result.deliveryDiscount).toBe(tk(60));
  });

  it('does nothing when delivery is already free', () => {
    const result = evaluatePromotions(
      [promotion({ type: 'free_delivery' })],
      context({ lines: [line({ unitPrice: tk(1000), quantity: 1 })], deliveryCharge: 0 }),
    );
    expect(result.applied).toHaveLength(0);
  });
});

describe('bundle offers', () => {
  it('charges the bundle price for a complete set', () => {
    const lines = [
      line({ id: 'a', productId: 'p1', unitPrice: tk(800), quantity: 1 }),
      line({ id: 'b', productId: 'p2', unitPrice: tk(600), quantity: 1 }),
    ];
    const result = evaluatePromotions(
      [
        promotion({
          type: 'bundle',
          bundleItems: [
            { productId: 'p1', variantId: null, name: 'শার্ট', quantity: 1 },
            { productId: 'p2', variantId: null, name: 'প্যান্ট', quantity: 1 },
          ],
          bundlePrice: tk(1200),
        }),
      ],
      context({ lines }),
    );
    // Regular 1,400 − bundle 1,200 = 200 off.
    expect(result.itemDiscount).toBe(tk(200));
  });

  it('counts only complete sets', () => {
    const lines = [
      line({ id: 'a', productId: 'p1', unitPrice: tk(800), quantity: 3 }),
      line({ id: 'b', productId: 'p2', unitPrice: tk(600), quantity: 1 }),
    ];
    const result = evaluatePromotions(
      [
        promotion({
          type: 'bundle',
          bundleItems: [
            { productId: 'p1', variantId: null, name: 'শার্ট', quantity: 2 },
            { productId: 'p2', variantId: null, name: 'প্যান্ট', quantity: 1 },
          ],
          bundlePrice: tk(1800),
        }),
      ],
      context({ lines }),
    );
    // One complete set: (2×800 + 1×600) = 2,200 → 1,800, saving 400.
    expect(result.itemDiscount).toBe(tk(400));
  });

  it('does not apply when the basket is missing an item', () => {
    const result = evaluatePromotions(
      [
        promotion({
          type: 'bundle',
          bundleItems: [
            { productId: 'p1', variantId: null, name: 'শার্ট', quantity: 1 },
            { productId: 'p9', variantId: null, name: 'অনুপস্থিত', quantity: 1 },
          ],
          bundlePrice: tk(500),
        }),
      ],
      context({ lines: [line({ productId: 'p1', unitPrice: tk(800), quantity: 1 })] }),
    );
    expect(result.applied).toHaveLength(0);
  });
});

describe('coupon codes', () => {
  const coupon = promotion({ type: 'coupon', percentOff: 20, couponCode: 'EID20' });

  it('applies when the code matches, ignoring case and spaces', () => {
    const result = evaluatePromotions([coupon], context({
      lines: [line({ unitPrice: tk(1000), quantity: 1 })],
      couponCode: '  eid20 ',
    }));
    expect(result.itemDiscount).toBe(tk(200));
  });

  it('is rejected when the code does not match', () => {
    const result = evaluatePromotions([coupon], context({
      lines: [line({ unitPrice: tk(1000), quantity: 1 })],
      couponCode: 'WRONG',
    }));
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0].reason).toContain('কুপন');
  });

  it('is rejected when no code was typed', () => {
    const result = evaluatePromotions([coupon], context({
      lines: [line({ unitPrice: tk(1000), quantity: 1 })],
      couponCode: '',
    }));
    expect(result.applied).toHaveLength(0);
  });
});

describe('eligibility, windows and limits', () => {
  it('rejects an expired offer', () => {
    const result = evaluatePromotions(
      [promotion({ type: 'percent', percentOff: 10, endsAt: NOW - DAY })],
      context({ lines: [line({ unitPrice: tk(1000), quantity: 1 })] }),
    );
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0].reason).toContain('মেয়াদ');
  });

  it('rejects an offer that has not started', () => {
    const result = evaluatePromotions(
      [promotion({ type: 'percent', percentOff: 10, startsAt: NOW + DAY })],
      context({ lines: [line({ unitPrice: tk(1000), quantity: 1 })] }),
    );
    expect(result.rejected[0].reason).toContain('শুরু');
  });

  it('rejects a paused or draft offer', () => {
    for (const status of ['paused', 'draft'] as const) {
      const result = evaluatePromotions(
        [promotion({ type: 'percent', percentOff: 10, status })],
        context({ lines: [line({ unitPrice: tk(1000), quantity: 1 })] }),
      );
      expect(result.applied).toHaveLength(0);
    }
  });

  it('requires the minimum purchase', () => {
    const promo = promotion({ type: 'min_purchase', amountOff: tk(200), minOrderAmount: tk(3000) });
    const tooSmall = evaluatePromotions([promo], context({ lines: [line({ unitPrice: tk(1000), quantity: 1 })] }));
    const bigEnough = evaluatePromotions([promo], context({ lines: [line({ unitPrice: tk(1000), quantity: 4 })] }));

    expect(tooSmall.applied).toHaveLength(0);
    expect(tooSmall.rejected[0].reason).toContain('ন্যূনতম');
    expect(bigEnough.itemDiscount).toBe(tk(200));
  });

  it('first-order offers only apply to a brand-new customer', () => {
    const promo = promotion({ type: 'first_order', percentOff: 15, customerEligibility: 'first_order' });
    const first = evaluatePromotions([promo], context({ lines: [line({ unitPrice: tk(1000) })], customerOrderCount: 0 }));
    const repeat = evaluatePromotions([promo], context({ lines: [line({ unitPrice: tk(1000) })], customerOrderCount: 3 }));

    expect(first.itemDiscount).toBe(tk(150));
    expect(repeat.applied).toHaveLength(0);
    expect(repeat.rejected[0].reason).toContain('প্রথম');
  });

  it('repeat-customer offers only apply to someone who bought before', () => {
    const promo = promotion({ type: 'repeat_customer', percentOff: 10, customerEligibility: 'repeat' });
    const first = evaluatePromotions([promo], context({ lines: [line({ unitPrice: tk(1000) })], customerOrderCount: 0 }));
    const repeat = evaluatePromotions([promo], context({ lines: [line({ unitPrice: tk(1000) })], customerOrderCount: 2 }));

    expect(first.applied).toHaveLength(0);
    expect(repeat.itemDiscount).toBe(tk(100));
  });

  it('honours the total usage limit', () => {
    const promo = promotion({ type: 'percent', percentOff: 10, usageLimit: 5 });
    const result = evaluatePromotions([promo], context({
      lines: [line({ unitPrice: tk(1000) })],
      usageByPromotion: { [promo.id]: 5 },
    }));
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0].reason).toContain('সীমা');
  });

  it('honours the per-customer usage limit', () => {
    const promo = promotion({ type: 'percent', percentOff: 10, perCustomerLimit: 1 });
    const result = evaluatePromotions([promo], context({
      lines: [line({ unitPrice: tk(1000) })],
      customerId: 'cus-9',
      usageByPromotionForCustomer: { [promo.id]: 1 },
    }));
    expect(result.applied).toHaveLength(0);
  });

  it('respects customer segments', () => {
    const promo = promotion({ type: 'percent', percentOff: 10, customerSegments: ['পাইকারি'] });
    const matching = evaluatePromotions([promo], context({ lines: [line({ unitPrice: tk(1000) })], customerSegment: 'পাইকারি' }));
    const other = evaluatePromotions([promo], context({ lines: [line({ unitPrice: tk(1000) })], customerSegment: 'খুচরা' }));

    expect(matching.itemDiscount).toBe(tk(100));
    expect(other.applied).toHaveLength(0);
  });
});

describe('discount stacking prevention', () => {
  const lines = [line({ unitPrice: tk(1000), quantity: 1 })];

  it('applies only ONE promotion when stacking is switched off', () => {
    const result = evaluatePromotions(
      [
        promotion({ id: 'ten', type: 'percent', percentOff: 10 }),
        promotion({ id: 'fifty', type: 'percent', percentOff: 50 }),
      ],
      context({ lines, settings: { allowStacking: false } as PromotionSettings }),
    );
    expect(result.applied).toHaveLength(1);
    // The better offer wins, not simply the first one in the list.
    expect(result.applied[0].promotionId).toBe('fifty');
    expect(result.itemDiscount).toBe(tk(500));
  });

  it('combines stackable promotions when stacking is allowed', () => {
    const result = evaluatePromotions(
      [
        promotion({ id: 'ten', type: 'percent', percentOff: 10, priority: 1 }),
        promotion({ id: 'hundred', type: 'fixed', amountOff: tk(100), priority: 2 }),
      ],
      context({ lines, settings: { allowStacking: true } as PromotionSettings }),
    );
    // 10% of 1,000 = 100, then a further 100 off the remaining 900.
    expect(result.applied).toHaveLength(2);
    expect(result.totalDiscount).toBe(tk(200));
  });

  it('never lets two promotions take the order below zero', () => {
    const result = evaluatePromotions(
      [
        promotion({ id: 'a', type: 'percent', percentOff: 80, priority: 1 }),
        promotion({ id: 'b', type: 'fixed', amountOff: tk(9000), priority: 2 }),
      ],
      context({ lines, settings: { allowStacking: true } as PromotionSettings }),
    );
    expect(result.totalDiscount).toBeLessThanOrEqual(tk(1000));
    expect(result.totalDiscount).toBe(tk(1000));
  });

  it('never combines two promotions from the same combination group', () => {
    const result = evaluatePromotions(
      [
        promotion({ id: 'a', type: 'percent', percentOff: 10, combinationGroup: 'eid', priority: 1 }),
        promotion({ id: 'b', type: 'percent', percentOff: 20, combinationGroup: 'eid', priority: 2 }),
      ],
      context({ lines, settings: { allowStacking: true } as PromotionSettings }),
    );
    expect(result.applied).toHaveLength(1);
    expect(result.rejected.some((r) => r.reason.includes('গ্রুপ'))).toBe(true);
  });

  it('a non-stackable promotion always stands alone', () => {
    const result = evaluatePromotions(
      [
        promotion({ id: 'exclusive', type: 'percent', percentOff: 30, stackable: false, priority: 1 }),
        promotion({ id: 'other', type: 'fixed', amountOff: tk(50), stackable: true, priority: 2 }),
      ],
      context({ lines, settings: { allowStacking: true } as PromotionSettings }),
    );
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].promotionId).toBe('exclusive');
  });

  it('allows only one free-delivery offer', () => {
    const result = evaluatePromotions(
      [
        promotion({ id: 'fd1', type: 'free_delivery', priority: 1 }),
        promotion({ id: 'fd2', type: 'free_delivery', priority: 2 }),
      ],
      context({ lines, deliveryCharge: tk(60), settings: { allowStacking: true } as PromotionSettings }),
    );
    expect(result.deliveryDiscount).toBe(tk(60));
    expect(result.applied).toHaveLength(1);
  });

  it('gives the same answer every time it is evaluated', () => {
    const promos = [
      promotion({ id: 'ten', type: 'percent', percentOff: 10 }),
      promotion({ id: 'fixed', type: 'fixed', amountOff: tk(50) }),
    ];
    const ctx = context({ lines, settings: { allowStacking: true } as PromotionSettings });
    const first = evaluatePromotions(promos, ctx);
    const second = evaluatePromotions(promos, ctx);
    expect(second.totalDiscount).toBe(first.totalDiscount);
    expect(JSON.stringify(second.lineDiscounts)).toBe(JSON.stringify(first.lineDiscounts));
  });
});

describe('loyalty points', () => {
  it('earns one point per whole 100 taka by default', () => {
    const settings = { ...defaultPromotions(), pointsPerHundredTaka: 1 } as PromotionSettings;
    const result = evaluatePromotions(
      [promotion({ type: 'loyalty_points' })],
      context({ lines: [line({ unitPrice: tk(1000), quantity: 3 })], settings }),
    );
    // 3,000 taka → 30 points.
    expect(result.pointsEarned).toBe(30);
  });

  it('does not award a partial point', () => {
    const settings = { ...defaultPromotions(), pointsPerHundredTaka: 1 } as PromotionSettings;
    const result = evaluatePromotions(
      [promotion({ type: 'loyalty_points' })],
      context({ lines: [line({ unitPrice: tk(150), quantity: 1 })], settings }),
    );
    expect(result.pointsEarned).toBe(1); // 150 taka → floor(1.5) = 1
  });

  it('redeems points as money off, clamped to the balance', () => {
    const settings = { ...defaultPromotions(), paisaPerPoint: tk(1) } as PromotionSettings;
    const result = evaluatePromotions([], context({
      lines: [line({ unitPrice: tk(1000), quantity: 1 })],
      settings,
      loyaltyPointsAvailable: 10,
      pointsToRedeem: 500,
    }));
    // Only 10 points exist, so only 10 taka comes off.
    expect(result.pointsRedeemed).toBe(10);
    expect(result.loyaltyDiscount).toBe(tk(10));
  });

  it('never lets redemption make the order free', () => {
    const settings = { ...defaultPromotions(), paisaPerPoint: tk(1) } as PromotionSettings;
    const result = evaluatePromotions([], context({
      lines: [line({ unitPrice: tk(200), quantity: 1 })],
      settings,
      loyaltyPointsAvailable: 100000,
      pointsToRedeem: 100000,
    }));
    expect(result.loyaltyDiscount).toBe(tk(200));
  });

  it('ignores redemption when loyalty is switched off', () => {
    const settings = { ...defaultPromotions(), loyaltyEnabled: false, paisaPerPoint: tk(1) } as PromotionSettings;
    const result = evaluatePromotions([], context({
      lines: [line({ unitPrice: tk(1000), quantity: 1 })],
      settings,
      loyaltyPointsAvailable: 50,
      pointsToRedeem: 50,
    }));
    expect(result.loyaltyDiscount).toBe(0);
  });

  it('earns points on the discounted value, not the original', () => {
    const settings = { ...defaultPromotions(), pointsPerHundredTaka: 1, allowStacking: true } as PromotionSettings;
    const result = evaluatePromotions(
      [
        promotion({ id: 'half', type: 'percent', percentOff: 50, priority: 1 }),
        promotion({ id: 'loy', type: 'loyalty_points', priority: 2 }),
      ],
      context({ lines: [line({ unitPrice: tk(1000), quantity: 1 })], settings }),
    );
    // 1,000 − 500 discount = 500 taka → 5 points.
    expect(result.itemDiscount).toBe(tk(500));
    expect(result.pointsEarned).toBe(5);
  });
});

describe('order totals after discounts', () => {
  it('produces the totals the order service will store', () => {
    const lines = [line({ unitPrice: tk(700), quantity: 2 })];
    const result = evaluatePromotions(
      [promotion({ type: 'percent', percentOff: 10 })],
      context({ lines, deliveryCharge: tk(60) }),
    );

    const grossSubtotal = tk(1400);
    const itemDiscount = result.itemDiscount; // 140
    const netSubtotal = subMoney(grossSubtotal, itemDiscount);
    const deliveryCharge = subMoney(tk(60), result.deliveryDiscount);
    const total = addMoney(netSubtotal, deliveryCharge);

    expect(netSubtotal).toBe(tk(1260));
    expect(total).toBe(tk(1320));
    // The discount is recorded separately so the report can show it.
    expect(result.totalDiscount).toBe(tk(140));
  });

  it('keeps delivery charge out of the discount base', () => {
    const lines = [line({ unitPrice: tk(1000), quantity: 1 })];
    const result = evaluatePromotions(
      [promotion({ type: 'percent', percentOff: 50 })],
      context({ lines, deliveryCharge: tk(500) }),
    );
    // 50% applies to the 1,000 taka of goods, not to the 500 taka delivery.
    expect(result.itemDiscount).toBe(tk(500));
    expect(result.deliveryDiscount).toBe(0);
  });
});

describe('previewPromotion', () => {
  it('scores one promotion on its own and says when it does not apply', () => {
    const promo = promotion({ type: 'percent', percentOff: 10, minOrderAmount: tk(5000) });
    const small = previewPromotion(promo, context({ lines: [line({ unitPrice: tk(100) })] }));
    const big = previewPromotion(promo, context({ lines: [line({ unitPrice: tk(10000) })] }));

    expect(small).toBeNull();
    expect(big?.itemDiscount).toBe(tk(1000));
  });
});

describe('applyCombinationRules', () => {
  it('keeps the best single offer when stacking is off', () => {
    const candidates = [
      { promotionId: 'a', itemDiscount: tk(10), orderDiscount: 0, deliveryDiscount: 0 } as never,
      { promotionId: 'b', itemDiscount: tk(90), orderDiscount: 0, deliveryDiscount: 0 } as never,
    ];
    const { accepted } = applyCombinationRules(candidates, [], false);
    expect(accepted.map((a) => a.promotionId)).toEqual(['b']);
  });
});
