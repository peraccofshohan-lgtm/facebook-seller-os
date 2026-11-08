/**
 * courierService.ts — Courier consignment records and COD settlement.
 *
 * IMPORTANT: this module does NOT integrate with any courier API. Statuses are entered and
 * updated manually by the user. No tracking is fetched from the network.
 *
 * Money rules:
 *  - A courier payout is NOT new revenue. The sale was already recorded on the order; the
 *    payout only moves cash and reduces the COD receivable.
 *  - Courier cost = deliveryCharge + courierFee + returnFee + adjustment (adjustment is signed).
 */

import { db } from '@/db/db';
import { nowMs } from '@/lib/date';
import { randomId } from '@/lib/id';
import { addMoney, subMoney, sumMoney, type Minor } from '@/lib/money';
import { courierCostOf } from '@/finance/profit';
import type { CourierRecord, ID } from '@/domain/types';
import type { CourierInput } from '@/domain/schemas';

export interface CourierQuery {
  query?: string;
  providerId?: ID;
  status?: string;
  from?: number | null;
  to?: number | null;
  unsettledOnly?: boolean;
  limit?: number;
  offset?: number;
}

export async function listCourierRecords(q: CourierQuery = {}): Promise<{ rows: CourierRecord[]; total: number }> {
  let rows = await db.courierRecords.toArray();
  if (q.providerId) rows = rows.filter((r) => r.providerId === q.providerId);
  if (q.status && q.status !== 'all') rows = rows.filter((r) => r.status === q.status);
  if (q.from !== undefined && q.from !== null) rows = rows.filter((r) => r.shipmentDate >= (q.from as number));
  if (q.to !== undefined && q.to !== null) rows = rows.filter((r) => r.shipmentDate < (q.to as number));
  if (q.query) {
    const needle = q.query.trim().toLowerCase();
    rows = rows.filter((r) =>
      [r.consignmentId, r.courierName, r.orderNumber, r.note, r.payoutReference].join(' ').toLowerCase().includes(needle),
    );
  }
  if (q.unsettledOnly) {
    const settled = await settledMap();
    rows = rows.filter((r) => {
      const expected = expectedNetPayable(r).net;
      const received = settled.get(r.id) ?? 0;
      return expected - received > 0;
    });
  }
  const total = rows.length;
  rows.sort((a, b) => b.shipmentDate - a.shipmentDate);
  const offset = q.offset ?? 0;
  const limit = q.limit ?? 50;
  return { rows: rows.slice(offset, offset + limit), total };
}

export async function getCourierRecord(id: ID): Promise<CourierRecord | undefined> {
  return db.courierRecords.get(id);
}

export async function findByConsignment(consignmentId: string): Promise<CourierRecord | undefined> {
  const clean = consignmentId.trim();
  if (!clean) return undefined;
  return db.courierRecords.where('consignmentId').equals(clean).first();
}

export async function isConsignmentTaken(consignmentId: string, exceptId?: ID): Promise<boolean> {
  const existing = await findByConsignment(consignmentId);
  return Boolean(existing && existing.id !== exceptId);
}

export async function createCourierRecord(input: CourierInput): Promise<CourierRecord> {
  const now = nowMs();
  const order = input.orderId ? await db.orders.get(input.orderId) : null;
  const record: CourierRecord = {
    id: randomId(),
    providerId: input.providerId ?? null,
    courierName: input.courierName,
    consignmentId: input.consignmentId.trim(),
    orderId: input.orderId ?? null,
    orderNumber: order?.orderNumber ?? '',
    shipmentDate: input.shipmentDate,
    status: input.status,
    deliveryCharge: input.deliveryCharge,
    customerDeliveryCharge: input.customerDeliveryCharge,
    codAmount: input.codAmount,
    collectedAmount: input.collectedAmount,
    courierFee: input.courierFee,
    returnFee: input.returnFee,
    adjustment: input.adjustment,
    payoutDate: input.payoutDate ?? null,
    payoutReference: input.payoutReference,
    note: input.note,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  await db.transaction('rw', db.courierRecords, db.orders, db.orderEvents, async () => {
    await db.courierRecords.add(record);
    if (record.orderId) {
      const orderRow = await db.orders.get(record.orderId);
      if (orderRow) {
        await db.orders.update(record.orderId, {
          courierProviderId: record.providerId ?? orderRow.courierProviderId,
          courierName: record.courierName || orderRow.courierName,
          trackingNumber: record.consignmentId || orderRow.trackingNumber,
          codAmount: record.codAmount || orderRow.codAmount,
          updatedAt: now,
        });
      }
      await db.orderEvents.add({
        id: randomId(),
        orderId: record.orderId,
        type: 'courier',
        message: `কুরিয়ার রেকর্ড যোগ: ${record.courierName} (${record.consignmentId || 'কনসাইনমেন্ট নেই'})`,
        meta: { courierRecordId: record.id },
        createdAt: now,
      });
    }
  });
  return record;
}

export async function updateCourierRecord(id: ID, patch: Partial<CourierInput>): Promise<CourierRecord> {
  const existing = await db.courierRecords.get(id);
  if (!existing) throw new Error('কুরিয়ার রেকর্ড পাওয়া যায়নি।');
  const next: CourierRecord = { ...existing, ...patch, id, updatedAt: nowMs() };
  await db.transaction('rw', db.courierRecords, db.orders, async () => {
    await db.courierRecords.put(next);
    if (next.orderId) {
      const order = await db.orders.get(next.orderId);
      if (order) {
        await db.orders.update(next.orderId, {
          trackingNumber: next.consignmentId || order.trackingNumber,
          codAmount: next.codAmount || order.codAmount,
          courierName: next.courierName || order.courierName,
          courierProviderId: next.providerId ?? order.courierProviderId,
          updatedAt: nowMs(),
        });
      }
    }
  });
  return next;
}

export async function deleteCourierRecord(id: ID): Promise<void> {
  const payments = await db.payments.where('courierRecordId').equals(id).count();
  if (payments > 0) {
    throw new Error('এই কুরিয়ার রেকর্ডে পেআউট লেনদেন যুক্ত আছে। হিসাব রক্ষায় এটি মুছে ফেলা যাবে না।');
  }
  await db.courierRecords.delete(id);
}

/* ------------------------------------------------------------------ */
/* Settlement                                                          */
/* ------------------------------------------------------------------ */

export interface ExpectedPayout {
  /** Net amount the courier should hand over (>0) or the cost the business bears (<0). */
  net: Minor;
  /** True when the collected amount has not been entered yet and COD is assumed. */
  estimated: boolean;
  cost: Minor;
}

export function expectedNetPayable(record: CourierRecord): ExpectedPayout {
  const cost = courierCostOf(record);
  const returned = record.status === 'returned' || record.status === 'lost' || record.status === 'cancelled';
  if (returned) return { net: -cost, estimated: false, cost };
  const delivered = record.status === 'delivered' || record.status === 'partial_delivered';
  if (!delivered) return { net: 0, estimated: false, cost };
  const collected = record.collectedAmount > 0 ? record.collectedAmount : record.codAmount;
  return { net: subMoney(collected, cost), estimated: record.collectedAmount === 0 && record.codAmount > 0, cost };
}

export async function settledMap(): Promise<Map<ID, Minor>> {
  const payments = (await db.payments.toArray()).filter(
    (p) => !p.voidedAt && p.courierRecordId && (p.kind === 'courier_payout' || p.kind === 'cod_collection') && p.direction === 'in',
  );
  const map = new Map<ID, Minor>();
  for (const p of payments) {
    if (!p.courierRecordId) continue;
    map.set(p.courierRecordId, addMoney(map.get(p.courierRecordId) ?? 0, p.amount));
  }
  return map;
}

export interface CodSummary {
  /** COD declared at shipment for consignments still in the pipeline. */
  pipelineCod: Minor;
  /** Net receivable from delivered consignments (minus courier costs). */
  expectedNet: Minor;
  /** Already received through payouts. */
  received: Minor;
  /** expectedNet - received. */
  remaining: Minor;
  /** Courier cost of returned/lost consignments (a loss, not a receivable). */
  returnCosts: Minor;
  unsettledCount: number;
  estimatedCount: number;
}

export async function codSummary(): Promise<CodSummary> {
  const records = await db.courierRecords.toArray();
  const settled = await settledMap();
  let pipelineCod = 0;
  let expectedNet = 0;
  let received = 0;
  let returnCosts = 0;
  let unsettledCount = 0;
  let estimatedCount = 0;

  for (const record of records) {
    const payout = expectedNetPayable(record);
    const got = settled.get(record.id) ?? 0;
    received = addMoney(received, got);
    if (record.status === 'returned' || record.status === 'lost' || record.status === 'cancelled') {
      returnCosts = addMoney(returnCosts, Math.abs(payout.net));
      continue;
    }
    // Still with the courier: nothing has been collected yet, so the declared
    // COD belongs in the pipeline. (It must not be booked as a receivable — and
    // the courier's fee on an undelivered parcel is a cost, not negative income.)
    if (record.status === 'pending' || record.status === 'in_transit' || record.status === 'hold') {
      pipelineCod = addMoney(pipelineCod, record.codAmount);
      continue;
    }
    if (payout.net === 0) {
      pipelineCod = addMoney(pipelineCod, record.codAmount);
      continue;
    }
    expectedNet = addMoney(expectedNet, payout.net);
    if (payout.estimated) estimatedCount += 1;
    if (subMoney(payout.net, got) > 0) unsettledCount += 1;
  }

  return {
    pipelineCod,
    expectedNet,
    received,
    remaining: subMoney(expectedNet, received),
    returnCosts,
    unsettledCount,
    estimatedCount,
  };
}

export interface PayoutDiscrepancy {
  record: CourierRecord;
  expected: Minor;
  received: Minor;
  difference: Minor;
}

export async function payoutDiscrepancies(): Promise<PayoutDiscrepancy[]> {
  const records = await db.courierRecords.toArray();
  const settled = await settledMap();
  const out: PayoutDiscrepancy[] = [];
  for (const record of records) {
    const { net } = expectedNetPayable(record);
    if (net === 0) continue;
    const received = settled.get(record.id) ?? 0;
    const difference = subMoney(net, received);
    if (difference !== 0) out.push({ record, expected: net, received, difference });
  }
  return out.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
}

export interface RecordPayoutInput {
  courierRecordId: ID;
  amount: Minor;
  method: string;
  date?: number;
  reference?: string;
  note?: string;
  markSettled?: boolean;
}

export async function recordCourierPayout(input: RecordPayoutInput): Promise<void> {
  if (input.amount <= 0) throw new Error('পরিমাণ ০ এর বেশি হতে হবে।');
  const now = nowMs();
  await db.transaction('rw', db.payments, db.courierRecords, async () => {
    const record = await db.courierRecords.get(input.courierRecordId);
    if (!record) throw new Error('কুরিয়ার রেকর্ড পাওয়া যায়নি।');
    await db.payments.add({
      id: randomId(),
      kind: 'courier_payout',
      direction: 'in',
      amount: input.amount,
      method: input.method || 'cash',
      orderId: record.orderId ?? null,
      customerId: null,
      courierRecordId: record.id,
      expenseId: null,
      date: input.date ?? now,
      reference: input.reference ?? '',
      note: input.note ?? `কুরিয়ার পেআউট (${record.consignmentId || record.orderNumber})`,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      voidedAt: null,
    });
    if (input.markSettled !== false) {
      await db.courierRecords.update(record.id, {
        payoutDate: input.date ?? now,
        payoutReference: input.reference ?? record.payoutReference,
        updatedAt: now,
      });
    }
  });
}

export interface CourierPerformanceRow {
  providerName: string;
  shipments: number;
  delivered: number;
  returned: number;
  deliveredValue: Minor;
  cost: Minor;
  successRate: number;
}

export async function courierPerformance(): Promise<CourierPerformanceRow[]> {
  const records = await db.courierRecords.toArray();
  const map = new Map<string, CourierPerformanceRow>();
  for (const record of records) {
    const key = record.courierName || 'অনির্দিষ্ট';
    const row =
      map.get(key) ??
      ({ providerName: key, shipments: 0, delivered: 0, returned: 0, deliveredValue: 0, cost: 0, successRate: 0 } as CourierPerformanceRow);
    row.shipments += 1;
    if (record.status === 'delivered' || record.status === 'partial_delivered') {
      row.delivered += 1;
      row.deliveredValue = addMoney(row.deliveredValue, record.collectedAmount || record.codAmount);
    }
    if (record.status === 'returned' || record.status === 'lost') row.returned += 1;
    row.cost = addMoney(row.cost, courierCostOf(record));
    map.set(key, row);
  }
  return Array.from(map.values())
    .map((r) => ({ ...r, successRate: r.shipments > 0 ? Math.round((r.delivered / r.shipments) * 100) : 0 }))
    .sort((a, b) => b.shipments - a.shipments);
}

export function totalCourierCost(records: CourierRecord[]): Minor {
  return sumMoney(records.map(courierCostOf));
}
