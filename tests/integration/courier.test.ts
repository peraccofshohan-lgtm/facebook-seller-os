import { describe, expect, it } from 'vitest';
import { codSummary, courierPerformance, createCourierRecord, expectedNetPayable, isConsignmentTaken, payoutDiscrepancies, recordCourierPayout, settledMap } from '@/services/courierService';
import { categoryTotals, createExpense, syncExpenseFromCourier, totalExpenses } from '@/services/expenseService';
import { createOrder } from '@/services/orderService';
import { cashSummary } from '@/services/paymentService';
import { parseMoney } from '@/lib/money';
import { fromDateInputValue } from '@/lib/date';
import { line, orderInput, seedProductWithStock } from '../helpers/factories';
import { db } from '@/db/db';

const tk = parseMoney;

async function seedConsignment(partial: Partial<Parameters<typeof createCourierRecord>[0]> = {}) {
  const product = await seedProductWithStock(20, '400', '700');
  const order = await createOrder(orderInput({ items: [line(product.id, 1, '700')], status: 'confirmed' }));
  return createCourierRecord({
    providerId: null,
    courierName: 'পাঠাও',
    consignmentId: partial.consignmentId ?? 'CN-1',
    orderId: order.id,
    shipmentDate: fromDateInputValue('2026-11-08') ?? Date.now(),
    status: 'delivered',
    deliveryCharge: tk('60'),
    customerDeliveryCharge: tk('60'),
    codAmount: tk('760'),
    collectedAmount: tk('760'),
    courierFee: tk('30'),
    returnFee: 0,
    adjustment: 0,
    payoutDate: null,
    payoutReference: '',
    note: '',
    ...partial,
  } as Parameters<typeof createCourierRecord>[0]);
}

describe('courier COD accounting', () => {
  it('computes what the courier should pay and settles it with a payment', async () => {
    const record = await seedConsignment();
    // collected 760 − (delivery 60 + fee 30) = 670
    expect(expectedNetPayable(record).net).toBe(tk('670'));

    await recordCourierPayout({ courierRecordId: record.id, amount: tk('670'), method: 'bkash', date: Date.now(), reference: '', note: '' });

    const settled = await settledMap();
    expect(settled.get(record.id)).toBe(tk('670'));

    const summary = await codSummary();
    expect(summary.expectedNet).toBe(tk('670'));
    expect(summary.received).toBe(tk('670'));
    expect(summary.remaining).toBe(0);
    expect((await payoutDiscrepancies()).length).toBe(0);
  });

  it('shows an unsettled COD balance until the payout is received', async () => {
    const record = await seedConsignment({ consignmentId: 'CN-2' });
    const summary = await codSummary();
    expect(summary.remaining).toBe(tk('670'));

    await recordCourierPayout({ courierRecordId: record.id, amount: tk('500'), method: 'cash', date: Date.now(), reference: '', note: '' });
    const after = await codSummary();
    expect(after.remaining).toBe(tk('170'));
  });

  it('counts only money in from COD payouts — never as new sales', async () => {
    const record = await seedConsignment({ consignmentId: 'CN-3' });
    await recordCourierPayout({ courierRecordId: record.id, amount: tk('670'), method: 'cash', date: Date.now(), reference: '', note: '' });
    const cash = await cashSummary();
    expect(cash.cashIn).toBe(tk('670'));

    const payments = await db.payments.toArray();
    expect(payments.every((p) => p.kind === 'courier_payout')).toBe(true);
    expect(payments.every((p) => p.direction === 'in')).toBe(true);
  });

  it('rejects a duplicate consignment id', async () => {
    await seedConsignment({ consignmentId: 'CN-DUP' });
    expect(await isConsignmentTaken('CN-DUP')).toBe(true);
    expect(await isConsignmentTaken('CN-OTHER')).toBe(false);
  });

  it('summarises provider performance from recorded outcomes', async () => {
    await seedConsignment({ consignmentId: 'CN-A' });
    await seedConsignment({ consignmentId: 'CN-B', status: 'returned', collectedAmount: 0, returnFee: tk('60') });
    const rows = await courierPerformance();
    expect(rows.length).toBeGreaterThan(0);
    const row = rows.find((r) => r.providerName === 'পাঠাও');
    expect(row?.shipments).toBe(2);
    expect(row?.delivered).toBe(1);
    expect(row?.returned).toBe(1);
  });
});

describe('courier cost as an expense', () => {
  it('syncs the courier cost once and never double-counts it', async () => {
    const record = await seedConsignment({ consignmentId: 'CN-EXP' });
    const categories = await db.expenseCategories.toArray();
    const courierCategory = categories.find((c) => c.name.includes('কুরিয়ার')) ?? categories[0];

    const expense = await syncExpenseFromCourier(
      { id: record.id, courierName: record.courierName, consignmentId: record.consignmentId, orderNumber: '', shipmentDate: record.shipmentDate },
      tk('90'),
      courierCategory.id,
    );
    expect(expense?.amount).toBe(tk('90'));

    // Calling again must update the same expense, not create a second one.
    await syncExpenseFromCourier(
      { id: record.id, courierName: record.courierName, consignmentId: record.consignmentId, orderNumber: '', shipmentDate: record.shipmentDate },
      tk('120'),
      courierCategory.id,
    );
    const linked = await db.expenses.filter((e) => e.courierRecordId === record.id).toArray();
    expect(linked).toHaveLength(1);
    expect(linked[0].amount).toBe(tk('120'));
    expect(await totalExpenses()).toBe(tk('120'));
  });

  it('keeps voided expenses out of totals but keeps the audit trail', async () => {
    const categories = await db.expenseCategories.toArray();
    const expense = await createExpense({
      date: fromDateInputValue('2026-11-08') ?? Date.now(),
      categoryId: categories[0].id,
      amount: tk('500'),
      method: 'cash',
      payee: 'বিজ্ঞাপন',
      reference: '',
      description: 'ফেসবুক বুস্ট',
      note: '',
    } as Parameters<typeof createExpense>[0]);

    expect(await totalExpenses()).toBe(tk('500'));
    const { voidExpense } = await import('@/services/expenseService');
    await voidExpense(expense.id, 'ভুল এন্ট্রি');
    expect(await totalExpenses()).toBe(0);
    expect((await db.expenses.get(expense.id))?.voidedAt).toBeGreaterThan(0);

    const totals = await categoryTotals();
    expect(totals.reduce((s, t) => s + t.amount, 0)).toBe(0);
  });
});
