import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button, LinkButton } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { SearchInput, Tabs } from '@/components/ui/Controls';
import { DataTable, Pagination, type Column } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorBanner, WarningBanner } from '@/components/ui/Feedback';
import { useAsync, usePagination } from '@/hooks/useAsync';
import { useAppContext } from '@/app/AppContext';
import { adjustStock, listMovements, rebuildStockLevels, stockRows, stockValuation, type ProductStockRow } from '@/services/inventoryService';
import { exportStockMovementsCsv } from '@/services/importExportService';
import { downloadCsv } from '@/lib/download';
import { formatDateTime, fromDateInputValue, nowMs, toDateInputValue } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { STOCK_MOVEMENT_LABEL } from '@/domain/constants';
import type { ID, StockMovement, StockMovementType } from '@/domain/types';

const ADJUST_TYPES: { value: StockMovementType; label: string }[] = [
  { value: 'purchase', label: 'স্টক ক্রয়' },
  { value: 'adjustment', label: 'ম্যানুয়াল সমন্বয়' },
  { value: 'opening', label: 'ওপেনিং স্টক' },
  { value: 'damage', label: 'নষ্ট' },
  { value: 'loss', label: 'হারিয়েছে' },
  { value: 'return_in', label: 'রিটার্ন (স্টকে ফেরত)' },
  { value: 'return_out', label: 'রিটার্ন (স্টক থেকে বাদ)' },
];

export default function InventoryPage() {
  const { version, refresh, settings } = useAppContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('action') === 'adjust' ? 'adjust' : 'stock');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const pagination = usePagination(50);

  const [adjustOpen, setAdjustOpen] = useState(searchParams.get('action') === 'adjust');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adjustForm, setAdjustForm] = useState<{
    productId: ID;
    variantId: ID | null;
    quantity: number;
    type: StockMovementType;
    unitCost: number;
    party: string;
    reason: string;
    date: string;
  }>({ productId: '', variantId: null, quantity: 0, type: 'purchase', unitCost: 0, party: '', reason: '', date: toDateInputValue(nowMs()) });

  const rows = useAsync(() => stockRows(), [version]);
  const valuation = useAsync(() => stockValuation(), [version]);
  const movements = useAsync(
    () => listMovements({ limit: pagination.pageSize, offset: (pagination.page - 1) * pagination.pageSize }),
    [version, pagination.page, pagination.pageSize],
  );

  useEffect(() => {
    if (searchParams.get('action') === 'adjust') {
      setAdjustOpen(true);
      const params = new URLSearchParams(searchParams);
      params.delete('action');
      setSearchParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = (rows.data ?? []).filter((row) => {
    if (filter === 'low' && !(row.isLow || row.isOut)) return false;
    if (filter === 'out' && !row.isOut) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${row.product.name} ${row.sku} ${row.variantLabel}`.toLowerCase().includes(needle);
  });

  const columns: Column<ProductStockRow>[] = [
    {
      key: 'name',
      header: 'পণ্য',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">
            {row.product.name}
            {row.variantLabel ? <span className="text-ink-500"> — {row.variantLabel}</span> : null}
          </p>
          <p className="truncate text-xs text-ink-400">{row.sku || 'SKU নেই'}</p>
        </div>
      ),
    },
    {
      key: 'qty',
      header: 'স্টক',
      align: 'right',
      render: (row) => (
        <span className={`tabular font-semibold ${row.isOut ? 'text-rose-600' : row.isLow ? 'text-amber-600' : 'text-ink-900'}`}>
          {row.quantity} {row.product.unit}
        </span>
      ),
    },
    {
      key: 'avg',
      header: 'গড় ক্রয়মূল্য',
      align: 'right',
      hideOnMobile: true,
      render: (row) => <span className="tabular text-ink-600">{formatMoney(row.avgCost)}</span>,
    },
    {
      key: 'value',
      header: 'মূল্য',
      align: 'right',
      render: (row) => <span className="tabular font-medium text-ink-900">{formatMoney(row.value)}</span>,
    },
    {
      key: 'status',
      header: 'অবস্থা',
      align: 'center',
      render: (row) =>
        row.isOut ? (
          <Badge tone="bg-rose-50 text-rose-700 ring-rose-200">স্টক নেই</Badge>
        ) : row.isLow ? (
          <Badge tone="bg-amber-50 text-amber-800 ring-amber-200">কম</Badge>
        ) : (
          <Badge tone="bg-emerald-50 text-emerald-700 ring-emerald-200">ঠিক আছে</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setAdjustForm({
              productId: row.product.id,
              variantId: row.variantId,
              quantity: 0,
              type: 'purchase',
              unitCost: row.avgCost,
              party: '',
              reason: '',
              date: toDateInputValue(nowMs()),
            });
            setError(null);
            setAdjustOpen(true);
          }}
        >
          সমন্বয়
        </Button>
      ),
    },
  ];

  const movementColumns: Column<StockMovement>[] = [
    {
      key: 'date',
      header: 'সময়',
      render: (movement) => <span className="text-xs text-ink-500">{formatDateTime(movement.createdAt)}</span>,
    },
    {
      key: 'product',
      header: 'পণ্য',
      hideOnMobile: true,
      render: (movement) => {
        const row = (rows.data ?? []).find((r) => r.product.id === movement.productId && (r.variantId ?? null) === (movement.variantId ?? null));
        return <span className="text-ink-800">{row ? `${row.product.name}${row.variantLabel ? ` — ${row.variantLabel}` : ''}` : 'অজানা পণ্য'}</span>;
      },
    },
    {
      key: 'type',
      header: 'ধরন',
      render: (movement) => <Badge tone="bg-ink-100 text-ink-700 ring-ink-200">{STOCK_MOVEMENT_LABEL[movement.type] ?? movement.type}</Badge>,
    },
    {
      key: 'reason',
      header: 'কারণ',
      hideOnMobile: true,
      render: (movement) => <span className="truncate text-ink-600">{movement.reason || movement.note || '—'}</span>,
    },
    {
      key: 'qty',
      header: 'পরিমাণ',
      align: 'right',
      render: (movement) => (
        <span className={`tabular font-semibold ${movement.quantity >= 0 ? 'text-brand-700' : 'text-rose-600'}`}>
          {movement.quantity > 0 ? '+' : ''}
          {movement.quantity}
        </span>
      ),
    },
  ];

  const submitAdjust = async () => {
    setError(null);
    if (!adjustForm.productId) {
      setError('পণ্য নির্বাচন করুন');
      return;
    }
    if (adjustForm.quantity === 0) {
      setError('পরিমাণ লিখুন');
      return;
    }
    setBusy(true);
    try {
      await adjustStock({
        productId: adjustForm.productId,
        variantId: adjustForm.variantId,
        quantity: adjustForm.quantity,
        type: adjustForm.type,
        referenceType: 'manual',
        unitCost: adjustForm.unitCost,
        party: adjustForm.party,
        reason: adjustForm.reason || STOCK_MOVEMENT_LABEL[adjustForm.type],
        createdAt: fromDateInputValue(adjustForm.date) ?? nowMs(),
      });
      await refresh();
      setAdjustOpen(false);
      setTab('stock');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const productOptions = (rows.data ?? []).map((row) => ({
    value: `${row.product.id}::${row.variantId ?? '-'}`,
    label: `${row.product.name}${row.variantLabel ? ` — ${row.variantLabel}` : ''} (স্টক ${row.quantity})`,
  }));

  return (
    <>
      <PageHeader
        title="ইনভেন্টরি / স্টক"
        subtitle="প্রতিটি স্টক পরিবর্তনের একটি কারণ ও ইতিহাস থাকে"
        actions={
          <>
            <Button
              variant="outline"
              icon="download"
              onClick={async () => downloadCsv(await exportStockMovementsCsv(), `stock-movements-${Date.now()}.csv`)}
            >
              CSV
            </Button>
            <Button icon="inventory" onClick={() => { setAdjustForm({ ...adjustForm, productId: '', variantId: null, quantity: 0 }); setError(null); setAdjustOpen(true); }}>
              স্টক সমন্বয়
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="মোট স্টক (একক)" value={String(valuation.data?.totalQuantity ?? 0)} />
        <StatCard label="স্টকের মূল্য" value={formatMoney(valuation.data?.totalValue ?? 0, { compact: true })} tone="positive" />
        <StatCard label="কম স্টক" value={String(valuation.data?.lowStockCount ?? 0)} tone="warning" />
        <StatCard label="স্টক শেষ" value={String(valuation.data?.outOfStockCount ?? 0)} tone="negative" />
      </div>

      <div className="mt-4">
        <Tabs
          tabs={[
            { key: 'stock', label: 'বর্তমান স্টক', count: rows.data?.length },
            { key: 'movements', label: 'স্টক মুভমেন্ট' },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {settings?.inventory?.allowNegativeStock && (
        <div className="mt-3">
          <WarningBanner>
            ঋণাত্মক স্টক অনুমোদিত আছে (সেটিংস থেকে বন্ধ করতে পারেন)। এতে স্টক মাইনাসে যেতে পারে এবং স্টকের মূল্য ভুল দেখাতে পারে।
          </WarningBanner>
        </div>
      )}

      {tab === 'stock' ? (
        <Card className="mt-3">
          <CardHeader title="বর্তমান স্টক" />
          <div className="flex flex-wrap gap-2 border-b border-ink-100 px-4 py-3">
            <SearchInput value={query} onChange={setQuery} placeholder="পণ্য বা SKU…" className="min-w-[200px] flex-1" />
            <Select
              aria-label="ফিল্টার"
              options={[
                { value: 'all', label: 'সব' },
                { value: 'low', label: 'কম স্টক' },
                { value: 'out', label: 'স্টক শেষ' },
              ]}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-10 w-auto"
            />
            <Button
              variant="ghost"
              size="sm"
              icon="refresh"
              onClick={async () => {
                await rebuildStockLevels();
                await refresh();
              }}
              title="মুভমেন্ট ইতিহাস থেকে স্টক পুনরায় গণনা করুন"
            >
              পুনর্গণনা
            </Button>
          </div>
          <CardBody className="px-0 py-0">
            {!rows.loading && filtered.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon="inventory"
                  title="কোনো স্টক তথ্য নেই"
                  description="পণ্য যোগ করলে এখানে স্টক দেখাবে। স্টক বাড়াতে “স্টক সমন্বয়” বা পণ্য পেজ থেকে “ওপেনিং স্টক” ব্যবহার করুন।"
                  action={<LinkButton to="/products/new" icon="plus">পণ্য যোগ করুন</LinkButton>}
                />
              </div>
            ) : (
              <DataTable
                columns={columns}
                rows={filtered}
                rowKey={(row) => `${row.product.id}::${row.variantId ?? '-'}`}
                loading={rows.loading}
                renderCard={(row) => (
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink-900">
                          {row.product.name}
                          {row.variantLabel ? <span className="text-ink-500"> — {row.variantLabel}</span> : null}
                        </p>
                        <p className="truncate text-xs text-ink-400">{row.sku || 'SKU নেই'}</p>
                      </div>
                      <span className={`tabular shrink-0 font-semibold ${row.isOut ? 'text-rose-600' : row.isLow ? 'text-amber-600' : 'text-ink-900'}`}>
                        {row.quantity} {row.product.unit}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-xs">
                      <span className="text-ink-500">মূল্য {formatMoney(row.value)}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setAdjustForm({
                            productId: row.product.id,
                            variantId: row.variantId,
                            quantity: 0,
                            type: 'purchase',
                            unitCost: row.avgCost,
                            party: '',
                            reason: '',
                            date: toDateInputValue(nowMs()),
                          });
                          setAdjustOpen(true);
                        }}
                      >
                        সমন্বয়
                      </Button>
                    </div>
                  </div>
                )}
              />
            )}
          </CardBody>
        </Card>
      ) : (
        <Card className="mt-3">
          <CardHeader title="স্টক মুভমেন্ট" subtitle="সব স্টক পরিবর্তনের অডিট ট্রেইল" />
          <CardBody className="px-0 py-0">
            {!movements.loading && (movements.data ?? []).length === 0 ? (
              <div className="p-4">
                <EmptyState icon="inventory" title="কোনো স্টক মুভমেন্ট নেই" description="স্টক বাড়ালে বা বিক্রি হলে এখানে ইতিহাস জমা হবে।" />
              </div>
            ) : (
              <DataTable columns={movementColumns} rows={movements.data ?? []} rowKey={(movement) => movement.id} loading={movements.loading} />
            )}
            {(movements.data ?? []).length > 0 && (
              <Pagination
                page={pagination.page}
                pageSize={pagination.pageSize}
                total={(movements.data ?? []).length === pagination.pageSize ? (pagination.page + 1) * pagination.pageSize : pagination.page * pagination.pageSize}
                onPageChange={pagination.setPage}
              />
            )}
          </CardBody>
        </Card>
      )}

      <Modal
        open={adjustOpen}
        title="স্টক সমন্বয়"
        onClose={() => setAdjustOpen(false)}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>
              বাতিল
            </Button>
            <Button onClick={submitAdjust} loading={busy}>
              সংরক্ষণ
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <ErrorBanner message={error} />}
          <Field label="পণ্য" required>
            {({ id }) => (
              <Select
                id={id}
                options={productOptions}
                value={`${adjustForm.productId}::${adjustForm.variantId ?? '-'}`}
                onChange={(e) => {
                  const [productId, variantId] = e.target.value.split('::');
                  const row = (rows.data ?? []).find((r) => r.product.id === productId && (r.variantId ?? '-') === variantId);
                  setAdjustForm({
                    ...adjustForm,
                    productId,
                    variantId: variantId === '-' ? null : variantId,
                    unitCost: row?.avgCost ?? 0,
                  });
                }}
                placeholder="নির্বাচন করুন"
              />
            )}
          </Field>
          <Field label="কারণ" required>
            {({ id }) => (
              <Select id={id} options={ADJUST_TYPES.map((t) => ({ value: t.value, label: t.label }))} value={adjustForm.type} onChange={(e) => setAdjustForm({ ...adjustForm, type: e.target.value as StockMovementType })} />
            )}
          </Field>
          <Field label="পরিমাণ" required hint="যোগ করতে 10, কমাতে -10">
            {({ id }) => <Input id={id} type="number" step="1" value={adjustForm.quantity} onChange={(e) => setAdjustForm({ ...adjustForm, quantity: Number(e.target.value) || 0 })} />}
          </Field>
          <Field label="প্রতি ইউনিট ক্রয়মূল্য" hint="ক্রয়ের ক্ষেত্রে পূরণ করলে গড় ক্রয়মূল্য হালনাগাদ হবে">
            {({ id }) => (
              <Input id={id} type="number" min={0} step="0.01" value={(adjustForm.unitCost / 100).toFixed(2)} onChange={(e) => setAdjustForm({ ...adjustForm, unitCost: Math.round(Number(e.target.value || 0) * 100) })} />
            )}
          </Field>
          <Field label="পক্ষ (সাপ্লায়ার)">
            {({ id }) => <Input id={id} value={adjustForm.party} onChange={(e) => setAdjustForm({ ...adjustForm, party: e.target.value })} />}
          </Field>
          <Field label="তারিখ">
            {({ id }) => <Input id={id} type="date" value={adjustForm.date} onChange={(e) => setAdjustForm({ ...adjustForm, date: e.target.value })} />}
          </Field>
          <Field label="নোট">
            {({ id }) => <Textarea id={id} value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })} />}
          </Field>
        </div>
      </Modal>
    </>
  );
}
