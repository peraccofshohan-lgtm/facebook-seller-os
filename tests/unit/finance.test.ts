import { describe, expect, it } from 'vitest';
import { computeLineTotal, computeOrderTotals, derivePaymentStatus, dueAmount, isOpenStatus } from '@/finance/orderTotals';
import { courierCostOf, courierNetPayable, orderProfit } from '@/finance/profit';
import { parseMoney } from '@/lib/money';
import type { CourierRecord, Order, OrderItem } from '@/domain/types';

const tk = parseMoney;

function item(partial: Partial<OrderItem> & Pick<OrderItem, 'unitPrice' | 'quantity'>): OrderItem {
  return {
    id: partial.id ?? 'i1',
    productId: null,
    variantId: null,
    name: partial.name ?? 'পণ্য',
    sku: '',
    unit: 'পিস',
    unitCost: 0,
    discount: 0,
    lineTotal: 0,
    ...partial,
  } as OrderItem;
}

describe('computeOrderTotals', () => {
  it('adds line totals and then applies discount, delivery and other charges', () => {
    const totals = computeOrderTotals({
      items: [item({ unitPrice: tk('500'), quantity: 2, unitCost: tk('300') }), item({ unitPrice: tk('1200'), quantity: 1, unitCost: tk('800'), discount: tk('100') })],
      discount: tk('50'),
      deliveryCharge: tk('60'),
      otherCharge: tk('20'),
    });

    // 2×500 + (1200 − 100) = 2100
    expect(totals.subtotal).toBe(tk('2100'));
    expect(totals.netSales).toBe(tk('2050'));
    expect(totals.total).toBe(tk('2130'));
    // COGS: 2×300 + 800
    expect(totals.cogs).toBe(tk('1400'));
    expect(totals.itemCount).toBe(3);
  });

  it('never lets a discount exceed the subtotal silently — it simply reduces net sales', () => {
    const totals = computeOrderTotals({ items: [item({ unitPrice: tk('100'), quantity: 1 })], discount: tk('150') });
    expect(totals.netSales).toBe(tk('-50'));
    expect(totals.total).toBe(tk('-50'));
  });

  it('computes line totals from unit price × quantity − discount', () => {
    expect(computeLineTotal({ unitPrice: tk('250.50'), quantity: 3, discount: tk('1.50') })).toBe(tk('750'));
  });
});

describe('derivePaymentStatus', () => {
  it('classifies orders by amounts rather than stored flags', () => {
    expect(derivePaymentStatus(tk('1000'), 0, 0)).toBe('unpaid');
    expect(derivePaymentStatus(tk('1000'), tk('400'), 0)).toBe('partial');
    expect(derivePaymentStatus(tk('1000'), tk('1000'), 0)).toBe('paid');
    expect(derivePaymentStatus(tk('1000'), tk('1200'), 0)).toBe('overpaid');
    expect(derivePaymentStatus(tk('1000'), tk('1000'), tk('1000'))).toBe('refunded');
    expect(derivePaymentStatus(0, 0, 0)).toBe('paid');
  });

  it('computes the outstanding due amount', () => {
    expect(dueAmount(tk('1000'), tk('400'), 0)).toBe(tk('600'));
    expect(dueAmount(tk('1000'), tk('1400'), 0)).toBe(0);
  });
});

describe('orderProfit', () => {
  const baseOrder = {
    subtotal: tk('2000'),
    discount: tk('100'),
    cogs: tk('1200'),
    deliveryCharge: tk('60'),
    otherCharge: 0,
    total: tk('1960'),
    status: 'delivered',
    paymentStatus: 'paid',
  } as unknown as Order;

  it('treats delivery charge as a pass-through, not sales or profit', () => {
    const p = orderProfit(baseOrder);
    expect(p.grossSales).toBe(tk('2000'));
    expect(p.netSales).toBe(tk('1900'));
    expect(p.grossProfit).toBe(tk('700'));
    expect(p.customerCharges).toBe(tk('60'));
    // Delivery charge is NOT added to profit; only courier cost is subtracted.
    expect(p.estimatedProfit).toBe(tk('700'));
  });

  it('subtracts real courier cost and refunds', () => {
    const p = orderProfit(baseOrder, { courierCost: tk('120'), refunds: tk('200') });
    expect(p.estimatedProfit).toBe(tk('380'));
  });

  it('only counts profit as realized when the order is delivered AND fully paid', () => {
    expect(orderProfit({ ...baseOrder, status: 'shipped' } as Order).isRealized).toBe(false);
    expect(orderProfit({ ...baseOrder, paymentStatus: 'partial' } as Order).isRealized).toBe(false);
    expect(orderProfit({ ...baseOrder, paymentStatus: 'overpaid' } as Order).isRealized).toBe(true);
    const p = orderProfit(baseOrder, { courierCost: tk('120') });
    expect(p.realizedProfit).toBe(tk('580'));
  });
});

describe('courier money', () => {
  const record = {
    codAmount: tk('1500'),
    collectedAmount: tk('1500'),
    deliveryCharge: tk('60'),
    courierFee: tk('30'),
    returnFee: 0,
    adjustment: tk('10'),
    status: 'delivered',
  } as unknown as CourierRecord;

  it('adds every fee the business bears', () => {
    expect(courierCostOf(record)).toBe(tk('100'));
  });

  it('nets collection against fees', () => {
    expect(courierNetPayable(record)).toBe(tk('1400'));
  });

  it('shows only the cost for returned/lost consignments', () => {
    // Returned: nothing collected, so the business only bears 60 + 30 + 60 + 10 = 160.
    expect(courierNetPayable({ ...record, status: 'returned', collectedAmount: 0, returnFee: tk('60') } as CourierRecord)).toBe(tk('-160'));
  });
});

describe('isOpenStatus', () => {
  it('is true only while there is work left on the order', () => {
    expect(isOpenStatus('new')).toBe(true);
    expect(isOpenStatus('shipped')).toBe(true);
    expect(isOpenStatus('delivered')).toBe(false);
    expect(isOpenStatus('cancelled')).toBe(false);
    expect(isOpenStatus('returned')).toBe(false);
  });
});
