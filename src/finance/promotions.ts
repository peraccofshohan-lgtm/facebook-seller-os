/**
 * promotions.ts — the ONE place a discount is ever calculated (V2).
 *
 * Financial integrity rules this file exists to enforce
 *  1. Every paisa is an integer. Percentages go through `percentOf`, splits through
 *     `allocateByWeights`, and both guarantee the parts sum back to the original amount.
 *  2. A discount is always capped by the money that is actually left to discount. No
 *     combination of promotions can produce a negative line, order or delivery charge.
 *  3. Stacking is explicit, not accidental. Priority, combination groups and the
 *     `stackable` flag decide what may combine; see `applyCombinationRules`.
 *  4. A free gift is not a sale. Gift lines are added with `unitPrice` 0 so they never
 *     enter net sales — but they keep their real `unitCost`, because the goods did cost
 *     money and must land in COGS.
 *  5. Delivery charge is reported on its own line; waiving it is a `deliveryDiscount`,
 *     never negative revenue.
 *
 * This module is pure: no database, no React, no I/O. Everything it needs arrives in the
 * context object, which is what makes the whole engine unit-testable.
 */

import { addMoney, allocateByWeights, minMoney, mulQty, percentOf, subMoney, sumMoney, type Minor as MinorType } from '@/lib/money';
import type {
  ID,
  Promotion,
  PromotionResult,
  PromotionSettings,
  PromotionType,
  Timestamp,
} from '@/domain/types';

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export interface BasketLineInput {
  id: ID;
  productId: ID | null;
  variantId: ID | null;
  categoryId: ID | null;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: MinorType;
  unitCost: MinorType;
  /** Manual per-line discount already applied before promotions are considered. */
  lineDiscount: MinorType;
  isFreeGift?: boolean;
}

export interface BasketContext {
  lines: BasketLineInput[];
  deliveryCharge: MinorType;
  otherCharge: MinorType;
  now: Timestamp;

  couponCode: string;
  customerId: ID | null;
  /** Delivered/confirmed orders the customer already has. 0 ⇒ this is their first. */
  customerOrderCount: number;
  customerSegment: string;

  loyaltyPointsAvailable: number;
  /** Points the seller is redeeming on this order. */
  pointsToRedeem: number;

  settings: PromotionSettings;

  /** Total redemptions so far, per promotion id. */
  usageByPromotion: Record<ID, number>;
  /** Redemptions by THIS customer, per promotion id. */
  usageByPromotionForCustomer: Record<ID, number>;

  /**
   * Cost lookup for explicit free gifts. Optional: without it a gift line is still
   * added (with cost 0) rather than the promotion silently failing.
   */
  unitCostOf?: (productId: ID | null, variantId: ID | null) => MinorType | undefined;
}

/* ------------------------------------------------------------------ */
/* Outputs                                                             */
/* ------------------------------------------------------------------ */

export interface GiftLine {
  productId: ID | null;
  variantId: ID | null;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: MinorType;
  unitCost: MinorType;
  promotionId: ID;
}

export interface AppliedPromotion extends PromotionResult {
  /** Extra discount to add to each affected line. */
  lineDiscounts: Array<{ lineId: ID; amount: MinorType }>;
  /** Extra discount to add at order level. */
  orderDiscount: MinorType;
  /** Free lines to append to the order. */
  giftLines: GiftLine[];
}

export interface RejectedPromotion {
  promotionId: ID;
  name: string;
  reason: string;
}

export interface PromotionEvaluation {
  applied: AppliedPromotion[];
  rejected: RejectedPromotion[];

  /** Merged extra discount per line id. */
  lineDiscounts: Record<ID, MinorType>;
  /** Sum of all line-level discounts produced by promotions. */
  itemDiscount: MinorType;
  /** Order-level discount produced by promotions (bundles, point redemption). */
  orderDiscount: MinorType;
  /** Delivery charge waived. */
  deliveryDiscount: MinorType;
  /** Discount bought with loyalty points. */
  loyaltyDiscount: MinorType;
  /** itemDiscount + orderDiscount + deliveryDiscount. */
  totalDiscount: MinorType;

  pointsEarned: number;
  /** Points spent on this order (after clamping to what the customer actually has). */
  pointsRedeemed: number;

  giftLines: GiftLine[];
  /** Bengali explanations, one per applied promotion. */
  messages: string[];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function lineGross(line: BasketLineInput): MinorType {
  return mulQty(line.unitPrice, line.quantity);
}

/** Current value of a line after its manual discount. */
function lineNet(line: BasketLineInput): MinorType {
  return subMoney(lineGross(line), line.lineDiscount ?? 0);
}

function withinWindow(promotion: Promotion, now: Timestamp): boolean {
  if (promotion.startsAt && now < promotion.startsAt) return false;
  if (promotion.endsAt != null && now > promotion.endsAt) return false;
  return true;
}

function matchesScope(promotion: Promotion, line: BasketLineInput): boolean {
  const products = promotion.productIds ?? [];
  const categories = promotion.categoryIds ?? [];
  if (products.length === 0 && categories.length === 0) return true;
  if (products.length > 0 && line.productId && products.includes(line.productId)) return true;
  if (categories.length > 0 && line.categoryId && categories.includes(line.categoryId)) return true;
  return false;
}

/** Percent-formatted in the seller's own digits (the UI converts). */
function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/* ------------------------------------------------------------------ */
/* Eligibility                                                         */
/* ------------------------------------------------------------------ */

function eligibilityError(promotion: Promotion, ctx: BasketContext): string | null {
  if (promotion.status !== 'active') return 'অফারটি চালু নেই';
  if (!withinWindow(promotion, ctx.now)) {
    if (promotion.endsAt != null && ctx.now > promotion.endsAt) return 'অফারের মেয়াদ শেষ';
    return 'অফারটি এখনো শুরু হয়নি';
  }

  const grossSubtotal = sumMoney(ctx.lines.filter((l) => !l.isFreeGift).map(lineNet));
  if (promotion.minOrderAmount > 0 && grossSubtotal < promotion.minOrderAmount) {
    return `ন্যূনতম ${promotion.minOrderAmount / 100} টাকার ক্রয় লাগবে`;
  }

  if (promotion.couponCode.trim()) {
    const typed = ctx.couponCode.trim().toLowerCase();
    if (!typed) return 'কুপন কোড দিতে হবে';
    if (typed !== promotion.couponCode.trim().toLowerCase()) return 'কুপন কোড মিলছে না';
  }

  if (promotion.customerEligibility === 'first_order' && ctx.customerOrderCount > 0) {
    return 'শুধু প্রথম অর্ডারে প্রযোজ্য';
  }
  if (promotion.customerEligibility === 'repeat' && ctx.customerOrderCount === 0) {
    return 'শুধু পুনরায় ক্রয়কারীদের জন্য';
  }
  if (promotion.customerSegments.length > 0) {
    if (!ctx.customerSegment || !promotion.customerSegments.includes(ctx.customerSegment)) {
      return 'এই কাস্টমার এই অফারের জন্য যোগ্য নন';
    }
  }

  const used = ctx.usageByPromotion[promotion.id] ?? 0;
  if (promotion.usageLimit != null && used >= promotion.usageLimit) {
    return 'অফারের সর্বোচ্চ ব্যবহার সীমা শেষ';
  }
  if (ctx.customerId) {
    const usedByCustomer = ctx.usageByPromotionForCustomer[promotion.id] ?? 0;
    if (promotion.perCustomerLimit != null && usedByCustomer >= promotion.perCustomerLimit) {
      return 'এই কাস্টমার এই অফারের সীমা শেষ করেছেন';
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Mechanism calculators                                               */
/* ------------------------------------------------------------------ */

interface MutableState {
  /** Remaining discountable value per line id. */
  remaining: Map<ID, MinorType>;
  /** Units already given away for free, per line id. */
  freeUnits: Map<ID, number>;
  remainingDelivery: MinorType;
}

function eligibleLines(promotion: Promotion, ctx: BasketContext): BasketLineInput[] {
  return ctx.lines.filter((l) => !l.isFreeGift && matchesScope(promotion, l));
}

function capDiscount(discount: MinorType, promotion: Promotion, ceiling: MinorType): MinorType {
  const capped = promotion.maxDiscount > 0 ? minMoney(discount, promotion.maxDiscount) : discount;
  return minMoney(capped, ceiling);
}

/** Percentage or fixed amount off, spread across the eligible lines. */
function computeAmountOff(
  promotion: Promotion,
  ctx: BasketContext,
  state: MutableState,
  percent: number | null,
): AppliedPromotion | null {
  const lines = eligibleLines(promotion, ctx);
  if (lines.length === 0) return null;

  const remainingFor = (line: BasketLineInput) => state.remaining.get(line.id) ?? 0;
  const base = sumMoney(lines.map(remainingFor));
  if (base <= 0) return null;

  const raw = percent !== null ? percentOf(base, percent) : (promotion.amountOff ?? 0);
  if (raw <= 0) return null;
  const discount = capDiscount(raw, promotion, base);
  if (discount <= 0) return null;

  const shares = allocateByWeights(discount, lines.map(remainingFor));
  const lineDiscounts = lines.map((line, i) => ({ lineId: line.id, amount: shares[i] }));
  for (const entry of lineDiscounts) {
    state.remaining.set(entry.lineId, subMoney(state.remaining.get(entry.lineId) ?? 0, entry.amount));
  }

  const message =
    percent !== null
      ? `${promotion.name}: ${formatPercent(percent)}% ছাড়`
      : `${promotion.name}: নির্দিষ্ট ছাড়`;

  return {
    promotionId: promotion.id,
    name: promotion.name,
    type: promotion.type,
    mechanism: promotion.mechanism,
    itemDiscount: discount,
    orderDiscount: 0,
    deliveryDiscount: 0,
    freeItems: [],
    pointsEarned: 0,
    message,
    lineDiscounts,
    giftLines: [],
  };
}

/**
 * Buy X Get Y (BOGO is buy 1 get 1). The CHEAPEST units go free, which is what every
 * shop in Bangladesh means by the offer and what keeps the discount smallest.
 */
function computeFreeItems(
  promotion: Promotion,
  ctx: BasketContext,
  state: MutableState,
): AppliedPromotion | null {
  // Explicit free gifts are a different behaviour under the same mechanism.
  if ((promotion.giftItems ?? []).length > 0) return computeExplicitGift(promotion, ctx, state);

  const lines = eligibleLines(promotion, ctx);
  if (lines.length === 0) return null;

  const buyQty = Math.max(1, Math.floor(promotion.buyQuantity || 1));
  const getQty = Math.max(0, Math.floor(promotion.getQuantity || 0));
  const groupSize = buyQty + getQty;
  if (getQty <= 0 || groupSize <= getQty) return null;

  // Build one slot per whole unit that has not already been given away.
  type Slot = { lineId: ID; unitPrice: MinorType };
  const slots: Slot[] = [];
  for (const line of lines) {
    const whole = Math.floor(line.quantity);
    const alreadyFree = state.freeUnits.get(line.id) ?? 0;
    for (let i = alreadyFree; i < whole; i += 1) slots.push({ lineId: line.id, unitPrice: line.unitPrice });
  }
  if (slots.length < groupSize) return null;

  let freeCount = Math.floor(slots.length / groupSize) * getQty;
  if (freeCount <= 0) return null;

  // Cheapest first.
  slots.sort((a, b) => a.unitPrice - b.unitPrice || (a.lineId < b.lineId ? -1 : 1));

  // Respect the promotion's own cap by dropping the most expensive free units.
  if (promotion.maxDiscount > 0) {
    while (freeCount > 0) {
      const total = sumMoney(slots.slice(0, freeCount).map((s) => s.unitPrice));
      if (total <= promotion.maxDiscount) break;
      freeCount -= 1;
    }
    if (freeCount <= 0) return null;
  }

  const chosen = slots.slice(0, freeCount);
  const byLine = new Map<ID, { units: number; amount: MinorType }>();
  for (const slot of chosen) {
    const entry = byLine.get(slot.lineId) ?? { units: 0, amount: 0 };
    entry.units += 1;
    entry.amount = addMoney(entry.amount, slot.unitPrice);
    byLine.set(slot.lineId, entry);
  }

  // Never discount more than what is left on the line.
  const lineDiscounts: Array<{ lineId: ID; amount: MinorType }> = [];
  for (const [lineId, entry] of byLine) {
    const remaining = state.remaining.get(lineId) ?? 0;
    const amount = minMoney(entry.amount, remaining);
    if (amount <= 0) continue;
    lineDiscounts.push({ lineId, amount });
    state.remaining.set(lineId, subMoney(remaining, amount));
    state.freeUnits.set(lineId, (state.freeUnits.get(lineId) ?? 0) + entry.units);
  }
  if (lineDiscounts.length === 0) return null;

  const discount = sumMoney(lineDiscounts.map((d) => d.amount));
  const label = buyQty === 1 && getQty === 1 ? 'BOGO' : `${buyQty} কিনলে ${getQty} ফ্রি`;

  return {
    promotionId: promotion.id,
    name: promotion.name,
    type: promotion.type,
    mechanism: promotion.mechanism,
    itemDiscount: discount,
    orderDiscount: 0,
    deliveryDiscount: 0,
    freeItems: Array.from(byLine, ([lineId, entry]) => {
      const line = lines.find((l) => l.id === lineId);
      return {
        productId: line?.productId ?? null,
        variantId: line?.variantId ?? null,
        name: line?.name ?? '',
        quantity: entry.units,
      };
    }),
    pointsEarned: 0,
    message: `${promotion.name}: ${label} — ${chosen.length}টি আইটেম ফ্রি`,
    lineDiscounts,
    giftLines: [],
  };
}

/** A named product added to the order at zero price. */
function computeExplicitGift(
  promotion: Promotion,
  ctx: BasketContext,
  _state: MutableState,
): AppliedPromotion | null {
  const gifts = (promotion.giftItems ?? []).filter((g) => g.quantity > 0);
  if (gifts.length === 0) return null;

  const giftLines: GiftLine[] = gifts.map((gift) => ({
    productId: gift.productId ?? null,
    variantId: gift.variantId ?? null,
    name: gift.name,
    unit: 'পিস',
    quantity: gift.quantity,
    // Zero price: a gift is never a sale. Cost stays real so COGS is honest.
    unitPrice: 0,
    unitCost: ctx.unitCostOf?.(gift.productId ?? null, gift.variantId ?? null) ?? 0,
    promotionId: promotion.id,
  }));

  return {
    promotionId: promotion.id,
    name: promotion.name,
    type: promotion.type,
    mechanism: promotion.mechanism,
    itemDiscount: 0,
    orderDiscount: 0,
    deliveryDiscount: 0,
    freeItems: giftLines.map((g) => ({
      productId: g.productId,
      variantId: g.variantId,
      name: g.name,
      quantity: g.quantity,
    })),
    pointsEarned: 0,
    message: `${promotion.name}: ${giftLines.map((g) => g.name).join(', ')} উপহার`,
    lineDiscounts: [],
    giftLines,
  };
}

/** A fixed price for a fixed set of products. */
function computeBundle(
  promotion: Promotion,
  ctx: BasketContext,
  state: MutableState,
): AppliedPromotion | null {
  const items = (promotion.bundleItems ?? []).filter((b) => b.quantity > 0);
  if (items.length === 0) return null;

  // How many complete bundles does the basket contain?
  let sets = Number.POSITIVE_INFINITY;
  const participating = new Map<ID, BasketLineInput>();
  for (const item of items) {
    const line = ctx.lines.find(
      (l) =>
        !l.isFreeGift &&
        (item.productId ? l.productId === item.productId : l.name === item.name),
    );
    if (!line) return null;
    const available = Math.floor(line.quantity);
    sets = Math.min(sets, Math.floor(available / item.quantity));
    participating.set(line.id, line);
  }
  if (!Number.isFinite(sets) || sets <= 0) return null;

  const regularPerSet = sumMoney(items.map((item) => {
    const line = ctx.lines.find(
      (l) => (item.productId ? l.productId === item.productId : l.name === item.name),
    );
    return mulQty(line?.unitPrice ?? 0, item.quantity);
  }));
  const savingPerSet = subMoney(regularPerSet, promotion.bundlePrice ?? 0);
  if (savingPerSet <= 0) return null;

  const raw = mulQty(savingPerSet, sets);
  const ceiling = sumMoney(Array.from(participating.keys()).map((id) => state.remaining.get(id) ?? 0));
  const discount = capDiscount(raw, promotion, ceiling);
  if (discount <= 0) return null;

  const ids = Array.from(participating.keys());
  const shares = allocateByWeights(discount, ids.map((id) => state.remaining.get(id) ?? 0));
  const lineDiscounts = ids.map((id, i) => ({ lineId: id, amount: shares[i] }));
  for (const entry of lineDiscounts) {
    state.remaining.set(entry.lineId, subMoney(state.remaining.get(entry.lineId) ?? 0, entry.amount));
  }

  return {
    promotionId: promotion.id,
    name: promotion.name,
    type: promotion.type,
    mechanism: promotion.mechanism,
    itemDiscount: discount,
    orderDiscount: 0,
    deliveryDiscount: 0,
    freeItems: [],
    pointsEarned: 0,
    message: `${promotion.name}: ${sets}টি বান্ডেলে ছাড়`,
    lineDiscounts,
    giftLines: [],
  };
}

function computeFreeDelivery(
  promotion: Promotion,
  _ctx: BasketContext,
  state: MutableState,
): AppliedPromotion | null {
  if (state.remainingDelivery <= 0) return null;
  const waiver = capDiscount(state.remainingDelivery, promotion, state.remainingDelivery);
  if (waiver <= 0) return null;
  state.remainingDelivery = subMoney(state.remainingDelivery, waiver);

  return {
    promotionId: promotion.id,
    name: promotion.name,
    type: promotion.type,
    mechanism: promotion.mechanism,
    itemDiscount: 0,
    orderDiscount: 0,
    deliveryDiscount: waiver,
    freeItems: [],
    pointsEarned: 0,
    message: `${promotion.name}: ডেলিভারি চার্জ মওকুফ`,
    lineDiscounts: [],
    giftLines: [],
  };
}

/** Loyalty: earn points on the order, and (separately) spend them. */
function computeLoyalty(
  promotion: Promotion,
  ctx: BasketContext,
  state: MutableState,
): AppliedPromotion | null {
  const netSales = sumMoney(Array.from(state.remaining.values()));
  const perHundred = Math.max(0, Math.floor(ctx.settings.pointsPerHundredTaka || 0));
  if (perHundred <= 0) return null;
  // 100 BDT = 10 000 paisa.
  const pointsEarned = Math.floor(netSales / 10000) * perHundred;
  if (pointsEarned <= 0) return null;

  return {
    promotionId: promotion.id,
    name: promotion.name,
    type: promotion.type,
    mechanism: promotion.mechanism,
    itemDiscount: 0,
    orderDiscount: 0,
    deliveryDiscount: 0,
    freeItems: [],
    pointsEarned,
    message: `${promotion.name}: ${pointsEarned} পয়েন্ট অর্জিত`,
    lineDiscounts: [],
    giftLines: [],
  };
}

/** Referral: records the reward. It is not itself a discount on this order. */
function computeReferral(
  promotion: Promotion,
  ctx: BasketContext,
  _state: MutableState,
): AppliedPromotion | null {
  const points = Math.max(0, Math.floor(ctx.settings.referralPoints || 0));
  if (!ctx.settings.referralEnabled || points <= 0) return null;
  return {
    promotionId: promotion.id,
    name: promotion.name,
    type: promotion.type,
    mechanism: promotion.mechanism,
    itemDiscount: 0,
    orderDiscount: 0,
    deliveryDiscount: 0,
    freeItems: [],
    pointsEarned: points,
    message: `${promotion.name}: রেফারেল পুরস্কার রেকর্ড করা হয়েছে`,
    lineDiscounts: [],
    giftLines: [],
  };
}

function computeFor(
  promotion: Promotion,
  ctx: BasketContext,
  state: MutableState,
): AppliedPromotion | null {
  switch (promotion.mechanism) {
    case 'percent_off':
      return computeAmountOff(promotion, ctx, state, promotion.percentOff);
    case 'amount_off':
      return computeAmountOff(promotion, ctx, state, null);
    case 'free_items':
      return computeFreeItems(promotion, ctx, state);
    case 'bundle_price':
      return computeBundle(promotion, ctx, state);
    case 'free_delivery':
      return computeFreeDelivery(promotion, ctx, state);
    case 'loyalty_points':
      return computeLoyalty(promotion, ctx, state);
    case 'referral_reward':
      return computeReferral(promotion, ctx, state);
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Combination rules                                                   */
/* ------------------------------------------------------------------ */

/**
 * Decide which of the individually-eligible promotions may actually combine.
 *
 * Rules, in order:
 *  1. If the seller has switched stacking off, exactly one promotion wins — the one
 *     that saves the customer the most (ties broken by priority, then by name).
 *  2. Otherwise promotions apply in priority order, but:
 *     - two promotions in the same non-empty `combinationGroup` never combine;
 *     - a promotion marked `stackable: false` always ends up on its own;
 *     - only one `free_delivery` and only one `loyalty_points` promotion may apply,
 *       because a second one would be double-counting the same benefit.
 */
export function applyCombinationRules(
  candidates: AppliedPromotion[],
  promotions: Promotion[],
  allowStacking: boolean,
): { accepted: AppliedPromotion[]; rejected: RejectedPromotion[] } {
  const byId = new Map(promotions.map((p) => [p.id, p]));
  const valueOf = (a: AppliedPromotion) => addMoney(a.itemDiscount, a.orderDiscount, a.deliveryDiscount);
  const rejected: RejectedPromotion[] = [];

  if (candidates.length === 0) return { accepted: [], rejected };

  const ordered = [...candidates].sort((a, b) => {
    const pa = byId.get(a.promotionId)?.priority ?? 100;
    const pb = byId.get(b.promotionId)?.priority ?? 100;
    if (pa !== pb) return pa - pb;
    const diff = valueOf(b) - valueOf(a);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name, 'bn');
  });

  if (!allowStacking) {
    const best = ordered.reduce((winner, current) => (valueOf(current) > valueOf(winner) ? current : winner));
    for (const candidate of ordered) {
      if (candidate.promotionId === best.promotionId) continue;
      rejected.push({
        promotionId: candidate.promotionId,
        name: candidate.name,
        reason: 'একই সময়ে একটির বেশি অফার প্রযোজ্য নয়',
      });
    }
    return { accepted: [best], rejected };
  }

  const accepted: AppliedPromotion[] = [];
  const usedGroups = new Set<string>();
  const usedMechanisms = new Set<string>();
  let blockedByExclusive = false;

  for (const candidate of ordered) {
    const promotion = byId.get(candidate.promotionId);
    const group = promotion?.combinationGroup?.trim() ?? '';

    if (blockedByExclusive) {
      rejected.push({ promotionId: candidate.promotionId, name: candidate.name, reason: 'অন্য অফারের সাথে একত্র করা যায় না' });
      continue;
    }
    if (group && usedGroups.has(group)) {
      rejected.push({ promotionId: candidate.promotionId, name: candidate.name, reason: `একই গ্রুপের (${group}) দুটি অফার একসাথে প্রযোজ্য নয়` });
      continue;
    }
    if (candidate.mechanism === 'free_delivery' && usedMechanisms.has('free_delivery')) {
      rejected.push({ promotionId: candidate.promotionId, name: candidate.name, reason: 'একবারেই ডেলিভারি চার্জ মওকুফ করা যায়' });
      continue;
    }
    if (candidate.mechanism === 'loyalty_points' && usedMechanisms.has('loyalty_points')) {
      rejected.push({ promotionId: candidate.promotionId, name: candidate.name, reason: 'একবারেই পয়েন্ট অর্জন হয়' });
      continue;
    }

    accepted.push(candidate);
    if (group) usedGroups.add(group);
    if (candidate.mechanism === 'free_delivery' || candidate.mechanism === 'loyalty_points') {
      usedMechanisms.add(candidate.mechanism);
    }
    // A non-stackable offer can stand alone, so nothing may join it afterwards.
    if (promotion && !promotion.stackable) blockedByExclusive = true;
  }

  return { accepted, rejected };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/** Default mechanism for a promotion type. Kept here so services and UI agree. */
export function mechanismForType(type: PromotionType): Promotion['mechanism'] {
  switch (type) {
    case 'fixed':
    case 'min_purchase':
      return 'amount_off';
    case 'bogo':
    case 'buy_x_get_y':
    case 'free_gift':
      return 'free_items';
    case 'free_delivery':
      return 'free_delivery';
    case 'bundle':
      return 'bundle_price';
    case 'loyalty_points':
      return 'loyalty_points';
    case 'referral':
      return 'referral_reward';
    default:
      return 'percent_off';
  }
}

/**
 * Evaluate every promotion against a basket and return exactly what to apply.
 *
 * Pure and deterministic: the same basket and the same promotion list always give the
 * same answer, which is what makes the financial tests meaningful.
 */
export function evaluatePromotions(
  promotions: Promotion[],
  ctx: BasketContext,
): PromotionEvaluation {
  const state: MutableState = {
    remaining: new Map(ctx.lines.filter((l) => !l.isFreeGift).map((l) => [l.id, lineNet(l)])),
    freeUnits: new Map(),
    remainingDelivery: Math.max(0, ctx.deliveryCharge ?? 0),
  };

  const rejected: RejectedPromotion[] = [];
  const candidates: AppliedPromotion[] = [];

  for (const promotion of promotions) {
    const problem = eligibilityError(promotion, ctx);
    if (problem) {
      rejected.push({ promotionId: promotion.id, name: promotion.name, reason: problem });
      continue;
    }
    // Each candidate is scored against a snapshot so ordering during evaluation does
    // not change how much an individual offer is worth.
    const snapshot: MutableState = {
      remaining: new Map(state.remaining),
      freeUnits: new Map(state.freeUnits),
      remainingDelivery: state.remainingDelivery,
    };
    const result = computeFor(promotion, ctx, snapshot);
    if (!result) {
      rejected.push({ promotionId: promotion.id, name: promotion.name, reason: 'এই অর্ডারে প্রযোজ্য নয়' });
      continue;
    }
    candidates.push(result);
  }

  const { accepted, rejected: rejectedByStacking } = applyCombinationRules(
    candidates,
    promotions,
    ctx.settings.allowStacking,
  );

  // Now commit the accepted promotions against the real, shared remaining amounts —
  // recomputed in priority order so the second offer sees what the first one took.
  const committed: AppliedPromotion[] = [];
  const finalState: MutableState = {
    remaining: new Map(ctx.lines.filter((l) => !l.isFreeGift).map((l) => [l.id, lineNet(l)])),
    freeUnits: new Map(),
    remainingDelivery: Math.max(0, ctx.deliveryCharge ?? 0),
  };
  const acceptedIds = new Set(accepted.map((a) => a.promotionId));
  const ordered = [...promotions]
    .filter((p) => acceptedIds.has(p.id))
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  for (const promotion of ordered) {
    const result = computeFor(promotion, ctx, finalState);
    if (!result) {
      rejectedByStacking.push({
        promotionId: promotion.id,
        name: promotion.name,
        reason: 'অন্য অফারের পরে আর ছাড় পাওয়া যায়নি',
      });
      continue;
    }
    committed.push(result);
  }

  const lineDiscounts: Record<ID, MinorType> = {};
  for (const applied of committed) {
    for (const entry of applied.lineDiscounts) {
      lineDiscounts[entry.lineId] = addMoney(lineDiscounts[entry.lineId] ?? 0, entry.amount);
    }
  }

  const itemDiscount = sumMoney(committed.map((a) => a.itemDiscount));
  const orderDiscountFromOffers = sumMoney(committed.map((a) => a.orderDiscount));
  const deliveryDiscount = sumMoney(committed.map((a) => a.deliveryDiscount));

  // Loyalty redemption: clamp to the points the customer actually has and to the
  // money that is actually left, so a stale balance can never create free goods.
  const paisaPerPoint = Math.max(0, Math.floor(ctx.settings.paisaPerPoint || 0));
  const pointsWanted = Math.max(0, Math.floor(ctx.pointsToRedeem || 0));
  const pointsAvailable = Math.max(0, Math.floor(ctx.loyaltyPointsAvailable || 0));
  const pointsRedeemable = Math.min(pointsWanted, pointsAvailable);
  const remainingAfterDiscounts = sumMoney(Array.from(finalState.remaining.values()));
  let loyaltyDiscount: MinorType = 0;
  let pointsRedeemed = 0;
  if (ctx.settings.loyaltyEnabled && paisaPerPoint > 0 && pointsRedeemable > 0) {
    const wanted = mulQty(paisaPerPoint, pointsRedeemable);
    loyaltyDiscount = minMoney(wanted, remainingAfterDiscounts);
    pointsRedeemed = paisaPerPoint > 0 ? Math.floor(loyaltyDiscount / paisaPerPoint) : 0;
    // Spend only whole points; any paisa that does not make a full point stays billed.
    loyaltyDiscount = mulQty(paisaPerPoint, pointsRedeemed);
    if (pointsRedeemed <= 0) {
      loyaltyDiscount = 0;
      pointsRedeemed = 0;
    }
  }

  const pointsEarned = committed.reduce((total, a) => total + a.pointsEarned, 0);

  return {
    applied: committed,
    rejected: [...rejected, ...rejectedByStacking],
    lineDiscounts,
    itemDiscount,
    orderDiscount: addMoney(orderDiscountFromOffers, loyaltyDiscount),
    deliveryDiscount,
    loyaltyDiscount,
    totalDiscount: addMoney(itemDiscount, orderDiscountFromOffers, loyaltyDiscount, deliveryDiscount),
    pointsEarned,
    pointsRedeemed,
    giftLines: committed.flatMap((a) => a.giftLines),
    messages: committed.map((a) => a.message),
  };
}

/**
 * Preview a single promotion on its own — used by the UI to show "this offer would save
 * ৳X" before the seller commits, and by the tests to check one rule at a time.
 */
export function previewPromotion(promotion: Promotion, ctx: BasketContext): AppliedPromotion | null {
  const state: MutableState = {
    remaining: new Map(ctx.lines.filter((l) => !l.isFreeGift).map((l) => [l.id, lineNet(l)])),
    freeUnits: new Map(),
    remainingDelivery: Math.max(0, ctx.deliveryCharge ?? 0),
  };
  if (eligibilityError(promotion, ctx)) return null;
  return computeFor(promotion, ctx, state);
}
