/**
 * money-audit.test.ts — independent audit of the financial engine.
 *
 * Every expectation is worked out by hand, so the test states what a seller
 * would work out on paper rather than what the code happens to return. The
 * point is to catch double counting, mis-scaled money and float drift.
 *
 * NOTE ON UNITS: money is always integer paisa. `tk('700')` means 700.00 BDT
 * and is 70000 here. The `line()` factory takes TAKA STRINGS.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { changeOrderStatus, createOrder, getOrder, recalcOrderFinancials } from '@/services/orderService';
import { recordOrderPayment, totalsForOrder } from '@/services/paymentService';
import { codSummary, createCourierRecord, expectedNetPayable } from '@/services/courierService';
import { createReturn, refundsByOrder, returnSummary } from '@/services/returnService';
import { adjustStock, stockRows, stockValuation } from '@/services/inventoryService';
import { createExpense, syncExpenseFromCourier, totalExpenses } from '@/services/expenseService';
import { profitLossReport } from '@/services/reportService';
import { courierCostOf, orderProfit, periodProfit } from '@/finance/profit';
import { addMoney, allocate, allocateByWeights, mulQty, parseMoney, subMoney, sumMoney, toMinor } from '@/lib/money';
import { endOfDay, nowMs, startOfDay } from '@/lib/date';
import { db } from '@/db/db';
import { line, orderInput, seedProductWithStock } from '../helpers/factories';

const tk = parseMoney;
/**
 * The app thinks in Asia/Dhaka, so "today" is the Dhaka day — orders are
 * created on that day on purpose, otherwise a test run late in the UTC evening
 * would place them on the previous Dhaka day and find an empty period.
 */
const DHACA_TODAY = startOfDay(nowMs());
const today = () => ({ from: DHACA_TODAY, to: endOfDay(DHACA_TODAY) });

beforeEach(async () => {
  for (const table of [
    db.orders,
    db.payments,
    db.orderEvents,
    db.products,
    db.productVariants,
    db.stockLevels,
    db.stockMovements,
    db.returns,
    db.courierRecords,
    db.expenses,
    db.customers,
  ]) {
    await table.clear();
  }
});

describe('order totals', () => {
  it('adds up line totals, discount, delivery and other charges exactly once', async () => {
    const product = await seedProductWithStock(50);
    const order = await createOrder(
      orderInput({
        status: 'confirmed',
        items: [line(product.id, 3, '700', '400'), line(product.id, 2, '250.50', '100')],
        discount: tk('100'),
        deliveryCharge: tk('60'),
        otherCharge: tk('40'),
      }),
    );

    // 3 × 700 = 2,100 ; 2 × 250.50 = 501.00 → subtotal 2,601.00
    expect(order.subtotal).toBe(260100);
    // 2,601 − 100 discount = 2,501 ; + 60 delivery + 40 other = 2,601
    expect(order.total).toBe(260100);
    // COGS = 3 × 400 + 2 × 100 = 1,400
    expect(order.cogs).toBe(140000);
    // Delivery and other charges are cost recovery, never revenue.
    const profit = orderProfit(order);
    expect(profit.netSales).toBe(250100);
    expect(profit.customerCharges).toBe(10000);
    expect(profit.grossProfit).toBe(110100);
    expect(profit.estimatedProfit).toBe(110100);
  });

  it('keeps paisa exact where floats would drift', async () => {
    // 0.1 + 0.2 is 0.30000000000000004 in JavaScript. Not here.
    expect(addMoney(tk('0.10'), tk('0.20'))).toBe(30);
    expect(sumMoney([tk('0.01'), tk('0.02'), tk('0.03')])).toBe(6);
    expect(mulQty(tk('33.33'), 3)).toBe(9999);

    const product = await seedProductWithStock(10);
    const order = await createOrder(
      orderInput({ status: 'confirmed', items: [line(product.id, 3, '33.33', '0.01')] }),
    );
    expect(order.subtotal).toBe(9999); // 99.99
    expect(order.cogs).toBe(3); // 0.03
  });

  it('splits an amount without losing a single paisa', () => {
    expect(allocate(1000, 3).reduce((a, b) => a + b, 0)).toBe(1000);
    expect(allocate(100, 3).reduce((a, b) => a + b, 0)).toBe(100);
    expect(allocate(1, 3).reduce((a, b) => a + b, 0)).toBe(1);
    expect(allocateByWeights(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(allocateByWeights(100, [1, 2, 3]).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('handles very large amounts inside the safe-integer range', async () => {
    const product = await seedProductWithStock(5);
    const order = await createOrder(
      orderInput({ status: 'confirmed', items: [line(product.id, 1, '90,000,000', '1')] }),
    );
    expect(Number.isSafeInteger(order.subtotal)).toBe(true);
    expect(order.subtotal).toBe(toMinor(90_000_000));
    expect(order.total).toBe(order.subtotal);
  });
});

describe('advance and outstanding balances', () => {
  it('an advance recorded with the order is money received, not a discount', async () => {
    const product = await seedProductWithStock(10);
    const order = await createOrder(
      orderInput({
        status: 'confirmed',
        items: [line(product.id, 2, '700', '400')],
        deliveryCharge: tk('60'),
        advancePayment: tk('500'),
      }),
    );

    expect(order.total).toBe(146000);
    const totals = await totalsForOrder(order.id);
    expect(totals.paidIn).toBe(50000);
    // The advance must not shrink the order total — only what is still owed.
    expect(totals.due).toBe(96000);
    expect(order.total).toBe(146000);

    await recordOrderPayment({ orderId: order.id, amount: tk('960'), method: 'cash' });
    const after = await totalsForOrder(order.id);
    expect(after.paidIn).toBe(146000);
    expect(after.due).toBe(0);
  });

  it('paying twice is recorded twice and reads as overpaid, not as extra sales', async () => {
    const product = await seedProductWithStock(10);
    const order = await createOrder(
      orderInput({ status: 'confirmed', items: [line(product.id, 1, '700', '400')] }),
    );
    await recordOrderPayment({ orderId: order.id, amount: tk('700'), method: 'cash' });
    await recordOrderPayment({ orderId: order.id, amount: tk('700'), method: 'cash' });

    const totals = await totalsForOrder(order.id);
    expect(totals.paidIn).toBe(140000); // genuinely received twice
    expect(totals.due).toBe(0); // never negative
    expect((await getOrder(order.id))?.paymentStatus).toBe('overpaid');
    // Sales are untouched by how often the customer paid.
    expect((await getOrder(order.id))?.subtotal).toBe(70000);
  });
});

describe('delivery charge and courier cost', () => {
  it('the delivery charge the customer pays is not counted as sales', async () => {
    const product = await seedProductWithStock(10);
    const withDelivery = await createOrder(
      orderInput({ status: 'confirmed', items: [line(product.id, 1, '1,000', '600')], deliveryCharge: tk('120') }),
    );
    const without = await createOrder(
      orderInput({ status: 'confirmed', items: [line(product.id, 1, '1,000', '600')], deliveryCharge: 0 }),
    );

    // Revenue is the same 1,000 either way — only what the customer owes differs.
    expect(orderProfit(withDelivery).netSales).toBe(orderProfit(without).netSales);
    expect(withDelivery.total - without.total).toBe(12000);
    expect(orderProfit(withDelivery).estimatedProfit).toBe(orderProfit(without).estimatedProfit);
  });

  it('courier cost is what the business bears; a returned parcel is a pure cost', async () => {
    const delivered = await createCourierRecord({
      providerId: null,
      courierName: 'Pathao',
      consignmentId: 'CN-1',
      orderId: null,
      shipmentDate: nowMs(),
      status: 'delivered',
      deliveryCharge: tk('60'),
      customerDeliveryCharge: tk('60'),
      codAmount: tk('1,000'),
      collectedAmount: tk('1,000'),
      courierFee: tk('30'),
      returnFee: 0,
      adjustment: 0,
      payoutDate: null,
      payoutReference: '',
      note: '',
    });
    // 1,000 collected − (60 delivery + 30 fee) = 910 payable to the business.
    expect(expectedNetPayable(delivered).net).toBe(91000);
    expect(courierCostOf(delivered)).toBe(9000);

    const returned = await createCourierRecord({
      providerId: null,
      courierName: 'Pathao',
      consignmentId: 'CN-2',
      orderId: null,
      shipmentDate: nowMs(),
      status: 'returned',
      deliveryCharge: tk('60'),
      customerDeliveryCharge: tk('60'),
      codAmount: tk('1,000'),
      collectedAmount: 0,
      courierFee: tk('30'),
      returnFee: tk('60'),
      adjustment: 0,
      payoutDate: null,
      payoutReference: '',
      note: '',
    });
    // Nothing collected: the business only pays 60 + 30 + 60 = 150.
    expect(expectedNetPayable(returned).net).toBe(-15000);
    const summary = await codSummary();
    expect(summary.returnCosts).toBe(15000);
    expect(summary.expectedNet).toBe(91000);
  });

  it('a parcel still with the courier is pipeline COD, not a negative receivable', async () => {
    const product = await seedProductWithStock(10);
    const order = await createOrder(
      orderInput({ status: 'confirmed', items: [line(product.id, 1, '1,000', '600')], deliveryCharge: tk('60') }),
    );
    await createCourierRecord({
      providerId: null,
      courierName: 'Steadfast',
      consignmentId: 'CN-COD',
      orderId: order.id,
      shipmentDate: nowMs(),
      status: 'in_transit',
      deliveryCharge: tk('60'),
      customerDeliveryCharge: tk('60'),
      codAmount: tk('1,060'),
      collectedAmount: 0,
      courierFee: tk('25'),
      returnFee: 0,
      adjustment: 0,
      payoutDate: null,
      payoutReference: '',
      note: '',
    });

    const summary = await codSummary();
    expect(summary.pipelineCod).toBe(106000);
    expect(summary.received).toBe(0);
    expect(summary.remaining).toBe(0);
  });
});

describe('returns and refunds', () => {
  it('a refund reduces profit, puts stock back, and is counted exactly once', async () => {
    const product = await seedProductWithStock(10);
    const order = await createOrder(
      orderInput({ status: 'delivered', items: [line(product.id, 2, '700', '400')], deliveryCharge: tk('60') }),
    );
    await recordOrderPayment({ orderId: order.id, amount: tk('1,460'), method: 'cash' });

    await createReturn({
      orderId: order.id,
      type: 'return',
      date: nowMs(),
      reason: 'size_issue',
      condition: 'resellable',
      courierFee: tk('50'),
      note: '',
      items: [
        {
          orderItemId: null,
          productId: product.id,
          variantId: null,
          name: product.name,
          sku: '',
          quantity: 1,
          unitPrice: tk('700'),
          refundAmount: tk('700'),
          restock: true,
          replacementProductId: null,
          replacementVariantId: null,
          replacementQuantity: 0,
        },
      ],
    });

    // One unit comes back to the shelf: 10 − 2 + 1 = 9.
    expect((await db.stockLevels.get(`${product.id}::-`))?.quantity).toBe(9);

    // The refund reaches the profit engine exactly once.
    const refunds = await refundsByOrder();
    expect(refunds.get(order.id)).toBe(70000);

    const stored = await getOrder(order.id);
    const profit = orderProfit(stored!, { refunds: refunds.get(order.id) ?? 0 });
    // 1,400 sales − 800 cogs − 700 refund = −100
    expect(profit.estimatedProfit).toBe(-10000);
  });

  it('a written-off return does not put stock back', async () => {
    const product = await seedProductWithStock(10);
    const order = await createOrder(
      orderInput({ status: 'delivered', items: [line(product.id, 2, '700', '400')] }),
    );
    await createReturn({
      orderId: order.id,
      type: 'return',
      date: nowMs(),
      reason: 'damaged',
      condition: 'damaged',
      courierFee: 0,
      note: '',
      items: [
        {
          orderItemId: null,
          productId: product.id,
          variantId: null,
          name: product.name,
          sku: '',
          quantity: 2,
          unitPrice: tk('700'),
          refundAmount: tk('1,400'),
          restock: false,
          replacementProductId: null,
          replacementVariantId: null,
          replacementQuantity: 0,
        },
      ],
    });
    expect((await db.stockLevels.get(`${product.id}::-`))?.quantity).toBe(8);
    const summary = await returnSummary();
    expect(summary.restockedUnits).toBe(0);
    expect(summary.writtenOffUnits).toBe(2);
  });
});

describe('profit and loss for a period', () => {
  it('estimated profit is optimistic; realized profit waits for delivery and payment', async () => {
    const product = await seedProductWithStock(50);

    // Delivered AND paid → counts in both.
    const deliveredPaid = await createOrder(
      orderInput({ orderDate: DHACA_TODAY, status: 'confirmed', items: [line(product.id, 1, '1,000', '600')] }),
    );
    await recordOrderPayment({ orderId: deliveredPaid.id, amount: tk('1,000'), method: 'cash' });
    await changeOrderStatus({ id: deliveredPaid.id, status: 'delivered' });

    // Confirmed but unpaid → estimated only.
    await createOrder(orderInput({ orderDate: DHACA_TODAY, status: 'confirmed', items: [line(product.id, 1, '1,000', '600')] }));

    // Cancelled → excluded entirely.
    const cancelled = await createOrder(
      orderInput({ orderDate: DHACA_TODAY, status: 'confirmed', items: [line(product.id, 1, '1,000', '600')] }),
    );
    await changeOrderStatus({ id: cancelled.id, status: 'cancelled' });

    const report = await profitLossReport(today());
    // Two orders still count, the cancelled one does not → gross sales 2,000.
    expect(report.grossSales).toBe(200000);
    expect(report.cogs).toBe(120000); // 2 × 600
    expect(report.grossProfit).toBe(80000);
    expect(report.estimatedProfit).toBe(80000); // both live orders
    expect(report.realizedProfit).toBe(40000); // only the delivered + paid one
  });

  it('expenses are subtracted once and never touch revenue', async () => {
    const product = await seedProductWithStock(50);
    const order = await createOrder(
      orderInput({ orderDate: DHACA_TODAY, status: 'confirmed', items: [line(product.id, 1, '1,000', '600')] }),
    );
    await changeOrderStatus({ id: order.id, status: 'delivered' });
    await recordOrderPayment({ orderId: order.id, amount: tk('1,000'), method: 'cash' });

    await createExpense({ date: nowMs(), categoryId: null, amount: tk('250'), method: 'cash', payee: '', reference: '', description: '', note: '' });
    await createExpense({ date: nowMs(), categoryId: null, amount: tk('150.75'), method: 'cash', payee: '', reference: '', description: '', note: '' });

    expect(await totalExpenses()).toBe(40075);

    const report = await profitLossReport(today());
    expect(report.grossSales).toBe(100000);
    expect(report.operatingExpenses).toBe(40075);
    // Estimated profit is per-order (sales − COGS); expenses are only taken
    // off the conservative, realized figure.
    expect(report.estimatedProfit).toBe(40000);
    expect(report.realizedProfit).toBe(subMoney(40000, 40075)); // −75
  });

  it('a courier cost is charged once, even when it is also booked as an expense', async () => {
    const product = await seedProductWithStock(10);
    const order = await createOrder(
      orderInput({ orderDate: DHACA_TODAY, status: 'confirmed', items: [line(product.id, 1, '1,000', '600')] }),
    );
    const record = await createCourierRecord({
      providerId: null,
      courierName: 'Pathao',
      consignmentId: 'CN-DOUBLE',
      orderId: order.id,
      shipmentDate: DHACA_TODAY,
      status: 'delivered',
      deliveryCharge: tk('60'),
      customerDeliveryCharge: tk('60'),
      codAmount: tk('1,060'),
      collectedAmount: tk('1,060'),
      courierFee: tk('40'),
      returnFee: 0,
      adjustment: 0,
      payoutDate: null,
      payoutReference: '',
      note: '',
    });
    await changeOrderStatus({ id: order.id, status: 'delivered' });
    await recordOrderPayment({ orderId: order.id, amount: tk('1,060'), method: 'cash' });

    const before = await profitLossReport(today());
    // Courier cost 60 + 40 = 100 already comes off the estimated profit.
    expect(before.estimatedProfit).toBe(30000); // 1,000 − 600 − 100

    // The seller now also books it in the expense book — exactly what the
    // courier screen's "খরচ হিসেবে যোগ করুন" button does.
    await syncExpenseFromCourier(record, courierCostOf(record), null);
    const linked = (await db.expenses.toArray()).filter((e) => e.courierRecordId === record.id);
    expect(linked).toHaveLength(1);
    // It really does show up in the expense book (the seller expects to see it).
    expect(await totalExpenses()).toBe(10000);

    const after = await profitLossReport(today());
    // …but it is not charged a second time in the profit figure.
    expect(after.estimatedProfit).toBe(before.estimatedProfit);
    expect(after.realizedProfit).toBe(before.realizedProfit);
    expect(after.operatingExpenses).toBe(0);

    // Pressing the button twice must not create a second expense either.
    await syncExpenseFromCourier(record, courierCostOf(record), null);
    expect((await db.expenses.toArray()).filter((e) => e.courierRecordId === record.id)).toHaveLength(1);
    expect(await totalExpenses()).toBe(10000);
  });

  it('periodProfit never counts a cancelled order', () => {
    const base = {
      subtotal: 100000,
      discount: 0,
      cogs: 60000,
      deliveryCharge: 0,
      otherCharge: 0,
      total: 100000,
      paymentStatus: 'paid' as const,
    };
    const result = periodProfit({
      orders: [
        { ...base, id: 'a', status: 'delivered' as const },
        { ...base, id: 'b', status: 'cancelled' as const },
      ] as never[],
      expenses: [],
      courierRecords: [],
      refundsByOrderId: new Map(),
      courierCostByOrderId: new Map(),
    });
    expect(result.grossSales).toBe(100000); // only the delivered one
    expect(result.estimatedProfit).toBe(40000);
  });
});

describe('stock valuation', () => {
  it('values stock at weighted average cost and updates on purchase', async () => {
    const product = await seedProductWithStock(10, '400', '700'); // 10 × 400
    let valuation = await stockValuation();
    expect(valuation.totalQuantity).toBe(10);
    expect(valuation.totalValue).toBe(400000);

    // Buy 10 more at 500 → average cost becomes 450.
    await adjustStock({ productId: product.id, variantId: null, quantity: 10, type: 'purchase', unitCost: tk('500'), reason: '' });

    valuation = await stockValuation();
    expect(valuation.totalQuantity).toBe(20);
    expect(valuation.totalValue).toBe(900000);

    const row = (await stockRows()).find((r) => r.product.id === product.id)!;
    expect(row.quantity).toBe(20);
    expect(row.avgCost).toBe(45000);
  });

  it('a sale reduces quantity and value at the average cost', async () => {
    const product = await seedProductWithStock(20, '400', '700');
    await adjustStock({ productId: product.id, variantId: null, quantity: -5, type: 'sale', unitCost: tk('400'), reason: '' });

    const row = (await stockRows()).find((r) => r.product.id === product.id)!;
    expect(row.quantity).toBe(15);
    expect(row.value).toBe(600000);
    expect(row.avgCost).toBe(40000); // unchanged by a sale
  });

  it('selling what is not there is refused unless negative stock is allowed', async () => {
    const product = await seedProductWithStock(2, '400', '700');
    await expect(
      adjustStock({ productId: product.id, variantId: null, quantity: -5, type: 'sale', unitCost: tk('400'), reason: '' }),
    ).rejects.toThrow();
    const row = (await stockRows()).find((r) => r.product.id === product.id)!;
    expect(row.quantity).toBe(2);
  });
});

describe('recalculation is idempotent', () => {
  it('recomputing an order does not move its total', async () => {
    const product = await seedProductWithStock(10);
    const order = await createOrder(
      orderInput({ status: 'confirmed', items: [line(product.id, 3, '700', '400')], deliveryCharge: tk('60') }),
    );
    const first = order.total;
    expect(recalcOrderFinancials({ ...order }).total).toBe(first);
    expect(recalcOrderFinancials({ ...recalcOrderFinancials({ ...order }) }).total).toBe(first);
    // 3 × 700 = 2,100 + 60 delivery = 2,160
    expect(first).toBe(216000);
  });
});
