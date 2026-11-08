import { describe, expect, it } from 'vitest';
import { cancelReturn, createReturn, refundsByOrder, returnSummary, returnsForOrder } from '@/services/returnService';
import { createOrder } from '@/services/orderService';
import { getQuantity, listMovements } from '@/services/inventoryService';
import { totalsForOrder } from '@/services/paymentService';
import { parseMoney } from '@/lib/money';
import { fromDateInputValue } from '@/lib/date';
import { line, orderInput, seedProductWithStock } from '../helpers/factories';
import type { ReturnInput } from '@/domain/schemas';

const tk = parseMoney;

async function seedOrder() {
  const product = await seedProductWithStock(20, '400', '700');
  const order = await createOrder(
    orderInput({ items: [line(product.id, 5, '700', '400')], deliveryCharge: tk('60'), status: 'confirmed' }),
  );
  return { product, order };
}

function returnInput(orderId: string, itemId: string, quantity: number, restock = true): ReturnInput {
  return {
    orderId,
    type: 'return',
    date: fromDateInputValue('2026-11-08') ?? Date.now(),
    reason: 'size_issue',
    condition: 'resellable',
    items: [
      {
        orderItemId: itemId,
        productId: null,
        variantId: null,
        name: 'পণ্য',
        sku: '',
        quantity,
        unitPrice: tk('700'),
        refundAmount: tk('700') * quantity,
        restock,
        replacementProductId: null,
        replacementVariantId: null,
        replacementQuantity: 0,
      },
    ],
    courierFee: 0,
    note: '',
  } as ReturnInput;
}

describe('returns and refunds', () => {
  it('restocks resellable items and records the refund', async () => {
    const { product, order } = await seedOrder();
    expect(await getQuantity(product.id, null)).toBe(15);

    const record = await createReturn(returnInput(order.id, order.items[0].id, 2));
    expect(record.type).toBe('return');

    // Stock goes back up by the returned quantity only.
    expect(await getQuantity(product.id, null)).toBe(17);
    expect((await listMovements({ productId: product.id })).some((m) => m.type === 'return_in' && m.quantity === 2)).toBe(true);

    const refunds = await refundsByOrder();
    expect(refunds.get(order.id)).toBe(tk('1400'));

    const totals = await totalsForOrder(order.id);
    expect(totals.refundedOut).toBe(tk('1400'));
  });

  it('does not restock when the item came back damaged', async () => {
    const { product, order } = await seedOrder();
    await createReturn(returnInput(order.id, order.items[0].id, 3, false));
    expect(await getQuantity(product.id, null)).toBe(15);
  });

  it('never allows returning more than was ordered', async () => {
    const { order } = await seedOrder();
    await expect(createReturn(returnInput(order.id, order.items[0].id, 99))).rejects.toThrow();
    expect((await returnsForOrder(order.id)).length).toBe(0);
  });

  it('voiding a return reverses the refund and the restock', async () => {
    const { product, order } = await seedOrder();
    const record = await createReturn(returnInput(order.id, order.items[0].id, 2));
    expect(await getQuantity(product.id, null)).toBe(17);

    await cancelReturn(record.id, 'ভুল এন্ট্রি');
    expect(await getQuantity(product.id, null)).toBe(15);
    expect((await refundsByOrder()).get(order.id) ?? 0).toBe(0);
  });

  it('summarises returns with real numbers', async () => {
    const { order } = await seedOrder();
    await createReturn(returnInput(order.id, order.items[0].id, 1));
    const summary = await returnSummary();
    expect(summary.count).toBe(1);
    expect(summary.refunded).toBe(tk('700'));
    expect(summary.restockedUnits).toBe(1);
    expect(summary.writtenOffUnits).toBe(0);
  });
});
