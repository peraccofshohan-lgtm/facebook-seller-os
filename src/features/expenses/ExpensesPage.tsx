import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { DateRangePicker, MoneyInput, SearchInput, Tabs } from '@/components/ui/Controls';
import { DataTable, Pagination, type Column } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState, ErrorBanner, WarningBanner } from '@/components/ui/Feedback';
import { HorizontalBars } from '@/components/charts/Charts';
import { useAsync, usePagination } from '@/hooks/useAsync';
import { useAppContext } from '@/app/AppContext';
import { useExpenseCategories, usePaymentMethods } from '@/hooks/useTaxonomies';
import { categoryTotals, createExpense, deleteExpense, listExpenses, restoreExpense, updateExpense, voidExpense } from '@/services/expenseService';
import { exportExpensesCsv } from '@/services/importExportService';
import { downloadCsv } from '@/lib/download';
import { formatDate, fromDateInputValue, nowMs, rangeForPreset, toDateInputValue, type DateRange, type DateRangePreset } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import type { Expense, ID } from '@/domain/types';

export default function ExpensesPage() {
  const { version, refresh } = useAppContext();
  const categories = useExpenseCategories();
  const paymentMethods = usePaymentMethods();
  const [searchParams, setSearchParams] = useSearchParams();
  const pagination = usePagination(50);

  const [tab, setTab] = useState('list');
  const [preset, setPreset] = useState<DateRangePreset>('thisMonth');
  const [range, setRange] = useState<DateRange>(() => rangeForPreset('thisMonth'));
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ID | null>(null);
  const [confirm, setConfirm] = useState<{ expense: Expense; action: 'void' | 'restore' | 'delete' } | null>(null);

  const [form, setForm] = useState({
    date: toDateInputValue(nowMs()),
    categoryId: '',
    amount: 0,
    method: 'cash',
    payee: '',
    reference: '',
    description: '',
    note: '',
  });

  useEffect(() => {
    if (searchParams.get('action') === 'new') {
      setError(null);
      setEditing(null);
      setOpen(true);
      const params = new URLSearchParams(searchParams);
      params.delete('action');
      setSearchParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const state = useAsync(
    () =>
      listExpenses({
        from: range.from,
        to: range.to,
        categoryId: categoryFilter === 'all' ? undefined : categoryFilter,
        method: methodFilter === 'all' ? undefined : methodFilter,
        query,
        limit: pagination.pageSize,
        offset: (pagination.page - 1) * pagination.pageSize,
      }),
    [version, range.from, range.to, categoryFilter, methodFilter, query, pagination.page, pagination.pageSize],
  );

  const totals = useAsync(() => categoryTotals({ from: range.from, to: range.to }), [version, range.from, range.to]);

  const rows = state.data?.rows ?? [];
  const totalExpense = (totals.data ?? []).reduce((sum, row) => sum + row.amount, 0);
  const selectedCategoryName = categories.rows.find((c) => c.id === form.categoryId)?.name ?? '';
  const isPurchaseCategory = selectedCategoryName.includes('ক্রয়') || selectedCategoryName.includes('ক্রয়');
  const isCourierCategory = selectedCategoryName.includes('কুরিয়ার') || selectedCategoryName.toLowerCase().includes('courier');

  const columns: Column<Expense>[] = [
    {
      key: 'date',
      header: 'তারিখ',
      render: (expense) => <span className="text-xs text-ink-500">{formatDate(expense.date)}</span>,
    },
    {
      key: 'description',
      header: 'বিবরণ',
      render: (expense) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-900">{expense.description || expense.categoryName}</p>
          <p className="truncate text-xs text-ink-400">
            {expense.categoryName}
            {expense.payee ? ` • ${expense.payee}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'method',
      header: 'মাধ্যম',
      hideOnMobile: true,
      render: (expense) => <Badge tone="bg-ink-100 text-ink-700 ring-ink-200">{expense.method}</Badge>,
    },
    {
      key: 'amount',
      header: 'পরিমাণ',
      align: 'right',
      render: (expense) => (
        <span className={`tabular font-semibold ${expense.voidedAt ? 'text-ink-400 line-through' : 'text-ink-900'}`}>{formatMoney(expense.amount)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (expense) => (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(expense.id);
              setForm({
                date: toDateInputValue(expense.date),
                categoryId: expense.categoryId ?? '',
                amount: expense.amount,
                method: expense.method,
                payee: expense.payee,
                reference: expense.reference,
                description: expense.description,
                note: expense.note,
              });
              setError(null);
              setOpen(true);
            }}
          >
            সম্পাদনা
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm({ expense, action: expense.voidedAt ? 'restore' : 'void' })}>
            {expense.voidedAt ? 'ফিরিয়ে আনুন' : 'বাতিল'}
          </Button>
        </div>
      ),
    },
  ];

  const submit = async () => {
    setError(null);
    if (form.amount <= 0) {
      setError('খরচের পরিমাণ দিন');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        date: fromDateInputValue(form.date) ?? nowMs(),
        categoryId: form.categoryId || null,
        amount: form.amount,
        method: form.method,
        payee: form.payee,
        reference: form.reference,
        description: form.description,
        note: form.note,
      };
      if (editing) await updateExpense(editing, payload);
      else await createExpense(payload);
      await refresh();
      setOpen(false);
      setEditing(null);
      setForm({ date: toDateInputValue(nowMs()), categoryId: '', amount: 0, method: 'cash', payee: '', reference: '', description: '', note: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="খরচ"
        subtitle="বিজ্ঞাপন, প্যাকেজিং, ভাড়া — সব ব্যবসার খরচ এক জায়গায়"
        actions={
          <>
            <Button
              variant="outline"
              icon="download"
              onClick={async () => downloadCsv(await exportExpensesCsv(range.from, range.to), `expenses-${Date.now()}.csv`)}
            >
              CSV
            </Button>
            <Button icon="plus" onClick={() => { setEditing(null); setError(null); setOpen(true); }}>
              খরচ যোগ
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="মোট খরচ (নির্বাচিত সময়)" value={formatMoney(totalExpense, { compact: true })} tone="negative" />
        <StatCard label="খরচের সংখ্যা" value={String((totals.data ?? []).reduce((sum, row) => sum + row.count, 0))} />
        <StatCard label="সবচেয়ে বড় খাত" value={(totals.data ?? [])[0]?.categoryName ?? '—'} hint={(totals.data ?? [])[0] ? formatMoney(totals.data![0].amount, { compact: true }) : ''} />
      </div>

      <div className="mt-4">
        <Tabs
          tabs={[
            { key: 'list', label: 'খরচ তালিকা' },
            { key: 'categories', label: 'খাত অনুযায়ী' },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'list' ? (
        <Card className="mt-3">
          <CardHeader title="খরচ তালিকা" />
          <div className="space-y-2 border-b border-ink-100 px-4 py-3">
            <DateRangePicker preset={preset} range={range} onChange={(nextPreset, nextRange) => { setPreset(nextPreset); setRange(nextRange); pagination.reset(); }} />
            <div className="flex flex-wrap gap-2">
              <SearchInput value={query} onChange={setQuery} placeholder="বিবরণ, প্রাপক, রেফারেন্স…" className="min-w-[180px] flex-1" />
              <Select aria-label="খাত" options={[{ value: 'all', label: 'সব খাত' }, ...categories.options]} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-10 w-auto" />
              <Select aria-label="মাধ্যম" options={[{ value: 'all', label: 'সব মাধ্যম' }, ...paymentMethods.options]} value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)} className="h-10 w-auto" />
            </div>
          </div>
          <CardBody className="px-0 py-0">
            {!state.loading && rows.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon="expenses"
                  title="কোনো খরচ নথিভুক্ত নেই"
                  description="বিজ্ঞাপন, প্যাকেজিং, কুরিয়ার, ভাড়া — প্রতিদিনের খরচ লিখলে আসল লাভ দেখতে পারবেন।"
                  action={<Button icon="plus" onClick={() => setOpen(true)}>প্রথম খরচ যোগ করুন</Button>}
                />
              </div>
            ) : (
              <DataTable
                columns={columns}
                rows={rows}
                rowKey={(expense) => expense.id}
                loading={state.loading}
                renderCard={(expense) => (
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink-900">{expense.description || expense.categoryName}</p>
                        <p className="truncate text-xs text-ink-400">
                          {formatDate(expense.date)} • {expense.categoryName}
                        </p>
                      </div>
                      <span className={`tabular shrink-0 font-semibold ${expense.voidedAt ? 'text-ink-400 line-through' : 'text-ink-900'}`}>
                        {formatMoney(expense.amount)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(expense.id);
                          setForm({
                            date: toDateInputValue(expense.date),
                            categoryId: expense.categoryId ?? '',
                            amount: expense.amount,
                            method: expense.method,
                            payee: expense.payee,
                            reference: expense.reference,
                            description: expense.description,
                            note: expense.note,
                          });
                          setOpen(true);
                        }}
                      >
                        সম্পাদনা
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirm({ expense, action: expense.voidedAt ? 'restore' : 'void' })}>
                        {expense.voidedAt ? 'ফিরিয়ে আনুন' : 'বাতিল'}
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
      ) : (
        <Card className="mt-3">
          <CardHeader title="খাত অনুযায়ী খরচ" subtitle="নির্বাচিত সময়" />
          <CardBody>
            {(totals.data ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">এই সময়ে কোনো খরচ নেই।</p>
            ) : (
              <HorizontalBars items={(totals.data ?? []).map((row) => ({ label: row.categoryName, value: row.amount }))} />
            )}
          </CardBody>
        </Card>
      )}

      <Modal
        open={open}
        title={editing ? 'খরচ সম্পাদনা' : 'নতুন খরচ'}
        onClose={() => setOpen(false)}
        size="md"
        footer={
          <>
            {editing && (
              <Button variant="ghost" className="mr-auto text-rose-600" icon="trash" onClick={() => setConfirm({ expense: rows.find((r) => r.id === editing)!, action: 'delete' })}>
                মুছুন
              </Button>
            )}
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="তারিখ" required>
              {({ id }) => <Input id={id} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />}
            </Field>
            <Field label="খাত">
              {({ id }) => <Select id={id} options={categories.options} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} placeholder="নির্বাচন করুন" />}
            </Field>
            <Field label="পরিমাণ" required>
              {({ id }) => <MoneyInput id={id} value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} />}
            </Field>
            <Field label="মাধ্যম">
              {({ id }) => <Select id={id} options={paymentMethods.options} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} />}
            </Field>
            <Field label="বিবরণ" className="sm:col-span-2">
              {({ id }) => <Input id={id} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="যেমন: ফেসবুক বুস্ট" />}
            </Field>
            <Field label="কার কাছে দিলেন">
              {({ id }) => <Input id={id} value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} />}
            </Field>
            <Field label="রেফারেন্স">
              {({ id }) => <Input id={id} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} dir="ltr" />}
            </Field>
            <Field label="নোট" className="sm:col-span-2">
              {({ id }) => <Textarea id={id} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />}
            </Field>
          </div>

          {isPurchaseCategory && (
            <WarningBanner>
              “পণ্য ক্রয়” খাতে খরচ লিখলে স্টকে আসা পণ্যের সাথে দ্বিগুণ হিসাব হতে পারে। স্টকে যোগ করা পণ্যের জন্য <strong>ইনভেন্টরি → স্টক সমন্বয় (স্টক ক্রয়)</strong> ব্যবহার করুন।
              শুধু সরাসরি সোর্স করে বিক্রি করা পণ্যের ক্ষেত্রেই এই খাত ব্যবহার করুন।
            </WarningBanner>
          )}
          {isCourierCategory && (
            <WarningBanner>
              কুরিয়ার খরচ একবারই হিসাব হওয়া উচিত। কুরিয়ার পেজ থেকে “খরচ হিসেবে যোগ করুন” ব্যবহার করলে স্বয়ংক্রিয়ভাবে যুক্ত হয়ে যায় — তখন এখানে আলাদা করে লিখবেন না।
            </WarningBanner>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.action === 'void' ? 'খরচ বাতিল করবেন?' : confirm?.action === 'restore' ? 'খরচ ফিরিয়ে আনবেন?' : 'খরচ মুছে ফেলবেন?'}
        message={
          confirm?.action === 'void'
            ? `"${confirm.expense.description || confirm.expense.categoryName}" বাতিল করলে এটি মোট খরচ থেকে বাদ যাবে, তবে ইতিহাসে থেকে যাবে।`
            : confirm?.action === 'restore'
              ? 'খরচটি আবার মোট হিসাবে যুক্ত হবে।'
              : 'এই খরচের রেকর্ড স্থায়ীভাবে মুছে যাবে। কুরিয়ার রেকর্ড থেকে তৈরি খরচ মোছা যায় না।'
        }
        tone={confirm?.action === 'delete' ? 'danger' : 'primary'}
        confirmLabel={confirm?.action === 'delete' ? 'মুছে ফেলুন' : 'নিশ্চিত'}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          setBusy(true);
          try {
            if (confirm.action === 'void') await voidExpense(confirm.expense.id, 'ব্যবহারকারী বাতিল করেছেন');
            if (confirm.action === 'restore') await restoreExpense(confirm.expense.id);
            if (confirm.action === 'delete') {
              await deleteExpense(confirm.expense.id);
              setOpen(false);
            }
            await refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
            setConfirm(null);
          }
        }}
      />
    </>
  );
}
