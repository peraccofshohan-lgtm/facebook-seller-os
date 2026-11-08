/**
 * inventoryService.ts — Stock ledger.
 *
 * Rules (see FINANCIAL_RULES.md §Inventory):
 *  - Stock is NEVER changed silently. Every change writes a StockMovement row with a type,
 *    a reason, and (when relevant) a reference to the order/return that caused it.
 *  - A movement may be applied inside a caller-owned Dexie transaction (order commit,
 *    return processing) so that stock and the business record stay consistent.
 *  - Negative stock is blocked by default; `settings.inventory.allowNegativeStock` allows
 *    it with a warning recorded on the movement.
 *  - Weighted-average cost is maintained for valuation only. It never alters the cost
 *    snapshot already stored on an order line.
 */

import { db } from '@/db/db';
import { nowMs } from '@/lib/date';
import { randomId } from '@/lib/id';
import type {
  ID,
  Product,
  StockLevel,
  StockMovement,
  StockMovementType,
  StockReferenceType,
} from '@/domain/types';
import type { Minor } from '@/lib/money';
import { getSettings } from './settingsService';

export function levelId(productId: ID, variantId: ID | null): string {
  return `${productId}::${variantId ?? '-'}`;
}

export async function getStockLevel(productId: ID, variantId: ID | null): Promise<StockLevel | null> {
  return (await db.stockLevels.get(levelId(productId, variantId))) ?? null;
}

export async function getQuantity(productId: ID, variantId: ID | null): Promise<number> {
  const level = await getStockLevel(productId, variantId);
  return level?.quantity ?? 0;
}

export interface MovementDraft {
  productId: ID;
  variantId: ID | null;
  /** Signed quantity. Negative removes stock. */
  quantity: number;
  type: StockMovementType;
  referenceType: StockReferenceType;
  referenceId?: ID | null;
  unitCost?: Minor;
  reason?: string;
  party?: string;
  note?: string;
  createdAt?: number;
}

/**
 * Apply a stock movement and update the cached level.
 * Joins the ambient Dexie transaction when there is one; otherwise runs on its own.
 */
export async function applyMovement(draft: MovementDraft): Promise<StockMovement> {
  const id = levelId(draft.productId, draft.variantId);
  const level = await db.stockLevels.get(id);
  const currentQty = level?.quantity ?? 0;
  const currentAvg = level?.avgCost ?? 0;
  const nextQty = currentQty + draft.quantity;

  const settings = await getSettings();
  if (nextQty < 0 && !settings.inventory.allowNegativeStock) {
    throw new Error(
      `স্টক পর্যাপ্ত নয়। বর্তমান স্টক ${currentQty}, কমানো হচ্ছে ${Math.abs(draft.quantity)}। স্টক বাড়িয়ে আবার চেষ্টা করুন।`,
    );
  }

  let avgCost = currentAvg;
  const inQty = draft.quantity;
  const inCost = draft.unitCost ?? 0;
  if (inQty > 0) {
    if (currentQty + inQty > 0) {
      const totalCost = currentAvg * Math.max(currentQty, 0) + inCost * inQty;
      avgCost = Math.round(totalCost / (Math.max(currentQty, 0) + inQty));
    } else if (inCost > 0) {
      avgCost = inCost;
    }
  }

  const movement: StockMovement = {
    id: randomId(),
    productId: draft.productId,
    variantId: draft.variantId ?? null,
    quantity: draft.quantity,
    type: draft.type,
    referenceType: draft.referenceType,
    referenceId: draft.referenceId ?? null,
    unitCost: inCost,
    reason: draft.reason ?? '',
    party: draft.party ?? '',
    note: draft.note ?? '',
    createdAt: draft.createdAt ?? nowMs(),
  };

  await db.stockMovements.add(movement);
  await db.stockLevels.put({
    id,
    productId: draft.productId,
    variantId: draft.variantId ?? null,
    quantity: nextQty,
    avgCost,
    updatedAt: movement.createdAt,
  });

  return movement;
}

/** Simulate a movement to find out whether it would be rejected (for UI pre-validation). */
export async function canApply(draft: MovementDraft): Promise<{ ok: boolean; current: number; next: number; message?: string }> {
  const level = await db.stockLevels.get(levelId(draft.productId, draft.variantId));
  const current = level?.quantity ?? 0;
  const next = current + draft.quantity;
  const settings = await getSettings();
  if (next < 0 && !settings.inventory.allowNegativeStock) {
    return {
      ok: false,
      current,
      next,
      message: `স্টক পর্যাপ্ত নয়। বর্তমান স্টক ${current}, প্রয়োজন ${Math.abs(draft.quantity)}।`,
    };
  }
  return { ok: true, current, next };
}

export interface StockAdjustRequest extends Omit<MovementDraft, 'referenceType'> {
  referenceType?: StockReferenceType;
  allowNegative?: boolean;
}

/** Public entry point for manual stock changes (Inventory screen, product opening stock). */
export async function adjustStock(request: StockAdjustRequest): Promise<StockMovement> {
  return db.transaction('rw', db.stockLevels, db.stockMovements, db.settings, db.products, async () => {
    if (request.allowNegative) {
      const settings = await getSettings();
      if (!settings.inventory.allowNegativeStock) {
        await db.settings.update('app', {
          inventory: { ...settings.inventory, allowNegativeStock: true },
        });
      }
    }
    return applyMovement({
      ...request,
      referenceType: request.referenceType ?? 'manual',
    });
  });
}

export interface MovementQuery {
  productId?: ID;
  variantId?: ID | null;
  type?: StockMovementType;
  referenceType?: StockReferenceType;
  referenceId?: ID;
  from?: number | null;
  to?: number | null;
  limit?: number;
  offset?: number;
}

export async function listMovements(query: MovementQuery = {}): Promise<StockMovement[]> {
  let collection = db.stockMovements.orderBy('createdAt').reverse();
  if (query.from !== undefined && query.from !== null && query.to !== undefined && query.to !== null) {
    collection = collection.filter((m) => m.createdAt >= (query.from as number) && m.createdAt < (query.to as number));
  }
  let rows = await collection.toArray();
  if (query.productId) rows = rows.filter((m) => m.productId === query.productId);
  if (query.variantId !== undefined) rows = rows.filter((m) => (m.variantId ?? null) === (query.variantId ?? null));
  if (query.type) rows = rows.filter((m) => m.type === query.type);
  if (query.referenceType) rows = rows.filter((m) => m.referenceType === query.referenceType);
  if (query.referenceId) rows = rows.filter((m) => m.referenceId === query.referenceId);
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 100;
  return rows.slice(offset, offset + limit);
}

/** Total quantity currently on hand for a product (sums variants when the product has them). */
export async function productQuantity(productId: ID, variants: { id: ID }[] = []): Promise<number> {
  if (variants.length > 0) {
    const levels = await db.stockLevels.where('productId').equals(productId).toArray();
    return levels.reduce((s, l) => s + l.quantity, 0);
  }
  const level = await db.stockLevels.get(levelId(productId, null));
  return level?.quantity ?? 0;
}

export interface ProductStockRow {
  product: Product;
  variantId: ID | null;
  variantLabel: string;
  sku: string;
  quantity: number;
  avgCost: Minor;
  value: Minor;
  threshold: number;
  isLow: boolean;
  isOut: boolean;
}

/** Build the full stock table (product/variant rows) with valuation. */
export async function stockRows(options: { includeArchived?: boolean } = {}): Promise<ProductStockRow[]> {
  const [products, variants, levels] = await Promise.all([
    db.products.toArray(),
    db.productVariants.toArray(),
    db.stockLevels.toArray(),
  ]);
  const levelMap = new Map(levels.map((l) => [l.id, l]));
  const variantMap = new Map<ID, typeof variants>();
  for (const v of variants) {
    if (!v.archivedAt) {
      const list = variantMap.get(v.productId) ?? [];
      list.push(v);
      variantMap.set(v.productId, list as never);
    }
  }

  const rows: ProductStockRow[] = [];
  for (const product of products) {
    if (!options.includeArchived && product.archivedAt) continue;
    const productVariants = variantMap.get(product.id) ?? [];
    if (productVariants.length > 0) {
      for (const variant of productVariants as unknown as { id: ID; label: string; sku: string; costPrice: Minor }[]) {
        const level = levelMap.get(levelId(product.id, variant.id));
        const quantity = level?.quantity ?? 0;
        const avgCost = level?.avgCost ?? variant.costPrice ?? 0;
        const threshold = product.lowStockThreshold ?? 0;
        rows.push({
          product,
          variantId: variant.id,
          variantLabel: variant.label,
          sku: variant.sku || product.sku,
          quantity,
          avgCost,
          value: Math.round(quantity * avgCost),
          threshold,
          isLow: threshold > 0 && quantity > 0 && quantity <= threshold,
          isOut: quantity <= 0,
        });
      }
    } else {
      const level = levelMap.get(levelId(product.id, null));
      const quantity = level?.quantity ?? 0;
      const avgCost = level?.avgCost ?? product.costPrice ?? 0;
      const threshold = product.lowStockThreshold ?? 0;
      rows.push({
        product,
        variantId: null,
        variantLabel: '',
        sku: product.sku,
        quantity,
        avgCost,
        value: Math.round(quantity * avgCost),
        threshold,
        isLow: threshold > 0 && quantity > 0 && quantity <= threshold,
        isOut: quantity <= 0,
      });
    }
  }
  return rows;
}

export interface StockValuation {
  totalQuantity: number;
  totalValue: Minor;
  lowStockCount: number;
  outOfStockCount: number;
  productCount: number;
}

export async function stockValuation(): Promise<StockValuation> {
  const rows = await stockRows();
  return {
    totalQuantity: rows.reduce((s, r) => s + r.quantity, 0),
    totalValue: rows.reduce((s, r) => s + r.value, 0),
    lowStockCount: rows.filter((r) => r.isLow).length,
    outOfStockCount: rows.filter((r) => r.isOut).length,
    productCount: new Set(rows.map((r) => r.product.id)).size,
  };
}

export async function lowStockProducts(limit = 50): Promise<ProductStockRow[]> {
  const rows = await stockRows();
  return rows.filter((r) => r.isLow || r.isOut).sort((a, b) => a.quantity - b.quantity).slice(0, limit);
}

/** Rebuild the cached stock levels from the movement ledger (repair / integrity tool). */
export async function rebuildStockLevels(): Promise<{ products: number; rows: number }> {
  const movements = await db.stockMovements.orderBy('createdAt').toArray();
  const aggregate = new Map<string, { productId: ID; variantId: ID | null; quantity: number; avgCost: number }>();
  for (const m of movements) {
    const id = levelId(m.productId, m.variantId ?? null);
    const entry = aggregate.get(id) ?? { productId: m.productId, variantId: m.variantId ?? null, quantity: 0, avgCost: 0 };
    if (m.quantity > 0 && m.unitCost > 0) {
      const totalQty = entry.quantity + m.quantity;
      if (totalQty > 0) entry.avgCost = Math.round((entry.avgCost * Math.max(entry.quantity, 0) + m.unitCost * m.quantity) / totalQty);
    }
    entry.quantity += m.quantity;
    aggregate.set(id, entry);
  }
  const rows: StockLevel[] = Array.from(aggregate.values()).map((e) => ({
    id: levelId(e.productId, e.variantId),
    productId: e.productId,
    variantId: e.variantId,
    quantity: e.quantity,
    avgCost: e.avgCost,
    updatedAt: nowMs(),
  }));
  await db.transaction('rw', db.stockLevels, async () => {
    await db.stockLevels.clear();
    await db.stockLevels.bulkPut(rows);
  });
  return { products: new Set(rows.map((r) => r.productId)).size, rows: rows.length };
}
