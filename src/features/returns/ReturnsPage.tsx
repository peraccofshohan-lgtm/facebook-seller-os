import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/Controls';
import { DataTable, type Column } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState, ErrorBanner, InfoBanner } from '@/components/ui/Feedback';
import { useAsync } from '@/hooks/useAsync';
import { useAppContext } from '@/app/AppContext';
import { cancelReturn, createReturn, listReturns, returnSummary } from '@/services/returnService';
import { db } from '@/db/db';
import { formatDate, fromDateInputValue, nowMs, toDateInputValue } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { RETURN_CONDITION_LABEL, RETURN_REASON_LABEL, RETURN_TYPE_LABEL } from '@/domain/constants';
import type { Order, ReturnCondition, ReturnItem, ReturnReason, ReturnRecord, ReturnType } from '@/domain/types';

interface DraftItem extends ReturnItem {
  maxQuantity: number;
}

export default function ReturnsPage() {
  const { version, refresh } = useAppContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [confirmCancel, setConfirmCancel] = useState<ReturnRecord | null>(null);

  const [orderId, setOrderId] = useState('');
  const [type, setType] = useState<ReturnType>('return');
  const [reason, setReason] = useState<ReturnReason>('damaged');
  const [condition, setCondition] = useState<ReturnCondition>('resellable');
  const [date, setDate] = useState(toDateInputValue(nowMs()));
  const [courierFee, setCourierFee] = useState(0);
  const [note, setNote] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);

  const records = useAsync(() => listReturns({ type: filter, limit: 200 }), [version, filter]);
  const summary = useAsync(() => returnSummary(), [version]);
  const orders = useAsync<Order[]>(async () => (await db.orders.toArray()).sort((a, b) => b.orderDate - a.orderDate), [version]);
  const selectedOrder = useMemo(() => (orders.data ?? []).find((order) => order.id === orderId), [orders.data, orderId]);

  useEffect(() => {
    const paramOrder = searchParams.get('order');
    if (searchParams.get('action') === 'new') {
      setOrderId(paramOrder ?? '');
      setError(null);
      setOpen(true);
      const params = new URLSearchParams(searchParams);
      params.delete('action');
      params.delete('order');
      setSearchParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedOrder) {
      setItems([]);
      return;
    }
    setItems(
      selectedOrder.items.map((item) => ({
        id: item.id,
        orderItemId: item.id,
        productId: item.productId,
        variantId: item.variantId,
        name: item.name,
        sku: item.sku,
        quantity: 0,
        unitPrice: item.unitPrice,
        refundAmount: 0,
        restock: true,
        replacementProductId: null,
        replacementVariantId: null,
        replacementQuantity: 0,
        maxQuantity: item.quantity,
      })),
    );
  }, [selectedOrder]);

  const refundTotal = items.reduce((sum, item) => sum + (item.quantity > 0 ? item.refundAmount : 0), 0);

  const submit = async () => {
    setError(null);
    const chosen = items.filter((item) => item.quantity > 0);
    if (!orderId) {
      setError('অর্ডার নির্বাচন করুন');
      return;
    }
    if (chosen.length === 0) {
      setError('অন্তত একটি পণ্যের পরিমাণ দিন');
      return;
    }
    setBusy(true);
    try {
      await createReturn({
        orderId,
        type,
        date: fromDateInputValue(date) ?? nowMs(),
        reason,
        condition,
        items: chosen.map((item) => ({
          orderItemId: item.orderItemId,
          productId: item.productId,
          variantId: item.variantId,
          name: item.name,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          refundAmount: item.refundAmount,
          restock: item.restock,
          replacementProductId: item.replacementProductId,
          replacementVariantId: item.replacementVariantId,
          replacementQuantity: item.replacementQuantity,
        })),
        courierFee,
        note,
      });
      await refresh();
      setOpen(false);
      setItems([]);
      setOrderId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<ReturnRecord>[] = [
    {
      key: 'returnNumber',
      header: 'রিটার্ন',
      render: (record) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{record.returnNumber}</p>
          <p className="truncate text-xs text-ink-400">{formatDate(record.date)}</p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'ধরন',
      render: (record) => (
        <Badge tone={record.status === 'cancelled' ? 'bg-ink-100 text-ink-600 ring-ink-200' : 'bg-amber-50 text-amber-800 ring-amber-200'}>
          {RETURN_TYPE_LABEL[record.type]}
          {record.status === 'cancelled' ? ' (বাতিল)' : ''}
        </Badge>
      ),
    },
    {
      key: 'reason',
      header: 'কারণ',
      hideOnMobile: true,
      render: (record) => <span className="text-ink-600">{RETURN_REASON_LABEL[record.reason]}</span>,
    },
    {
      key: 'qty',
      header: 'পরিমাণ',
      align: 'right',
      hideOnMobile: true,
      render: (record) => <span className="tabular">{record.items.reduce((sum, item) => sum + item.quantity, 0)}</span>,
    },
    {
      key: 'refund',
      header: 'রিফান্ড',
      align: 'right',
      render: (record) => <span className="tabular font-semibold text-rose-600">{formatMoney(record.refundAmount)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (record) =>
        record.status === 'cancelled' ? null : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(record)}>
            বাতিল
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="রিটার্ন, রিফান্ড ও এক্সচেঞ্জ"
        subtitle="রিটার্ন নেওয়া, টাকা ফেরত ও স্টকে ফেরত — তিনটি আলাদা বিষয়"
        actions={
          <Button icon="plus" onClick={() => { setError(null); setOpen(true); }}>
            রিটার্ন নথিভুক্ত
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="মোট রিটার্ন" value={String(summary.data?.count ?? 0)} />
        <StatCard label="রিফান্ড দেওয়া" value={formatMoney(summary.data?.refunded ?? 0, { compact: true })} tone="negative" />
        <StatCard label="স্টকে ফেরত" value={`${summary.data?.restockedUnits ?? 0} পিস`} tone="positive" />
        <StatCard label="নষ্ট/লেখাবদ্ধ" value={`${summary.data?.writtenOffUnits ?? 0} পিস`} tone="warning" />
      </div>

      <Card className="mt-4">
        <CardHeader title="রিটার্ন তালিকা" />
        <div className="border-b border-ink-100 px-4 py-3">
          <Select
            aria-label="ধরন"
            options={[
              { value: 'all', label: 'সব' },
              { value: 'return', label: 'রিটার্ন' },
              { value: 'exchange', label: 'এক্সচেঞ্জ' },
              { value: 'refund_only', label: 'শুধু রিফান্ড' },
            ]}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-10 w-auto"
          />
        </div>
        <CardBody className="px-0 py-0">
          {!records.loading && (records.data?.rows ?? []).length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon="returns"
                title="কোনো রিটার্ন নথিভুক্ত হয়নি"
                description="কাস্টমার পণ্য ফেরত দিলে এখানে নথিভুক্ত করুন। তাহলে রিফান্ড, স্টক ও লাভের হিসাব সঠিক থাকবে।"
                action={<Button icon="plus" onClick={() => setOpen(true)}>প্রথম রিটার্ন যোগ করুন</Button>}
              />
            </div>
          ) : (
            <DataTable
              columns={columns}
              rows={records.data?.rows ?? []}
              rowKey={(record) => record.id}
              loading={records.loading}
              renderCard={(record) => (
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-900">{record.returnNumber}</p>
                      <p className="truncate text-xs text-ink-400">
                        {RETURN_TYPE_LABEL[record.type]} • {RETURN_REASON_LABEL[record.reason]}
                      </p>
                    </div>
                    <span className="tabular shrink-0 font-semibold text-rose-600">{formatMoney(record.refundAmount)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-xs text-ink-500">{formatDate(record.date)}</span>
                    {record.status !== 'cancelled' && (
                      <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(record)}>
                        বাতিল
                      </Button>
                    )}
                  </div>
                </div>
              )}
            />
          )}
        </CardBody>
      </Card>

      <Modal
        open={open}
        title="রিটার্ন নথিভুক্ত করুন"
        onClose={() => setOpen(false)}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              বাতিল
            </Button>
            <Button onClick={submit} loading={busy}>
              সংরক্ষণ
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <ErrorBanner message={error} />}
          <Field label="অর্ডার" required>
            {({ id }) => (
              <Select
                id={id}
                options={(orders.data ?? []).map((order) => ({ value: order.id, label: `${order.orderNumber} — ${order.customerName || 'নগদ'} (${formatMoney(order.total)})` }))}
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                placeholder="নির্বাচন করুন"
              />
            )}
          </Field>

          {selectedOrder && items.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-ink-500">কোন পণ্য ফেরত এসেছে</p>
              {items.map((item) => (
                <div key={item.id} className="rounded-lg border border-ink-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{item.name}</p>
                      <p className="text-xs text-ink-400">
                        অর্ডারে ছিল {item.maxQuantity} • দর {formatMoney(item.unitPrice)}
                      </p>
                    </div>
                    <Checkbox label="স্টকে ফেরত" checked={item.restock} onChange={(e) => setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, restock: e.target.checked } : row)))} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Field label="ফেরত পরিমাণ">
                      {({ id }) => (
                        <Input
                          id={id}
                          type="number"
                          min={0}
                          max={item.maxQuantity}
                          value={item.quantity}
                          onChange={(e) => {
                            const qty = Math.min(Number(e.target.value) || 0, item.maxQuantity);
                            setItems((prev) =>
                              prev.map((row) => (row.id === item.id ? { ...row, quantity: qty, refundAmount: Math.round(item.unitPrice * qty) } : row)),
                            );
                          }}
                        />
                      )}
                    </Field>
                    <Field label="রিফান্ড">
                      {({ id }) => (
                        <MoneyInput id={id} value={item.refundAmount} onChange={(value) => setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, refundAmount: value } : row)))} />
                      )}
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ধরন">
              {({ id }) => (
                <Select
                  id={id}
                  options={(Object.keys(RETURN_TYPE_LABEL) as ReturnType[]).map((key) => ({ value: key, label: RETURN_TYPE_LABEL[key] }))}
                  value={type}
                  onChange={(e) => setType(e.target.value as ReturnType)}
                />
              )}
            </Field>
            <Field label="কারণ">
              {({ id }) => (
                <Select
                  id={id}
                  options={(Object.keys(RETURN_REASON_LABEL) as ReturnReason[]).map((key) => ({ value: key, label: RETURN_REASON_LABEL[key] }))}
                  value={reason}
                  onChange={(e) => setReason(e.target.value as ReturnReason)}
                />
              )}
            </Field>
            <Field label="পণ্যের অবস্থা">
              {({ id }) => (
                <Select
                  id={id}
                  options={(Object.keys(RETURN_CONDITION_LABEL) as ReturnCondition[]).map((key) => ({ value: key, label: RETURN_CONDITION_LABEL[key] }))}
                  value={condition}
                  onChange={(e) => setCondition(e.target.value as ReturnCondition)}
                />
              )}
            </Field>
            <Field label="তারিখ">
              {({ id }) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
            </Field>
            <Field label="রিটার্ন কুরিয়ার খরচ" hint="আপনার পকেট থেকে গেলে">
              {({ id }) => <MoneyInput id={id} value={courierFee} onChange={setCourierFee} />}
            </Field>
            <Field label="মোট রিফান্ড" hint="স্বয়ংক্রিয়ভাবে যোগ হয়">
              {() => <p className="tabular rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-700">{formatMoney(refundTotal)}</p>}
            </Field>
            <Field label="নোট" className="sm:col-span-2">
              {({ id }) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
          </div>

          <InfoBanner>
            “স্টকে ফেরত” চিহ্নিত পণ্য স্টকে যোগ হবে। ক্ষতিগ্রস্ত পণ্যের ক্ষেত্রে টিক চিহ্ন সরিয়ে দিন — তখন স্টক বাড়বে না এবং ক্ষতি হিসেবে থেকে যাবে।
            রিফান্ডের টাকা অটোমেটিক পেমেন্ট খাতায় “রিফান্ড” হিসেবে জমা হবে।
          </InfoBanner>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmCancel !== null}
        title="রিটার্ন বাতিল করবেন?"
        message="রিফান্ডের লেনদেনটি বাতিল (ভয়েড) হয়ে যাবে এবং স্টকে ফেরত দেওয়া পণ্য আবার কেটে যাবে। মূল ইতিহাস মুছে যাবে না।"
        tone="danger"
        confirmLabel="বাতিল করুন"
        busy={busy}
        onCancel={() => setConfirmCancel(null)}
        onConfirm={async () => {
          if (!confirmCancel) return;
          setBusy(true);
          try {
            await cancelReturn(confirmCancel.id);
            await refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
            setConfirmCancel(null);
          }
        }}
      />
    </>
  );
}
