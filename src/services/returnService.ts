/**
 * returnService.ts — Returns, refunds and exchanges.
 *
 * Four separate effects are tracked independently (see FINANCIAL_RULES.md §Returns):
 *  1. Return received      → the ReturnRecord
 *  2. Refund issued        → a Payment row (kind `order_refund`, direction `out`)
 *  3. Inventory restored   → a StockMovement of type `return_in` (only for restocked lines)
 *  4. Inventory written off→ no movement at all, recorded in the return's condition
 *
 * Reversing a return never deletes history: the refund payment is voided (kept for audit)
 * and a compensating `return_out` movement is written.
 */

import { db } from '@/db/db';
import { nowMs } from '@/lib/date';
import { randomId } from '@/lib/id';
import { addMoney, type Minor } from '@/lib/money';
import { applyMovement } from './inventoryService';
import { nextNumber } from './settingsService';
import { voidPayment } from './paymentService';
import type { ID, ReturnItem, ReturnRecord, StockMovement } from '@/domain/types';
import type { ReturnInput } from '@/domain/schemas';

export interface ReturnQuery {
  orderId?: ID;
  type?: string;
  reason?: string;
  from?: number | null;
  to?: number | null;
  limit?: number;
  offset?: number;
}

export async function listReturns(q: ReturnQuery = {}): Promise<{ rows: ReturnRecord[]; total: number }> {
  let rows = await db.returns.toArray();
  if (q.orderId) rows = rows.filter((r) => r.orderId === q.orderId);
  if (q.type && q.type !== 'all') rows = rows.filter((r) => r.type === q.type);
  if (q.reason && q.reason !== 'all') rows = rows.filter((r) => r.reason === q.reason);
  if (q.from !== undefined && q.from !== null) rows = rows.filter((r) => r.date >= (q.from as number));
  if (q.to !== undefined && q.to !== null) rows = rows.filter((r) => r.date < (q.to as number));
  const total = rows.length;
  rows.sort((a, b) => b.date - a.date);
  const offset = q.offset ?? 0;
  const limit = q.limit ?? 50;
  return { rows: rows.slice(offset, offset + limit), total };
}

export async function getReturn(id: ID): Promise<ReturnRecord | undefined> {
  return db.returns.get(id);
}

export async function returnsForOrder(orderId: ID): Promise<ReturnRecord[]> {
  return (await db.returns.where('orderId').equals(orderId).toArray()).sort((a, b) => b.date - a.date);
}

export async function allReturns(): Promise<ReturnRecord[]> {
  return db.returns.toArray();
}

export async function createReturn(input: ReturnInput): Promise<ReturnRecord> {
  return db.transaction(
    'rw',
    [db.returns, db.orders, db.orderEvents, db.payments, db.stockLevels, db.stockMovements, db.settings, db.products, db.productVariants],
    async () => {
      const order = await db.orders.get(input.orderId);
      if (!order) throw new Error('অর্ডার পাওয়া যায়নি।');

      // Resolve each returned line against the order so a caller can never
      // over-return, or restock a product that was not on the order.
      const alreadyReturned = new Map<string, number>();
      for (const existing of await db.returns.where('orderId').equals(order.id).toArray()) {
        if (existing.status === 'cancelled') continue;
        for (const item of existing.items) {
          const key = item.orderItemId ?? `${item.productId ?? '-'}::${item.variantId ?? '-'}`;
          alreadyReturned.set(key, (alreadyReturned.get(key) ?? 0) + item.quantity);
        }
      }

      const items: ReturnItem[] = input.items.map((item) => {
        const source = item.orderItemId ? order.items.find((i) => i.id === item.orderItemId) : undefined;
        if (item.orderItemId && !source) throw new Error('অর্ডারের পণ্য পাওয়া যায়নি।');

        const key = item.orderItemId ?? `${item.productId ?? '-'}::${item.variantId ?? '-'}`;
        const ordered = source?.quantity ?? 0;
        const returnedSoFar = alreadyReturned.get(key) ?? 0;
        if (source && item.quantity > ordered - returnedSoFar) {
          throw new Error(
            `ফেরত দেওয়া যাবে সর্বোচ্চ ${Math.max(ordered - returnedSoFar, 0)} টি। এই লাইনে অর্ডার হয়েছে ${ordered} টি, ইতিমধ্যে ফেরত হয়েছে ${returnedSoFar} টি।`,
          );
        }
        alreadyReturned.set(key, returnedSoFar + item.quantity);

        return {
          id: randomId(),
          orderItemId: item.orderItemId ?? null,
          productId: item.productId ?? source?.productId ?? null,
          variantId: item.variantId ?? source?.variantId ?? null,
          name: item.name || source?.name || '',
          sku: item.sku ?? source?.sku ?? '',
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          refundAmount: item.refundAmount ?? 0,
          restock: item.restock && item.quantity > 0,
          replacementProductId: item.replacementProductId ?? null,
          replacementVariantId: item.replacementVariantId ?? null,
          replacementQuantity: item.replacementQuantity ?? 0,
        };
      });

      const refundAmount = items.reduce((s, i) => addMoney(s, i.refundAmount), 0);
      const numbering = await nextNumber('return');
      const now = nowMs();
      const record: ReturnRecord = {
        id: randomId(),
        returnNumber: numbering.value,
        orderId: order.id,
        type: input.type,
        date: input.date,
        reason: input.reason,
        condition: input.condition,
        items,
        refundAmount,
        courierFee: input.courierFee ?? 0,
        status: 'completed',
        note: input.note ?? '',
        refundPaymentId: null,
        previousOrderStatus: order.status,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };

      await db.returns.add(record);

      // 1. Refund (cash out)
      if (refundAmount > 0) {
        const paymentId = randomId();
        await db.payments.add({
          id: paymentId,
          kind: 'order_refund',
          direction: 'out',
          amount: refundAmount,
          method: 'cash',
          orderId: order.id,
          customerId: order.customerId,
          courierRecordId: null,
          expenseId: null,
          date: input.date,
          reference: record.returnNumber,
          note: `রিটার্ন রিফান্ড (${record.returnNumber})`,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          voidedAt: null,
        });
        record.refundPaymentId = paymentId;
        await db.returns.update(record.id, { refundPaymentId: paymentId });
        await db.orderEvents.add({
          id: randomId(),
          orderId: order.id,
          type: 'refund',
          message: `রিফান্ড প্রদান: ৳${(refundAmount / 100).toFixed(2)} (${record.returnNumber})`,
          meta: { returnId: record.id },
          createdAt: now,
        });
      }

      // 2. Stock effects
      let restocked = false;
      for (const item of items) {
        if (!item.productId) continue;
        if (item.restock) {
          await applyMovement({
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: Math.abs(item.quantity),
            type: input.type === 'exchange' ? 'exchange_in' : 'return_in',
            referenceType: 'return',
            referenceId: record.id,
            reason: `রিটার্ন (${record.returnNumber}) — ${input.reason}`,
            note: item.restock ? 'পুনরায় স্টকে যোগ' : '',
            createdAt: input.date,
          });
          restocked = true;
        }
        if (input.type === 'exchange' && item.replacementProductId && item.replacementQuantity > 0) {
          await applyMovement({
            productId: item.replacementProductId,
            variantId: item.replacementVariantId ?? null,
            quantity: -Math.abs(item.replacementQuantity),
            type: 'exchange_out',
            referenceType: 'exchange',
            referenceId: record.id,
            reason: `এক্সচেঞ্জের বদলি পণ্য (${record.returnNumber})`,
            createdAt: input.date,
          });
        }
      }

      // 3. Order status
      const nextStatus = input.type === 'exchange' ? 'exchanged' : 'returned';
      await db.orders.update(order.id, {
        status: nextStatus,
        returnRestocked: restocked || order.returnRestocked,
        cancelReason: input.type === 'return' && input.reason ? `রিটার্ন: ${input.reason}` : order.cancelReason,
        updatedAt: now,
      });
      await db.orderEvents.add({
        id: randomId(),
        orderId: order.id,
        type: 'return',
        message: `${input.type === 'exchange' ? 'এক্সচেঞ্জ' : 'রিটার্ন'} নথিভুক্ত (${record.returnNumber})`,
        meta: { returnId: record.id, reason: input.reason, condition: input.condition },
        createdAt: now,
      });

      return record;
    },
  );
}

/** Reverse a return: voids the refund payment and writes compensating stock movements. */
export async function cancelReturn(id: ID, reason = 'রিটার্ন বাতিল'): Promise<void> {
  // db.settings is required because applyMovement() reads the negative-stock policy.
  await db.transaction('rw', [db.returns, db.orders, db.orderEvents, db.stockMovements, db.stockLevels, db.settings, db.products, db.productVariants], async () => {
    const record = await db.returns.get(id);
    if (!record) throw new Error('রিটার্ন রেকর্ড পাওয়া যায়নি।');
    if (record.status === 'cancelled') return;

    const movements: StockMovement[] = (await db.stockMovements.where('referenceId').equals(id).toArray()).filter(
      (m) => m.type === 'return_in' || m.type === 'exchange_in' || m.type === 'exchange_out',
    );
    for (const movement of movements) {
      await applyMovement({
        productId: movement.productId,
        variantId: movement.variantId ?? null,
        quantity: -movement.quantity,
        type: 'return_out',
        referenceType: 'return',
        referenceId: record.id,
        unitCost: movement.unitCost,
        reason: `${reason} (${record.returnNumber})`,
        note: 'রিটার্ন বাতিলের সমন্বয়',
      });
    }

    await db.returns.update(id, { status: 'cancelled', updatedAt: nowMs() });
    const order = await db.orders.get(record.orderId);
    if (order && (order.status === 'returned' || order.status === 'exchanged')) {
      await db.orders.update(order.id, {
        status: record.previousOrderStatus ?? 'delivered',
        returnRestocked: false,
        updatedAt: nowMs(),
      });
    }
    await db.orderEvents.add({
      id: randomId(),
      orderId: record.orderId,
      type: 'return',
      message: `রিটার্ন বাতিল করা হয়েছে (${record.returnNumber})`,
      meta: { returnId: record.id },
      createdAt: nowMs(),
    });
  });

  const record = await db.returns.get(id);
  if (record?.refundPaymentId) {
    await voidPayment(record.refundPaymentId, reason);
  }
}

export interface ReturnSummary {
  count: number;
  refunded: Minor;
  restockedUnits: number;
  writtenOffUnits: number;
  courierFees: Minor;
}

export async function returnSummary(range?: { from: number | null; to: number | null }): Promise<ReturnSummary> {
  const { rows } = await listReturns({ ...range, limit: Number.MAX_SAFE_INTEGER });
  let refunded = 0;
  let restockedUnits = 0;
  let writtenOffUnits = 0;
  let courierFees = 0;
  for (const record of rows) {
    if (record.status === 'cancelled') continue;
    refunded = addMoney(refunded, record.refundAmount);
    courierFees = addMoney(courierFees, record.courierFee);
    for (const item of record.items) {
      if (item.restock) restockedUnits += item.quantity;
      else writtenOffUnits += item.quantity;
    }
  }
  return { count: rows.length, refunded, restockedUnits, writtenOffUnits, courierFees };
}

/** Refund totals per order (used by the profit engine). */
export async function refundsByOrder(): Promise<Map<ID, Minor>> {
  const returns = await db.returns.toArray();
  const map = new Map<ID, Minor>();
  for (const record of returns) {
    if (record.status === 'cancelled') continue;
    map.set(record.orderId, addMoney(map.get(record.orderId) ?? 0, record.refundAmount));
  }
  return map;
}
