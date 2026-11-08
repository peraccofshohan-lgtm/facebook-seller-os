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
import { archiveCustomer, customerStats, listCustomers, restoreCustomer } from '@/services/customerService';
import { exportCustomersCsv } from '@/services/importExportService';
import { downloadCsv } from '@/lib/download';
import { formatDate } from '@/lib/date';
import { formatMoney, type Minor } from '@/lib/money';
import type { Customer } from '@/domain/types';

interface Row extends Customer {
  stats?: { orderCount: number; totalPurchase: Minor; outstanding: Minor };
}

export default function CustomersPage() {
  const { version, refresh } = useAppContext();
  const pagination = usePagination(25);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [confirm, setConfirm] = useState<{ customer: Customer; action: 'archive' | 'restore' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    pagination.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, status, showArchived]);

  const state = useAsync(
    () =>
      listCustomers({
        query,
        status: status === 'all' ? undefined : (status as Customer['status']),
        archived: showArchived,
        limit: pagination.pageSize,
        offset: (pagination.page - 1) * pagination.pageSize,
      }),
    [version, query, status, showArchived, pagination.page, pagination.pageSize],
  );

  const rows = (state.data?.rows ?? []) as Row[];

  // Statistics are loaded for the visible page only (keeps the list fast on big datasets).
  const withStats = useAsync(async () => {
    const enriched: Row[] = [];
    for (const customer of rows) {
      enriched.push({ ...customer, stats: await customerStats(customer.id) });
    }
    return enriched;
  }, [version, rows.map((r) => r.id).join(',')]);

  const displayRows = withStats.data ?? rows;

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'কাস্টমার',
      render: (customer) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{customer.name}</p>
          <p className="truncate text-xs text-ink-400" dir="ltr">
            {customer.phone || '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'area',
      header: 'এলাকা',
      hideOnMobile: true,
      render: (customer) => <span className="truncate text-ink-600">{customer.area || customer.district || '—'}</span>,
    },
    {
      key: 'orders',
      header: 'অর্ডার',
      align: 'right',
      render: (customer) => <span className="tabular">{customer.stats?.orderCount ?? '—'}</span>,
    },
    {
      key: 'purchase',
      header: 'মোট কেনা',
      align: 'right',
      hideOnMobile: true,
      render: (customer) => <span className="tabular">{customer.stats ? formatMoney(customer.stats.totalPurchase) : '—'}</span>,
    },
    {
      key: 'due',
      header: 'বাকি',
      align: 'right',
      render: (customer) => (
        <span className={`tabular ${(customer.stats?.outstanding ?? 0) > 0 ? 'font-semibold text-amber-700' : 'text-ink-500'}`}>
          {customer.stats ? formatMoney(customer.stats.outstanding) : '—'}
        </span>
      ),
    },
    {
      key: 'last',
      header: 'সর্বশেষ অর্ডার',
      align: 'right',
      hideOnMobile: true,
      render: (customer) => <span className="text-xs text-ink-500">{customer.lastOrderAt ? formatDate(customer.lastOrderAt) : '—'}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (customer) => (
        <div className="flex justify-end gap-1">
          <LinkButton to={`/customers/${customer.id}`} variant="ghost" size="sm">
            প্রোফাইল
          </LinkButton>
          <Button variant="ghost" size="sm" onClick={() => setConfirm({ customer, action: customer.archivedAt ? 'restore' : 'archive' })}>
            {customer.archivedAt ? 'পুনরুদ্ধার' : 'আর্কাইভ'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="কাস্টমার"
        subtitle={`মোট ${state.data?.total ?? 0} জন`}
        actions={
          <>
            <Button
              variant="outline"
              icon="download"
              loading={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  downloadCsv(await exportCustomersCsv(), `customers-${Date.now()}.csv`);
                } finally {
                  setExporting(false);
                }
              }}
            >
              CSV
            </Button>
            <LinkButton to="/customers/new" icon="plus">
              নতুন কাস্টমার
            </LinkButton>
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          <SearchInput value={query} onChange={setQuery} placeholder="নাম, ফোন, এলাকা, ট্যাগ…" className="min-w-[220px] flex-1" />
          <Select
            aria-label="স্ট্যাটাস"
            options={[
              { value: 'all', label: 'সবাই' },
              { value: 'active', label: 'সাধারণ' },
              { value: 'vip', label: 'ভিআইপি' },
              { value: 'blocked', label: 'ব্লকড' },
            ]}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-10 w-auto min-w-[130px]"
          />
          <Select
            aria-label="আর্কাইভ"
            options={[
              { value: 'active', label: 'চালু' },
              { value: 'archived', label: 'আর্কাইভ' },
            ]}
            value={showArchived ? 'archived' : 'active'}
            onChange={(e) => setShowArchived(e.target.value === 'archived')}
            className="h-10 w-auto min-w-[130px]"
          />
        </div>
      </PageHeader>

      {state.error && <ErrorBanner message={state.error.message} onRetry={state.reload} />}

      <Card>
        <CardBody className="px-0 py-0">
          {!state.loading && rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon="customers"
                title="কোনো কাস্টমার পাওয়া যায়নি"
                description="কাস্টমার যোগ করলে বারবার নাম-ঠিকানা লেখা লাগবে না, আর পুরনো অর্ডার ও বাকির হিসাব এক জায়গায় পাবেন।"
                action={<LinkButton to="/customers/new" icon="plus">প্রথম কাস্টমার যোগ করুন</LinkButton>}
              />
            </div>
          ) : (
            <DataTable
              columns={columns}
              rows={displayRows}
              rowKey={(customer) => customer.id}
              loading={state.loading}
              onRowClick={(customer) => {
                window.location.href = `/customers/${customer.id}`;
              }}
              renderCard={(customer) => (
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-900">{customer.name}</p>
                      <p className="truncate text-xs text-ink-400" dir="ltr">
                        {customer.phone || 'ফোন নেই'}
                      </p>
                    </div>
                    {customer.status !== 'active' && <Badge>{customer.status === 'vip' ? 'ভিআইপি' : 'ব্লকড'}</Badge>}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-xs">
                    <span className="text-ink-500">অর্ডার: {customer.stats?.orderCount ?? '—'}</span>
                    <span className={(customer.stats?.outstanding ?? 0) > 0 ? 'font-semibold text-amber-700' : 'text-ink-500'}>
                      বাকি: {customer.stats ? formatMoney(customer.stats.outstanding) : '—'}
                    </span>
                  </div>
                </div>
              )}
            />
          )}
          {rows.length > 0 && (
            <Pagination
              page={pagination.page}
              pageSize={pagination.pageSize}
              total={state.data?.total ?? 0}
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
            />
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.action === 'archive' ? 'কাস্টমার আর্কাইভ করবেন?' : 'কাস্টমার পুনরুদ্ধার করবেন?'}
        message={
          confirm?.action === 'archive'
            ? `"${confirm?.customer.name}" আর্কাইভ করলে নতুন অর্ডারে আর দেখাবে না। পুরনো অর্ডার ও বাকির হিসাব অক্ষত থাকবে।`
            : `"${confirm?.customer.name}" আবার চালু তালিকায় আসবে।`
        }
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          setBusy(true);
          try {
            if (confirm.action === 'archive') await archiveCustomer(confirm.customer.id);
            else await restoreCustomer(confirm.customer.id);
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
