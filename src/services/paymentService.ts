/**
 * paymentService.ts — Transaction ledger.
 *
 * Every movement of money (order payment, refund, courier payout, COD settlement,
 * expense payment, manual adjustment) is a row in `payments`. Nothing is ever edited in
 * place: a mistaken entry is voided (kept for audit) and a new compensating entry is added.
 *
 * Cash balance = Σ(payments where direction='in') - Σ(payments where direction='out'),
 * excluding voided rows. This is a *recorded* cash figure: it only reflects transactions
 * the user entered.
 */

import { db } from '@/db/db';
import { nowMs } from '@/lib/date';
import { randomId } from '@/lib/id';
import { addMoney, subMoney, type Minor } from '@/lib/money';
import { derivePaymentStatus } from '@/finance/orderTotals';
import type { ID, Order, Payment, PaymentKind } from '@/domain/types';

export interface OrderPaymentTotals {
  paidIn: Minor;
  refundedOut: Minor;
  netPaid: Minor;
  due: Minor;
}

function validPayment(p: Payment): boolean {
  return !p.voidedAt;
}

export async function totalsForOrder(orderId: ID): Promise<OrderPaymentTotals> {
  const [payments, order] = await Promise.all([
    db.payments.where('orderId').equals(orderId).toArray(),
    db.orders.get(orderId),
  ]);
  return totalsFromPayments(payments.filter(validPayment), order?.total);
}

/**
 * `due` can only be computed when the order total is supplied — this helper
 * works on payments alone, so callers that do know the total must pass it.
 * (It used to be hard-coded to 0, which quietly meant "nothing is owed".)
 */
export function totalsFromPayments(payments: Payment[], orderTotal?: Minor): OrderPaymentTotals {
  let paidIn = 0;
  let refundedOut = 0;
  for (const p of payments) {
    if (p.kind === 'order_payment' && p.direction === 'in') paidIn = addMoney(paidIn, p.amount);
    if (p.kind === 'order_refund' && p.direction === 'out') refundedOut = addMoney(refundedOut, p.amount);
  }
  const netPaid = subMoney(paidIn, refundedOut);
  const due = orderTotal === undefined ? 0 : Math.max(subMoney(orderTotal, netPaid), 0);
  return { paidIn, refundedOut, netPaid, due };
}

export async function totalsForOrders(orderIds: ID[]): Promise<Map<ID, OrderPaymentTotals>> {
  const map = new Map<ID, OrderPaymentTotals>();
  if (orderIds.length === 0) return map;
  const all = (await db.payments.filter((p) => p.orderId !== null).toArray()).filter(validPayment);
  const grouped = new Map<ID, Payment[]>();
  for (const p of all) {
    if (!p.orderId) continue;
    const list = grouped.get(p.orderId) ?? [];
    list.push(p);
    grouped.set(p.orderId, list);
  }
  for (const id of orderIds) {
    const totals = totalsFromPayments(grouped.get(id) ?? []);
    map.set(id, totals);
  }
  return map;
}

export async function paymentsForOrder(orderId: ID): Promise<Payment[]> {
  return (await db.payments.where('orderId').equals(orderId).toArray()).sort((a, b) => b.date - a.date);
}

/** Recompute and persist the derived payment status of an order. */
export async function refreshOrderPaymentStatus(orderId: ID): Promise<void> {
  const order = await db.orders.get(orderId);
  if (!order) return;
  const totals = await totalsForOrder(orderId);
  const paymentStatus = derivePaymentStatus(order.total, totals.paidIn, totals.refundedOut);
  if (paymentStatus !== order.paymentStatus) {
    await db.orders.update(orderId, { paymentStatus, updatedAt: nowMs() });
  }
}

export interface RecordPaymentInput {
  orderId: ID;
  amount: Minor;
  method: string;
  date?: number;
  reference?: string;
  note?: string;
}

export async function recordOrderPayment(input: RecordPaymentInput): Promise<Payment> {
  if (input.amount <= 0) throw new Error('পরিমাণ ০ এর বেশি হতে হবে।');
  return db.transaction('rw', db.payments, db.orders, db.orderEvents, db.customers, async () => {
    const order = await db.orders.get(input.orderId);
    if (!order) throw new Error('অর্ডার পাওয়া যায়নি।');
    const now = nowMs();
    const payment: Payment = {
      id: randomId(),
      kind: 'order_payment',
      direction: 'in',
      amount: input.amount,
      method: input.method || 'cash',
      orderId: order.id,
      customerId: order.customerId ?? null,
      courierRecordId: null,
      expenseId: null,
      date: input.date ?? now,
      reference: input.reference ?? '',
      note: input.note ?? '',
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      voidedAt: null,
    };
    await db.payments.add(payment);
    await addOrderEventInternal(order.id, 'payment', `পেমেন্ট গ্রহণ: ৳${(input.amount / 100).toFixed(2)} (${input.method || 'cash'})`);
    return payment;
  }).then(async (payment) => {
    await refreshOrderPaymentStatus(input.orderId);
    return payment;
  });
}

export interface RecordRefundInput extends Omit<RecordPaymentInput, 'orderId'> {
  orderId: ID;
}

export async function recordRefund(input: RecordRefundInput): Promise<Payment> {
  if (input.amount <= 0) throw new Error('পরিমাণ ০ এর বেশি হতে হবে।');
  return db.transaction('rw', db.payments, db.orders, db.orderEvents, async () => {
    const order = await db.orders.get(input.orderId);
    if (!order) throw new Error('অর্ডার পাওয়া যায়নি।');
    const totals = await totalsForOrder(order.id);
    const refundable = subMoney(totals.paidIn, totals.refundedOut);
    if (input.amount > refundable) {
      throw new Error(`রিফান্ড সর্বোচ্চ ৳${(refundable / 100).toFixed(2)} হতে পারে (গৃহীত পেমেন্টের বেশি রিফান্ড করা যাবে না)।`);
    }
    const now = nowMs();
    const payment: Payment = {
      id: randomId(),
      kind: 'order_refund',
      direction: 'out',
      amount: input.amount,
      method: input.method || 'cash',
      orderId: order.id,
      customerId: order.customerId ?? null,
      courierRecordId: null,
      expenseId: null,
      date: input.date ?? now,
      reference: input.reference ?? '',
      note: input.note ?? '',
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      voidedAt: null,
    };
    await db.payments.add(payment);
    await addOrderEventInternal(order.id, 'refund', `রিফান্ড প্রদান: ৳${(input.amount / 100).toFixed(2)}`);
    return payment;
  }).then(async (payment) => {
    await refreshOrderPaymentStatus(input.orderId);
    return payment;
  });
}

/** Void a payment (never delete) and reverse its effect on derived totals. */
export async function voidPayment(id: ID, reason: string): Promise<void> {
  await db.transaction('rw', db.payments, db.orderEvents, async () => {
    const payment = await db.payments.get(id);
    if (!payment) throw new Error('লেনদেন পাওয়া যায়নি।');
    if (payment.voidedAt) return;
    await db.payments.update(id, { voidedAt: nowMs(), note: `${payment.note}\n[বাতিল] ${reason}`.trim(), updatedAt: nowMs() });
    if (payment.orderId) {
      await addOrderEventInternal(payment.orderId, 'payment', `পেমেন্ট বাতিল করা হয়েছে: ৳${(payment.amount / 100).toFixed(2)}`);
    }
  });
  const payment = await db.payments.get(id);
  if (payment?.orderId) await refreshOrderPaymentStatus(payment.orderId);
}

export interface PaymentQuery {
  from?: number | null;
  to?: number | null;
  kind?: PaymentKind;
  method?: string;
  customerId?: ID;
  orderId?: ID;
  direction?: 'in' | 'out';
  query?: string;
  limit?: number;
  offset?: number;
}

export async function listPayments(q: PaymentQuery = {}): Promise<{ rows: Payment[]; total: number }> {
  let rows = await db.payments.toArray();
  if (q.kind) rows = rows.filter((p) => p.kind === q.kind);
  if (q.direction) rows = rows.filter((p) => p.direction === q.direction);
  if (q.method) rows = rows.filter((p) => p.method === q.method);
  if (q.customerId) rows = rows.filter((p) => p.customerId === q.customerId);
  if (q.orderId) rows = rows.filter((p) => p.orderId === q.orderId);
  if (q.from !== undefined && q.from !== null) rows = rows.filter((p) => p.date >= (q.from as number));
  if (q.to !== undefined && q.to !== null) rows = rows.filter((p) => p.date < (q.to as number));
  if (q.query) {
    const needle = q.query.toLowerCase();
    rows = rows.filter((p) =>
      [p.reference, p.note, p.method, p.amount.toString()].some((f) => (f ?? '').toLowerCase().includes(needle)),
    );
  }
  const total = rows.length;
  rows.sort((a, b) => b.date - a.date);
  const offset = q.offset ?? 0;
  const limit = q.limit ?? 200;
  return { rows: rows.slice(offset, offset + limit), total };
}

export interface CashSummary {
  cashIn: Minor;
  cashOut: Minor;
  balance: Minor;
  byMethod: { method: string; in: Minor; out: Minor }[];
}

export async function cashSummary(range?: { from: number | null; to: number | null }): Promise<CashSummary> {
  let rows = (await db.payments.toArray()).filter(validPayment);
  if (range?.from !== undefined && range?.from !== null) rows = rows.filter((p) => p.date >= (range.from as number));
  if (range?.to !== undefined && range?.to !== null) rows = rows.filter((p) => p.date < (range.to as number));
  let cashIn = 0;
  let cashOut = 0;
  const byMethodMap = new Map<string, { in: number; out: number }>();
  for (const p of rows) {
    if (p.direction === 'in') cashIn = addMoney(cashIn, p.amount);
    else cashOut = addMoney(cashOut, p.amount);
    const entry = byMethodMap.get(p.method) ?? { in: 0, out: 0 };
    if (p.direction === 'in') entry.in += p.amount;
    else entry.out += p.amount;
    byMethodMap.set(p.method, entry);
  }
  return {
    cashIn,
    cashOut,
    balance: subMoney(cashIn, cashOut),
    byMethod: Array.from(byMethodMap.entries()).map(([method, v]) => ({ method, in: v.in, out: v.out })),
  };
}

/**
 * Outstanding customer receivables: for every non-cancelled, non-archived order,
 * total minus what has been paid (net of refunds).
 */
export async function outstandingReceivables(): Promise<{ total: Minor; orders: { order: Order; due: Minor }[] }> {
  const orders = await db.orders.filter((o) => !o.archivedAt && o.status !== 'cancelled').toArray();
  const totals = await totalsForOrders(orders.map((o) => o.id));
  const rows: { order: Order; due: Minor }[] = [];
  let total = 0;
  for (const order of orders) {
    const t = totals.get(order.id) ?? { paidIn: 0, refundedOut: 0, netPaid: 0, due: 0 };
    const due = subMoney(order.total, t.netPaid);
    if (due > 0) {
      rows.push({ order, due });
      total = addMoney(total, due);
    }
  }
  rows.sort((a, b) => b.due - a.due);
  return { total, orders: rows };
}

/** Internal: append an order activity event. Must be called inside a transaction. */
export async function addOrderEventInternal(
  orderId: ID,
  type: Parameters<typeof db.orderEvents.add>[0]['type'],
  message: string,
  meta: Record<string, string | number | null> = {},
): Promise<void> {
  await db.orderEvents.add({
    id: randomId(),
    orderId,
    type,
    message,
    meta,
    createdAt: nowMs(),
  });
}
