import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button, LinkButton } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { DateRangePicker, SearchInput, useQueryState } from '@/components/ui/Controls';
import { DataTable, Pagination, type Column } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Checkbox } from '@/components/ui/Field';
import { EmptyState, ErrorBanner } from '@/components/ui/Feedback';
import { useAsync, usePagination } from '@/hooks/useAsync';
import { useAppContext } from '@/app/AppContext';
import { useChannels, useOrderStatuses, useStatusMeta } from '@/hooks/useTaxonomies';
import { bulkUpdateStatus, listOrders } from '@/services/orderService';
import { exportOrdersCsv } from '@/services/importExportService';
import { downloadCsv } from '@/lib/download';
import { formatDate } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE } from '@/domain/constants';
import { rangeForPreset, type DateRangePreset } from '@/lib/date';
import type { Order } from '@/domain/types';

const PAGE_SIZES = [25, 50, 100];

export default function OrdersPage() {
  const { version, refresh } = useAppContext();
  const statuses = useOrderStatuses();
  const channels = useChannels();
  const statusMeta = useStatusMeta();
  const pagination = usePagination(25);

  const [filters, setFilters] = useQueryState({
    q: '',
    status: 'all',
    channel: 'all',
    payment: 'all',
    sort: 'newest',
    preset: 'last30',
    from: '',
    to: '',
  });
  const [range, setRange] = useState(() => rangeForPreset((filters.preset || 'last30') as DateRangePreset));
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState('confirmed');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setRange(rangeForPreset((filters.preset || 'last30') as DateRangePreset));
    pagination.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.preset]);

  const state = useAsync(
    () =>
      listOrders({
        query: filters.q,
        status: filters.status === 'all' ? undefined : (filters.status as never),
        channel: filters.channel === 'all' ? undefined : filters.channel,
        paymentStatus: filters.payment === 'all' ? undefined : filters.payment,
        from: range.from,
        to: range.to,
        sort: filters.sort as never,
        limit: pagination.pageSize,
        offset: (pagination.page - 1) * pagination.pageSize,
      }),
    [version, filters.q, filters.status, filters.channel, filters.payment, filters.sort, range.from, range.to, pagination.page, pagination.pageSize],
  );

  const rows = state.data?.rows ?? [];
  const total = state.data?.total ?? 0;
  const allSelected = rows.length > 0 && rows.every((order) => selected.includes(order.id));

  const columns = useMemo<Column<Order>[]>(
    () => [
      {
        key: 'orderNumber',
        header: 'অর্ডার',
        render: (order) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink-900">{order.orderNumber}</p>
            <p className="truncate text-xs text-ink-400">{formatDate(order.orderDate)}</p>
          </div>
        ),
      },
      {
        key: 'customer',
        header: 'কাস্টমার',
        hideOnMobile: true,
        render: (order) => (
          <div className="min-w-0">
            <p className="truncate text-ink-800">{order.customerName || 'নগদ কাস্টমার'}</p>
            <p className="truncate text-xs text-ink-400" dir="ltr">
              {order.customerPhone || '—'}
            </p>
          </div>
        ),
      },
      {
        key: 'items',
        header: 'পণ্য',
        hideOnMobile: true,
        render: (order) => <span className="text-ink-600">{order.items.reduce((sum, item) => sum + item.quantity, 0)} পিস</span>,
      },
      {
        key: 'total',
        header: 'মোট',
        align: 'right',
        render: (order) => <span className="tabular font-semibold text-ink-900">{formatMoney(order.total)}</span>,
      },
      {
        key: 'payment',
        header: 'পেমেন্ট',
        align: 'center',
        render: (order) => <Badge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>{PAYMENT_STATUS_LABEL[order.paymentStatus]}</Badge>,
      },
      {
        key: 'status',
        header: 'স্ট্যাটাস',
        align: 'center',
        render: (order) => <StatusBadge status={order.status} label={statusMeta.label(order.status)} tone={statusMeta.tone(order.status)} />,
      },
    ],
    [statusMeta],
  );

  const runBulk = async () => {
    if (selected.length === 0) return;
    setBulkBusy(true);
    const result = await bulkUpdateStatus(selected, bulkStatus as never);
    setBulkBusy(false);
    setSelected([]);
    await refresh();
    if (result.errors.length > 0) {
      window.alert(`${result.updated} টি আপডেট হয়েছে, ${result.skipped} টি হয়নি।\n${result.errors.slice(0, 3).join('\n')}`);
    }
  };

  return (
    <>
      <PageHeader
        title="অর্ডার"
        subtitle={`মোট ${total} টি অর্ডার (নির্বাচিত ফিল্টারে)`}
        actions={
          <>
            <Button
              variant="outline"
              icon="download"
              loading={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  const csv = await exportOrdersCsv(range.from, range.to);
                  downloadCsv(csv, `orders-${Date.now()}.csv`);
                } finally {
                  setExporting(false);
                }
              }}
            >
              CSV
            </Button>
            <LinkButton to="/orders/new" icon="plus">
              নতুন অর্ডার
            </LinkButton>
          </>
        }
      >
        <div className="space-y-2">
          <SearchInput value={filters.q} onChange={(value) => setFilters({ q: value })} placeholder="অর্ডার নং, নাম, ফোন, কনসাইনমেন্ট…" />
          <DateRangePicker
            preset={(filters.preset || 'last30') as DateRangePreset}
            range={range}
            onChange={(preset, next) => {
              setFilters({ preset, from: next.from ? String(next.from) : '', to: next.to ? String(next.to) : '' });
              setRange(next);
            }}
          />
          <div className="flex flex-wrap items-end gap-2">
            <Select
              aria-label="স্ট্যাটাস"
              options={[{ value: 'all', label: 'সব স্ট্যাটাস' }, ...statuses.map((s) => ({ value: s.value, label: s.label }))]}
              value={filters.status}
              onChange={(e) => setFilters({ status: e.target.value })}
              className="h-10 w-auto min-w-[130px]"
            />
            <Select
              aria-label="চ্যানেল"
              options={[{ value: 'all', label: 'সব চ্যানেল' }, ...channels]}
              value={filters.channel}
              onChange={(e) => setFilters({ channel: e.target.value })}
              className="h-10 w-auto min-w-[130px]"
            />
            <Select
              aria-label="পেমেন্ট স্ট্যাটাস"
              options={[
                { value: 'all', label: 'সব পেমেন্ট' },
                { value: 'unpaid', label: PAYMENT_STATUS_LABEL.unpaid },
                { value: 'partial', label: PAYMENT_STATUS_LABEL.partial },
                { value: 'paid', label: PAYMENT_STATUS_LABEL.paid },
              ]}
              value={filters.payment}
              onChange={(e) => setFilters({ payment: e.target.value })}
              className="h-10 w-auto min-w-[130px]"
            />
            <Select
              aria-label="সাজান"
              options={[
                { value: 'newest', label: 'নতুন আগে' },
                { value: 'oldest', label: 'পুরনো আগে' },
                { value: 'total', label: 'বেশি টাকা আগে' },
              ]}
              value={filters.sort}
              onChange={(e) => setFilters({ sort: e.target.value })}
              className="h-10 w-auto min-w-[130px]"
            />
          </div>
        </div>
      </PageHeader>

      {state.error && <ErrorBanner message={state.error.message} onRetry={state.reload} />}

      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-300 bg-brand-50 p-3">
          <span className="text-sm font-medium text-brand-900">{selected.length} টি নির্বাচিত</span>
          <Select
            aria-label="নতুন স্ট্যাটাস"
            options={statuses.map((s) => ({ value: s.value, label: s.label }))}
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value)}
            className="h-10 w-auto"
          />
          <Button size="sm" loading={bulkBusy} onClick={runBulk}>
            স্ট্যাটাস বদলান
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            নির্বাচন সরিয়ে দিন
          </Button>
        </div>
      )}

      <Card>
        <CardBody className="px-0 py-0">
          {!state.loading && rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon="orders"
                title={filters.q || filters.status !== 'all' ? 'এই ফিল্টারে কোনো অর্ডার পাওয়া যায়নি' : 'এখনো কোনো অর্ডার নেই'}
                description={
                  filters.q || filters.status !== 'all'
                    ? 'ফিল্টার বা সময়সীমা পরিবর্তন করে আবার চেষ্টা করুন।'
                    : 'ফেসবুক, মেসেঞ্জার, হোয়াটসঅ্যাপ বা ফোনে পাওয়া প্রতিটি অর্ডার এখানে নথিভুক্ত করতে পারবেন।'
                }
                action={<LinkButton to="/orders/new" icon="plus">প্রথম অর্ডার তৈরি করুন</LinkButton>}
              />
            </div>
          ) : (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(order) => order.id}
              loading={state.loading}
              onRowClick={(order) => {
                if (selected.length > 0) {
                  setSelected((prev) => (prev.includes(order.id) ? prev.filter((id) => id !== order.id) : [...prev, order.id]));
                  return;
                }
                window.location.href = `/orders/${order.id}`;
              }}
              renderCard={(order) => (
                <div className="flex items-start gap-3">
                  {selected.length > 0 || allSelected ? (
                    <Checkbox
                      aria-label="নির্বাচন"
                      checked={selected.includes(order.id)}
                      onChange={() => setSelected((prev) => (prev.includes(order.id) ? prev.filter((id) => id !== order.id) : [...prev, order.id]))}
                      label=""
                      className="mt-1"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink-900">{order.customerName || 'নগদ কাস্টমার'}</p>
                        <p className="truncate text-xs text-ink-400">
                          {order.orderNumber} • {formatDate(order.orderDate)}
                        </p>
                      </div>
                      <span className="tabular shrink-0 font-semibold text-ink-900">{formatMoney(order.total)}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <StatusBadge status={order.status} label={statusMeta.label(order.status)} tone={statusMeta.tone(order.status)} />
                      <Badge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>{PAYMENT_STATUS_LABEL[order.paymentStatus]}</Badge>
                    </div>
                  </div>
                </div>
              )}
            />
          )}
          {rows.length > 0 && (
            <Pagination
              page={pagination.page}
              pageSize={pagination.pageSize}
              total={total}
              pageSizeOptions={PAGE_SIZES}
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
            />
          )}
        </CardBody>
      </Card>
    </>
  );
}

export function StatusBadge({ status, label, tone }: { status: string; label: string; tone: string }) {
  const toneClass: Record<string, string> = {
    neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
    info: 'bg-sky-50 text-sky-700 ring-sky-200',
    warning: 'bg-amber-50 text-amber-800 ring-amber-200',
    success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    danger: 'bg-rose-50 text-rose-700 ring-rose-200',
    purple: 'bg-violet-50 text-violet-700 ring-violet-200',
  };
  void status;
  return <Badge tone={toneClass[tone] ?? toneClass.neutral}>{label}</Badge>;
}
