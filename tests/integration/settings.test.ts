import { describe, expect, it } from 'vitest';
import { getSettings, nextNumber, peekNumber, resetSettings, updateSettings } from '@/services/settingsService';
import { createOrder } from '@/services/orderService';
import { line, orderInput, seedProductWithStock } from '../helpers/factories';
import { db } from '@/db/db';

describe('settings', () => {
  it('seeds defaults on first read', async () => {
    const settings = await getSettings();
    expect(settings.id).toBe('app');
    expect(settings.currency.code).toBe('BDT');
    expect(settings.locale.timeZone).toBe('Asia/Dhaka');
    expect(settings.order.prefix).toBe('ORD');
    expect(settings.order.stockCommitStatuses).toContain('confirmed');
    expect(settings.onboardingCompleted).toBe(false);
  });

  it('merges a partial update without wiping other sections', async () => {
    await updateSettings({ business: { name: 'রিমা কালেকশন' } as never });
    const settings = await getSettings();
    expect(settings.business.name).toBe('রিমা কালেকশন');
    // Untouched sections keep their defaults.
    expect(settings.currency.code).toBe('BDT');
    expect(settings.invoice.prefix).toBe('INV');
  });

  it('allocates document numbers without collisions', async () => {
    const product = await seedProductWithStock(50, '400', '700');
    const seen = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const order = await createOrder(orderInput({ items: [line(product.id, 1, '700')] }));
      expect(seen.has(order.orderNumber)).toBe(false);
      seen.add(order.orderNumber);
    }
    expect(seen.size).toBe(5);
    expect([...seen][0]).toMatch(/^ORD-0000\d$/);
  });

  it('honours a custom prefix and counter', async () => {
    const product = await seedProductWithStock(50, '400', '700');
    await updateSettings({ order: { ...(await getSettings()).order, prefix: 'FB', nextNumber: 100 } });
    expect(await peekNumber('order')).toBe('FB-00100');
    const order = await createOrder(orderInput({ items: [line(product.id, 1, '700')] }));
    expect(order.orderNumber).toBe('FB-00100');
    expect(await peekNumber('order')).toBe('FB-00101');
  });

  it('keeps numbering monotonic even after a settings reset to a lower counter', async () => {
    await updateSettings({ order: { ...(await getSettings()).order, nextNumber: 1 } });
    const product = await seedProductWithStock(50, '400', '700');
    const first = await createOrder(orderInput({ items: [line(product.id, 1, '700')] }));
    // A user lowering the counter to 1 must not create a duplicate: the create fails loudly.
    await updateSettings({ order: { ...(await getSettings()).order, nextNumber: 1 } });
    await expect(createOrder(orderInput({ items: [line(product.id, 1, '700')] }))).rejects.toThrow();
    expect((await db.orders.toArray()).filter((o) => o.orderNumber === first.orderNumber)).toHaveLength(1);
  });

  it('resetSettings restores factory defaults', async () => {
    await updateSettings({ business: { name: 'পরিবর্তিত' } as never });
    const reset = await resetSettings();
    expect(reset.business.name).toBe('');
    expect(reset.order.prefix).toBe('ORD');
  });

  it('nextNumber allocates invoice/return/expense sequences', async () => {
    const current = await getSettings();
    const invoice = await nextNumber('invoice');
    expect(invoice.value.startsWith(current.invoice.prefix)).toBe(true);
    const returns = await nextNumber('return');
    expect(returns.value.startsWith('RET-')).toBe(true);
    const expense = await nextNumber('expense');
    expect(expense.value.startsWith('EXP-')).toBe(true);
  });
});
