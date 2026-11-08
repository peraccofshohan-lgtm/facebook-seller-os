import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { MoneyInput, SearchInput, Tabs } from '@/components/ui/Controls';
import { DataTable, Pagination, type Column } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState, ErrorBanner, InfoBanner } from '@/components/ui/Feedback';
import { useAsync, usePagination } from '@/hooks/useAsync';
import { db } from '@/db/db';
import { useAppContext } from '@/app/AppContext';
import { useCourierProviders, useExpenseCategories, usePaymentMethods } from '@/hooks/useTaxonomies';
import {
  codSummary,
  courierPerformance,
  createCourierRecord,
  deleteCourierRecord,
  expectedNetPayable,
  isConsignmentTaken,
  listCourierRecords,
  payoutDiscrepancies,
  recordCourierPayout,
  settledMap,
  updateCourierRecord,
} from '@/services/courierService';
import { syncExpenseFromCourier } from '@/services/expenseService';
import { courierCostOf } from '@/finance/profit';
import { exportCourierCsv } from '@/services/importExportService';
import { downloadCsv } from '@/lib/download';
import { formatDate, fromDateInputValue, nowMs, toDateInputValue } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { COURIER_STATUS_LABEL } from '@/domain/constants';
import type { CourierDeliveryStatus, CourierRecord, ID } from '@/domain/types';

const STATUS_OPTIONS = (Object.keys(COURIER_STATUS_LABEL) as CourierDeliveryStatus[]).map((key) => ({
  value: key,
  label: COURIER_STATUS_LABEL[key],
}));

type FormState = {
  id: ID | null;
  providerId: string;
  courierName: string;
  consignmentId: string;
  orderId: string;
  shipmentDate: string;
  status: CourierDeliveryStatus;
  deliveryCharge: number;
  customerDeliveryCharge: number;
  codAmount: number;
  collectedAmount: number;
  courierFee: number;
  returnFee: number;
  adjustment: number;
  payoutDate: string;
  payoutReference: string;
  note: string;
};

const emptyForm = (): FormState => ({
  id: null,
  providerId: '',
  courierName: '',
  consignmentId: '',
  orderId: '',
  shipmentDate: toDateInputValue(nowMs()),
  status: 'pending',
  deliveryCharge: 0,
  customerDeliveryCharge: 0,
  codAmount: 0,
  collectedAmount: 0,
  courierFee: 0,
  returnFee: 0,
  adjustment: 0,
  payoutDate: '',
  payoutReference: '',
  note: '',
});

export default function CourierPage() {
  const { version, refresh } = useAppContext();
  const providers = useCourierProviders();
  const expenseCategories = useExpenseCategories();
  const paymentMethods = usePaymentMethods();
  const [searchParams, setSearchParams] = useSearchParams();
  const pagination = usePagination(25);

  const [tab, setTab] = useState('records');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const [unsettledOnly, setUnsettledOnly] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payoutFor, setPayoutFor] = useState<CourierRecord | null>(null);
  const [payout, setPayout] = useState({ amount: 0, method: 'cash', date: toDateInputValue(nowMs()), reference: '' });
  const [confirmDelete, setConfirmDelete] = useState<CourierRecord | null>(null);

  const orders = useAsync(async () => (await db.orders.toArray()).sort((a, b) => b.orderDate - a.orderDate).slice(0, 200), [version]);

  useEffect(() => {
    if (searchParams.get('action') === 'new') {
      setForm({ ...emptyForm(), orderId: searchParams.get('order') ?? '' });
      setError(null);
      setFormOpen(true);
      const params = new URLSearchParams(searchParams);
      params.delete('action');
      params.delete('order');
      setSearchParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const state = useAsync(
    () =>
      listCourierRecords({
        query,
        status: statusFilter,
        providerId: providerFilter === 'all' ? undefined : providerFilter,
        unsettledOnly,
        limit: pagination.pageSize,
        offset: (pagination.page - 1) * pagination.pageSize,
      }),
    [version, query, statusFilter, providerFilter, unsettledOnly, pagination.page, pagination.pageSize],
  );

  const summary = useAsync(() => codSummary(), [version]);
  const discrepancies = useAsync(() => payoutDiscrepancies(), [version]);
  const performance = useAsync(() => courierPerformance(), [version]);

  const settled = useAsync(() => settledMap(), [version]);

  const rows = useMemo(() => state.data?.rows ?? [], [state.data]);

  const columns: Column<CourierRecord>[] = [
    {
      key: 'consignment',
      header: 'কনসাইনমেন্ট',
      render: (record) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900" dir="ltr">
            {record.consignmentId || '—'}
          </p>
          <p className="truncate text-xs text-ink-400">
            {record.courierName}
            {record.orderNumber ? ` • ${record.orderNumber}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'date',
      header: 'তারিখ',
      hideOnMobile: true,
      render: (record) => <span className="text-xs text-ink-500">{formatDate(record.shipmentDate)}</span>,
    },
    {
      key: 'status',
      header: 'স্ট্যাটাস',
      align: 'center',
      render: (record) => (
        <Badge tone={record.status === 'delivered' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : record.status === 'returned' || record.status === 'lost' ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-ink-100 text-ink-700 ring-ink-200'}>
          {COURIER_STATUS_LABEL[record.status]}
        </Badge>
      ),
    },
    {
      key: 'cod',
      header: 'COD',
      align: 'right',
      render: (record) => <span className="tabular">{formatMoney(record.codAmount)}</span>,
    },
    {
      key: 'expected',
      header: 'প্রত্যাশিত',
      align: 'right',
      hideOnMobile: true,
      render: (record) => {
        const { net } = expectedNetPayable(record);
        return <span className="tabular text-ink-700">{formatMoney(net)}</span>;
      },
    },
    {
      key: 'received',
      header: 'পেয়েছেন',
      align: 'right',
      render: (record) => <span className="tabular font-medium text-brand-700">{formatMoney(settled.data?.get(record.id) ?? 0)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (record) => (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setPayoutFor(record);
              setPayout({ ...payout, amount: Math.max(expectedNetPayable(record).net - (settled.data?.get(record.id) ?? 0), 0) });
            }}
          >
            পেআউট
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setForm({
                id: record.id,
                providerId: record.providerId ?? '',
                courierName: record.courierName,
                consignmentId: record.consignmentId,
                orderId: record.orderId ?? '',
                shipmentDate: toDateInputValue(record.shipmentDate),
                status: record.status,
                deliveryCharge: record.deliveryCharge,
                customerDeliveryCharge: record.customerDeliveryCharge,
                codAmount: record.codAmount,
                collectedAmount: record.collectedAmount,
                courierFee: record.courierFee,
                returnFee: record.returnFee,
                adjustment: record.adjustment,
                payoutDate: record.payoutDate ? toDateInputValue(record.payoutDate) : '',
                payoutReference: record.payoutReference,
                note: record.note,
              });
              setError(null);
              setFormOpen(true);
            }}
          >
            সম্পাদনা
          </Button>
        </div>
      ),
    },
  ];

  const submit = async () => {
    setError(null);
    if (!form.courierName.trim()) {
      setError('কুরিয়ারের নাম দিন');
      return;
    }
    if (form.consignmentId && (await isConsignmentTaken(form.consignmentId, form.id ?? undefined))) {
      setError('এই কনসাইনমেন্ট নম্বর আগেই ব্যবহৃত হয়েছে');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        providerId: form.providerId || null,
        courierName: form.courierName,
        consignmentId: form.consignmentId,
        orderId: form.orderId || null,
        shipmentDate: fromDateInputValue(form.shipmentDate) ?? nowMs(),
        status: form.status,
        deliveryCharge: form.deliveryCharge,
        customerDeliveryCharge: form.customerDeliveryCharge,
        codAmount: form.codAmount,
        collectedAmount: form.collectedAmount,
        courierFee: form.courierFee,
        returnFee: form.returnFee,
        adjustment: form.adjustment,
        payoutDate: form.payoutDate ? fromDateInputValue(form.payoutDate) : null,
        payoutReference: form.payoutReference,
        note: form.note,
      };
      if (form.id) await updateCourierRecord(form.id, payload);
      else await createCourierRecord(payload);
      await refresh();
      setFormOpen(false);
      setForm(emptyForm());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const totals = useMemo(() => {
    const expected = rows.reduce((sum, record) => sum + expectedNetPayable(record).net, 0);
    const received = rows.reduce((sum, record) => sum + (settled.data?.get(record.id) ?? 0), 0);
    return { expected, received, remaining: expected - received };
  }, [rows, settled.data]);

  return (
    <>
      <PageHeader
        title="কুরিয়ার ও COD"
        subtitle="কনসাইনমেন্ট ও পেআউট হাতে নথিভুক্ত করুন — কোনো API সংযোগ নেই"
        actions={
          <>
            <Button variant="outline" icon="download" onClick={async () => downloadCsv(await exportCourierCsv(), `courier-${Date.now()}.csv`)}>
              CSV
            </Button>
            <Button
              icon="plus"
              onClick={() => {
                setForm(emptyForm());
                setError(null);
                setFormOpen(true);
              }}
            >
              নতুন রেকর্ড
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="COD পাওনা (নিট)" value={formatMoney(summary.data?.expectedNet ?? 0, { compact: true })} hint="ডেলিভার্ড, কুরিয়ার খরচ বাদ" tone="info" />
        <StatCard label="পেআউট পেয়েছেন" value={formatMoney(summary.data?.received ?? 0, { compact: true })} tone="positive" />
        <StatCard label="এখনো বাকি" value={formatMoney(summary.data?.remaining ?? 0, { compact: true })} tone="warning" hint={`${summary.data?.unsettledCount ?? 0} টি কনসাইনমেন্ট`} />
        <StatCard label="পাইপলাইনে COD" value={formatMoney(summary.data?.pipelineCod ?? 0, { compact: true })} hint="এখনো ডেলিভার্ড হয়নি" />
      </div>

      <div className="mt-4">
        <Tabs
          tabs={[
            { key: 'records', label: 'কনসাইনমেন্ট' },
            { key: 'settlement', label: 'হিসাব মিলানো', count: discrepancies.data?.length },
            { key: 'performance', label: 'কুরিয়ার পারফরম্যান্স' },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'records' && (
        <Card className="mt-3">
          <CardHeader title="কুরিয়ার রেকর্ড" subtitle={`নির্বাচিত ভিউতে প্রত্যাশিত ${formatMoney(totals.expected)}, পেয়েছেন ${formatMoney(totals.received)}`} />
          <div className="flex flex-wrap gap-2 border-b border-ink-100 px-4 py-3">
            <SearchInput value={query} onChange={setQuery} placeholder="কনসাইনমেন্ট, অর্ডার নং, কুরিয়ার…" className="min-w-[200px] flex-1" />
            <Select aria-label="স্ট্যাটাস" options={[{ value: 'all', label: 'সব স্ট্যাটাস' }, ...STATUS_OPTIONS]} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 w-auto" />
            <Select aria-label="কুরিয়ার" options={[{ value: 'all', label: 'সব কুরিয়ার' }, ...providers.options]} value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} className="h-10 w-auto" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={unsettledOnly} onChange={(e) => setUnsettledOnly(e.target.checked)} className="h-5 w-5 rounded border-ink-300 text-brand-700" />
              শুধু বাকি
            </label>
          </div>
          <CardBody className="px-0 py-0">
            {!state.loading && rows.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon="courier"
                  title="কোনো কুরিয়ার রেকর্ড নেই"
                  description="পণ্য পাঠানোর পর কনসাইনমেন্ট নম্বর ও COD এখানে লিখে রাখুন। পরে পেআউট এলে “পেআউট” বাটনে টাকা নথিভুক্ত করুন।"
                  action={<Button icon="plus" onClick={() => setFormOpen(true)}>প্রথম রেকর্ড যোগ করুন</Button>}
                />
              </div>
            ) : (
              <DataTable
                columns={columns}
                rows={rows}
                rowKey={(record) => record.id}
                loading={state.loading}
                renderCard={(record) => (
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink-900" dir="ltr">
                          {record.consignmentId || 'কনসাইনমেন্ট নেই'}
                        </p>
                        <p className="truncate text-xs text-ink-400">
                          {record.courierName}
                          {record.orderNumber ? ` • ${record.orderNumber}` : ''}
                        </p>
                      </div>
                      <Badge tone={record.status === 'delivered' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-ink-100 text-ink-700 ring-ink-200'}>
                        {COURIER_STATUS_LABEL[record.status]}
                      </Badge>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-xs">
                      <span className="text-ink-500">COD {formatMoney(record.codAmount)}</span>
                      <span className="text-brand-700">পেয়েছেন {formatMoney(settled.data?.get(record.id) ?? 0)}</span>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setPayoutFor(record);
                          setPayout({ ...payout, amount: Math.max(expectedNetPayable(record).net - (settled.data?.get(record.id) ?? 0), 0) });
                        }}
                      >
                        পেআউট
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setForm({
                            id: record.id,
                            providerId: record.providerId ?? '',
                            courierName: record.courierName,
                            consignmentId: record.consignmentId,
                            orderId: record.orderId ?? '',
                            shipmentDate: toDateInputValue(record.shipmentDate),
                            status: record.status,
                            deliveryCharge: record.deliveryCharge,
                            customerDeliveryCharge: record.customerDeliveryCharge,
                            codAmount: record.codAmount,
                            collectedAmount: record.collectedAmount,
                            courierFee: record.courierFee,
                            returnFee: record.returnFee,
                            adjustment: record.adjustment,
                            payoutDate: record.payoutDate ? toDateInputValue(record.payoutDate) : '',
                            payoutReference: record.payoutReference,
                            note: record.note,
                          });
                          setFormOpen(true);
                        }}
                      >
                        সম্পাদনা
                      </Button>
                    </div>
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

      {tab === 'settlement' && (
        <Card className="mt-3">
          <CardHeader title="হিসাব মিলানো" subtitle="প্রত্যাশিত বনাম প্রাপ্ত — পার্থক্য থাকলে এখানে দেখাবে" />
          <CardBody className="px-0 py-0">
            {(discrepancies.data ?? []).length === 0 ? (
              <div className="p-4">
                <EmptyState icon="check" title="কোনো পার্থক্য নেই" description="সব ডেলিভার্ড কনসাইনমেন্টের হিসাব মিলেছে।" />
              </div>
            ) : (
              <ul className="divide-y divide-ink-100">
                {(discrepancies.data ?? []).map((item) => (
                  <li key={item.record.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900" dir="ltr">
                        {item.record.consignmentId || 'কনসাইনমেন্ট নেই'}
                      </p>
                      <p className="truncate text-xs text-ink-400">
                        {item.record.courierName} • প্রত্যাশিত {formatMoney(item.expected)} • পেয়েছেন {formatMoney(item.received)}
                      </p>
                    </div>
                    <span className={`tabular shrink-0 text-sm font-semibold ${item.difference >= 0 ? 'text-amber-700' : 'text-rose-600'}`}>
                      {item.difference >= 0 ? 'বাকি ' : 'বেশি '}
                      {formatMoney(Math.abs(item.difference))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'performance' && (
        <Card className="mt-3">
          <CardHeader title="কুরিয়ার পারফরম্যান্স" subtitle="শুধু আপনার নথিভুক্ত তথ্য থেকে" />
          <CardBody className="px-0 py-0">
            {(performance.data ?? []).length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-400">পর্যাপ্ত তথ্য নেই।</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {(performance.data ?? []).map((row) => (
                  <li key={row.providerName} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{row.providerName}</p>
                      <p className="text-xs text-ink-400">
                        {row.shipments} শিপমেন্ট • {row.delivered} ডেলিভার্ড • {row.returned} রিটার্ন
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular text-sm font-semibold text-brand-700">{row.successRate}% সফল</p>
                      <p className="text-xs text-ink-400">খরচ {formatMoney(row.cost)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      <Modal
        open={formOpen}
        title={form.id ? 'কুরিয়ার রেকর্ড সম্পাদনা' : 'নতুন কুরিয়ার রেকর্ড'}
        onClose={() => setFormOpen(false)}
        size="lg"
        footer={
          <>
            {form.id && (
              <Button variant="ghost" className="mr-auto text-rose-600" icon="trash" onClick={() => setConfirmDelete(rows.find((r) => r.id === form.id) ?? null)}>
                মুছুন
              </Button>
            )}
            <Button variant="outline" onClick={() => setFormOpen(false)}>
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
          <InfoBanner>এই অ্যাপ কোনো কুরিয়ার API ব্যবহার করে না — স্ট্যাটাস ও পেআউট আপনাকে হাতে আপডেট করতে হবে।</InfoBanner>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="কুরিয়ার">
              {({ id }) => (
                <Select
                  id={id}
                  options={providers.options}
                  value={form.providerId}
                  onChange={(e) => {
                    const provider = providers.rows.find((p) => p.id === e.target.value);
                    setForm({ ...form, providerId: e.target.value, courierName: provider?.name ?? form.courierName });
                  }}
                  placeholder="নির্বাচন করুন"
                />
              )}
            </Field>
            <Field label="কুরিয়ারের নাম" required hint="তালিকায় না থাকলে নাম লিখুন">
              {({ id }) => <Input id={id} value={form.courierName} onChange={(e) => setForm({ ...form, courierName: e.target.value })} />}
            </Field>
            <Field label="কনসাইনমেন্ট নম্বর">
              {({ id }) => <Input id={id} value={form.consignmentId} onChange={(e) => setForm({ ...form, consignmentId: e.target.value })} dir="ltr" />}
            </Field>
            <Field label="অর্ডার">
              {({ id }) => (
                <Select
                  id={id}
                  options={(orders.data ?? []).map((order) => ({ value: order.id, label: `${order.orderNumber} — ${order.customerName || 'নগদ'}` }))}
                  value={form.orderId}
                  onChange={(e) => setForm({ ...form, orderId: e.target.value })}
                  placeholder="লিংক করুন (ঐচ্ছিক)"
                />
              )}
            </Field>
            <Field label="পাঠানোর তারিখ">
              {({ id }) => <Input id={id} type="date" value={form.shipmentDate} onChange={(e) => setForm({ ...form, shipmentDate: e.target.value })} />}
            </Field>
            <Field label="ডেলিভারি স্ট্যাটাস">
              {({ id }) => <Select id={id} options={STATUS_OPTIONS} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as CourierDeliveryStatus })} />}
            </Field>
            <Field label="COD (কাস্টমার থেকে আদায়)" hint="ডেলিভারিতে কুরিয়ার কত টাকা নেবে">
              {({ id }) => <MoneyInput id={id} value={form.codAmount} onChange={(value) => setForm({ ...form, codAmount: value })} />}
            </Field>
            <Field label="কুরিয়ার আদায় করেছে" hint="পেআউটের সময় মিলিয়ে দিন">
              {({ id }) => <MoneyInput id={id} value={form.collectedAmount} onChange={(value) => setForm({ ...form, collectedAmount: value })} />}
            </Field>
            <Field label="কুরিয়ার চার্জ" hint="আপনাকে যা দিতে হবে">
              {({ id }) => <MoneyInput id={id} value={form.deliveryCharge} onChange={(value) => setForm({ ...form, deliveryCharge: value })} />}
            </Field>
            <Field label="কাস্টমারের কাছে নেওয়া ডেলিভারি চার্জ">
              {({ id }) => <MoneyInput id={id} value={form.customerDeliveryCharge} onChange={(value) => setForm({ ...form, customerDeliveryCharge: value })} />}
            </Field>
            <Field label="অতিরিক্ত কুরিয়ার ফি">
              {({ id }) => <MoneyInput id={id} value={form.courierFee} onChange={(value) => setForm({ ...form, courierFee: value })} />}
            </Field>
            <Field label="রিটার্ন ফি">
              {({ id }) => <MoneyInput id={id} value={form.returnFee} onChange={(value) => setForm({ ...form, returnFee: value })} />}
            </Field>
            <Field label="সমন্বয় (+/-)" hint="বিবাদ বা ভুল সংশোধনের জন্য">
              {({ id }) => <MoneyInput id={id} value={form.adjustment} onChange={(value) => setForm({ ...form, adjustment: value })} />}
            </Field>
            <Field label="পেআউট তারিখ">
              {({ id }) => <Input id={id} type="date" value={form.payoutDate} onChange={(e) => setForm({ ...form, payoutDate: e.target.value })} />}
            </Field>
            <Field label="পেআউট রেফারেন্স">
              {({ id }) => <Input id={id} value={form.payoutReference} onChange={(e) => setForm({ ...form, payoutReference: e.target.value })} dir="ltr" />}
            </Field>
            <Field label="নোট" className="sm:col-span-2">
              {({ id }) => <Textarea id={id} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />}
            </Field>
          </div>
          {form.id && (
            <div className="rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
              কুরিয়ার খরচ: {formatMoney(courierCostOf({ deliveryCharge: form.deliveryCharge, courierFee: form.courierFee, returnFee: form.returnFee, adjustment: form.adjustment }))}।
              চাইলে{' '}
              <button
                type="button"
                className="font-medium text-brand-700 underline"
                onClick={async () => {
                  const record = rows.find((r) => r.id === form.id);
                  if (!record) return;
                  await syncExpenseFromCourier(record, courierCostOf(record), expenseCategories.rows.find((c) => c.name.includes('কুরিয়ার'))?.id ?? null);
                  await refresh();
                }}
              >
                খরচ হিসেবে যোগ করুন
              </button>{' '}
              (একবারই যোগ হবে — ডুপ্লিকেট হবে না)।
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={payoutFor !== null}
        title="কুরিয়ার পেআউট নথিভুক্ত"
        onClose={() => setPayoutFor(null)}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setPayoutFor(null)}>
              বাতিল
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                if (!payoutFor || payout.amount <= 0) return;
                setBusy(true);
                try {
                  await recordCourierPayout({
                    courierRecordId: payoutFor.id,
                    amount: payout.amount,
                    method: payout.method,
                    date: fromDateInputValue(payout.date) ?? nowMs(),
                    reference: payout.reference,
                  });
                  await refresh();
                  setPayoutFor(null);
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              সংরক্ষণ
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm">
            প্রত্যাশিত: {formatMoney(payoutFor ? expectedNetPayable(payoutFor).net : 0)}
          </p>
          <Field label="পরিমাণ" required>
            {({ id }) => <MoneyInput id={id} value={payout.amount} onChange={(value) => setPayout({ ...payout, amount: value })} />}
          </Field>
          <Field label="মাধ্যম">
            {({ id }) => <Select id={id} options={paymentMethods.options} value={payout.method} onChange={(e) => setPayout({ ...payout, method: e.target.value })} />}
          </Field>
          <Field label="তারিখ">
            {({ id }) => <Input id={id} type="date" value={payout.date} onChange={(e) => setPayout({ ...payout, date: e.target.value })} />}
          </Field>
          <Field label="রেফারেন্স">
            {({ id }) => <Input id={id} value={payout.reference} onChange={(e) => setPayout({ ...payout, reference: e.target.value })} />}
          </Field>
          <p className="text-xs text-ink-500">পেআউট নতুন বিক্রয় নয় — এটি শুধু নগদ প্রবাহ ও COD বাকি কমায়।</p>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="রেকর্ড মুছবেন?"
        message="পেআউট যুক্ত থাকলে মুছে ফেলা যাবে না — হিসাব রক্ষায় তখন রেকর্ডটি রেখেই দিন।"
        tone="danger"
        confirmLabel="মুছে ফেলুন"
        busy={busy}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!confirmDelete) return;
          setBusy(true);
          try {
            await deleteCourierRecord(confirmDelete.id);
            await refresh();
            setFormOpen(false);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
            setConfirmDelete(null);
          }
        }}
      />
    </>
  );
}
