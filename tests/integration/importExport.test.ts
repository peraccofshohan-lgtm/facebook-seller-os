import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_IMPORT_FIELDS,
  PRODUCT_IMPORT_FIELDS,
  autoMapColumns,
  commitCustomerImport,
  commitProductImport,
  exportCustomersCsv,
  exportOrdersCsv,
  exportProductsCsv,
  exportStockMovementsCsv,
  previewCustomerImport,
  previewProductImport,
  readCsv,
} from '@/services/importExportService';
import { createProduct } from '@/services/productService';
import { adjustStock } from '@/services/inventoryService';
import { createOrder } from '@/services/orderService';
import { parseCsv } from '@/lib/csv';
import { parseMoney } from '@/lib/money';
import { db } from '@/db/db';
import { line, orderInput, seedProductWithStock } from '../helpers/factories';

const tk = parseMoney;

describe('CSV export', () => {
  it('exports products with a Bengali header and a UTF-8 BOM', async () => {
    await createProduct(
      {
        name: 'টি-শার্ট, সাদা',
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
      { openingStock: 0 },
    );

    const csv = await exportProductsCsv();
    expect(csv.startsWith('﻿')).toBe(true);
    const table = parseCsv(csv);
    expect(table[0][0]).toMatch(/[া-৿]/); // Bengali header
    // The comma inside the product name must survive a parse round-trip.
    expect(table[1].some((cell) => cell === 'টি-শার্ট, সাদা')).toBe(true);
    expect(table[1].length).toBe(table[0].length);
  });

  it('exports every row, not a truncated sample', async () => {
    const product = await seedProductWithStock(100, '400', '700');
    for (let i = 0; i < 5; i += 1) {
      await createOrder(orderInput({ items: [line(product.id, 1, '700')] }));
    }
    const csv = await exportOrdersCsv();
    const table = parseCsv(csv);
    expect(table.length).toBe(6); // header + 5 orders
  });

  it('exports stock movements with signed quantities', async () => {
    const product = await seedProductWithStock(10, '400', '700');
    await adjustStock({ productId: product.id, variantId: null, quantity: -4, type: 'sale' });
    const csv = await exportStockMovementsCsv();
    const table = parseCsv(csv);
    expect(table.length).toBe(3);
    expect(table.slice(1).some((row) => row.join(' ').includes('-4'))).toBe(true);
  });

  it('exports customers', async () => {
    await db.customers.add({
      id: 'c1',
      code: 'C0001',
      name: 'রিমা',
      phone: '01712345678',
      altPhone: '',
      address: 'টাঙ্গাইল',
      district: '',
      area: '',
      notes: '',
      tags: ['ভিআইপি'],
      status: 'active',
      lastOrderAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archivedAt: null,
    });
    const csv = await exportCustomersCsv();
    expect(parseCsv(csv)[1]).toContain('রিমা');
  });
});

describe('CSV import', () => {
  it('auto-maps Bengali and English headers', () => {
    const mapping = autoMapColumns(['নাম', 'বিক্রয়মূল্য', 'ক্রয়মূল্য', 'এসকেইউ'], PRODUCT_IMPORT_FIELDS);
    expect(mapping.name).toBe(0);
    expect(mapping.sellingPrice).toBe(1);
    expect(mapping.costPrice).toBe(2);
    expect(mapping.sku).toBe(3);
  });

  it('previews rows with per-row Bengali errors and never imports silently', async () => {
    const csv = [
      'name,sellingPrice,costPrice',
      'টি-শার্ট,700,400',
      ',500,300', // no name
      'হিজাব,abc,200', // bad price
    ].join('\n');

    const preview = readCsv(csv);
    const mapping = autoMapColumns(preview.headers, PRODUCT_IMPORT_FIELDS);
    const result = await previewProductImport(preview, mapping);

    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].errors).toHaveLength(0);
    expect(result.rows[1].errors.length).toBeGreaterThan(0);
    expect(result.rows[2].errors.length).toBeGreaterThan(0);
    expect(result.rows[1].errors.join(' ')).toMatch(/[া-৿]/);
    expect(result.errorCount).toBe(2);

    // Nothing was written to the database by the preview.
    expect(await db.products.count()).toBe(0);
  });

  it('commits only the valid rows and reports the rest', async () => {
    const csv = ['name,sellingPrice,costPrice,sku', 'টি-শার্ট,700,400,TS-1', ',500,300,TS-2', 'হিজাব,300,150,TS-3'].join('\n');
    const preview = readCsv(csv);
    const mapping = autoMapColumns(preview.headers, PRODUCT_IMPORT_FIELDS);
    const { rows } = await previewProductImport(preview, mapping);

    const result = await commitProductImport(rows);
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(1);
    expect(await db.products.count()).toBe(2);
    const stored = await db.products.toArray();
    expect(stored.find((p) => p.sku === 'TS-1')?.sellingPrice).toBe(tk('700'));
  });

  it('marks existing SKUs as updates instead of duplicating them', async () => {
    await createProduct(
      {
        name: 'পুরনো নাম',
        sku: 'TS-1',
        description: '',
        categoryId: null,
        brand: '',
        costPrice: tk('300'),
        sellingPrice: tk('500'),
        discountPrice: null,
        unit: 'পিস',
        barcode: '',
        imageDataUrl: null,
        hasVariants: false,
        lowStockThreshold: 5,
        isActive: true,
      },
      { openingStock: 0 },
    );

    const csv = ['name,sellingPrice,costPrice,sku', 'নতুন নাম,900,450,TS-1'].join('\n');
    const preview = readCsv(csv);
    const { rows } = await previewProductImport(preview, autoMapColumns(preview.headers, PRODUCT_IMPORT_FIELDS));
    expect(rows[0].action).toBe('update');

    const result = await commitProductImport(rows);
    expect(result.updated).toBe(1);
    expect(await db.products.count()).toBe(1);
    const stored = await db.products.toArray();
    expect(stored[0].name).toBe('নতুন নাম');
    expect(stored[0].sellingPrice).toBe(tk('900'));
  });

  it('imports customers and normalises their phone numbers', async () => {
    const csv = ['name,phone,address', 'রিমা,+88 01712-345678,টাঙ্গাইল', 'করিম,01711111111,ঢাকা'].join('\n');
    const preview = readCsv(csv);
    const { rows } = await previewCustomerImport(preview, autoMapColumns(preview.headers, CUSTOMER_IMPORT_FIELDS));
    const result = await commitCustomerImport(rows);

    expect(result.created).toBe(2);
    const customers = await db.customers.toArray();
    expect(customers.find((c) => c.name === 'রিমা')?.phone).toBe('01712345678');
  });

  it('rejects a duplicate phone inside the same file as a warning, not a silent overwrite', async () => {
    const csv = ['name,phone', 'রিমা,01712345678', 'রিমা আক্তার,01712345678'].join('\n');
    const preview = readCsv(csv);
    const { rows } = await previewCustomerImport(preview, autoMapColumns(preview.headers, CUSTOMER_IMPORT_FIELDS));
    expect(rows[1].warnings.length + rows[1].errors.length).toBeGreaterThan(0);
  });
});
