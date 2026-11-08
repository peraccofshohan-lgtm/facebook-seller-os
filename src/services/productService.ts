/**
 * productService.ts — Product & variant CRUD, SKU integrity, archiving.
 */

import { db } from '@/db/db';
import { nowMs } from '@/lib/date';
import { randomId } from '@/lib/id';
import { matchesQuery, searchKey } from '@/lib/search';
import type { ID, Product, ProductVariant } from '@/domain/types';
import type { ProductInput, VariantInput } from '@/domain/schemas';
import type { Minor } from '@/lib/money';
import { applyMovement } from './inventoryService';

export interface ProductQuery {
  query?: string;
  categoryId?: ID | null;
  isActive?: boolean;
  archived?: boolean;
  lowStockOnly?: boolean;
  limit?: number;
  offset?: number;
  sort?: 'name' | 'newest' | 'stock';
}

export interface ProductListResult {
  rows: Product[];
  total: number;
}

export async function listProducts(q: ProductQuery = {}): Promise<ProductListResult> {
  let rows = await db.products.toArray();
  if (!q.archived) rows = rows.filter((p) => !p.archivedAt);
  else rows = rows.filter((p) => Boolean(p.archivedAt));
  if (q.isActive !== undefined) rows = rows.filter((p) => p.isActive === q.isActive);
  if (q.categoryId) rows = rows.filter((p) => p.categoryId === q.categoryId);
  if (q.query) {
    const haystack = rows.map((p) => searchKey(p.name, p.sku, p.brand, p.barcode, p.description));
    rows = rows.filter((_, i) => matchesQuery(haystack[i], q.query as string));
  }
  if (q.lowStockOnly) {
    const lowIds = new Set(await lowStockProductIds());
    rows = rows.filter((p) => lowIds.has(p.id));
  }
  const total = rows.length;
  rows.sort((a, b) => {
    if (q.sort === 'newest') return b.createdAt - a.createdAt;
    if (q.sort === 'name') return a.name.localeCompare(b.name, 'bn');
    return a.name.localeCompare(b.name, 'bn');
  });
  const offset = q.offset ?? 0;
  const limit = q.limit ?? 50;
  return { rows: rows.slice(offset, offset + limit), total };
}

async function lowStockProductIds(): Promise<ID[]> {
  const [products, variants, levels] = await Promise.all([
    db.products.toArray(),
    db.productVariants.toArray(),
    db.stockLevels.toArray(),
  ]);
  const levelMap = new Map(levels.map((l) => [l.id, l]));
  const variantCount = new Map<ID, number>();
  for (const v of variants) if (!v.archivedAt) variantCount.set(v.productId, (variantCount.get(v.productId) ?? 0) + 1);
  const ids: ID[] = [];
  for (const p of products) {
    if (p.archivedAt) continue;
    const threshold = p.lowStockThreshold ?? 0;
    if (threshold <= 0) continue;
    if ((variantCount.get(p.id) ?? 0) > 0) {
      let total = 0;
      for (const v of variants) if (v.productId === p.id && !v.archivedAt) total += levelMap.get(`${p.id}::${v.id}`)?.quantity ?? 0;
      if (total <= threshold) ids.push(p.id);
    } else {
      const qty = levelMap.get(`${p.id}::-`)?.quantity ?? 0;
      if (qty <= threshold) ids.push(p.id);
    }
  }
  return ids;
}

export async function getProduct(id: ID): Promise<Product | undefined> {
  return db.products.get(id);
}

export async function findBySku(sku: string): Promise<Product | undefined> {
  const clean = sku.trim();
  if (!clean) return undefined;
  return db.products.where('sku').equals(clean).first();
}

export async function isSkuTaken(sku: string, exceptProductId?: ID): Promise<boolean> {
  const clean = sku.trim();
  if (!clean) return false;
  const existing = await db.products.where('sku').equals(clean).toArray();
  return existing.some((p) => p.id !== exceptProductId);
}

export interface CreateProductOptions {
  openingStock?: number;
  openingUnitCost?: Minor;
}

export async function createProduct(input: ProductInput, options: CreateProductOptions = {}): Promise<Product> {
  return db.transaction('rw', db.products, db.stockLevels, db.stockMovements, db.settings, async () => {
    if (input.sku && (await isSkuTaken(input.sku))) {
      throw new Error(`SKU "${input.sku}" ইতিমধ্যে ব্যবহৃত হয়েছে।`);
    }
    const now = nowMs();
    const product: Product = {
      id: randomId(),
      sku: input.sku.trim(),
      name: input.name,
      description: input.description,
      categoryId: input.categoryId ?? null,
      brand: input.brand,
      costPrice: input.costPrice,
      sellingPrice: input.sellingPrice,
      discountPrice: input.discountPrice ?? null,
      unit: input.unit || 'পিস',
      barcode: input.barcode,
      imageDataUrl: input.imageDataUrl ?? null,
      hasVariants: input.hasVariants,
      lowStockThreshold: input.lowStockThreshold,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    await db.products.add(product);

    const opening = Number(options.openingStock ?? 0);
    if (opening > 0 && !input.hasVariants) {
      await applyMovement({
        productId: product.id,
        variantId: null,
        quantity: opening,
        type: 'opening',
        referenceType: 'opening',
        unitCost: options.openingUnitCost ?? product.costPrice,
        reason: 'ওপেনিং স্টক',
        note: '',
      });
    }
    return product;
  });
}

export async function updateProduct(id: ID, patch: Partial<ProductInput>): Promise<Product> {
  return db.transaction('rw', db.products, async () => {
    const existing = await db.products.get(id);
    if (!existing) throw new Error('পণ্য পাওয়া যায়নি।');
    if (patch.sku && (await isSkuTaken(patch.sku, id))) {
      throw new Error(`SKU "${patch.sku}" ইতিমধ্যে ব্যবহৃত হয়েছে।`);
    }
    const next: Product = {
      ...existing,
      ...patch,
      id,
      updatedAt: nowMs(),
    };
    await db.products.put(next);
    return next;
  });
}

export async function archiveProduct(id: ID): Promise<void> {
  await db.products.update(id, { archivedAt: nowMs(), updatedAt: nowMs(), isActive: false });
}

export async function restoreProduct(id: ID): Promise<void> {
  await db.products.update(id, { archivedAt: null, updatedAt: nowMs(), isActive: true });
}

export interface DeleteCheck {
  canDelete: boolean;
  orderCount: number;
  movementCount: number;
  reason: string;
}

export async function checkHardDelete(id: ID): Promise<DeleteCheck> {
  const orders = await db.orders.toArray();
  const orderCount = orders.filter((o) => o.items.some((i) => i.productId === id)).length;
  const movementCount = await db.stockMovements.where('productId').equals(id).count();
  const canDelete = orderCount === 0 && movementCount === 0;
  return {
    canDelete,
    orderCount,
    movementCount,
    reason: canDelete
      ? 'এই পণ্য সম্পূর্ণ মুছে ফেলা যাবে।'
      : `এই পণ্যটি ${orderCount} টি অর্ডার এবং ${movementCount} টি স্টক মুভমেন্টে ব্যবহৃত হয়েছে। তাই এটি স্থায়ীভাবে মোছা যাবে না — আর্কাইভ করা হবে।`,
  };
}

/** Permanently delete a product and its variants/levels. Only allowed when unreferenced. */
export async function hardDeleteProduct(id: ID): Promise<void> {
  const check = await checkHardDelete(id);
  if (!check.canDelete) throw new Error(check.reason);
  await db.transaction('rw', db.products, db.productVariants, db.stockLevels, async () => {
    await db.products.delete(id);
    const variants = await db.productVariants.where('productId').equals(id).toArray();
    for (const v of variants) await db.productVariants.delete(v.id);
    const levels = await db.stockLevels.where('productId').equals(id).toArray();
    for (const l of levels) await db.stockLevels.delete(l.id);
  });
}

/* ------------------------------------------------------------------ */
/* Variants                                                            */
/* ------------------------------------------------------------------ */

export async function listVariants(productId: ID): Promise<ProductVariant[]> {
  return db.productVariants.where('productId').equals(productId).toArray();
}

export async function createVariant(input: VariantInput): Promise<ProductVariant> {
  const now = nowMs();
  const variant: ProductVariant = {
    id: randomId(),
    productId: input.productId,
    sku: input.sku.trim(),
    label: input.label,
    attributes: {
      size: input.size,
      color: input.color,
      weight: input.weight,
      custom: input.custom,
    },
    costPrice: input.costPrice,
    sellingPrice: input.sellingPrice,
    isActive: input.isActive,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  await db.productVariants.add(variant);
  await db.products.update(input.productId, { hasVariants: true, updatedAt: now });
  return variant;
}

export async function updateVariant(id: ID, patch: Partial<VariantInput>): Promise<ProductVariant> {
  const existing = await db.productVariants.get(id);
  if (!existing) throw new Error('ভ্যারিয়েন্ট পাওয়া যায়নি।');
  const next: ProductVariant = {
    ...existing,
    ...patch,
    attributes: {
      size: patch.size ?? existing.attributes.size,
      color: patch.color ?? existing.attributes.color,
      weight: patch.weight ?? existing.attributes.weight,
      custom: patch.custom ?? existing.attributes.custom,
    },
    id,
    updatedAt: nowMs(),
  };
  delete (next as { size?: string }).size;
  await db.productVariants.put(next);
  return next;
}

export async function deleteVariant(id: ID): Promise<void> {
  await db.transaction('rw', db.productVariants, db.stockLevels, db.stockMovements, async () => {
    const level = await db.stockLevels.get(`${(await db.productVariants.get(id))?.productId}::${id}`);
    if (level && level.quantity !== 0) {
      throw new Error('এই ভ্যারিয়েন্টের স্টক ০ নয়। প্রথমে স্টক সমন্বয় করুন।');
    }
    await db.productVariants.delete(id);
  });
}

/** Effective sale price for a product/variant combination. */
export function effectivePrice(product: Pick<Product, 'sellingPrice' | 'discountPrice'>, variant?: Pick<ProductVariant, 'sellingPrice'> | null): Minor {
  if (variant) return variant.sellingPrice;
  return product.discountPrice && product.discountPrice > 0 ? product.discountPrice : product.sellingPrice;
}

export function effectiveCost(product: Pick<Product, 'costPrice'>, variant?: Pick<ProductVariant, 'costPrice'> | null): Minor {
  return variant ? variant.costPrice : product.costPrice;
}
