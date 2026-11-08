import { useEffect, useState } from 'react';
import { Card, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button, LinkButton } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { SearchInput } from '@/components/ui/Controls';
import { DataTable, Pagination, type Column } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorBanner } from '@/components/ui/Feedback';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useAsync, usePagination } from '@/hooks/useAsync';
import { useAppContext } from '@/app/AppContext';
import { useProductCategories } from '@/hooks/useTaxonomies';
import { archiveProduct, listProducts, restoreProduct } from '@/services/productService';
import { stockRows } from '@/services/inventoryService';
import { exportProductsCsv } from '@/services/importExportService';
import { downloadCsv } from '@/lib/download';
import { formatMoney } from '@/lib/money';
import type { Product } from '@/domain/types';

export default function ProductsPage() {
  const { version, refresh } = useAppContext();
  const categories = useProductCategories();
  const pagination = usePagination(25);

  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [confirm, setConfirm] = useState<{ product: Product; action: 'archive' | 'restore' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    pagination.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, categoryId, stockFilter, showArchived]);

  const state = useAsync(
    () =>
      listProducts({
        query,
        categoryId: categoryId === 'all' ? undefined : categoryId,
        lowStockOnly: stockFilter === 'low',
        archived: showArchived,
        limit: pagination.pageSize,
        offset: (pagination.page - 1) * pagination.pageSize,
      }),
    [version, query, categoryId, stockFilter, showArchived, pagination.page, pagination.pageSize],
  );

  const stock = useAsync(() => stockRows({ includeArchived: showArchived }), [version]);
  const stockMap = new Map<string, { qty: number; value: number }>();
  for (const row of stock.data ?? []) {
    const key = row.product.id;
    const existing = stockMap.get(key);
    if (existing) {
      existing.qty += row.quantity;
      existing.value += row.value;
    } else {
      stockMap.set(key, { qty: row.quantity, value: row.value });
    }
  }

  const rows = state.data?.rows ?? [];
  const total = state.data?.total ?? 0;

  const columns: Column<Product>[] = [
    {
      key: 'name',
      header: 'পণ্য',
      render: (product) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{product.name}</p>
          <p className="truncate text-xs text-ink-400">
            {product.sku ? `${product.sku} • ` : ''}
            {categories.rows.find((c) => c.id === product.categoryId)?.name ?? 'ক্যাটেগরিহীন'}
          </p>
        </div>
      ),
    },
    {
      key: 'cost',
      header: 'ক্রয়মূল্য',
      align: 'right',
      hideOnMobile: true,
      render: (product) => <span className="tabular text-ink-600">{formatMoney(product.costPrice)}</span>,
    },
    {
      key: 'price',
      header: 'বিক্রয়মূল্য',
      align: 'right',
      render: (product) => (
        <span className="tabular font-medium text-ink-900">
          {formatMoney(product.discountPrice && product.discountPrice > 0 ? product.discountPrice : product.sellingPrice)}
        </span>
      ),
    },
    {
      key: 'stock',
      header: 'স্টক',
      align: 'right',
      render: (product) => {
        const qty = stockMap.get(product.id)?.qty ?? 0;
        const threshold = product.lowStockThreshold ?? 0;
        const isLow = threshold > 0 && qty <= threshold;
        return (
          <span className="inline-flex items-center gap-1.5">
            <span className={`tabular ${qty <= 0 ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-ink-800'}`}>{qty}</span>
            {qty <= 0 ? (
              <Badge tone="bg-rose-50 text-rose-700 ring-rose-200">নেই</Badge>
            ) : isLow ? (
              <Badge tone="bg-amber-50 text-amber-800 ring-amber-200">কম</Badge>
            ) : null}
          </span>
        );
      },
    },
    {
      key: 'value',
      header: 'মূল্য',
      align: 'right',
      hideOnMobile: true,
      render: (product) => <span className="tabular text-ink-600">{formatMoney(stockMap.get(product.id)?.value ?? 0, { compact: true })}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (product) => (
        <div className="flex justify-end gap-1">
          <LinkButton to={`/products/${product.id}`} variant="ghost" size="sm">
            বিস্তারিত
          </LinkButton>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirm({ product, action: product.archivedAt ? 'restore' : 'archive' })}
          >
            {product.archivedAt ? 'পুনরুদ্ধার' : 'আর্কাইভ'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="পণ্য"
        subtitle={`মোট ${total} টি পণ্য`}
        actions={
          <>
            <Button
              variant="outline"
              icon="download"
              loading={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  downloadCsv(await exportProductsCsv(), `products-${Date.now()}.csv`);
                } finally {
                  setExporting(false);
                }
              }}
            >
              CSV
            </Button>
            <LinkButton to="/products/new" icon="plus">
              নতুন পণ্য
            </LinkButton>
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          <SearchInput value={query} onChange={setQuery} placeholder="নাম, SKU, ব্র্যান্ড, বারকোড…" className="min-w-[220px] flex-1" />
          <Select
            aria-label="ক্যাটেগরি"
            options={[{ value: 'all', label: 'সব ক্যাটেগরি' }, ...categories.options]}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="h-10 w-auto min-w-[140px]"
          />
          <Select
            aria-label="স্টক"
            options={[
              { value: 'all', label: 'সব স্টক' },
              { value: 'low', label: 'কম স্টক/শেষ' },
            ]}
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value)}
            className="h-10 w-auto min-w-[130px]"
          />
          <Select
            aria-label="আর্কাইভ"
            options={[
              { value: 'active', label: 'চালু পণ্য' },
              { value: 'archived', label: 'আর্কাইভ করা' },
            ]}
            value={showArchived ? 'archived' : 'active'}
            onChange={(e) => setShowArchived(e.target.value === 'archived')}
            className="h-10 w-auto min-w-[140px]"
          />
        </div>
      </PageHeader>

      {state.error && <ErrorBanner message={state.error.message} onRetry={state.reload} />}

      <Card>
        <CardBody className="px-0 py-0">
          {!state.loading && rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon="products"
                title="কোনো পণ্য পাওয়া যায়নি"
                description="পণ্য যোগ করলে অর্ডার তৈরির সময় দর ও ক্রয়মূল্য স্বয়ংক্রিয়ভাবে আসবে এবং স্টক হিসাব শুরু হবে।"
                action={<LinkButton to="/products/new" icon="plus">প্রথম পণ্য যোগ করুন</LinkButton>}
              />
            </div>
          ) : (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(product) => product.id}
              loading={state.loading}
              onRowClick={(product) => {
                window.location.href = `/products/${product.id}`;
              }}
              renderCard={(product) => {
                const qty = stockMap.get(product.id)?.qty ?? 0;
                const threshold = product.lowStockThreshold ?? 0;
                return (
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink-900">{product.name}</p>
                        <p className="truncate text-xs text-ink-400">{product.sku || 'SKU নেই'}</p>
                      </div>
                      <span className="tabular shrink-0 font-semibold text-ink-900">
                        {formatMoney(product.discountPrice && product.discountPrice > 0 ? product.discountPrice : product.sellingPrice)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-xs">
                      <span className={qty <= 0 ? 'text-rose-600' : threshold > 0 && qty <= threshold ? 'text-amber-600' : 'text-ink-500'}>
                        স্টক: {qty} {product.unit}
                      </span>
                      <span className="text-ink-400">ক্রয় {formatMoney(product.costPrice)}</span>
                    </div>
                  </div>
                );
              }}
            />
          )}
          {rows.length > 0 && (
            <Pagination
              page={pagination.page}
              pageSize={pagination.pageSize}
              total={total}
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
            />
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.action === 'archive' ? 'পণ্য আর্কাইভ করবেন?' : 'পণ্য পুনরুদ্ধার করবেন?'}
        message={
          confirm?.action === 'archive'
            ? `"${confirm?.product.name}" আর্কাইভ করলে নতুন অর্ডারে আর দেখাবে না। পুরনো অর্ডার ও রিপোর্টে তথ্য থেকে যাবে।`
            : `"${confirm?.product.name}" আবার চালু পণ্যের তালিকায় আসবে।`
        }
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          setBusy(true);
          try {
            if (confirm.action === 'archive') await archiveProduct(confirm.product.id);
            else await restoreProduct(confirm.product.id);
            await refresh();
          } finally {
            setBusy(false);
            setConfirm(null);
          }
        }}
      />
    </>
  );
}
