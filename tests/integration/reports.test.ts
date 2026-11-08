import { describe, expect, it } from 'vitest';
import { dashboardMetrics, inventoryReport, profitLossReport, salesReport, salesTrend, statusDistribution, topProducts } from '@/services/reportService';
import { createOrder, changeOrderStatus } from '@/services/orderService';
import { createExpense } from '@/services/expenseService';
import { recordOrderPayment } from '@/services/paymentService';
import { parseMoney } from '@/lib/money';
import { fromDateInputValue, rangeForPreset } from '@/lib/date';
import { customerInput, line, orderInput, seedProductWithStock } from '../helpers/factories';
import { createCustomer } from '@/services/customerService';
import { db } from '@/db/db';

const tk = parseMoney;
const RANGE = { from: fromDateInputValue('2026-01-01') ?? 0, to: (fromDateInputValue('2027-01-01') ?? 0) };

describe('profit and loss', () => {
  it('separates estimated profit from realized profit', async () => {
    const product = await seedProductWithStock(50, '400', '700');

    // One delivered + fully paid order => realized.
    const paid = await createOrder(orderInput({ items: [line(product.id, 2, '700')], status: 'delivered' }));
    await recordOrderPayment({ orderId: paid.id, amount: paid.total, method: 'cash', date: Date.now(), reference: '', note: '' });

    // One still in transit => estimated only.
    await createOrder(orderInput({ items: [line(product.id, 1, '700')], status: 'shipped' }));

    const report = await profitLossReport(RANGE);
    expect(report.grossSales).toBe(tk('2100'));
    expect(report.cogs).toBe(tk('1200'));
    // 3 × (700 − 400) = 900 of gross margin.
    expect(report.grossProfit).toBe(tk('900'));
    expect(report.estimatedProfit).toBe(tk('900'));
    // Only the delivered + fully paid order counts as realized: 2 × 300 = 600.
    expect(report.realizedProfit).toBe(tk('600'));
    expect(report.deliveredCount).toBe(1);
    expect(report.paidAndDeliveredCount).toBe(1);
  });

  it('subtracts operating expenses from realized profit only', async () => {
    const product = await seedProductWithStock(50, '400', '700');
    const order = await createOrder(orderInput({ items: [line(product.id, 1, '700')], status: 'delivered' }));
    await recordOrderPayment({ orderId: order.id, amount: order.total, method: 'cash', date: Date.now(), reference: '', note: '' });

    const category = (await db.expenseCategories.toArray())[0];
    await createExpense({
      date: fromDateInputValue('2026-11-08') ?? Date.now(),
      categoryId: category.id,
      amount: tk('100'),
      method: 'cash',
      payee: '',
      reference: '',
      description: 'প্যাকেজিং',
      note: '',
    } as Parameters<typeof createExpense>[0]);

    const report = await profitLossReport(RANGE);
    expect(report.operatingExpenses).toBe(tk('100'));
    expect(report.realizedProfit).toBe(tk('200'));
    expect(report.operatingProfit).toBe(tk('200'));
    expect(report.expenseByCategory[0].amount).toBe(tk('100'));
  });

  it('excludes cancelled orders from every profit figure', async () => {
    const product = await seedProductWithStock(50, '400', '700');
    const order = await createOrder(orderInput({ items: [line(product.id, 4, '700')], status: 'confirmed' }));
    await changeOrderStatus({ id: order.id, status: 'cancelled', reason: 'পরীক্ষা' });

    const report = await profitLossReport(RANGE);
    expect(report.grossSales).toBe(0);
    expect(report.estimatedProfit).toBe(0);
  });
});

describe('sales reporting', () => {
  it('reports per-order rows with the customer snapshot', async () => {
    const product = await seedProductWithStock(50, '400', '700');
    const customer = await createCustomer(customerInput({ name: 'রিমা' }));
    const order = await createOrder(
      orderInput({ customerId: customer.id, customerName: 'রিমা', items: [line(product.id, 1, '700')], deliveryCharge: tk('60') }),
    );

    const rows = await salesReport(RANGE);
    expect(rows).toHaveLength(1);
    expect(rows[0].order.id).toBe(order.id);
    expect(rows[0].order.total).toBe(tk('760'));
    expect(rows[0].order.customerName).toBe('রিমা');

    // Renaming the customer later must not rewrite the historical order row.
    const { updateCustomer } = await import('@/services/customerService');
    await updateCustomer(customer.id, { name: 'রিমা খাতুন' });
    const after = await salesReport(RANGE);
    expect(after[0].order.customerName).toBe('রিমা');
  });

  it('ranks top products by quantity and revenue', async () => {
    const a = await seedProductWithStock(50, '400', '700');
    const b = await seedProductWithStock(50, '400', '1000');
    await createOrder(orderInput({ items: [line(a.id, 3, '700')], status: 'delivered' }));
    await createOrder(orderInput({ items: [line(b.id, 1, '1000')], status: 'delivered' }));

    const rows = await topProducts(RANGE, 5);
    expect(rows).toHaveLength(2);
    expect(rows[0].quantity).toBe(3);
    expect(rows[1].quantity).toBe(1);
  });

  it('breaks the day range into daily trend points', async () => {
    const product = await seedProductWithStock(50, '400', '700');
    await createOrder(orderInput({ items: [line(product.id, 1, '700')] }));
    // Only days that actually have activity are emitted (no fake zero rows to pad a chart).
    const trend = await salesTrend(rangeForPreset('last7'), 'day');
    expect(trend).toHaveLength(1);
    expect(trend[0].orders).toBe(1);

    // Two orders on different days produce two chronological buckets.
    await createOrder(orderInput({ items: [line(product.id, 2, '700')], orderDate: (fromDateInputValue('2026-11-06') ?? 0) }));
    const two = await salesTrend(rangeForPreset('last7'), 'day');
    expect(two).toHaveLength(2);
    expect(two[0].ts).toBeLessThan(two[1].ts);
    expect(two.reduce((sum, point) => sum + point.orders, 0)).toBe(2);
  });

  it('counts orders per status for the dashboard', async () => {
    const product = await seedProductWithStock(50, '400', '700');
    await createOrder(orderInput({ items: [line(product.id, 1, '700')], status: 'new' }));
    await createOrder(orderInput({ items: [line(product.id, 1, '700')], status: 'delivered' }));

    const distribution = await statusDistribution(RANGE);
    const byKey = new Map(distribution.map((d) => [d.status, d.count]));
    expect(byKey.get('new')).toBe(1);
    expect(byKey.get('delivered')).toBe(1);

    const metrics = await dashboardMetrics(rangeForPreset('all'));
    expect(metrics.totalOrders).toBe(2);
  });

  it('values inventory at weighted-average cost', async () => {
    const product = await seedProductWithStock(12, '400', '700');
    const report = await inventoryReport();
    const row = report.rows.find((r) => r.productId === product.id && r.variantId === null);
    expect(row?.quantity).toBe(12);
    expect(row?.avgCost).toBe(tk('400'));
    expect(row?.value).toBe(tk('4800'));
    // report.total is the number of stock rows, not a money amount.
    expect(report.total).toBe(1);
    expect(report.rows.reduce((sum, r) => sum + r.value, 0)).toBe(tk('4800'));
  });
});
