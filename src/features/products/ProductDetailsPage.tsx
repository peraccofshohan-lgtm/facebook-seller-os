import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button, LinkButton } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState, ErrorBanner, Skeleton } from '@/components/ui/Feedback';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Badge';
import { useAsync } from '@/hooks/useAsync';
import { useAppContext } from '@/app/AppContext';
import { archiveProduct, checkHardDelete, getProduct, hardDeleteProduct, listVariants, restoreProduct } from '@/services/productService';
import { adjustStock, listMovements, stockRows } from '@/services/inventoryService';
import { formatDate, formatDateTime, toDateInputValue, fromDateInputValue, nowMs } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { STOCK_MOVEMENT_LABEL } from '@/domain/constants';
import type { ID, StockMovementType } from '@/domain/types';

const ADJUST_TYPES: { value: StockMovementType; label: string }[] = [
  { value: 'purchase', label: 'স্টক ক্রয় (সাপ্লায়ার থেকে)' },
  { value: 'adjustment', label: 'ম্যানুয়াল সমন্বয়' },
  { value: 'damage', label: 'নষ্ট' },
  { value: 'loss', label: 'হারিয়েছে' },
  { value: 'return_in', label: 'রিটার্ন (স্টকে ফেরত)' },
  { value: 'opening', label: 'ওপেনিং স্টক' },
];

export default function ProductDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { version, refresh } = useAppContext();

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adjustForm, setAdjustForm] = useState<{
    variantId: ID | null;
    quantity: number;
    type: StockMovementType;
    unitCost: number;
    party: string;
    reason: string;
    date: string;
  }>({ variantId: null, quantity: 0, type: 'purchase', unitCost: 0, party: '', reason: '', date: toDateInputValue(nowMs()) });

  const product = useAsync(() => (id ? getProduct(id) : Promise.resolve(undefined)), [id, version]);
  const variants = useAsync(() => (id ? listVariants(id) : Promise.resolve([])), [id, version]);
  const stock = useAsync(() => stockRows({ includeArchived: true }), [version]);
  const movements = useAsync(() => (id ? listMovements({ productId: id, limit: 25 }) : Promise.resolve([])), [id, version]);

  if (product.loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!product.data) {
    return (
      <EmptyState
        icon="products"
        title="পণ্য পাওয়া যায়নি"
        description="এই পণ্যটি মুছে ফেলা হয়েছে অথবা লিঙ্কটি সঠিক নয়।"
        action={<LinkButton to="/products">পণ্য তালিকায় যান</LinkButton>}
      />
    );
  }

  const current = product.data;
  const activeVariants = (variants.data ?? []).filter((v) => !v.archivedAt);
  const stockFor = (variantId: ID | null) =>
    (stock.data ?? []).find((row) => row.product.id === current.id && (row.variantId ?? null) === (variantId ?? null));

  const openAdjust = (variantId: ID | null) => {
    const row = stockFor(variantId);
    setAdjustForm({
      variantId,
      quantity: 0,
      type: 'purchase',
      unitCost: row?.avgCost ?? current.costPrice,
      party: '',
      reason: '',
      date: toDateInputValue(nowMs()),
    });
    setError(null);
    setAdjustOpen(true);
  };

  const submitAdjust = async () => {
    if (!id) return;
    if (adjustForm.quantity === 0) {
      setError('পরিমাণ লিখুন (যোগ করতে ধনাত্মক, কমাতে ঋণাত্মক)');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adjustStock({
        productId: id,
        variantId: adjustForm.variantId,
        quantity: adjustForm.quantity,
        type: adjustForm.type,
        referenceType: 'manual',
        unitCost: adjustForm.unitCost,
        party: adjustForm.party,
        reason: adjustForm.reason || (STOCK_MOVEMENT_LABEL[adjustForm.type] ?? ''),
        createdAt: fromDateInputValue(adjustForm.date) ?? nowMs(),
      });
      await refresh();
      setAdjustOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runDelete = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await hardDeleteProduct(id);
      await refresh();
      navigate('/products');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  const totalStock = activeVariants.length
    ? activeVariants.reduce((sum, variant) => sum + (stockFor(variant.id)?.quantity ?? 0), 0)
    : (stockFor(null)?.quantity ?? 0);
  const totalValue = activeVariants.length
    ? activeVariants.reduce((sum, variant) => sum + (stockFor(variant.id)?.value ?? 0), 0)
    : (stockFor(null)?.value ?? 0);

  return (
    <>
      <PageHeader
        title={current.name}
        subtitle={`${current.sku ? `SKU: ${current.sku} • ` : ''}যোগ করা হয়েছে ${formatDate(current.createdAt)}`}
        back
        actions={
          <>
            <Button variant="outline" icon="edit" onClick={() => navigate(`/products/${current.id}/edit`)}>
              সম্পাদনা
            </Button>
            <Button
              variant={current.archivedAt ? 'subtle' : 'outline'}
              icon="archive"
              onClick={async () => {
                if (current.archivedAt) await restoreProduct(current.id);
                else await archiveProduct(current.id);
                await refresh();
              }}
            >
              {current.archivedAt ? 'পুনরুদ্ধার' : 'আর্কাইভ'}
            </Button>
          </>
        }
      />

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardBody className="flex flex-col gap-4 sm:flex-row">
              {current.imageDataUrl ? (
                <img src={current.imageDataUrl} alt={current.name} className="h-32 w-32 shrink-0 rounded-lg border border-ink-200 object-contain" />
              ) : (
                <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-lg border border-dashed border-ink-300 text-ink-300">
                  <Icon name="products" size={32} />
                </div>
              )}
              <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Item label="ক্রয়মূল্য" value={formatMoney(current.costPrice)} />
                <Item label="বিক্রয়মূল্য" value={formatMoney(current.sellingPrice)} />
                {current.discountPrice ? <Item label="ছাড় মূল্য" value={formatMoney(current.discountPrice)} /> : null}
                <Item label="একক" value={current.unit} />
                <Item label="মোট স্টক" value={`${totalStock} ${current.unit}`} />
                <Item label="স্টক মূল্য" value={formatMoney(totalValue)} />
                <Item label="সতর্ক সীমা" value={String(current.lowStockThreshold)} />
                <Item label="স্ট্যাটাস">
                  <Badge tone={current.isActive ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-ink-100 text-ink-600 ring-ink-200'}>
                    {current.isActive ? 'চালু' : 'বন্ধ'}
                  </Badge>
                </Item>
              </dl>
            </CardBody>
            {current.description && (
              <CardBody className="border-t border-ink-100 pt-3 text-sm text-ink-600">{current.description}</CardBody>
            )}
          </Card>

          <Card>
            <CardHeader title="ভ্যারিয়েন্ট ও স্টক" subtitle="প্রতিটি ভ্যারিয়েন্টের আলাদা স্টক" />
            <CardBody className="px-0 py-0">
              {activeVariants.length === 0 ? (
                <div className="flex items-center justify-between gap-3 px-4 py-4">
                  <div>
                    <p className="text-sm font-medium text-ink-800">বর্তমান স্টক: {totalStock} {current.unit}</p>
                    <p className="text-xs text-ink-400">গড় ক্রয়মূল্য: {formatMoney(stockFor(null)?.avgCost ?? current.costPrice)}</p>
                  </div>
                  <Button size="sm" icon="inventory" onClick={() => openAdjust(null)}>
                    স্টক সমন্বয়
                  </Button>
                </div>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {activeVariants.map((variant) => {
                    const row = stockFor(variant.id);
                    const qty = row?.quantity ?? 0;
                    return (
                      <li key={variant.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink-800">{variant.label}</p>
                          <p className="truncate text-xs text-ink-400">
                            {variant.sku ? `${variant.sku} • ` : ''}ক্রয় {formatMoney(variant.costPrice)} • বিক্রয় {formatMoney(variant.sellingPrice)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className={`tabular text-sm font-semibold ${qty <= 0 ? 'text-rose-600' : qty <= current.lowStockThreshold ? 'text-amber-600' : 'text-ink-900'}`}>
                            {qty}
                          </span>
                          <Button size="sm" variant="outline" onClick={() => openAdjust(variant.id)}>
                            সমন্বয়
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="স্টক মুভমেন্ট ইতিহাস" subtitle="সর্বশেষ ২৫টি" />
            <CardBody className="px-0 py-0">
              {(movements.data ?? []).length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-ink-400">এখনো কোনো স্টক মুভমেন্ট নেই।</p>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {(movements.data ?? []).map((movement) => (
                    <li key={movement.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm text-ink-800">
                          {STOCK_MOVEMENT_LABEL[movement.type] ?? movement.type}
                          {movement.reason ? ` — ${movement.reason}` : ''}
                        </p>
                        <p className="truncate text-xs text-ink-400">{formatDateTime(movement.createdAt)}</p>
                      </div>
                      <span className={`tabular shrink-0 text-sm font-semibold ${movement.quantity >= 0 ? 'text-brand-700' : 'text-rose-600'}`}>
                        {movement.quantity > 0 ? '+' : ''}
                        {movement.quantity}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="দ্রুত কাজ" />
            <CardBody className="space-y-2">
              <Button block variant="outline" icon="inventory" onClick={() => openAdjust(null)}>
                স্টক বাড়ান/কমান
              </Button>
              <LinkButton to={`/orders/new`} block variant="outline" icon="orders">
                এই পণ্য দিয়ে অর্ডার
              </LinkButton>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="বিপদ অঞ্চল" />
            <CardBody>
              <Button
                block
                variant="ghost"
                icon="trash"
                className="text-rose-600"
                onClick={async () => {
                  if (!id) return;
                  const check = await checkHardDelete(id);
                  setDeleteReason(check.reason);
                  setConfirmDelete(true);
                }}
              >
                স্থায়ীভাবে মুছুন
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>

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
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
            বর্তমান স্টক: <strong>{stockFor(adjustForm.variantId)?.quantity ?? 0}</strong> {current.unit}
          </p>
          <Field label="কারণ" required>
            {({ id: fieldId }) => (
              <Select id={fieldId} options={ADJUST_TYPES.map((t) => ({ value: t.value, label: t.label }))} value={adjustForm.type} onChange={(e) => setAdjustForm({ ...adjustForm, type: e.target.value as StockMovementType })} />
            )}
          </Field>
          <Field label="পরিমাণ" required hint="যোগ করতে যেমন 10, কমাতে -10">
            {({ id: fieldId }) => (
              <Input id={fieldId} type="number" step="1" value={adjustForm.quantity} onChange={(e) => setAdjustForm({ ...adjustForm, quantity: Number(e.target.value) || 0 })} />
            )}
          </Field>
          <Field label="প্রতি ইউনিট ক্রয়মূল্য" hint="ক্রয় হলে পূরণ করুন — স্টক মূল্য হিসাবে ব্যবহৃত হবে">
            {({ id: fieldId }) => <Input id={fieldId} type="number" min={0} step="0.01" value={(adjustForm.unitCost / 100).toFixed(2)} onChange={(e) => setAdjustForm({ ...adjustForm, unitCost: Math.round(Number(e.target.value || 0) * 100) })} />}
          </Field>
          <Field label="পক্ষ (সাপ্লায়ার/অন্যান্য)">
            {({ id: fieldId }) => <Input id={fieldId} value={adjustForm.party} onChange={(e) => setAdjustForm({ ...adjustForm, party: e.target.value })} />}
          </Field>
          <Field label="তারিখ">
            {({ id: fieldId }) => <Input id={fieldId} type="date" value={adjustForm.date} onChange={(e) => setAdjustForm({ ...adjustForm, date: e.target.value })} />}
          </Field>
          <Field label="নোট">
            {({ id: fieldId }) => <Textarea id={fieldId} value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })} />}
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="পণ্য মুছে ফেলবেন?"
        message={deleteReason}
        tone="danger"
        confirmLabel="মুছে ফেলুন"
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={runDelete}
      />
    </>
  );
}

function Item({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="text-sm font-medium text-ink-900">{children ?? value}</dd>
    </div>
  );
}
