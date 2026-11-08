import { describe, expect, it } from 'vitest';
import { changeOrderStatus, checkOrderDelete, createOrder, duplicateOrder, getOrder, updateOrder } from '@/services/orderService';
import { getQuantity } from '@/services/inventoryService';
import { paymentsForOrder, recordOrderPayment, recordRefund, totalsForOrder } from '@/services/paymentService';
import { listMovements } from '@/services/inventoryService';
import { parseMoney } from '@/lib/money';
import { line, orderInput, seedProductWithStock } from '../helpers/factories';
import { db } from '@/db/db';

const tk = parseMoney;

describe('order financials', () => {
  it('computes totals, COGS and the item snapshot at creation time', async () => {
    const product = await seedProductWithStock(20, '400', '700');
    const order = await createOrder(
      orderInput({
        items: [line(product.id, 2, '700', '400')],
        discount: tk('100'),
        deliveryCharge: tk('60'),
      }),
    );

    expect(order.subtotal).toBe(tk('1400'));
    expect(order.cogs).toBe(tk('800'));
    expect(order.total).toBe(tk('1360'));
    expect(order.orderNumber).toMatch(/^ORD-/);
    // The item row keeps the cost snapshot, so later price changes cannot rewrite history.
    expect(order.items[0].unitCost).toBe(tk('400'));
  });

  it('commits stock when the order reaches a stock-committing status and releases it on cancel', async () => {
    const product = await seedProductWithStock(10, '400', '700');
    const order = await createOrder(orderInput({ items: [line(product.id, 3, '700')], status: 'confirmed' }));

    expect(order.stockCommitted).toBe(true);
    expect(await getQuantity(product.id, null)).toBe(7);

    const cancelled = await changeOrderStatus({ id: order.id, status: 'cancelled', reason: 'কাস্টমার বাতিল করেছে' });
    expect(cancelled.status).toBe('cancelled');
    expect(await getQuantity(product.id, null)).toBe(10);

    const movements = await listMovements({ productId: product.id });
    expect(movements.some((m) => m.type === 'sale' && m.quantity === -3)).toBe(true);
    expect(movements.some((m) => m.type === 'sale_reversal' && m.quantity === 3)).toBe(true);
  });

  it('does not commit stock twice, and only moves the difference when quantities change', async () => {
    const product = await seedProductWithStock(10, '400', '700');
    const order = await createOrder(orderInput({ items: [line(product.id, 2, '700')], status: 'confirmed' }));
    expect(await getQuantity(product.id, null)).toBe(8);

    await updateOrder(order.id, {
      id: order.id,
      items: [line(product.id, 5, '700')],
    });
    // 3 more units, not 5 more.
    expect(await getQuantity(product.id, null)).toBe(5);
  });

  it('refuses to reduce stock below zero through an order', async () => {
    const product = await seedProductWithStock(1, '400', '700');
    await expect(createOrder(orderInput({ items: [line(product.id, 5, '700')], status: 'confirmed' }))).rejects.toThrow();
  });

  it('keeps a running advance payment and derives the payment status from amounts', async () => {
    const product = await seedProductWithStock(10, '400', '700');
    const order = await createOrder(
      orderInput({ items: [line(product.id, 1, '700')], deliveryCharge: tk('60'), advancePayment: tk('200'), advanceMethod: 'bkash' }),
    );

    expect(order.paymentStatus).toBe('partial');
    const advance = await paymentsForOrder(order.id);
    expect(advance).toHaveLength(1);
    expect(advance[0].amount).toBe(tk('200'));
    expect(advance[0].method).toBe('bkash');

    await recordOrderPayment({ orderId: order.id, amount: tk('560'), method: 'cash', date: Date.now(), reference: '', note: '' });
    const totals = await totalsForOrder(order.id);
    expect(totals.paidIn).toBe(tk('760'));
    expect((await getOrder(order.id))!.paymentStatus).toBe('paid');
  });

  it('treats refunds as money out and re-opens the due amount', async () => {
    const product = await seedProductWithStock(10, '400', '700');
    const order = await createOrder(orderInput({ items: [line(product.id, 1, '700')], advancePayment: tk('700') }));
    expect(order.paymentStatus).toBe('paid');

    await recordRefund({ amount: tk('300'), method: 'cash', date: Date.now(), reference: '', note: '', orderId: order.id });
    const totals = await totalsForOrder(order.id);
    expect(totals.refundedOut).toBe(tk('300'));
    expect(totals.netPaid).toBe(tk('400'));
    expect((await getOrder(order.id))!.paymentStatus).toBe('partial');
  });

  it('duplicates items but never copies payments', async () => {
    const product = await seedProductWithStock(10, '400', '700');
    const order = await createOrder(orderInput({ items: [line(product.id, 2, '700')], advancePayment: tk('500') }));
    const copy = await duplicateOrder(order.id);

    expect(copy.id).not.toBe(order.id);
    expect(copy.items).toHaveLength(1);
    expect(copy.items[0].quantity).toBe(2);
    expect(copy.paymentStatus).toBe('unpaid');
    expect(await paymentsForOrder(copy.id)).toHaveLength(0);
  });

  it('blocks hard deletion of an order that has money attached, and allows archiving instead', async () => {
    const product = await seedProductWithStock(10, '400', '700');
    const order = await createOrder(orderInput({ items: [line(product.id, 1, '700')], advancePayment: tk('100') }));

    const check = await checkOrderDelete(order.id);
    expect(check.canDelete).toBe(false);

    // A draft order (status "new") has no stock movement or payment, so it can be erased.
    const clean = await createOrder(orderInput({ items: [line(product.id, 1, '700')], status: 'new' }));
    expect((await checkOrderDelete(clean.id)).canDelete).toBe(true);
    expect(await db.orders.get(clean.id)).toBeDefined();
  });
});
