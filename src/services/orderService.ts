/**
 * orderService.ts — Order lifecycle.
 *
 * Stock rules (see FINANCIAL_RULES.md §Inventory):
 *  - Stock is committed (deducted) the first time an order reaches a status listed in
 *    settings.order.stockCommitStatuses (default: confirmed → delivered).
 *  - Committing is idempotent: the `stockCommitted` flag is checked AND verified against the
 *    movement ledger, so a status can never deduct stock twice.
 *  - Cancelling a committed order reverses the movements (`sale_reversal`) and clears the flag.
 *  - Returns never restock automatically: restocking happens through the Returns module,
 *    guarded by `returnRestocked`.
 *  - Editing a committed order applies only the *delta* against the previous quantities.
 */

import { db } from '@/db/db';
import { nowMs, startOfDay } from '@/lib/date';
import { randomId } from '@/lib/id';
import { addMoney, subMoney, type Minor } from '@/lib/money';
import { computeOrderTotals, derivePaymentStatus } from '@/finance/orderTotals';
import { getSettings } from './settingsService';
import { applyMovement } from './inventoryService';
import { refreshLastOrder } from './customerService';
import { addOrderEventInternal, totalsForOrder } from './paymentService';
import type { ID, Order, OrderEvent, OrderItem, OrderStatusKey } from '@/domain/types';
import type { OrderInput, OrderItemInput } from '@/domain/schemas';
import { newOrderFields, newOrderItemFields } from '@/domain/newRecord';
import { applyEvaluationToItems, evaluateForBasket, recordUsage, releaseUsage } from './promotionService';

export interface OrderQuery {
  query?: string;
  status?: OrderStatusKey | 'all';
  channel?: string;
  paymentStatus?: string;
  customerId?: ID;
  courierProviderId?: ID;
  from?: number | null;
  to?: number | null;
  archived?: boolean;
  limit?: number;
  offset?: number;
  sort?: 'newest' | 'oldest' | 'total' | 'orderNumber';
}

export interface OrderListResult {
  rows: Order[];
  total: number;
}

/** Fetch orders using the most selective index available, then filter in memory. */
export async function listOrders(q: OrderQuery = {}): Promise<OrderListResult> {
  const wantArchived = q.archived ?? false;
  let rows: Order[];

  const useRange = q.from !== undefined && q.from !== null && q.to !== undefined && q.to !== null;
  if (useRange) {
    rows = await db.orders.where('orderDate').between(q.from as number, q.to as number, true, false).toArray();
  } else if (q.status && q.status !== 'all') {
    rows = await db.orders.where('status').equals(q.status).toArray();
  } else if (q.customerId) {
    rows = await db.orders.where('customerId').equals(q.customerId).toArray();
  } else {
    rows = await db.orders.orderBy('orderDate').reverse().toArray();
  }

  rows = rows.filter((o) => Boolean(o.archivedAt) === wantArchived);
  if (q.status && q.status !== 'all') rows = rows.filter((o) => o.status === q.status);
  if (q.channel && q.channel !== 'all') rows = rows.filter((o) => o.channel === q.channel);
  if (q.paymentStatus && q.paymentStatus !== 'all') rows = rows.filter((o) => o.paymentStatus === q.paymentStatus);
  if (q.courierProviderId) rows = rows.filter((o) => o.courierProviderId === q.courierProviderId);
  if (useRange) {
    rows = rows.filter((o) => o.orderDate >= (q.from as number) && o.orderDate < (q.to as number));
  }

  if (q.query) {
    const needle = q.query.trim().toLowerCase();
    rows = rows.filter((o) => {
      const haystack = [
        o.orderNumber,
        o.customerName,
        o.customerPhone,
        o.trackingNumber,
        o.deliveryAddress,
        o.notes,
        o.courierName,
        ...o.items.map((i) => `${i.name} ${i.sku}`),
      ]
        .join(' ')
        .toLowerCase();
      return needle.split(/\s+/).every((t) => haystack.includes(t));
    });
  }

  const total = rows.length;
  rows.sort((a, b) => {
    switch (q.sort) {
      case 'oldest':
        return a.orderDate - b.orderDate;
      case 'total':
        return b.total - a.total;
      case 'orderNumber':
        return b.orderNumber.localeCompare(a.orderNumber);
      case 'newest':
      default:
        return b.orderDate - a.orderDate || b.createdAt - a.createdAt;
    }
  });
  const offset = q.offset ?? 0;
  const limit = q.limit ?? 50;
  return { rows: rows.slice(offset, offset + limit), total };
}

export async function getOrder(id: ID): Promise<Order | undefined> {
  return db.orders.get(id);
}

export async function getOrderByNumber(orderNumber: string): Promise<Order | undefined> {
  return db.orders.where('orderNumber').equals(orderNumber).first();
}

export async function orderEvents(orderId: ID): Promise<OrderEvent[]> {
  return (await db.orderEvents.where('orderId').equals(orderId).toArray()).sort((a, b) => b.createdAt - a.createdAt);
}

function buildItems(input: OrderItemInput[]): OrderItem[] {
  return input.map((item) => ({
    id: randomId(),
    productId: item.productId ?? null,
    variantId: item.variantId ?? null,
    name: item.name,
    sku: item.sku ?? '',
    unit: item.unit || 'পিস',
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    unitCost: item.unitCost ?? 0,
    discount: item.discount ?? 0,
    lineTotal: 0,
    ...newOrderItemFields(),
  }));
}

/** Fill in lineTotal / subtotal / cogs / total for an order object before writing. */
export function recalcOrderFinancials(order: Order): Order {
  const totals = computeOrderTotals({
    items: order.items,
    discount: order.discount,
    deliveryCharge: order.deliveryCharge,
    otherCharge: order.otherCharge,
  });
  order.items = order.items.map((item) => ({
    ...item,
    lineTotal: subMoney(Math.round(item.unitPrice * item.quantity), item.discount),
  }));
  order.subtotal = totals.subtotal;
  order.cogs = totals.cogs;
  order.total = totals.total;
  return order;
}

export async function createOrder(input: OrderInput): Promise<Order> {
  const settings = await getSettings();
  return db.transaction(
    'rw',
    [
      db.orders, db.orderEvents, db.payments, db.settings, db.stockLevels, db.stockMovements,
      db.customers, db.products, db.productVariants,
      // V2: promotions are evaluated and their usage recorded in the same transaction,
      // so an order can never exist without — or with the wrong — discount record.
      db.promotions, db.promotionUsages, db.loyaltyEntries,
    ],
    async () => {
      const now = nowMs();
      const numbering = await db.settings.get('app');
      const number = numbering?.order?.nextNumber ?? settings.order.nextNumber;
      const prefix = numbering?.order?.prefix ?? settings.order.prefix;
      const orderNumber = `${prefix}-${String(number).padStart(5, '0')}`;
      if (await db.orders.where('orderNumber').equals(orderNumber).first()) {
        throw new Error('অর্ডার নম্বর ডুপ্লিকেট হয়েছে। আবার চেষ্টা করুন।');
      }
      await db.settings.update('app', {
        order: { ...(numbering?.order ?? settings.order), nextNumber: number + 1 },
        updatedAt: now,
      });

      let items = buildItems(input.items);
      let deliveryChargeAfterPromotions = input.deliveryCharge ?? 0;
      let promotionFields = newOrderFields();
      let promotionOrderDiscount = 0;

      // V2: run the promotion engine BEFORE the totals are computed, so subtotal,
      // discount, delivery charge and total all reflect the real price the customer pays.
      let promotionEvaluation = null;
      if (numbering?.promotions?.enabled ?? settings.promotions.enabled) {
        promotionEvaluation = await evaluateForBasket({
          lines: items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            unitCost: item.unitCost,
            lineDiscount: item.discount,
            name: item.name,
            unit: item.unit,
          })),
          deliveryCharge: input.deliveryCharge ?? 0,
          otherCharge: input.otherCharge ?? 0,
          customerId: input.customerId ?? null,
          couponCode: input.couponCode ?? '',
          pointsToRedeem: input.pointsToRedeem ?? 0,
        });
        const applied = applyEvaluationToItems(
          items,
          input.deliveryCharge ?? 0,
          promotionEvaluation,
          input.couponCode ?? '',
        );
        items = applied.items;
        deliveryChargeAfterPromotions = applied.deliveryCharge;
        promotionOrderDiscount = applied.orderDiscount;
        promotionFields = {
          promotionIds: applied.promotionIds,
          promotionDiscount: applied.promotionDiscount,
          couponCode: applied.couponCode,
          loyaltyPointsEarned: applied.loyaltyPointsEarned,
          loyaltyPointsRedeemed: applied.loyaltyPointsRedeemed,
          loyaltyDiscount: applied.loyaltyDiscount,
          referralId: null,
        };
      }

      const draft: Order = {
        id: randomId(),
        orderNumber,
        orderDate: input.orderDate ?? startOfDay(now),
        channel: input.channel,
        customerId: input.customerId ?? null,
        customerName: input.customerName ?? '',
        customerPhone: input.customerPhone ?? '',
        deliveryAddress: input.deliveryAddress ?? '',
        items,
        subtotal: 0,
        // Manual discount from the form plus anything the promotions took off at
        // order level. Line-scoped discounts are already inside the lines' lineTotal.
        discount: addMoney(input.discount ?? 0, promotionOrderDiscount),
        deliveryCharge: deliveryChargeAfterPromotions,
        otherCharge: input.otherCharge ?? 0,
        total: 0,
        cogs: 0,
        status: input.status ?? 'new',
        paymentStatus: 'unpaid',
        paymentMethod: input.paymentMethod ?? 'cash',
        courierProviderId: input.courierProviderId ?? null,
        courierName: input.courierName ?? '',
        trackingNumber: input.trackingNumber ?? '',
        notes: input.notes ?? '',
        customerInstructions: input.customerInstructions ?? '',
        cancelReason: input.cancelReason ?? '',
        ...promotionFields,
        stockCommitted: false,
        returnRestocked: false,
        codAmount: 0,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };
      recalcOrderFinancials(draft);

      if (input.advancePayment > 0) {
        draft.paymentStatus = derivePaymentStatus(draft.total, input.advancePayment, 0);
      }

      const commitStatuses = numbering?.order?.stockCommitStatuses ?? settings.order.stockCommitStatuses;
      if (commitStatuses.includes(draft.status)) {
        await commitStockForOrder(draft);
        draft.stockCommitted = true;
      }

      await db.orders.add(draft);
      await addOrderEventInternal(draft.id, 'created', `অর্ডার তৈরি করা হয়েছে (${draft.orderNumber})`);

      // Record what was actually given away, so the promotion report measures reality
      // instead of re-deriving a number that could drift when an offer is edited later.
      // Points can be redeemed without any promotion being active, so the loyalty
      // ledger must be written in that case too — otherwise the customer would keep
      // points they have already spent.
      if (
        promotionEvaluation &&
        (promotionEvaluation.applied.length > 0 || promotionEvaluation.pointsRedeemed > 0)
      ) {
        await recordUsage(draft, promotionEvaluation);
        if (promotionEvaluation.applied.length > 0) {
          await addOrderEventInternal(
            draft.id,
            'note',
            `প্রযোজ্য অফার: ${promotionEvaluation.applied.map((a) => a.name).join(', ')}`,
          );
        }
      }

      if (input.advancePayment > 0) {
        await db.payments.add({
          id: randomId(),
          kind: 'order_payment',
          direction: 'in',
          amount: input.advancePayment,
          method: input.advanceMethod || 'cash',
          orderId: draft.id,
          customerId: draft.customerId,
          courierRecordId: null,
          expenseId: null,
          date: now,
          reference: '',
          note: 'অগ্রিম পেমেন্ট',
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          voidedAt: null,
        });
        await addOrderEventInternal(draft.id, 'payment', `অগ্রিম পেমেন্ট গ্রহণ: ৳${(input.advancePayment / 100).toFixed(2)}`);
      }

      await refreshLastOrder(draft.customerId);
      return draft;
    },
  );
}

interface PromotionEvaluationLike {
  applied: Array<{ name: string }>;
}

export interface UpdateOrderInput extends Partial<OrderInput> {
  id: ID;
}

export async function updateOrder(id: ID, patch: UpdateOrderInput): Promise<Order> {
  const settings = await getSettings();
  return db.transaction(
    'rw',
    [
      db.orders,
      db.orderEvents,
      db.payments,
      db.stockLevels,
      db.stockMovements,
      db.customers,
      db.products,
      db.productVariants,
      db.settings,
      // V2: promotions are re-evaluated on edit so the recorded discount always
      // matches the basket that was actually saved.
      db.promotions,
      db.promotionUsages,
      db.loyaltyEntries,
    ],
    async () => {
      const existing = await db.orders.get(id);
      if (!existing) throw new Error('অর্ডার পাওয়া যায়নি।');

      const next: Order = { ...existing };
      if (patch.orderDate !== undefined) next.orderDate = patch.orderDate;
      if (patch.channel !== undefined) next.channel = patch.channel;
      if (patch.customerId !== undefined) next.customerId = patch.customerId;
      if (patch.customerName !== undefined) next.customerName = patch.customerName;
      if (patch.customerPhone !== undefined) next.customerPhone = patch.customerPhone;
      if (patch.deliveryAddress !== undefined) next.deliveryAddress = patch.deliveryAddress;
      if (patch.discount !== undefined) next.discount = patch.discount;
      if (patch.deliveryCharge !== undefined) next.deliveryCharge = patch.deliveryCharge;
      if (patch.otherCharge !== undefined) next.otherCharge = patch.otherCharge;
      if (patch.paymentMethod !== undefined) next.paymentMethod = patch.paymentMethod;
      if (patch.courierProviderId !== undefined) next.courierProviderId = patch.courierProviderId;
      if (patch.courierName !== undefined) next.courierName = patch.courierName;
      if (patch.trackingNumber !== undefined) next.trackingNumber = patch.trackingNumber;
      if (patch.notes !== undefined) next.notes = patch.notes;
      if (patch.customerInstructions !== undefined) next.customerInstructions = patch.customerInstructions;
      if (patch.cancelReason !== undefined) next.cancelReason = patch.cancelReason;

      if (patch.items) {
        // Preserve identity of existing lines so the delta is computed correctly.
        const previousById = new Map(existing.items.map((i) => [i.id, i]));
        const nextItems: OrderItem[] = patch.items.map((item) => {
          const previous = item.productId && previousById.size ? findPrevious(existing.items, item) : undefined;
          return {
            id: previous?.id ?? randomId(),
            productId: item.productId ?? null,
            variantId: item.variantId ?? null,
            name: item.name,
            sku: item.sku ?? '',
            unit: item.unit || 'পিস',
            quantity: item.quantity,
            // Cost is a historical snapshot: keep the original cost for unchanged lines.
            unitPrice: item.unitPrice,
            unitCost: previous && previous.productId === (item.productId ?? null) ? previous.unitCost : (item.unitCost ?? 0),
            discount: item.discount ?? 0,
            lineTotal: 0,
            ...newOrderItemFields(),
          };
        });
        next.items = nextItems;
      }

      // V2: re-run promotions whenever the basket, the customer or the coupon changed.
      // The previous usage is released first so a usage limit is not consumed twice by
      // one order.
      const basketChanged =
        patch.items !== undefined ||
        patch.customerId !== undefined ||
        patch.deliveryCharge !== undefined ||
        patch.couponCode !== undefined ||
        patch.pointsToRedeem !== undefined;

      if (basketChanged && (settings.promotions?.enabled ?? true)) {
        await releaseUsage(id);
        const evaluation = await evaluateForBasket({
          lines: next.items
            // Lines that are already free gifts were produced by a promotion; feeding
            // them back in would let an offer discount a gift.
            .filter((item) => !item.isFreeGift)
            .map((item) => ({
              productId: item.productId,
              variantId: item.variantId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              unitCost: item.unitCost,
              lineDiscount: item.discount,
              name: item.name,
              unit: item.unit,
            })),
          deliveryCharge: next.deliveryCharge,
          otherCharge: next.otherCharge,
          customerId: next.customerId,
          couponCode: patch.couponCode ?? existing.couponCode ?? '',
          pointsToRedeem: patch.pointsToRedeem ?? 0,
        });
        const applied = applyEvaluationToItems(
          next.items.filter((item) => !item.isFreeGift),
          next.deliveryCharge,
          evaluation,
          patch.couponCode ?? existing.couponCode ?? '',
        );
        next.items = applied.items;
        next.deliveryCharge = applied.deliveryCharge;
        next.discount = addMoney(next.discount ?? 0, evaluation.orderDiscount);
        next.promotionIds = applied.promotionIds;
        next.promotionDiscount = applied.promotionDiscount;
        next.couponCode = applied.couponCode;
        next.loyaltyPointsEarned = applied.loyaltyPointsEarned;
        next.loyaltyPointsRedeemed = applied.loyaltyPointsRedeemed;
        next.loyaltyDiscount = applied.loyaltyDiscount;

        if (evaluation.applied.length > 0 || evaluation.pointsRedeemed > 0) {
          // Recorded after the row is written, below, so usage points at the final total.
          (next as Order & { __pendingPromotionEvaluation?: unknown }).__pendingPromotionEvaluation =
            evaluation;
        }
      }

      recalcOrderFinancials(next);

      // Stock delta for committed orders (only the difference is moved).
      const commitStatuses = settings.order.stockCommitStatuses;
      const wasCommitted = existing.stockCommitted;
      const willCommit = commitStatuses.includes(next.status);
      if (wasCommitted || willCommit) {
        await applyItemDelta(existing, next);
        next.stockCommitted = true;
      }

      const totals = await totalsForOrder(id);
      next.paymentStatus = derivePaymentStatus(next.total, totals.paidIn, totals.refundedOut);
      next.updatedAt = nowMs();

      await db.orders.put(next);
      await addOrderEventInternal(id, 'updated', 'অর্ডার হালনাগাদ করা হয়েছে');

      const pending = (next as Order & { __pendingPromotionEvaluation?: PromotionEvaluationLike })
        .__pendingPromotionEvaluation;
      if (pending) {
        await recordUsage(next, pending as never);
        if (pending.applied.length > 0) {
          await addOrderEventInternal(id, 'note', `প্রযোজ্য অফার: ${pending.applied.map((a) => a.name).join(', ')}`);
        }
      }
      if (patch.items) {
        await addOrderEventInternal(id, 'updated', `পণ্য তালিকা পরিবর্তন: ${next.items.length}টি আইটেম`);
      }
      if (existing.customerId !== next.customerId) {
        await refreshLastOrder(existing.customerId);
        await refreshLastOrder(next.customerId);
      } else {
        await refreshLastOrder(next.customerId);
      }
      return next;
    },
  );
}

function findPrevious(items: OrderItem[], candidate: { productId?: ID | null; variantId?: ID | null; name: string }): OrderItem | undefined {
  return items.find(
    (i) =>
      (i.productId ?? null) === (candidate.productId ?? null) &&
      (i.variantId ?? null) === (candidate.variantId ?? null) &&
      i.name === candidate.name,
  );
}

/** Apply only the quantity difference between two versions of a committed order. */
async function applyItemDelta(previous: Order, next: Order): Promise<void> {
  type Key = string;
  const key = (productId: ID | null, variantId: ID | null): Key => `${productId ?? '-'}::${variantId ?? '-'}`;
  const previousQty = new Map<Key, number>();
  for (const item of previous.items) {
    const k = key(item.productId, item.variantId);
    previousQty.set(k, (previousQty.get(k) ?? 0) + item.quantity);
  }
  const nextQty = new Map<Key, number>();
  const sample = new Map<Key, OrderItem>();
  for (const item of next.items) {
    const k = key(item.productId, item.variantId);
    nextQty.set(k, (nextQty.get(k) ?? 0) + item.quantity);
    if (!sample.has(k)) sample.set(k, item);
  }

  const keys = new Set<Key>([...previousQty.keys(), ...nextQty.keys()]);
  for (const k of keys) {
    const before = previousQty.get(k) ?? 0;
    const after = nextQty.get(k) ?? 0;
    const delta = after - before;
    if (delta === 0) continue;
    const item = sample.get(k) ?? previous.items.find((i) => key(i.productId, i.variantId) === k);
    if (!item || !item.productId) continue;
    await applyMovement({
      productId: item.productId,
      variantId: item.variantId ?? null,
      // delta > 0 means more items sold => remove stock.
      quantity: -delta,
      type: 'order_edit',
      referenceType: 'order',
      referenceId: next.id,
      unitCost: item.unitCost,
      reason: `অর্ডার সম্পাদনা (${next.orderNumber})`,
      note: `${before} → ${after}`,
    });
  }
}

/** Deduct stock for every line of an order. Idempotent. */
export async function commitStockForOrder(order: Order): Promise<void> {
  const existing = await db.stockMovements.where('referenceId').equals(order.id).toArray();
  const alreadyCommitted = existing.some((m) => m.referenceType === 'order' && m.type === 'sale');
  if (alreadyCommitted) return;
  for (const item of order.items) {
    if (!item.productId) continue;
    await applyMovement({
      productId: item.productId,
      variantId: item.variantId ?? null,
      quantity: -Math.abs(item.quantity),
      type: 'sale',
      referenceType: 'order',
      referenceId: order.id,
      unitCost: item.unitCost,
      reason: `বিক্রয় (${order.orderNumber})`,
      party: order.customerName,
    });
  }
}

/** Reverse a committed order's stock movements. Idempotent. */
export async function releaseStockForOrder(order: Order, reason: string): Promise<void> {
  const movements = await db.stockMovements.where('referenceId').equals(order.id).toArray();
  const saleMovements = movements.filter((m) => m.referenceType === 'order' && (m.type === 'sale' || m.type === 'order_edit'));
  if (saleMovements.length === 0) return;
  for (const item of order.items) {
    if (!item.productId) continue;
    await applyMovement({
      productId: item.productId,
      variantId: item.variantId ?? null,
      quantity: Math.abs(item.quantity),
      type: 'sale_reversal',
      referenceType: 'order',
      referenceId: order.id,
      unitCost: item.unitCost,
      reason,
      party: order.customerName,
    });
  }
}

export interface ChangeStatusInput {
  id: ID;
  status: OrderStatusKey;
  reason?: string;
  /** Also record a payment at the same time (e.g. COD collected on delivery). */
  collectPayment?: { amount: Minor; method: string } | null;
}

export async function changeOrderStatus(input: ChangeStatusInput): Promise<Order> {
  const settings = await getSettings();
  return db.transaction(
    'rw',
    [db.orders, db.orderEvents, db.stockLevels, db.stockMovements, db.payments, db.settings, db.customers],
    async () => {
      const order = await db.orders.get(input.id);
      if (!order) throw new Error('অর্ডার পাওয়া যায়নি।');
      const previousStatus = order.status;
      const commitStatuses = settings.order.stockCommitStatuses;
      const next: Order = { ...order, status: input.status, updatedAt: nowMs() };

      if (input.status === 'cancelled') {
        next.cancelReason = input.reason ?? order.cancelReason;
        if (order.stockCommitted) {
          await releaseStockForOrder(order, `অর্ডার বাতিল (${order.orderNumber})`);
          next.stockCommitted = false;
        }
      } else if (commitStatuses.includes(input.status) && !order.stockCommitted) {
        await commitStockForOrder(order);
        next.stockCommitted = true;
      }

      if (input.collectPayment && input.collectPayment.amount > 0) {
        const now = nowMs();
        await db.payments.add({
          id: randomId(),
          kind: 'order_payment',
          direction: 'in',
          amount: input.collectPayment.amount,
          method: input.collectPayment.method || 'cash',
          orderId: order.id,
          customerId: order.customerId,
          courierRecordId: null,
          expenseId: null,
          date: now,
          reference: '',
          note: `ডেলিভারির সময় আদায় (${order.orderNumber})`,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          voidedAt: null,
        });
        await addOrderEventInternal(order.id, 'payment', `পেমেন্ট গ্রহণ: ৳${(input.collectPayment.amount / 100).toFixed(2)}`);
      }

      await db.orders.put(next);
      if (previousStatus !== input.status) {
        await addOrderEventInternal(
          order.id,
          'status_changed',
          `স্ট্যাটাস পরিবর্তন: ${previousStatus} → ${input.status}`,
          { from: previousStatus, to: input.status, reason: input.reason ?? null },
        );
      }
      return next;
    },
  ).then(async (order) => {
    const totals = await totalsForOrder(order.id);
    const paymentStatus = derivePaymentStatus(order.total, totals.paidIn, totals.refundedOut);
    if (paymentStatus !== order.paymentStatus) {
      await db.orders.update(order.id, { paymentStatus, updatedAt: nowMs() });
      order.paymentStatus = paymentStatus;
    }
    return order;
  });
}

export async function bulkUpdateStatus(ids: ID[], status: OrderStatusKey): Promise<{ updated: number; skipped: number; errors: string[] }> {
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const id of ids) {
    try {
      const order = await db.orders.get(id);
      if (!order) {
        skipped += 1;
        continue;
      }
      await changeOrderStatus({ id, status });
      updated += 1;
    } catch (error) {
      skipped += 1;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { updated, skipped, errors };
}

export async function duplicateOrder(id: ID): Promise<Order> {
  const source = await db.orders.get(id);
  if (!source) throw new Error('অর্ডার পাওয়া যায়নি।');
  const input: OrderInput = {
    orderDate: startOfDay(nowMs()),
    channel: source.channel,
    customerId: source.customerId,
    customerName: source.customerName,
    customerPhone: source.customerPhone,
    deliveryAddress: source.deliveryAddress,
    items: source.items.map((i) => ({
      productId: i.productId,
      variantId: i.variantId,
      name: i.name,
      sku: i.sku,
      unit: i.unit,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      unitCost: i.unitCost,
      discount: i.discount,
    })),
    discount: source.discount,
    deliveryCharge: source.deliveryCharge,
    otherCharge: source.otherCharge,
    status: 'new',
    paymentMethod: source.paymentMethod,
    courierProviderId: source.courierProviderId,
    courierName: source.courierName,
    trackingNumber: '',
    notes: source.notes,
    customerInstructions: source.customerInstructions,
    cancelReason: '',
    advancePayment: 0,
    advanceMethod: 'cash',
    // The coupon travels with the copy; redeemed points do not, because they were
    // spent on the original order.
    couponCode: source.couponCode ?? '',
    pointsToRedeem: 0,
  };
  const copy = await createOrder(input);
  await db.orders.update(copy.id, { notes: `${copy.notes}\n[${source.orderNumber} থেকে কপি]`.trim() });
  return { ...copy, notes: `${copy.notes}\n[${source.orderNumber} থেকে কপি]`.trim() };
}

export async function archiveOrder(id: ID): Promise<void> {
  await db.transaction('rw', db.orders, db.stockLevels, db.stockMovements, db.orderEvents, async () => {
    const order = await db.orders.get(id);
    if (!order) return;
    if (order.stockCommitted && order.status !== 'delivered') {
      await releaseStockForOrder(order, `অর্ডার আর্কাইভ (${order.orderNumber})`);
    }
    await db.orders.update(id, { archivedAt: nowMs(), updatedAt: nowMs() });
    await addOrderEventInternal(id, 'archived', 'অর্ডার আর্কাইভ করা হয়েছে');
  });
}

export async function restoreOrder(id: ID): Promise<void> {
  await db.transaction('rw', db.orders, db.orderEvents, async () => {
    await db.orders.update(id, { archivedAt: null, updatedAt: nowMs() });
    await addOrderEventInternal(id, 'restored', 'অর্ডার পুনরুদ্ধার করা হয়েছে');
  });
}

export interface DeleteOrderCheck {
  canDelete: boolean;
  reason: string;
}

export async function checkOrderDelete(id: ID): Promise<DeleteOrderCheck> {
  const payments = await db.payments.where('orderId').equals(id).count();
  const movements = await db.stockMovements.where('referenceId').equals(id).count();
  const courier = await db.courierRecords.where('orderId').equals(id).count();
  const returns = await db.returns.where('orderId').equals(id).count();
  const linked = payments + movements + courier + returns;
  return {
    canDelete: linked === 0,
    reason:
      linked === 0
        ? 'এই অর্ডারে কোনো পেমেন্ট, স্টক মুভমেন্ট, কুরিয়ার বা রিটার্ন যুক্ত নেই — মুছে ফেলা যাবে।'
        : `এই অর্ডারের সাথে ${payments}টি পেমেন্ট, ${movements}টি স্টক মুভমেন্ট, ${courier}টি কুরিয়ার রেকর্ড ও ${returns}টি রিটার্ন যুক্ত। হিসাব রক্ষায় এটি মুছে ফেলা যাবে না — আর্কাইভ করুন।`,
  };
}

export async function hardDeleteOrder(id: ID): Promise<void> {
  const check = await checkOrderDelete(id);
  if (!check.canDelete) throw new Error(check.reason);
  await db.transaction('rw', db.orders, db.orderEvents, async () => {
    await db.orders.delete(id);
    const events = await db.orderEvents.where('orderId').equals(id).toArray();
    for (const e of events) await db.orderEvents.delete(e.id);
  });
}

export async function addOrderNote(id: ID, note: string): Promise<void> {
  await db.transaction('rw', db.orders, db.orderEvents, async () => {
    const order = await db.orders.get(id);
    if (!order) return;
    await db.orders.update(id, { notes: `${order.notes}\n${note}`.trim(), updatedAt: nowMs() });
    await addOrderEventInternal(id, 'note', note);
  });
}

/** Orders that still need attention (used by the dashboard reminder card). */
export async function ordersNeedingAttention(limit = 8): Promise<Order[]> {
  const open = await db.orders.filter((o) => !o.archivedAt && o.status !== 'delivered' && o.status !== 'cancelled' && o.status !== 'returned').toArray();
  return open.sort((a, b) => a.orderDate - b.orderDate).slice(0, limit);
}

/** Aggregate totals used by list footers (sums for the *filtered* set only). */
export function summarizeOrders(orders: Order[]): { count: number; total: Minor; items: number } {
  return {
    count: orders.length,
    total: orders.reduce((s, o) => addMoney(s, o.total), 0),
    items: orders.reduce((s, o) => s + o.items.reduce((n, i) => n + i.quantity, 0), 0),
  };
}
