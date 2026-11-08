/**
 * importExportService.ts — CSV export/import and selective JSON export.
 *
 * Export: UTF-8 with BOM (Excel opens Bengali text correctly), safe CSV escaping, and
 * spreadsheet formula-injection protection (any cell starting with = + - @ is quoted).
 *
 * Import: file → rows → column mapping → per-row validation → preview → explicit commit.
 * Nothing is written until `commitImport` is called, and every rejected row is reported
 * with a Bengali reason so the user can fix the file and retry.
 */

import { db } from '@/db/db';
import { nowMs, startOfDay, toDateInputValue } from '@/lib/date';
import { normalizeCsvTable, parseCsv, toCsv } from '@/lib/csv';
import { moneyToDecimalString, parseMoney, toLatinDigits } from '@/lib/money';
import { normalizePhone } from '@/lib/search';
import { randomId } from '@/lib/id';
import { applyMovement } from './inventoryService';
import { getSettings } from './settingsService';
import type { CourierRecord, Customer, Expense, Order, Payment, Product, ProductVariant, StockMovement } from '@/domain/types';

/* ------------------------------------------------------------------ */
/* Generic helpers                                                     */
/* ------------------------------------------------------------------ */

export interface ExportColumn<T> {
  key: string;
  header: string;
  value: (row: T) => string | number;
}

export function buildCsv<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const header = columns.map((c) => c.header);
  const body = rows.map((row) => columns.map((c) => String(c.value(row) ?? '')));
  return toCsv([header, ...body]);
}

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

export interface ProductExportRow {
  name: string;
  sku: string;
  variant: string;
  category: string;
  brand: string;
  unit: string;
  cost: string;
  price: string;
  stock: number;
  threshold: number;
  barcode: string;
  description: string;
}

export async function exportProductsCsv(): Promise<string> {
  const [products, variants, categories, levels] = await Promise.all([
    db.products.toArray(),
    db.productVariants.toArray(),
    db.productCategories.toArray(),
    db.stockLevels.toArray(),
  ]);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const levelMap = new Map(levels.map((l) => [l.id, l]));
  const variantMap = new Map<string, ProductVariant[]>();
  for (const v of variants) {
    const list = variantMap.get(v.productId) ?? [];
    list.push(v);
    variantMap.set(v.productId, list);
  }

  const columns: ExportColumn<ProductExportRow>[] = [
    { key: 'name', header: 'পণ্যের নাম', value: (r) => r.name },
    { key: 'sku', header: 'SKU', value: (r) => r.sku },
    { key: 'variant', header: 'ভ্যারিয়েন্ট', value: (r) => r.variant },
    { key: 'category', header: 'ক্যাটেগরি', value: (r) => r.category },
    { key: 'brand', header: 'ব্র্যান্ড', value: (r) => r.brand },
    { key: 'unit', header: 'একক', value: (r) => r.unit },
    { key: 'cost', header: 'ক্রয়মূল্য', value: (r) => r.cost },
    { key: 'price', header: 'বিক্রয়মূল্য', value: (r) => r.price },
    { key: 'stock', header: 'স্টক', value: (r) => r.stock },
    { key: 'threshold', header: 'সতর্ক সীমা', value: (r) => r.threshold },
    { key: 'barcode', header: 'বারকোড', value: (r) => r.barcode },
    { key: 'description', header: 'বিবরণ', value: (r) => r.description },
  ];

  const rows: ProductExportRow[] = [];
  for (const product of products) {
    if (product.archivedAt) continue;
    const productVariants = variantMap.get(product.id) ?? [];
    if (productVariants.length > 0) {
      for (const variant of productVariants) {
        const level = levelMap.get(`${product.id}::${variant.id}`);
        rows.push({
          name: product.name,
          sku: variant.sku || product.sku,
          variant: variant.label,
          category: categoryName.get(product.categoryId ?? '') ?? '',
          brand: product.brand,
          unit: product.unit,
          cost: moneyToDecimalString(variant.costPrice),
          price: moneyToDecimalString(variant.sellingPrice),
          stock: level?.quantity ?? 0,
          threshold: product.lowStockThreshold,
          barcode: product.barcode,
          description: product.description,
        });
      }
    } else {
      const level = levelMap.get(`${product.id}::-`);
      rows.push({
        name: product.name,
        sku: product.sku,
        variant: '',
        category: categoryName.get(product.categoryId ?? '') ?? '',
        brand: product.brand,
        unit: product.unit,
        cost: moneyToDecimalString(product.costPrice),
        price: moneyToDecimalString(product.sellingPrice),
        stock: level?.quantity ?? 0,
        threshold: product.lowStockThreshold,
        barcode: product.barcode,
        description: product.description,
      });
    }
  }
  return buildCsv(rows, columns);
}

export async function exportCustomersCsv(): Promise<string> {
  const customers = await db.customers.toArray();
  const orders = await db.orders.toArray();
  const columns: ExportColumn<Customer>[] = [
    { key: 'code', header: 'কোড', value: (c) => c.code },
    { key: 'name', header: 'নাম', value: (c) => c.name },
    { key: 'phone', header: 'ফোন', value: (c) => c.phone },
    { key: 'altPhone', header: 'বিকল্প ফোন', value: (c) => c.altPhone },
    { key: 'address', header: 'ঠিকানা', value: (c) => c.address },
    { key: 'district', header: 'জেলা', value: (c) => c.district },
    { key: 'area', header: 'এলাকা', value: (c) => c.area },
    { key: 'tags', header: 'ট্যাগ', value: (c) => c.tags.join(', ') },
    { key: 'status', header: 'স্ট্যাটাস', value: (c) => c.status },
    { key: 'notes', header: 'নোট', value: (c) => c.notes },
    { key: 'orders', header: 'অর্ডার সংখ্যা', value: (c) => orders.filter((o) => o.customerId === c.id).length },
    { key: 'createdAt', header: 'যোগ করা হয়েছে', value: (c) => toDateInputValue(c.createdAt) },
  ];
  return buildCsv(customers.filter((c) => !c.archivedAt), columns);
}

export async function exportOrdersCsv(from?: number | null, to?: number | null): Promise<string> {
  let orders = await db.orders.toArray();
  if (from !== undefined && from !== null) orders = orders.filter((o) => o.orderDate >= from);
  if (to !== undefined && to !== null) orders = orders.filter((o) => o.orderDate < to);
  const payments = await db.payments.toArray();
  const paidByOrder = new Map<string, number>();
  for (const p of payments) {
    if (!p.orderId || p.voidedAt) continue;
    if (p.kind === 'order_payment') paidByOrder.set(p.orderId, (paidByOrder.get(p.orderId) ?? 0) + p.amount);
    if (p.kind === 'order_refund') paidByOrder.set(p.orderId, (paidByOrder.get(p.orderId) ?? 0) - p.amount);
  }
  const columns: ExportColumn<Order>[] = [
    { key: 'orderNumber', header: 'অর্ডার নং', value: (o) => o.orderNumber },
    { key: 'date', header: 'তারিখ', value: (o) => toDateInputValue(o.orderDate) },
    { key: 'customer', header: 'কাস্টমার', value: (o) => o.customerName },
    { key: 'phone', header: 'ফোন', value: (o) => o.customerPhone },
    { key: 'channel', header: 'চ্যানেল', value: (o) => o.channel },
    { key: 'items', header: 'পণ্য', value: (o) => o.items.map((i) => `${i.name} x${i.quantity}`).join('; ') },
    { key: 'subtotal', header: 'সাবটোটাল', value: (o) => moneyToDecimalString(o.subtotal) },
    { key: 'discount', header: 'ছাড়', value: (o) => moneyToDecimalString(o.discount) },
    { key: 'delivery', header: 'ডেলিভারি চার্জ', value: (o) => moneyToDecimalString(o.deliveryCharge) },
    { key: 'total', header: 'মোট', value: (o) => moneyToDecimalString(o.total) },
    { key: 'paid', header: 'পরিশোধ', value: (o) => moneyToDecimalString(paidByOrder.get(o.id) ?? 0) },
    { key: 'due', header: 'বাকি', value: (o) => moneyToDecimalString(Math.max(o.total - (paidByOrder.get(o.id) ?? 0), 0)) },
    { key: 'status', header: 'স্ট্যাটাস', value: (o) => o.status },
    { key: 'paymentStatus', header: 'পেমেন্ট স্ট্যাটাস', value: (o) => o.paymentStatus },
    { key: 'courier', header: 'কুরিয়ার', value: (o) => o.courierName },
    { key: 'tracking', header: 'কনসাইনমেন্ট', value: (o) => o.trackingNumber },
    { key: 'address', header: 'ঠিকানা', value: (o) => o.deliveryAddress },
    { key: 'notes', header: 'নোট', value: (o) => o.notes },
  ];
  return buildCsv(orders.filter((o) => !o.archivedAt).sort((a, b) => b.orderDate - a.orderDate), columns);
}

export async function exportExpensesCsv(from?: number | null, to?: number | null): Promise<string> {
  let expenses = await db.expenses.toArray();
  if (from !== undefined && from !== null) expenses = expenses.filter((e) => e.date >= from);
  if (to !== undefined && to !== null) expenses = expenses.filter((e) => e.date < to);
  const columns: ExportColumn<Expense>[] = [
    { key: 'expenseNumber', header: 'খরচ নং', value: (e) => e.expenseNumber },
    { key: 'date', header: 'তারিখ', value: (e) => toDateInputValue(e.date) },
    { key: 'category', header: 'ক্যাটেগরি', value: (e) => e.categoryName },
    { key: 'amount', header: 'পরিমাণ', value: (e) => moneyToDecimalString(e.amount) },
    { key: 'method', header: 'মাধ্যম', value: (e) => e.method },
    { key: 'payee', header: 'প্রাপক', value: (e) => e.payee },
    { key: 'reference', header: 'রেফারেন্স', value: (e) => e.reference },
    { key: 'description', header: 'বিবরণ', value: (e) => e.description },
    { key: 'voided', header: 'বাতিল', value: (e) => (e.voidedAt ? 'হ্যাঁ' : 'না') },
  ];
  return buildCsv(expenses.sort((a, b) => b.date - a.date), columns);
}

export async function exportCourierCsv(): Promise<string> {
  const records = await db.courierRecords.toArray();
  const columns: ExportColumn<CourierRecord>[] = [
    { key: 'courierName', header: 'কুরিয়ার', value: (r) => r.courierName },
    { key: 'consignmentId', header: 'কনসাইনমেন্ট', value: (r) => r.consignmentId },
    { key: 'orderNumber', header: 'অর্ডার নং', value: (r) => r.orderNumber },
    { key: 'shipmentDate', header: 'পাঠানোর তারিখ', value: (r) => toDateInputValue(r.shipmentDate) },
    { key: 'status', header: 'স্ট্যাটাস', value: (r) => r.status },
    { key: 'codAmount', header: 'COD', value: (r) => moneyToDecimalString(r.codAmount) },
    { key: 'collectedAmount', header: 'আদায়', value: (r) => moneyToDecimalString(r.collectedAmount) },
    { key: 'deliveryCharge', header: 'ডেলিভারি চার্জ', value: (r) => moneyToDecimalString(r.deliveryCharge) },
    { key: 'courierFee', header: 'কুরিয়ার ফি', value: (r) => moneyToDecimalString(r.courierFee) },
    { key: 'returnFee', header: 'রিটার্ন ফি', value: (r) => moneyToDecimalString(r.returnFee) },
    { key: 'payoutDate', header: 'পেআউট তারিখ', value: (r) => (r.payoutDate ? toDateInputValue(r.payoutDate) : '') },
    { key: 'payoutReference', header: 'পেআউট রেফারেন্স', value: (r) => r.payoutReference },
    { key: 'note', header: 'নোট', value: (r) => r.note },
  ];
  return buildCsv(records.sort((a, b) => b.shipmentDate - a.shipmentDate), columns);
}

export async function exportPaymentsCsv(): Promise<string> {
  const [payments, orders] = await Promise.all([db.payments.toArray(), db.orders.toArray()]);
  const orderNumber = new Map(orders.map((o) => [o.id, o.orderNumber]));
  const columns: ExportColumn<Payment>[] = [
    { key: 'date', header: 'তারিখ', value: (p) => toDateInputValue(p.date) },
    { key: 'kind', header: 'ধরন', value: (p) => p.kind },
    { key: 'direction', header: 'দিক', value: (p) => (p.direction === 'in' ? 'জমা' : 'খরচ') },
    { key: 'amount', header: 'পরিমাণ', value: (p) => moneyToDecimalString(p.amount) },
    { key: 'method', header: 'মাধ্যম', value: (p) => p.method },
    { key: 'orderNumber', header: 'অর্ডার নং', value: (p) => (p.orderId ? orderNumber.get(p.orderId) ?? '' : '') },
    { key: 'reference', header: 'রেফারেন্স', value: (p) => p.reference },
    { key: 'note', header: 'নোট', value: (p) => p.note },
    { key: 'voided', header: 'বাতিল', value: (p) => (p.voidedAt ? 'হ্যাঁ' : 'না') },
  ];
  return buildCsv(payments.sort((a, b) => b.date - a.date), columns);
}

export async function exportStockMovementsCsv(limit = 5000): Promise<string> {
  const [movements, products, variants] = await Promise.all([
    db.stockMovements.orderBy('createdAt').reverse().limit(limit).toArray(),
    db.products.toArray(),
    db.productVariants.toArray(),
  ]);
  const productName = new Map(products.map((p) => [p.id, p.name]));
  const variantLabel = new Map(variants.map((v) => [v.id, v.label]));
  const columns: ExportColumn<StockMovement>[] = [
    { key: 'date', header: 'তারিখ', value: (m) => toDateInputValue(m.createdAt) },
    { key: 'product', header: 'পণ্য', value: (m) => productName.get(m.productId) ?? '' },
    { key: 'variant', header: 'ভ্যারিয়েন্ট', value: (m) => (m.variantId ? variantLabel.get(m.variantId) ?? '' : '') },
    { key: 'type', header: 'ধরন', value: (m) => m.type },
    { key: 'quantity', header: 'পরিমাণ', value: (m) => m.quantity },
    { key: 'reason', header: 'কারণ', value: (m) => m.reason },
    { key: 'party', header: 'পক্ষ', value: (m) => m.party },
    { key: 'note', header: 'নোট', value: (m) => m.note },
  ];
  return buildCsv(movements, columns);
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

export interface CsvPreview {
  headers: string[];
  rows: string[][];
}

export function readCsv(text: string): CsvPreview {
  const table = normalizeCsvTable(parseCsv(text));
  if (table.length === 0) return { headers: [], rows: [] };
  const [headers, ...rows] = table;
  return { headers, rows };
}

export interface ImportField {
  key: string;
  label: string;
  aliases: string[];
  required?: boolean;
}

export const PRODUCT_IMPORT_FIELDS: ImportField[] = [
  { key: 'name', label: 'পণ্যের নাম', aliases: ['name', 'product', 'পণ্যের নাম', 'নাম', 'product name', 'পণ্য'], required: true },
  { key: 'sku', label: 'SKU', aliases: ['sku', 'code', 'কোড', 'এসকেইউ', 'এস কে ইউ'] },
  { key: 'category', label: 'ক্যাটেগরি', aliases: ['category', 'ক্যাটেগরি', 'ক্যাটাগরি'] },
  { key: 'brand', label: 'ব্র্যান্ড', aliases: ['brand', 'ব্র্যান্ড'] },
  { key: 'unit', label: 'একক', aliases: ['unit', 'একক'] },
  { key: 'costPrice', label: 'ক্রয়মূল্য', aliases: ['cost', 'costprice', 'purchase', 'ক্রয়মূল্য', 'ক্রয়মূল্য', 'কস্ট'] },
  { key: 'sellingPrice', label: 'বিক্রয়মূল্য', aliases: ['price', 'sellingprice', 'sell', 'মূল্য', 'বিক্রয়মূল্য', 'বিক্রয়মূল্য', 'দাম'] },
  { key: 'stock', label: 'স্টক', aliases: ['stock', 'quantity', 'qty', 'স্টক', 'পরিমাণ'] },
  { key: 'threshold', label: 'সতর্ক সীমা', aliases: ['threshold', 'lowstock', 'সতর্ক সীমা'] },
  { key: 'barcode', label: 'বারকোড', aliases: ['barcode', 'বারকোড'] },
  { key: 'description', label: 'বিবরণ', aliases: ['description', 'details', 'বিবরণ'] },
];

export const CUSTOMER_IMPORT_FIELDS: ImportField[] = [
  { key: 'name', label: 'নাম', aliases: ['name', 'customer', 'নাম', 'কাস্টমার'], required: true },
  { key: 'phone', label: 'ফোন', aliases: ['phone', 'mobile', 'number', 'ফোন', 'মোবাইল'], required: true },
  { key: 'altPhone', label: 'বিকল্প ফোন', aliases: ['altphone', 'alt', 'বিকল্প ফোন'] },
  { key: 'address', label: 'ঠিকানা', aliases: ['address', 'ঠিকানা'] },
  { key: 'district', label: 'জেলা', aliases: ['district', 'জেলা'] },
  { key: 'area', label: 'এলাকা', aliases: ['area', 'upazila', 'thana', 'এলাকা', 'উপজেলা'] },
  { key: 'tags', label: 'ট্যাগ', aliases: ['tags', 'tag', 'ট্যাগ'] },
  { key: 'notes', label: 'নোট', aliases: ['notes', 'note', 'নোট'] },
];

/**
 * Guess a column mapping from header names (Bengali or English, case-insensitive).
 *
 * Two passes are needed because Bengali product words share suffixes: "বিক্রয়মূল্য"
 * (selling price) literally ends with "ক্রয়মূল্য" (cost price), so a naive substring
 * match maps both columns to the first field that claims them. Each column is claimed
 * by exactly one field, and an exact header match always beats a fuzzy one.
 */
export function autoMapColumns(headers: string[], fields: ImportField[]): Record<string, number | null> {
  const normalizedHeaders = headers.map((h) => h.trim().toLowerCase());
  const taken = new Set<number>();
  const mapping: Record<string, number | null> = {};

  const score = (header: string, field: ImportField): number => {
    let best = 0;
    for (const alias of field.aliases) {
      const a = alias.toLowerCase();
      if (header === a) best = Math.max(best, 100);
      else if (header.startsWith(`${a} `) || header.endsWith(` ${a}`)) best = Math.max(best, 60);
      else if (header.includes(a)) best = Math.max(best, 20);
    }
    return best;
  };

  for (const field of fields) {
    let bestIndex = -1;
    let bestScore = 0;
    normalizedHeaders.forEach((header, index) => {
      if (taken.has(index) || !header) return;
      const value = score(header, field);
      if (value > bestScore) {
        bestScore = value;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0 && bestScore > 0) {
      mapping[field.key] = bestIndex;
      taken.add(bestIndex);
    } else {
      mapping[field.key] = null;
    }
  }
  return mapping;
}

export interface ImportRow {
  index: number;
  values: Record<string, string>;
  errors: string[];
  warnings: string[];
  action: 'create' | 'update' | 'skip';
  existingId?: string;
}

export interface ImportPreviewResult {
  rows: ImportRow[];
  validCount: number;
  errorCount: number;
  createCount: number;
  updateCount: number;
}

/**
 * Strict money check for imported cells.
 *
 * `parseMoney` is intentionally forgiving in the UI (it strips ৳, commas and stray
 * characters), but in a bulk import that forgiveness is dangerous: a mistyped "abc"
 * would silently become 0 and the seller would import products with no price.
 * So an import only accepts digits (Latin or Bengali) with at most two decimals.
 */
function importMoney(raw: string, label: string, errors: string[]): number {
  const value = raw.trim();
  if (!value) return 0;
  const cleaned = toLatinDigits(value).replace(/[,\s৳]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    errors.push(`${label} সঠিক নয় (“${raw}”) — শুধু সংখ্যা লিখুন`);
    return 0;
  }
  return parseMoney(cleaned);
}

function importInteger(raw: string, label: string, errors: string[]): number {
  const value = raw.trim();
  if (!value) return 0;
  const cleaned = toLatinDigits(value).replace(/[,\s]/g, '');
  if (!/^-?\d+$/.test(cleaned)) {
    errors.push(`${label} সঠিক নয় (“${raw}”) — শুধু পূর্ণ সংখ্যা লিখুন`);
    return 0;
  }
  return Number(cleaned);
}

function cell(row: string[], mapping: Record<string, number | null>, key: string): string {
  const index = mapping[key];
  if (index === null || index === undefined) return '';
  return (row[index] ?? '').trim();
}

export async function previewProductImport(preview: CsvPreview, mapping: Record<string, number | null>): Promise<ImportPreviewResult> {
  const existingBySku = new Map<string, Product>();
  const existingByName = new Map<string, Product>();
  for (const product of await db.products.toArray()) {
    if (!product.archivedAt) {
      if (product.sku) existingBySku.set(product.sku.toLowerCase(), product);
      existingByName.set(product.name.trim().toLowerCase(), product);
    }
  }
  const seenSku = new Set<string>();

  const rows: ImportRow[] = preview.rows.map((raw, index) => {
    const values: Record<string, string> = {};
    for (const field of PRODUCT_IMPORT_FIELDS) values[field.key] = cell(raw, mapping, field.key);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!values.name) errors.push('পণ্যের নাম নেই');

    const cost = importMoney(values.costPrice, 'ক্রয়মূল্য', errors);
    const price = importMoney(values.sellingPrice, 'বিক্রয়মূল্য', errors);
    const stock = importInteger(values.stock, 'স্টক', errors);
    const threshold = importInteger(values.threshold, 'সতর্ক সীমা', errors);
    if (stock < 0) errors.push('স্টক ঋণাত্মক হতে পারবে না');
    if (threshold < 0) errors.push('সতর্ক সীমা ঋণাত্মক হতে পারবে না');
    if (price < 0 || cost < 0) errors.push('মূল্য ঋণাত্মক হতে পারবে না');

    let existing: Product | undefined;
    if (values.sku) existing = existingBySku.get(values.sku.toLowerCase());
    if (!existing) existing = existingByName.get(values.name.trim().toLowerCase());

    if (values.sku && seenSku.has(values.sku.toLowerCase())) {
      warnings.push('একই SKU ফাইলে একাধিকবার আছে — শেষটি প্রযোজ্য হবে');
    }
    if (values.sku) seenSku.add(values.sku.toLowerCase());
    if (!values.sku) warnings.push('SKU নেই — পরে ডুপ্লিকেট শনাক্ত করা কঠিন হবে');

    return {
      index: index + 2,
      values,
      errors,
      warnings,
      action: errors.length > 0 ? 'skip' : existing ? 'update' : 'create',
      existingId: existing?.id,
    };
  });

  return {
    rows,
    validCount: rows.filter((r) => r.errors.length === 0).length,
    errorCount: rows.filter((r) => r.errors.length > 0).length,
    createCount: rows.filter((r) => r.action === 'create').length,
    updateCount: rows.filter((r) => r.action === 'update').length,
  };
}

export async function previewCustomerImport(preview: CsvPreview, mapping: Record<string, number | null>): Promise<ImportPreviewResult> {
  const existingByPhone = new Map<string, Customer>();
  for (const customer of await db.customers.toArray()) {
    if (!customer.archivedAt && customer.phone) existingByPhone.set(normalizePhone(customer.phone), customer);
  }
  const seenPhone = new Set<string>();

  const rows: ImportRow[] = preview.rows.map((raw, index) => {
    const values: Record<string, string> = {};
    for (const field of CUSTOMER_IMPORT_FIELDS) values[field.key] = cell(raw, mapping, field.key);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!values.name) errors.push('নাম নেই');
    const phone = normalizePhone(values.phone || '');
    if (!phone) errors.push('ফোন নম্বর নেই বা সঠিক নয়');
    else if (!/^01[3-9]\d{8}$/.test(phone)) errors.push('ফোন নম্বর সঠিক নয় (০১৭১২৩৪৫৬৭৮)');

    const existing = phone ? existingByPhone.get(phone) : undefined;
    if (phone && seenPhone.has(phone)) warnings.push('একই ফোন নম্বর ফাইলে একাধিকবার আছে');
    if (phone) seenPhone.add(phone);

    return {
      index: index + 2,
      values,
      errors,
      warnings,
      action: errors.length > 0 ? 'skip' : existing ? 'update' : 'create',
      existingId: existing?.id,
    };
  });

  return {
    rows,
    validCount: rows.filter((r) => r.errors.length === 0).length,
    errorCount: rows.filter((r) => r.errors.length > 0).length,
    createCount: rows.filter((r) => r.action === 'create').length,
    updateCount: rows.filter((r) => r.action === 'update').length,
  };
}

export interface CommitResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export async function commitProductImport(rows: ImportRow[]): Promise<CommitResult> {
  const settings = await getSettings();
  const result: CommitResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  const categories = await db.productCategories.toArray();
  const categoryByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]));

  await db.transaction('rw', db.products, db.stockLevels, db.stockMovements, db.productCategories, async () => {
    for (const row of rows) {
      if (row.action === 'skip') {
        result.skipped += 1;
        continue;
      }
      try {
        let categoryId: string | null = null;
        if (row.values.category) {
          const key = row.values.category.trim().toLowerCase();
          const found = categoryByName.get(key);
          if (found) categoryId = found;
          else {
            const now = nowMs();
            const newId = randomId();
            await db.productCategories.add({ id: newId, name: row.values.category.trim(), description: '', createdAt: now, updatedAt: now, archivedAt: null });
            categoryByName.set(key, newId);
            categoryId = newId;
          }
        }

        const stock = Number((row.values.stock || '0').replace(/[^\d.-]/g, '')) || 0;
        const cost = parseMoney(row.values.costPrice || '0');
        const price = parseMoney(row.values.sellingPrice || '0');
        const now = nowMs();

        if (row.action === 'update' && row.existingId) {
          const existing = await db.products.get(row.existingId);
          if (!existing) {
            result.skipped += 1;
            continue;
          }
          await db.products.put({
            ...existing,
            name: row.values.name || existing.name,
            sku: row.values.sku || existing.sku,
            brand: row.values.brand || existing.brand,
            unit: row.values.unit || existing.unit,
            barcode: row.values.barcode || existing.barcode,
            description: row.values.description || existing.description,
            costPrice: row.values.costPrice ? cost : existing.costPrice,
            sellingPrice: row.values.sellingPrice ? price : existing.sellingPrice,
            lowStockThreshold: row.values.threshold ? Number(row.values.threshold) || existing.lowStockThreshold : existing.lowStockThreshold,
            categoryId: categoryId ?? existing.categoryId,
            updatedAt: now,
          });
          result.updated += 1;
        } else {
          const id = randomId();
          await db.products.add({
            id,
            sku: row.values.sku,
            name: row.values.name,
            description: row.values.description,
            categoryId,
            brand: row.values.brand,
            costPrice: cost,
            sellingPrice: price,
            discountPrice: null,
            unit: row.values.unit || 'পিস',
            barcode: row.values.barcode,
            imageDataUrl: null,
            hasVariants: false,
            lowStockThreshold: row.values.threshold ? Number(row.values.threshold) || settings.inventory.defaultLowStockThreshold : settings.inventory.defaultLowStockThreshold,
            isActive: true,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
          });
          result.created += 1;
          if (stock > 0) {
            await applyMovement({
              productId: id,
              variantId: null,
              quantity: stock,
              type: 'opening',
              referenceType: 'import',
              unitCost: cost,
              reason: 'CSV ইমপোর্ট (ওপেনিং স্টক)',
              createdAt: startOfDay(now),
            });
          }
          result.skipped += 0;
        }
      } catch (error) {
        result.skipped += 1;
        result.errors.push(`সারি ${row.index}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  return result;
}

export async function commitCustomerImport(rows: ImportRow[]): Promise<CommitResult> {
  const result: CommitResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  const now = nowMs();
  await db.transaction('rw', db.customers, async () => {
    for (const row of rows) {
      if (row.action === 'skip') {
        result.skipped += 1;
        continue;
      }
      try {
        const phone = normalizePhone(row.values.phone || '');
        const tags = (row.values.tags || '')
          .split(/[,;|]/)
          .map((t) => t.trim())
          .filter(Boolean);
        if (row.action === 'update' && row.existingId) {
          const existing = await db.customers.get(row.existingId);
          if (!existing) {
            result.skipped += 1;
            continue;
          }
          await db.customers.put({
            ...existing,
            name: row.values.name || existing.name,
            altPhone: row.values.altPhone || existing.altPhone,
            address: row.values.address || existing.address,
            district: row.values.district || existing.district,
            area: row.values.area || existing.area,
            notes: row.values.notes || existing.notes,
            tags: tags.length ? Array.from(new Set([...existing.tags, ...tags])) : existing.tags,
            updatedAt: now,
          });
          result.updated += 1;
        } else {
          const count = await db.customers.count();
          await db.customers.add({
            id: randomId(),
            code: `C${String(count + 1).padStart(4, '0')}`,
            name: row.values.name,
            phone,
            altPhone: normalizePhone(row.values.altPhone || ''),
            address: row.values.address,
            district: row.values.district,
            area: row.values.area,
            notes: row.values.notes,
            tags,
            status: 'active',
            lastOrderAt: null,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
          });
          result.created += 1;
        }
      } catch (error) {
        result.skipped += 1;
        result.errors.push(`সারি ${row.index}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
  return result;
}
