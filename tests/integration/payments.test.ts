import { beforeEach, describe, expect, it } from 'vitest';import {
  cashSummary,
  listPayments,
  outstandingReceivables,
  paymentsForOrder,
  recordOrderPayment,
  recordRefund,
  totalsForOrder,
  voidPayment,
} from '@/services/paymentService';
import { createOrder, getOrder } from '@/services/orderService';
import { parseMoney } from '@/lib/money';
import { nowMs, startOfDay, endOfDay } from '@/lib/date';
import { db } from '@/db/db';
import { orderInput, seedProductWithStock } from '../helpers/factories';

const tk = parseMoney;

/** One confirmed order: 2 × 700 + 60 delivery = 1,460. */
async function orderOf1460() {
  const product = await seedProductWithStock(10);
  return createOrder(
    orderInput({
      status: 'confirmed',
      items: [
        {
          productId: product.id,
          variantId: null,
          name: product.name,
          sku: '',
          unit: 'পিস',
          quantity: 2,
          unitPrice: tk('700'),
          unitCost: tk('400'),
          discount: 0,
        },
      ],
      discount: 0,
      deliveryCharge: tk('60'),
      otherCharge: 0,
      advancePayment: 0,
    }),
  );
}

describe('payments', () => {
  beforeEach(async () => {
    await db.orders.clear();
    await db.payments.clear();
    await db.orderEvents.clear();
    await db.products.clear();
    await db.stockLevels.clear();
    await db.stockMovements.clear();
  });

  it('a full payment clears the order; a partial one leaves the exact balance', async () => {
    const order = await orderOf1460();
    expect(order.total).toBe(146000);

    await recordOrderPayment({ orderId: order.id, amount: tk('500'), method: 'bkash' });
    let totals = await totalsForOrder(order.id);
    expect(totals.paidIn).toBe(50000);
    expect(totals.netPaid).toBe(50000);
    expect(totals.due).toBe(96000);
    expect((await getOrder(order.id))?.paymentStatus).toBe('partial');

    await recordOrderPayment({ orderId: order.id, amount: tk('960'), method: 'cash' });
    totals = await totalsForOrder(order.id);
    expect(totals.paidIn).toBe(146000);
    expect(totals.due).toBe(0);
    expect((await getOrder(order.id))?.paymentStatus).toBe('paid');
  });

  it('never records the same money twice: over-paying does not inflate income', async () => {
    const order = await orderOf1460();
    await recordOrderPayment({ orderId: order.id, amount: tk('1,460'), method: 'cash' });
    // A seller pressing "save" twice must not be able to invent a second payment
    // against the same order without an explicit new record.
    const payments = await paymentsForOrder(order.id);
    expect(payments).toHaveLength(1);
    const totals = await totalsForOrder(order.id);
    expect(totals.paidIn).toBe(146000);
    expect(totals.due).toBe(0);
  });

  it('rejects a payment of zero or less', async () => {
    const order = await orderOf1460();
    await expect(recordOrderPayment({ orderId: order.id, amount: 0, method: 'cash' })).rejects.toThrow();
    await expect(recordOrderPayment({ orderId: order.id, amount: -100, method: 'cash' })).rejects.toThrow();
  });

  it('a refund reduces what was collected and puts the money back as due', async () => {
    const order = await orderOf1460();
    await recordOrderPayment({ orderId: order.id, amount: tk('1,460'), method: 'cash' });
    await recordRefund({ orderId: order.id, amount: tk('400'), method: 'cash' });

    const totals = await totalsForOrder(order.id);
    expect(totals.paidIn).toBe(146000);
    expect(totals.refundedOut).toBe(40000);
    expect(totals.netPaid).toBe(106000);
    expect(totals.due).toBe(40000);
  });

  it('will not refund more than the customer actually paid', async () => {
    const order = await orderOf1460();
    await recordOrderPayment({ orderId: order.id, amount: tk('500'), method: 'cash' });
    await expect(recordRefund({ orderId: order.id, amount: tk('900'), method: 'cash' })).rejects.toThrow();
    const totals = await totalsForOrder(order.id);
    expect(totals.refundedOut).toBe(0);
  });

  it('voiding a payment reverses it instead of deleting history', async () => {
    const order = await orderOf1460();
    const payment = await recordOrderPayment({ orderId: order.id, amount: tk('1,000'), method: 'cash' });
    await voidPayment(payment.id, 'ভুল এন্ট্রি');

    // Kept as a row, marked void, and excluded from the totals.
    expect(await db.payments.get(payment.id)).toBeDefined();
    expect((await db.payments.get(payment.id))?.voidedAt).not.toBeNull();
    const totals = await totalsForOrder(order.id);
    expect(totals.netPaid).toBe(0);
    expect(totals.due).toBe(146000);
  });

  it('outstanding receivables add up across orders without double counting', async () => {
    const a = await orderOf1460();
    const b = await orderOf1460();
    await recordOrderPayment({ orderId: a.id, amount: tk('460'), method: 'cash' });
    await recordOrderPayment({ orderId: b.id, amount: tk('1,460'), method: 'cash' });

    const outstanding = await outstandingReceivables();
    expect(outstanding.total).toBe(100000); // only the unpaid 1,000 of order A
    expect(outstanding.orders).toHaveLength(1);
    expect(outstanding.orders[0]?.order.id).toBe(a.id);
    expect(outstanding.orders[0]?.due).toBe(100000);
  });

  it('the cash book separates money in from money out', async () => {
    const order = await orderOf1460();
    await recordOrderPayment({ orderId: order.id, amount: tk('1,000'), method: 'cash' });
    await recordOrderPayment({ orderId: order.id, amount: tk('460'), method: 'bkash' });
    await recordRefund({ orderId: order.id, amount: tk('100'), method: 'cash' });

    const range = { from: startOfDay(nowMs()), to: endOfDay(nowMs()) };
    const summary = await cashSummary(range);
    expect(summary.cashIn).toBe(146000);
    expect(summary.cashOut).toBe(10000);
    expect(summary.balance).toBe(136000);
    const byMethod = new Map(summary.byMethod.map((row) => [row.method, row]));
    expect(byMethod.get('cash')).toEqual({ method: 'cash', in: 100000, out: 10000 });
    expect(byMethod.get('bkash')).toEqual({ method: 'bkash', in: 46000, out: 0 });
  });

  it('lists payments newest first and can filter by method', async () => {
    const order = await orderOf1460();
    await recordOrderPayment({ orderId: order.id, amount: tk('100'), method: 'cash', date: nowMs() - 1000 });
    await recordOrderPayment({ orderId: order.id, amount: tk('200'), method: 'bkash', date: nowMs() });

    expect((await listPayments({})).total).toBe(2);
    expect((await listPayments({ method: 'bkash' })).total).toBe(1);
    const rows = (await listPayments({})).rows;
    expect(rows[0]!.date).toBeGreaterThanOrEqual(rows[1]!.date);
  });
});
