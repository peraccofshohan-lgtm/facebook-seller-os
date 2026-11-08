/**
 * promotionService.ts — persistence and reporting for promotions (V2).
 *
 * The arithmetic lives in src/finance/promotions.ts. This module does three other jobs:
 *   - CRUD on the promotion table, never hard-deleting a promotion that has been used
 *     (it is archived, so past orders keep a promotion they can be explained by);
 *   - building the BasketContext the engine needs from real database records;
 *   - recording what was actually applied, so reports use measured discounts rather
 *     than re-deriving them and possibly disagreeing with the order.
 */

import { db } from '@/db/db';
import { nowMs } from '@/lib/date';
import { randomId } from '@/lib/id';
import { addMoney, type Minor } from '@/lib/money';
import { getSettings } from './settingsService';
import {
  evaluatePromotions,
  type AppliedPromotion,
  type BasketContext,
  type BasketLineInput,
  type PromotionEvaluation,
} from '@/finance/promotions';
import { DEFAULT_MECHANISM } from '@/domain/constants';
import type {
  ID,
  LoyaltyEntry,
  Order,
  OrderItem,
  Promotion,
  PromotionUsage,
  Referral,
} from '@/domain/types';
import type { PromotionInput, ReferralInput } from '@/domain/schemas';

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */

export interface PromotionQuery {
  search?: string;
  type?: string;
  status?: string;
  includeArchived?: boolean;
  offset?: number;
  limit?: number;
}

export async function listPromotions(query: PromotionQuery = {}): Promise<{ rows: Promotion[]; total: number }> {
  let rows = await db.promotions.toArray();
  if (!query.includeArchived) rows = rows.filter((p) => !p.archivedAt);
  if (query.type) rows = rows.filter((p) => p.type === query.type);
  if (query.status) rows = rows.filter((p) => p.status === query.status);
  if (query.search?.trim()) {
    const needle = query.search.trim().toLowerCase();
    rows = rows.filter((p) =>
      [p.name, p.description, p.couponCode, p.combinationGroup].join(' ').toLowerCase().includes(needle),
    );
  }
  rows.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.name.localeCompare(b.name, 'bn'));
  return { rows: rows.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 100)), total: rows.length };
}

export async function getPromotion(id: ID): Promise<Promotion | undefined> {
  return db.promotions.get(id);
}

/** Promotions that can currently be applied, in the order the engine should consider them. */
export async function listActivePromotions(): Promise<Promotion[]> {
  const settings = await getSettings();
  if (!settings.promotions?.enabled) return [];
  const rows = (await db.promotions.toArray()).filter((p) => !p.archivedAt && p.status === 'active');
  return rows.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
}

function buildPromotion(input: PromotionInput, existing?: Promotion): Promotion {
  const now = nowMs();
  const mechanism = input.mechanism ?? DEFAULT_MECHANISM[input.type];
  const base: Promotion = {
    id: existing?.id ?? randomId(),
    name: input.name,
    description: input.description ?? '',
    type: input.type,
    mechanism,
    status: input.status ?? 'active',
    percentOff: input.percentOff ?? 0,
    amountOff: input.amountOff ?? 0,
    buyQuantity: input.buyQuantity ?? 0,
    getQuantity: input.getQuantity ?? 0,
    bundleItems: input.bundleItems ?? [],
    bundlePrice: input.bundlePrice ?? 0,
    giftItems: input.giftItems ?? [],
    startsAt: input.startsAt,
    endsAt: input.endsAt ?? null,
    productIds: input.productIds ?? [],
    categoryIds: input.categoryIds ?? [],
    minOrderAmount: input.minOrderAmount ?? 0,
    maxDiscount: input.maxDiscount ?? 0,
    usageLimit: input.usageLimit ?? null,
    usageCount: existing?.usageCount ?? 0,
    perCustomerLimit: input.perCustomerLimit ?? null,
    customerEligibility: input.customerEligibility ?? 'all',
    customerSegments: input.customerSegments ?? [],
    couponCode: (input.couponCode ?? '').trim(),
    stackable: input.stackable ?? true,
    priority: input.priority ?? 10,
    combinationGroup: input.combinationGroup ?? '',
    terms: input.terms ?? '',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    archivedAt: existing?.archivedAt ?? null,
  };

  // Two presets that would otherwise be configured by hand.
  if (base.type === 'bogo') {
    base.buyQuantity = 1;
    base.getQuantity = 1;
  }
  if (base.type === 'free_delivery') base.mechanism = 'free_delivery';
  return base;
}

export async function createPromotion(input: PromotionInput): Promise<Promotion> {
  const promotion = buildPromotion(input);
  await db.promotions.add(promotion);
  return promotion;
}

export async function updatePromotion(id: ID, input: PromotionInput): Promise<Promotion> {
  const existing = await db.promotions.get(id);
  if (!existing) throw new Error('অফারটি খুঁজে পাওয়া যায়নি');
  const next = buildPromotion(input, existing);
  await db.promotions.put(next);
  return next;
}

/**
 * Archive a promotion. A promotion that has ever been used is only archived — deleting it
 * would leave past orders pointing at something the seller can no longer look at.
 */
export async function archivePromotion(id: ID): Promise<void> {
  await db.promotions.update(id, { archivedAt: nowMs(), updatedAt: nowMs(), status: 'paused' });
}

export async function restorePromotion(id: ID): Promise<void> {
  await db.promotions.update(id, { archivedAt: null, updatedAt: nowMs() });
}

export async function deletePromotion(id: ID): Promise<void> {
  const usageCount = await db.promotionUsages.where('promotionId').equals(id).count();
  if (usageCount > 0) throw new Error('এই অফারটি ইতিমধ্যে ব্যবহৃত হয়েছে — এটি আর্কাইভ করুন, মুছবেন না');
  await db.promotions.delete(id);
}

export function blankPromotion(type: Promotion['type'] = 'percent'): Promotion {
  return buildPromotion(
    {
      name: '',
      description: '',
      type,
      status: 'draft',
      startsAt: nowMs(),
      endsAt: null,
      percentOff: 0,
      amountOff: 0,
      buyQuantity: 1,
      getQuantity: 1,
      bundleItems: [],
      bundlePrice: 0,
      giftItems: [],
      productIds: [],
      categoryIds: [],
      minOrderAmount: 0,
      maxDiscount: 0,
      usageLimit: null,
      perCustomerLimit: null,
      customerEligibility: 'all',
      customerSegments: [],
      couponCode: '',
      stackable: true,
      priority: 10,
      combinationGroup: '',
      terms: '',
    },
    undefined,
  );
}

/* ------------------------------------------------------------------ */
/* Building the basket context from real records                       */
/* ------------------------------------------------------------------ */

export interface BasketInputLine {
  productId: ID | null;
  variantId: ID | null;
  quantity: number;
  unitPrice: Minor;
  unitCost: Minor;
  lineDiscount: Minor;
  name: string;
  unit: string;
}

export interface EvaluateForBasketInput {
  lines: BasketInputLine[];
  deliveryCharge: Minor;
  otherCharge: Minor;
  customerId: ID | null;
  couponCode: string;
  pointsToRedeem: number;
}

/**
 * Count orders a customer already has. Cancelled orders are ignored — a cancelled
 * first attempt should not cost the customer their first-order discount.
 */
async function countCustomerOrders(customerId: ID | null): Promise<number> {
  if (!customerId) return 0;
  return db.orders.filter((o) => o.customerId === customerId && o.status !== 'cancelled').count();
}

export async function buildBasketContext(input: EvaluateForBasketInput): Promise<BasketContext> {
  const settings = await getSettings();
  const now = nowMs();

  // One read for the whole catalogue: the cost lookup the engine calls must be
  // synchronous, so everything it might ask for is loaded up-front.
  const products = await db.products.toArray();
  const productById = new Map(products.map((p) => [p.id, p]));
  const variantCost = new Map<string, number>();
  for (const variant of await db.productVariants.toArray()) {
    variantCost.set(variant.id, variant.costPrice ?? 0);
  }

  const lines: BasketLineInput[] = input.lines.map((line, index) => {
    const product = line.productId ? productById.get(line.productId) : undefined;
    return {
      id: line.productId ?? line.variantId ?? `draft-${index}`,
      productId: line.productId ?? null,
      variantId: line.variantId ?? null,
      categoryId: product?.categoryId ?? null,
      name: line.name || product?.name || `পণ্য ${index + 1}`,
      unit: line.unit || product?.unit || 'পিস',
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      unitCost: line.unitCost || product?.costPrice || 0,
      lineDiscount: line.lineDiscount ?? 0,
      isFreeGift: false,
    };
  });

  const customer = input.customerId ? await db.customers.get(input.customerId) : undefined;
  const customerOrderCount = await countCustomerOrders(input.customerId);

  const promotions = await listActivePromotions();
  const usageByPromotion: Record<ID, number> = {};
  const usageByPromotionForCustomer: Record<ID, number> = {};
  for (const promotion of promotions) {
    usageByPromotion[promotion.id] = await db.promotionUsages.where('promotionId').equals(promotion.id).count();
    if (input.customerId) {
      const all = await db.promotionUsages.where('promotionId').equals(promotion.id).toArray();
      usageByPromotionForCustomer[promotion.id] = all.filter((u) => u.customerId === input.customerId).length;
    }
  }

  return {
    lines,
    deliveryCharge: input.deliveryCharge ?? 0,
    otherCharge: input.otherCharge ?? 0,
    now,
    couponCode: input.couponCode ?? '',
    customerId: input.customerId ?? null,
    customerOrderCount,
    customerSegment: customer?.segment ?? '',
    loyaltyPointsAvailable: customer?.loyaltyPoints ?? 0,
    pointsToRedeem: input.pointsToRedeem ?? 0,
    settings: settings.promotions,
    usageByPromotion,
    usageByPromotionForCustomer,
    unitCostOf: (productId, variantId) => {
      if (variantId) {
        const cost = variantCost.get(variantId);
        if (cost !== undefined) return cost;
      }
      if (productId) return productById.get(productId)?.costPrice ?? 0;
      return 0;
    },
  };
}

export async function evaluateForBasket(
  input: EvaluateForBasketInput,
  promotions?: Promotion[],
): Promise<PromotionEvaluation> {
  const ctx = await buildBasketContext(input);
  const list = promotions ?? (await listActivePromotions());
  return evaluatePromotions(list, ctx);
}

/* ------------------------------------------------------------------ */
/* Applying the result to an order                                     */
/* ------------------------------------------------------------------ */

export interface AppliedOrderItems {
  items: OrderItem[];
  deliveryCharge: Minor;
  promotionIds: ID[];
  promotionDiscount: Minor;
  couponCode: string;
  loyaltyPointsEarned: number;
  loyaltyPointsRedeemed: number;
  loyaltyDiscount: Minor;
  /**
   * Order-level money to add to the order's own `discount` field (bundles and point
   * redemption). Line-scoped discounts are already written onto the lines.
   */
  orderDiscount: Minor;
  giftMessages: string[];
}

/**
 * Turn an evaluation into concrete order lines.
 *
 * The promotion discount is written onto the LINES wherever the offer was scoped to
 * lines, so per-line reporting stays accurate, and onto the ORDER only where the offer
 * was order-level (bundles, point redemption). Delivery waivers reduce the delivery
 * charge rather than being treated as negative revenue.
 */
export function applyEvaluationToItems(
  items: OrderItem[],
  deliveryCharge: Minor,
  evaluation: PromotionEvaluation,
  couponCode: string,
): AppliedOrderItems {
  const nextItems: OrderItem[] = items.map((item) => {
    const key = item.productId ?? item.variantId ?? item.id;
    const extra = evaluation.lineDiscounts[key] ?? 0;
    if (!extra) return item;
    const discount = addMoney(item.discount ?? 0, extra);
    return {
      ...item,
      discount,
      lineTotal: Math.max(0, item.unitPrice * item.quantity - discount),
      promotionId: evaluation.applied[0]?.promotionId ?? null,
    };
  });

  // Free gifts are appended as their own zero-priced lines.
  for (const gift of evaluation.giftLines) {
    nextItems.push({
      id: randomId(),
      productId: gift.productId,
      variantId: gift.variantId,
      name: gift.name,
      sku: '',
      unit: gift.unit,
      quantity: gift.quantity,
      unitPrice: 0,
      unitCost: gift.unitCost,
      discount: 0,
      lineTotal: 0,
      isFreeGift: true,
      promotionId: gift.promotionId,
    });
  }

  return {
    items: nextItems,
    deliveryCharge: Math.max(0, (deliveryCharge ?? 0) - evaluation.deliveryDiscount),
    promotionIds: evaluation.applied.map((a) => a.promotionId),
    promotionDiscount: evaluation.totalDiscount,
    couponCode,
    loyaltyPointsEarned: evaluation.pointsEarned,
    loyaltyPointsRedeemed: evaluation.pointsRedeemed,
    loyaltyDiscount: evaluation.loyaltyDiscount,
    orderDiscount: evaluation.orderDiscount,
    giftMessages: evaluation.messages,
  };
}

/* ------------------------------------------------------------------ */
/* Recording what actually happened                                    */
/* ------------------------------------------------------------------ */

/**
 * Write one usage row per applied promotion, plus the loyalty movement.
 *
 * Recording the realised figures is what makes the performance report trustworthy: it
 * is a measurement of what was given away, not a re-computation that could drift from
 * the order if a promotion is edited later.
 */
export async function recordUsage(order: Order, evaluation: PromotionEvaluation): Promise<void> {
  const now = nowMs();
  const usages: PromotionUsage[] = evaluation.applied.map((applied: AppliedPromotion) => {
    const discount = addMoney(applied.itemDiscount, applied.orderDiscount, applied.deliveryDiscount);
    return {
      id: randomId(),
      promotionId: applied.promotionId,
      promotionName: applied.name,
      promotionType: applied.type,
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      customerName: order.customerName,
      date: order.orderDate,
      itemDiscount: applied.itemDiscount,
      orderDiscount: applied.orderDiscount,
      deliveryDiscount: applied.deliveryDiscount,
      totalDiscount: discount,
      orderTotal: order.total,
      orderNetSales: Math.max(0, order.subtotal - order.discount),
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
  });
  if (usages.length) await db.promotionUsages.bulkAdd(usages);

  for (const usage of usages) {
    const promotion = await db.promotions.get(usage.promotionId);
    if (promotion) {
      await db.promotions.update(promotion.id, { usageCount: (promotion.usageCount ?? 0) + 1, updatedAt: now });
    }
  }

  if (order.customerId && evaluation.pointsEarned > 0) {
    await addLoyaltyEntry({
      customerId: order.customerId,
      type: 'earn',
      points: evaluation.pointsEarned,
      orderId: order.id,
      promotionId: null,
      note: `অর্ডার ${order.orderNumber} থেকে অর্জিত`,
      date: order.orderDate,
    });
  }
  if (order.customerId && evaluation.pointsRedeemed > 0) {
    await addLoyaltyEntry({
      customerId: order.customerId,
      type: 'redeem',
      points: -evaluation.pointsRedeemed,
      orderId: order.id,
      promotionId: null,
      note: `অর্ডার ${order.orderNumber}-এ ব্যবহৃত`,
      date: order.orderDate,
    });
  }
}

/**
 * Undo the usage rows for an order (cancellation, or an edit that re-runs promotions).
 * The rows are deleted rather than voided because they describe an order that no longer
 * carries that discount; the order's own event timeline is the audit trail.
 */
export async function releaseUsage(orderId: ID): Promise<void> {
  const usages = await db.promotionUsages.where('orderId').equals(orderId).toArray();
  if (!usages.length) return;
  for (const usage of usages) {
    const promotion = await db.promotions.get(usage.promotionId);
    if (promotion) {
      await db.promotions.update(promotion.id, {
        usageCount: Math.max(0, (promotion.usageCount ?? 1) - 1),
        updatedAt: nowMs(),
      });
    }
  }
  await db.promotionUsages.where('orderId').equals(orderId).delete();

  const loyalty = await db.loyaltyEntries.where('orderId').equals(orderId).toArray();
  await db.loyaltyEntries.where('orderId').equals(orderId).delete();
  for (const entry of loyalty) {
    await recomputeLoyaltyBalance(entry.customerId);
  }
}

/* ------------------------------------------------------------------ */
/* Loyalty                                                             */
/* ------------------------------------------------------------------ */

export async function addLoyaltyEntry(entry: {
  customerId: ID;
  type: LoyaltyEntry['type'];
  points: number;
  orderId: ID | null;
  promotionId: ID | null;
  note: string;
  date: number;
}): Promise<LoyaltyEntry> {
  const now = nowMs();
  const record: LoyaltyEntry = {
    id: randomId(),
    customerId: entry.customerId,
    orderId: entry.orderId,
    promotionId: entry.promotionId,
    type: entry.type,
    points: entry.points,
    note: entry.note,
    date: entry.date,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  await db.loyaltyEntries.add(record);
  await recomputeLoyaltyBalance(entry.customerId);
  return record;
}

/**
 * Recompute a customer's point balance from the ledger.
 *
 * The balance is derived, never accumulated: that way an edited or reversed entry can
 * never leave a customer with points they did not earn.
 */
export async function recomputeLoyaltyBalance(customerId: ID): Promise<number> {
  const entries = await db.loyaltyEntries.where('customerId').equals(customerId).toArray();
  const balance = entries.reduce((sum, entry) => sum + (entry.points || 0), 0);
  await db.customers.update(customerId, { loyaltyPoints: balance, updatedAt: nowMs() });
  return balance;
}

export async function loyaltyHistory(customerId: ID): Promise<LoyaltyEntry[]> {
  const rows = await db.loyaltyEntries.where('customerId').equals(customerId).toArray();
  return rows.sort((a, b) => b.date - a.date);
}

/* ------------------------------------------------------------------ */
/* Referrals                                                           */
/* ------------------------------------------------------------------ */

export async function createReferral(input: ReferralInput): Promise<Referral> {
  const now = nowMs();
  const referrer = await db.customers.get(input.referrerCustomerId);
  if (!referrer) throw new Error('রেফারকারী কাস্টমার খুঁজে পাওয়া যায়নি');
  const referred = input.referredCustomerId ? await db.customers.get(input.referredCustomerId) : null;

  const record: Referral = {
    id: randomId(),
    referrerCustomerId: input.referrerCustomerId,
    referrerName: referrer.name,
    referredCustomerId: input.referredCustomerId ?? null,
    referredName: input.referredName?.trim() || referred?.name || '',
    orderId: null,
    status: 'pending',
    rewardType: input.rewardType ?? 'points',
    rewardPoints: input.rewardPoints ?? 0,
    rewardAmount: input.rewardAmount ?? 0,
    note: input.note ?? '',
    date: input.date,
    rewardedAt: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  await db.referrals.add(record);
  return record;
}

export async function listReferrals(customerId?: ID): Promise<Referral[]> {
  const rows = customerId
    ? await db.referrals.where('referrerCustomerId').equals(customerId).toArray()
    : await db.referrals.toArray();
  return rows.sort((a, b) => b.date - a.date);
}

/** Mark a referral rewarded and credit the referrer's loyalty balance. */
export async function rewardReferral(id: ID): Promise<Referral> {
  const referral = await db.referrals.get(id);
  if (!referral) throw new Error('রেফারেল রেকর্ড খুঁজে পাওয়া যায়নি');
  if (referral.status === 'rewarded') return referral;

  const now = nowMs();
  const next: Referral = { ...referral, status: 'rewarded', rewardedAt: now, updatedAt: now };
  await db.referrals.put(next);

  if (referral.rewardType === 'points' && referral.rewardPoints > 0) {
    await addLoyaltyEntry({
      customerId: referral.referrerCustomerId,
      type: 'earn',
      points: referral.rewardPoints,
      orderId: referral.orderId,
      promotionId: null,
      note: 'রেফারেল পুরস্কার',
      date: now,
    });
  }
  return next;
}

export async function cancelReferral(id: ID): Promise<void> {
  const referral = await db.referrals.get(id);
  if (!referral || referral.status !== 'rewarded') {
    await db.referrals.update(id, { status: 'cancelled', updatedAt: nowMs() });
    return;
  }
  await db.referrals.update(id, { status: 'cancelled', rewardedAt: null, updatedAt: nowMs() });
  if (referral.rewardType === 'points' && referral.rewardPoints > 0) {
    await addLoyaltyEntry({
      customerId: referral.referrerCustomerId,
      type: 'adjust',
      points: -referral.rewardPoints,
      orderId: referral.orderId,
      promotionId: null,
      note: 'রেফারেল পুরস্কার বাতিল',
      date: nowMs(),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Promotion performance report                                        */
/* ------------------------------------------------------------------ */

export interface PromotionPerformanceRow {
  promotionId: ID;
  name: string;
  type: string;
  status: string;
  /** Redemptions inside the requested range. */
  usageCount: number;
  uniqueCustomers: number;
  totalDiscount: Minor;
  /** Order totals of the orders the promotion was used on. */
  orderValue: Minor;
  /** Net sales (goods only, after discounts) of those orders. */
  netSales: Minor;
  averageDiscount: Minor;
  firstUsedAt: number | null;
  lastUsedAt: number | null;
}

/**
 * Promotion performance, measured from `promotionUsages`.
 *
 * `orderValue` is the value of the orders the offer appeared on — that is the sales
 * *associated with* a campaign, and it is deliberately labelled that way. It is not
 * "sales caused by" the offer; the app cannot know what the customer would have bought
 * without it, and claiming otherwise would be a made-up number.
 */
export async function promotionPerformance(range?: {
  from: number;
  to: number;
}): Promise<PromotionPerformanceRow[]> {
  const usages = await db.promotionUsages.toArray();
  const inRange = usages.filter((u) => !range || (u.date >= range.from && u.date < range.to));

  const promotions = await db.promotions.toArray();
  const promotionById = new Map(promotions.map((p) => [p.id, p]));

  const grouped = new Map<ID, PromotionUsage[]>();
  for (const usage of inRange) {
    const list = grouped.get(usage.promotionId) ?? [];
    list.push(usage);
    grouped.set(usage.promotionId, list);
  }

  const rows: PromotionPerformanceRow[] = [];
  for (const [promotionId, list] of grouped) {
    const promotion = promotionById.get(promotionId);
    const totalDiscount = list.reduce((s, u) => s + (u.totalDiscount ?? 0), 0);
    const orderValue = list.reduce((s, u) => s + (u.orderTotal ?? 0), 0);
    const netSales = list.reduce((s, u) => s + (u.orderNetSales ?? 0), 0);
    const dates = list.map((u) => u.date).sort((a, b) => a - b);
    rows.push({
      promotionId,
      name: promotion?.name ?? list[0]?.promotionName ?? '(মুছে ফেলা অফার)',
      type: promotion?.type ?? list[0]?.promotionType ?? 'percent',
      status: promotion ? (promotion.archivedAt ? 'archived' : promotion.status) : 'deleted',
      usageCount: list.length,
      uniqueCustomers: new Set(list.map((u) => u.customerId).filter(Boolean)).size,
      totalDiscount,
      orderValue,
      netSales,
      averageDiscount: list.length ? Math.round(totalDiscount / list.length) : 0,
      firstUsedAt: dates[0] ?? null,
      lastUsedAt: dates[dates.length - 1] ?? null,
    });
  }

  return rows.sort((a, b) => b.totalDiscount - a.totalDiscount);
}

/** Total discount given away in a period, across every promotion. */
export async function totalDiscountInRange(from: number, to: number): Promise<Minor> {
  const usages = await db.promotionUsages.toArray();
  return usages.filter((u) => u.date >= from && u.date < to).reduce((s, u) => s + (u.totalDiscount ?? 0), 0);
}

/** Orders that used a given promotion — used by the promotion detail view. */
export async function usagesForPromotion(promotionId: ID): Promise<PromotionUsage[]> {
  const rows = await db.promotionUsages.where('promotionId').equals(promotionId).toArray();
  return rows.sort((a, b) => b.date - a.date);
}
