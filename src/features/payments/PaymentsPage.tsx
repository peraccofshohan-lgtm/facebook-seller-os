import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { DateRangePicker, MoneyInput, SearchInput, Tabs } from '@/components/ui/Controls';
import { DataTable, Pagination, type Column } from '@/components/ui/Table';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorBanner, InfoBanner } from '@/components/ui/Feedback';
import { useAsync, usePagination } from '@/hooks/useAsync';
import { useAppContext } from '@/app/AppContext';
import { usePaymentMethods } from '@/hooks/useTaxonomies';
import { cashSummary, listPayments, outstandingReceivables, recordOrderPayment, recordRefund } from '@/services/paymentService';
import { recordCourierPayout } from '@/services/courierService';
import { exportPaymentsCsv } from '@/services/importExportService';
import { downloadCsv } from '@/lib/download';
import { formatDate, fromDateInputValue, nowMs, rangeForPreset, toDateInputValue, type DateRange, type DateRangePreset } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { randomId } from '@/lib/id';
import { db } from '@/db/db';
import { PAYMENT_KIND_LABEL } from '@/domain/constants';
import type { Payment } from '@/domain/types';

type Kind = 'order_payment' | 'order_refund' | 'courier_payout' | 'adjustment_in' | 'adjustment_out';

export default function PaymentsPage() {
  const { version, refresh } = useAppContext();
  const paymentMethods = usePaymentMethods();
  const [searchParams, setSearchParams] = useSearchParams();
  const pagination = usePagination(50);

  const [tab, setTab] = useState('all');
  const [preset, setPreset] = useState<DateRangePreset>('last30');
  const [range, setRange] = useState<DateRange>(() => rangeForPreset('last30'));
  const [kind, setKind] = useState('all');
  const [method, setMethod] = useState('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ kind: Kind; amount: number; method: string; date: string; reference: string; note: string; orderId: string; courierRecordId: string }>({
    kind: 'order_payment',
    amount: 0,
    method: 'cash',
    date: toDateInputValue(nowMs()),
    reference: '',
    note: '',
    orderId: '',
    courierRecordId: '',
  });

  useEffect(() => {
    if (searchParams.get('action') === 'new') {
      setOpen(true);
      const params = new URLSearchParams(searchParams);
      params.delete('action');
      setSearchParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const state = useAsync(
    () =>
      listPayments({
        from: range.from,
        to: range.to,
        kind: kind === 'all' ? undefined : (kind as never),
        method: method === 'all' ? undefined : method,
        query,
        limit: pagination.pageSize,
        offset: (pagination.page - 1) * pagination.pageSize,
      }),
    [version, range.from, range.to, kind, method, query, pagination.page, pagination.pageSize],
  );

  const cash = useAsync(() => cashSummary({ from: range.from, to: range.to }), [version, range.from, range.to]);
  const receivables = useAsync(() => outstandingReceivables(), [version]);
  const orders = useAsync(async () => (await db.orders.toArray()).sort((a, b) => b.orderDate - a.orderDate).slice(0, 300), [version]);
  const courierRecords = useAsync(async () => (await db.courierRecords.toArray()).sort((a, b) => b.shipmentDate - a.shipmentDate), [version]);

  const rows = state.data?.rows ?? [];

  const columns: Column<Payment>[] = [
    {
      key: 'date',
      header: 'তারিখ',
      render: (payment) => <span className="text-xs text-ink-500">{formatDate(payment.date)}</span>,
    },
    {
      key: 'kind',
      header: 'ধরন',
      render: (payment) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-ink-800">{PAYMENT_KIND_LABEL[payment.kind] ?? payment.kind}</p>
          <p className="truncate text-xs text-ink-400">{payment.method}</p>
        </div>
      ),
    },
    {
      key: 'reference',
      header: 'রেফারেন্স/নোট',
      hideOnMobile: true,
      render: (payment) => <span className="truncate text-ink-600">{payment.reference || payment.note || '—'}</span>,
    },
    {
      key: 'amount',
      header: 'পরিমাণ',
      align: 'right',
      render: (payment) => (
        <span className={`tabular font-semibold ${payment.direction === 'in' ? 'text-brand-700' : 'text-rose-600'}`}>
          {payment.direction === 'in' ? '+' : '-'}
          {formatMoney(payment.amount)}
        </span>
      ),
    },
  ];

  const submit = async () => {
    setError(null);
    if (form.amount <= 0) {
      setError('পরিমাণ ০ এর বেশি দিন');
      return;
    }
    const date = fromDateInputValue(form.date) ?? nowMs();
    setBusy(true);
    try {
      if (form.kind === 'order_payment') {
        if (!form.orderId) throw new Error('অর্ডার নির্বাচন করুন');
        await recordOrderPayment({ orderId: form.orderId, amount: form.amount, method: form.method, date, reference: form.reference, note: form.note });
      } else if (form.kind === 'order_refund') {
        if (!form.orderId) throw new Error('অর্ডার নির্বাচন করুন');
        await recordRefund({ orderId: form.orderId, amount: form.amount, method: form.method, date, reference: form.reference, note: form.note });
      } else if (form.kind === 'courier_payout') {
        if (!form.courierRecordId) throw new Error('কুরিয়ার রেকর্ড নির্বাচন করুন');
        await recordCourierPayout({ courierRecordId: form.courierRecordId, amount: form.amount, method: form.method, date, reference: form.reference, note: form.note });
      } else {
        await db.payments.add({
          id: randomId(),
          kind: form.kind,
          direction: form.kind === 'adjustment_in' ? 'in' : 'out',
          amount: form.amount,
          method: form.method,
          orderId: null,
          customerId: null,
          courierRecordId: null,
          expenseId: null,
          date,
          reference: form.reference,
          note: form.note,
          createdAt: nowMs(),
          updatedAt: nowMs(),
          archivedAt: null,
          voidedAt: null,
        });
      }
      await refresh();
      setOpen(false);
      setForm({ ...form, amount: 0, note: '', reference: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="পেমেন্ট ও ক্যাশ"
        subtitle="প্রতিটি টাকা আদায় বা খরচের একটি লেনদেন রেকর্ড"
        actions={
          <>
            <Button variant="outline" icon="download" onClick={async () => downloadCsv(await exportPaymentsCsv(), `payments-${Date.now()}.csv`)}>
              CSV
            </Button>
            <Button icon="plus" onClick={() => { setError(null); setOpen(true); }}>
              লেনদেন যোগ
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="জমা (নির্বাচিত সময়)" value={formatMoney(cash.data?.cashIn ?? 0, { compact: true })} tone="positive" />
        <StatCard label="খরচ/প্রদান" value={formatMoney(cash.data?.cashOut ?? 0, { compact: true })} tone="negative" />
        <StatCard label="নগদ ব্যালেন্স" value={formatMoney(cash.data?.balance ?? 0, { compact: true })} hint="শুধু নথিভুক্ত লেনদেন থেকে" />
        <StatCard label="কাস্টমার বাকি" value={formatMoney(receivables.data?.total ?? 0, { compact: true })} tone="warning" hint={`${receivables.data?.orders.length ?? 0} টি অর্ডার`} />
      </div>

      <div className="mt-4">
        <Tabs
          tabs={[
            { key: 'all', label: 'সব লেনদেন' },
            { key: 'due', label: 'বাকি খাতা', count: receivables.data?.orders.length },
            { key: 'methods', label: 'মাধ্যম অনুযায়ী' },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'all' && (
        <Card className="mt-3">
          <CardHeader title="লেনদেনের খাতা" />
          <div className="space-y-2 border-b border-ink-100 px-4 py-3">
            <DateRangePicker preset={preset} range={range} onChange={(nextPreset, nextRange) => { setPreset(nextPreset); setRange(nextRange); pagination.reset(); }} />
            <div className="flex flex-wrap gap-2">
              <SearchInput value={query} onChange={setQuery} placeholder="রেফারেন্স বা নোট…" className="min-w-[180px] flex-1" />
              <Select
                aria-label="ধরন"
                options={[
                  { value: 'all', label: 'সব ধরন' },
                  ...Object.entries(PAYMENT_KIND_LABEL).map(([value, label]) => ({ value, label })),
                ]}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="h-10 w-auto"
              />
              <Select aria-label="মাধ্যম" options={[{ value: 'all', label: 'সব মাধ্যম' }, ...paymentMethods.options]} value={method} onChange={(e) => setMethod(e.target.value)} className="h-10 w-auto" />
            </div>
          </div>
          <CardBody className="px-0 py-0">
            {!state.loading && rows.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon="payments"
                  title="কোনো লেনদেন পাওয়া যায়নি"
                  description="অর্ডারের পেমেন্ট, রিফান্ড, কুরিয়ার পেআউট — সব এখানে জমা হবে।"
                  action={<Button icon="plus" onClick={() => setOpen(true)}>প্রথম লেনদেন যোগ করুন</Button>}
                />
              </div>
            ) : (
              <DataTable
                columns={columns}
                rows={rows}
                rowKey={(payment) => payment.id}
                loading={state.loading}
                renderCard={(payment) => (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{PAYMENT_KIND_LABEL[payment.kind] ?? payment.kind}</p>
                      <p className="truncate text-xs text-ink-400">
                        {formatDate(payment.date)} • {payment.method}
                        {payment.voidedAt ? ' • বাতিল' : ''}
                      </p>
                    </div>
                    <span className={`tabular shrink-0 font-semibold ${payment.direction === 'in' ? 'text-brand-700' : 'text-rose-600'}`}>
                      {payment.direction === 'in' ? '+' : '-'}
                      {formatMoney(payment.amount)}
                    </span>
                  </div>
                )}
              />
            )}
            {rows.length > 0 && (
              <Pagination page={pagination.page} pageSize={pagination.pageSize} total={state.data?.total ?? 0} onPageChange={pagination.setPage} />
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'due' && (
        <Card className="mt-3">
          <CardHeader title="কে কত টাকা বাকি আছে" subtitle="বাতিল করা অর্ডার বাদ" />
          <CardBody className="px-0 py-0">
            {(receivables.data?.orders ?? []).length === 0 ? (
              <div className="p-4">
                <EmptyState icon="check" title="কোনো বাকি নেই" description="সব অর্ডারের টাকা নথিভুক্ত হয়ে গেছে।" />
              </div>
            ) : (
              <ul className="divide-y divide-ink-100">
                {(receivables.data?.orders ?? []).map((row) => (
                  <li key={row.order.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{row.order.customerName || 'নগদ কাস্টমার'}</p>
                      <p className="truncate text-xs text-ink-400">
                        {row.order.orderNumber} • {formatDate(row.order.orderDate)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="tabular text-sm font-semibold text-amber-700">{formatMoney(row.due)}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setForm({ ...form, kind: 'order_payment', orderId: row.order.id, amount: row.due });
                          setError(null);
                          setOpen(true);
                        }}
                      >
                        আদায়
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'methods' && (
        <Card className="mt-3">
          <CardHeader title="মাধ্যম অনুযায়ী জমা ও খরচ" />
          <CardBody className="px-0 py-0">
            <ul className="divide-y divide-ink-100">
              {(cash.data?.byMethod ?? []).map((row) => (
                <li key={row.method} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-sm text-ink-800">{row.method}</span>
                  <span className="text-right text-sm">
                    <span className="tabular text-brand-700">+{formatMoney(row.in)}</span> / <span className="tabular text-rose-600">-{formatMoney(row.out)}</span>
                  </span>
                </li>
              ))}
              {(cash.data?.byMethod ?? []).length === 0 && <li className="px-4 py-8 text-center text-sm text-ink-400">এই সময়ে কোনো লেনদেন নেই।</li>}
            </ul>
          </CardBody>
        </Card>
      )}

      <Modal
        open={open}
        title="নতুন লেনদেন"
        onClose={() => setOpen(false)}
        size="sm"
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
          <Field label="ধরন" required>
            {({ id }) => (
              <Select
                id={id}
                options={[
                  { value: 'order_payment', label: 'অর্ডারের পেমেন্ট (টাকা আদায়)' },
                  { value: 'order_refund', label: 'রিফান্ড (কাস্টমারকে ফেরত)' },
                  { value: 'courier_payout', label: 'কুরিয়ার পেআউট' },
                  { value: 'adjustment_in', label: 'সমন্বয় — জমা (হাতে না থাকা আয়)' },
                  { value: 'adjustment_out', label: 'সমন্বয় — খরচ (হাতে না থাকা খরচ)' },
                ]}
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}
              />
            )}
          </Field>

          {(form.kind === 'order_payment' || form.kind === 'order_refund') && (
            <Field label="অর্ডার" required>
              {({ id }) => (
                <Select
                  id={id}
                  options={(orders.data ?? []).map((order) => ({ value: order.id, label: `${order.orderNumber} — ${order.customerName || 'নগদ'} (${formatMoney(order.total)})` }))}
                  value={form.orderId}
                  onChange={(e) => setForm({ ...form, orderId: e.target.value })}
                  placeholder="নির্বাচন করুন"
                />
              )}
            </Field>
          )}

          {form.kind === 'courier_payout' && (
            <Field label="কুরিয়ার রেকর্ড" required>
              {({ id }) => (
                <Select
                  id={id}
                  options={(courierRecords.data ?? []).map((record) => ({ value: record.id, label: `${record.courierName} — ${record.consignmentId || record.orderNumber || 'কনসাইনমেন্ট নেই'}` }))}
                  value={form.courierRecordId}
                  onChange={(e) => setForm({ ...form, courierRecordId: e.target.value })}
                  placeholder="নির্বাচন করুন"
                />
              )}
            </Field>
          )}

          <Field label="পরিমাণ" required>
            {({ id }) => <MoneyInput id={id} value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} />}
          </Field>
          <Field label="মাধ্যম">
            {({ id }) => <Select id={id} options={paymentMethods.options} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} />}
          </Field>
          <Field label="তারিখ">
            {({ id }) => <Input id={id} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />}
          </Field>
          <Field label="রেফারেন্স">
            {({ id }) => <Input id={id} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} dir="ltr" />}
          </Field>
          <Field label="নোট">
            {({ id }) => <Textarea id={id} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />}
          </Field>

          {form.kind === 'courier_payout' && (
            <InfoBanner>পেআউট নতুন বিক্রয় নয় — বিক্রয় তো অর্ডারেই নথিভুক্ত হয়েছে। এটি শুধু নগদ প্রবাহ ও COD বাকি কমায়।</InfoBanner>
          )}
          {form.kind === 'order_refund' && <InfoBanner>রিফান্ড কখনো গৃহীত পেমেন্টের বেশি হতে পারবে না।</InfoBanner>}
        </div>
      </Modal>

      <p className="mt-4 text-xs text-ink-400">
        নগদ ব্যালেন্স শুধু আপনার নথিভুক্ত লেনদেন থেকে হিসাব করা হয়। হাতে থাকা নগদের সাথে মিল না থাকলে “সমন্বয়” ব্যবহার করুন।
      </p>
    </>
  );
}
