import { beforeEach, describe, expect, it } from 'vitest';
import {
  archiveProduct,
  checkHardDelete,
  createProduct,
  createVariant,
  deleteVariant,
  effectiveCost,
  effectivePrice,
  findBySku,
  getProduct,
  hardDeleteProduct,
  isSkuTaken,
  listProducts,
  listVariants,
  restoreProduct,
  updateProduct,
  updateVariant,
} from '@/services/productService';
import { adjustStock, stockRows } from '@/services/inventoryService';
import { parseMoney } from '@/lib/money';
import { db } from '@/db/db';
import { seedProduct } from '../helpers/factories';

const tk = parseMoney;

describe('products', () => {
  beforeEach(async () => {
    await db.products.clear();
    await db.productVariants.clear();
    await db.stockLevels.clear();
    await db.stockMovements.clear();
  });

  it('creates a product and keeps the price exactly as entered', async () => {
    const product = await createProduct(
      {
        name: 'টি-শার্ট',
        sku: 'TS-1',
        description: '',
        categoryId: null,
        brand: '',
        costPrice: tk('400'),
        sellingPrice: tk('700'),
        discountPrice: null,
        unit: 'পিস',
        barcode: '',
        imageDataUrl: null,
        hasVariants: false,
        lowStockThreshold: 5,
        isActive: true,
      },
      { openingStock: 12 },
    );

    expect(product.costPrice).toBe(40000);
    expect(product.sellingPrice).toBe(70000);

    const rows = await stockRows();
    expect(rows.find((row) => row.product.id === product.id)?.quantity).toBe(12);
  });

  it('refuses a duplicate SKU', async () => {
    await seedProduct({ sku: 'TS-1' });
    await expect(isSkuTaken('TS-1')).resolves.toBe(true);
    await expect(isSkuTaken('TS-2')).resolves.toBe(false);
    await expect(findBySku('TS-1')).resolves.toBeDefined();

    await expect(
      createProduct(
        {
          name: 'আরেকটি',
          sku: 'TS-1',
          description: '',
          categoryId: null,
          brand: '',
          costPrice: 1,
          sellingPrice: 2,
          discountPrice: null,
          unit: 'পিস',
          barcode: '',
          imageDataUrl: null,
          hasVariants: false,
          lowStockThreshold: 5,
          isActive: true,
        },
        {},
      ),
    ).rejects.toThrow(/TS-1/);
  });

  it('edits a product and searches it by name, SKU and brand', async () => {
    const product = await seedProduct({ name: 'কটন টি-শার্ট', sku: 'CT-9' });
    await updateProduct(product.id, { name: 'প্রিমিয়াম টি-শার্ট', brand: 'Rima' });

    const updated = await getProduct(product.id);
    expect(updated?.name).toBe('প্রিমিয়াম টি-শার্ট');
    expect(updated?.brand).toBe('Rima');

    await expect(listProducts({ query: 'প্রিমিয়াম' })).resolves.toMatchObject({ total: 1 });
    await expect(listProducts({ query: 'ct-9' })).resolves.toMatchObject({ total: 1 });
    await expect(listProducts({ query: 'rima' })).resolves.toMatchObject({ total: 1 });
    await expect(listProducts({ query: 'কিছুই না' })).resolves.toMatchObject({ total: 0 });
  });

  it('archiving hides a product from new orders but keeps its history', async () => {
    const product = await seedProduct();
    await archiveProduct(product.id);
    expect((await getProduct(product.id))?.archivedAt).not.toBeNull();
    // `archived: false` (the default) means "not archived"; `archived: true` lists only archived.
    await expect(listProducts()).resolves.toMatchObject({ total: 0 });
    await expect(listProducts({ archived: true })).resolves.toMatchObject({ total: 1 });
    // The row itself is never destroyed by archiving.
    expect(await db.products.get(product.id)).toBeDefined();

    await restoreProduct(product.id);
    expect((await getProduct(product.id))?.archivedAt).toBeNull();
  });

  it('only allows hard delete when nothing references the product', async () => {
    const fresh = await seedProduct();
    const check1 = await checkHardDelete(fresh.id);
    expect(check1.canDelete).toBe(true);
    await hardDeleteProduct(fresh.id);
    expect(await db.products.get(fresh.id)).toBeUndefined();

    const sold = await seedProduct();
    await adjustStock({ productId: sold.id, variantId: null, quantity: 5, type: 'purchase', unitCost: 40000, reason: '' });
    const check2 = await checkHardDelete(sold.id);
    expect(check2.canDelete).toBe(false);
    expect(check2.movementCount).toBeGreaterThan(0);
    expect(check2.reason).toBeTruthy();
    await expect(hardDeleteProduct(sold.id)).rejects.toThrow();
  });

  it('tracks per-variant price and stock separately', async () => {
    const product = await seedProduct();
    await updateProduct(product.id, { hasVariants: true });

    const red = await createVariant({
      productId: product.id,
      sku: 'TS-RED',
      label: 'লাল / L',
      size: 'L',
      color: 'লাল',
      weight: '',
      custom: '',
      costPrice: tk('420'),
      sellingPrice: tk('750'),
      isActive: true,
    });
    await createVariant({
      productId: product.id,
      sku: 'TS-BLU',
      label: 'নীল / M',
      size: 'M',
      color: 'নীল',
      weight: '',
      custom: '',
      costPrice: tk('430'),
      sellingPrice: tk('780'),
      isActive: true,
    });

    expect(await listVariants(product.id)).toHaveLength(2);
    await adjustStock({ productId: product.id, variantId: red.id, quantity: 4, type: 'purchase', unitCost: tk('420'), reason: '' });

    const rows = await stockRows();
    const redRow = rows.find((row) => row.variantId === red.id);
    expect(redRow?.quantity).toBe(4);

    // Effective price/cost use the variant when there is one.
    const full = await getProduct(product.id);
    expect(effectivePrice(full!, red)).toBe(tk('750'));
    expect(effectiveCost(full!, red)).toBe(tk('420'));
    expect(effectivePrice(full!, null)).toBe(tk('700'));

    await updateVariant(red.id, { sellingPrice: tk('800') });
    expect((await listVariants(product.id)).find((v) => v.id === red.id)?.sellingPrice).toBe(tk('800'));

    // A variant that still holds stock may not be deleted — that would erase
    // stock the seller actually owns.
    await expect(deleteVariant(red.id)).rejects.toThrow(/স্টক/);
    await adjustStock({ productId: product.id, variantId: red.id, quantity: -4, type: 'adjustment', unitCost: tk('420'), reason: 'টেস্ট' });
    await deleteVariant(red.id);
    expect(await listVariants(product.id)).toHaveLength(1);
  });

  it('reports low stock from the product threshold', async () => {
    const product = await seedProduct();
    await updateProduct(product.id, { lowStockThreshold: 5 });
    await adjustStock({ productId: product.id, variantId: null, quantity: 3, type: 'purchase', unitCost: 40000, reason: '' });

    const rows = await stockRows();
    const row = rows.find((r) => r.product.id === product.id);
    expect(row?.quantity).toBe(3);
    expect(row!.quantity <= (row?.product.lowStockThreshold ?? 0)).toBe(true);
  });
});
