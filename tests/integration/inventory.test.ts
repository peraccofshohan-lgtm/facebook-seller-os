import { describe, expect, it } from 'vitest';
import { adjustStock, getQuantity, listMovements, lowStockProducts, rebuildStockLevels, stockRows, stockValuation } from '@/services/inventoryService';
import { updateSettings } from '@/services/settingsService';
import { parseMoney } from '@/lib/money';
import { seedProduct } from '../helpers/factories';

const tk = parseMoney;

describe('stock ledger', () => {
  it('blocks movements that would take stock below zero', async () => {
    const product = await seedProduct();
    await adjustStock({ productId: product.id, variantId: null, quantity: 10, type: 'purchase', unitCost: tk('400') });
    expect(await getQuantity(product.id, null)).toBe(10);

    await expect(adjustStock({ productId: product.id, variantId: null, quantity: -11, type: 'sale' })).rejects.toThrow();

    // The failed movement must not have touched the level or written a movement row.
    expect(await getQuantity(product.id, null)).toBe(10);
    expect((await listMovements({ productId: product.id })).length).toBe(1);
  });

  it('allows negative stock only when the setting is explicitly enabled', async () => {
    const product = await seedProduct();
    await updateSettings({ inventory: { defaultLowStockThreshold: 5, allowNegativeStock: true } });
    await expect(adjustStock({ productId: product.id, variantId: null, quantity: -3, type: 'damage' })).resolves.toBeDefined();
    expect(await getQuantity(product.id, null)).toBe(-3);
    await updateSettings({ inventory: { defaultLowStockThreshold: 5, allowNegativeStock: false } });
  });

  it('tracks a weighted-average cost, not the last purchase price', async () => {
    const product = await seedProduct();
    await adjustStock({ productId: product.id, variantId: null, quantity: 10, type: 'purchase', unitCost: tk('400') });
    await adjustStock({ productId: product.id, variantId: null, quantity: 10, type: 'purchase', unitCost: tk('600') });
    // (10×400 + 10×600) / 20 = 500
    const rows = await stockRows();
    const row = rows.find((r) => r.product.id === product.id && r.variantId === null);
    expect(row?.quantity).toBe(20);
    expect(row?.avgCost).toBe(tk('500'));
    expect(row?.value).toBe(tk('10000'));
  });

  it('does not divide by zero when stock returns to zero and then restocks', async () => {
    const product = await seedProduct();
    await adjustStock({ productId: product.id, variantId: null, quantity: 5, type: 'purchase', unitCost: tk('400') });
    await adjustStock({ productId: product.id, variantId: null, quantity: -5, type: 'sale' });
    // Average cost is kept (not reset to 0) so the next sale still has a COGS basis.
    await adjustStock({ productId: product.id, variantId: null, quantity: 2, type: 'purchase', unitCost: tk('500') });
    const rows = await stockRows();
    const row = rows.find((r) => r.product.id === product.id && r.variantId === null);
    expect(row?.quantity).toBe(2);
    expect(row?.avgCost).toBeGreaterThan(0);
    expect(row?.value).toBe((row?.avgCost ?? 0) * 2);
  });

  it('rebuilds cached levels from the movement history', async () => {
    const product = await seedProduct();
    await adjustStock({ productId: product.id, variantId: null, quantity: 7, type: 'purchase', unitCost: tk('400') });
    await adjustStock({ productId: product.id, variantId: null, quantity: -2, type: 'sale' });

    // Corrupt the cache on purpose, then rebuild.
    const { db } = await import('@/db/db');
    await db.stockLevels.put({ id: `${product.id}::-`, productId: product.id, variantId: null, quantity: 999, avgCost: 0, updatedAt: Date.now() } as never);

    const result = await rebuildStockLevels();
    expect(result.rows).toBeGreaterThan(0);
    expect(await getQuantity(product.id, null)).toBe(5);
  });

  it('values total stock and flags low stock', async () => {
    const product = await seedProduct();
    await adjustStock({ productId: product.id, variantId: null, quantity: 4, type: 'purchase', unitCost: tk('400') });
    const valuation = await stockValuation();
    expect(valuation.totalQuantity).toBe(4);
    expect(valuation.totalValue).toBe(tk('1600'));

    const low = await lowStockProducts();
    expect(low.some((r) => r.product.id === product.id)).toBe(true);
  });
});
