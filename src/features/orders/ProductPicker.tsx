import { useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { SearchInput } from '@/components/ui/Controls';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { useAsync } from '@/hooks/useAsync';
import { db } from '@/db/db';
import { useAppContext } from '@/app/AppContext';
import { listProducts } from '@/services/productService';
import { stockRows } from '@/services/inventoryService';
import { formatMoney } from '@/lib/money';
import type { ID } from '@/domain/types';

export interface PickedProduct {
  productId: ID;
  variantId: ID | null;
  name: string;
  sku: string;
  unit: string;
  unitPrice: number;
  unitCost: number;
  available: number;
}

export function ProductPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (product: PickedProduct) => void;
}) {
  const { version } = useAppContext();
  const [query, setQuery] = useState('');
  const state = useAsync(async () => {
    const [products, stock] = await Promise.all([listProducts({ limit: Number.MAX_SAFE_INTEGER, isActive: true }), stockRows()]);
    const available = new Map<string, number>();
    for (const row of stock) available.set(`${row.product.id}::${row.variantId ?? '-'}`, row.quantity);
    return { products: products.rows, available };
  }, [version]);

  const variants = useAsync(async () => (await db.productVariants.toArray()).filter((v) => !v.archivedAt), [version]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = state.data?.products ?? [];
    if (!needle) return rows.slice(0, 60);
    return rows.filter((p) => [p.name, p.sku, p.brand, p.barcode].join(' ').toLowerCase().includes(needle)).slice(0, 60);
  }, [state.data, query]);

  const variantMap = useMemo(() => {
    const map = new Map<ID, { id: ID; label: string; sku: string; sellingPrice: number; costPrice: number }[]>();
    for (const variant of variants.data ?? []) {
      const list = map.get(variant.productId) ?? [];
      list.push({
        id: variant.id,
        label: variant.label,
        sku: variant.sku,
        sellingPrice: variant.sellingPrice,
        costPrice: variant.costPrice,
      });
      map.set(variant.productId, list);
    }
    return map;
  }, [variants.data]);

  return (
    <Modal open={open} title="পণ্য নির্বাচন করুন" onClose={onClose} size="lg">
      <SearchInput value={query} onChange={setQuery} placeholder="নাম, SKU বা বারকোড দিয়ে খুঁজুন" className="mb-3" autoFocus />

      {state.loading ? (
        <p className="py-8 text-center text-sm text-ink-400">লোড হচ্ছে…</p>
      ) : results.length === 0 ? (
        <EmptyState
          icon="products"
          title="কোনো পণ্য পাওয়া যায়নি"
          description={query ? 'অন্য নাম দিয়ে খুঁজে দেখুন অথবা নতুন পণ্য যোগ করুন।' : 'প্রথমে পণ্য যোগ করুন।'}
        />
      ) : (
        <ul className="divide-y divide-ink-100">
          {results.map((product) => {
            const productVariants = variantMap.get(product.id) ?? [];
            const rows =
              productVariants.length > 0
                ? productVariants.map((variant) => ({
                    key: `${product.id}::${variant.id}`,
                    label: `${product.name} — ${variant.label}`,
                    sku: variant.sku || product.sku,
                    price: variant.sellingPrice,
                    cost: variant.costPrice,
                    variantId: variant.id as ID | null,
                    available: state.data?.available.get(`${product.id}::${variant.id}`) ?? 0,
                  }))
                : [
                    {
                      key: `${product.id}::-`,
                      label: product.name,
                      sku: product.sku,
                      price: product.discountPrice && product.discountPrice > 0 ? product.discountPrice : product.sellingPrice,
                      cost: product.costPrice,
                      variantId: null as ID | null,
                      available: state.data?.available.get(`${product.id}::-`) ?? 0,
                    },
                  ];
            return (
              <li key={product.id} className="py-2">
                {rows.map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => {
                      onPick({
                        productId: product.id,
                        variantId: row.variantId,
                        name: row.label,
                        sku: row.sku,
                        unit: product.unit,
                        unitPrice: row.price,
                        unitCost: row.cost,
                        available: row.available,
                      });
                      onClose();
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-brand-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink-800">{row.label}</span>
                      <span className="block text-xs text-ink-400">
                        {row.sku ? `${row.sku} • ` : ''}স্টক: {row.available} {product.unit}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="tabular block text-sm font-semibold text-brand-800">{formatMoney(row.price)}</span>
                      <span className="block text-[11px] text-ink-400">ক্রয় {formatMoney(row.cost)}</span>
                    </span>
                  </button>
                ))}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex justify-end">
        <Button
          variant="outline"
          icon="plus"
          onClick={() => {
            window.location.href = '/products/new';
          }}
        >
          নতুন পণ্য যোগ করুন
        </Button>
      </div>
    </Modal>
  );
}
