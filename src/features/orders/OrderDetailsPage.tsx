import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button, LinkButton } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/Controls';
import { Badge } from '@/components/ui/Badge';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState, ErrorBanner, Skeleton, WarningBanner } from '@/components/ui/Feedback';
import { Icon } from '@/components/ui/Icon';
import { useAsync } from '@/hooks/useAsync';
import { useAppContext } from '@/app/AppContext';
import { usePaymentMethods, useStatusMeta, useOrderStatuses } from '@/hooks/useTaxonomies';
import {
  archiveOrder,
  changeOrderStatus,
  checkOrderDelete,
  duplicateOrder,
  getOrder,
  hardDeleteOrder,
  orderEvents,
  restoreOrder,
} from '@/services/orderService';
import { paymentsForOrder, recordOrderPayment, totalsForOrder } from '@/services/paymentService';
import { returnsForOrder } from '@/services/returnService';
import { db } from '@/db/db';
import { formatDate, formatDateTime, nowMs, toDateInputValue, fromDateInputValue } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { PAYMENT_KIND_LABEL, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE } from '@/domain/constants';
import type { OrderStatusKey } from '@/domain/types';
import { StatusBadge } from './OrdersPage';
import { InvoicePrint } from './InvoicePrint';

export default function OrderDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { version, refresh, settings } = useAppContext();
  const statusMeta = useStatusMeta();
  const statuses = useOrderStatuses();
  const paymentMethods = usePaymentMethods();

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | 'archive' | 'duplicate' | 'delete' | 'restore'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteInfo, setDeleteInfo] = useState<string>('');

  const [paymentForm, setPaymentForm] = useState({ amount: 0, method: 'cash', date: toDateInputValue(nowMs()), note: '' });
  const [statusForm, setStatusForm] = useState<{ status: OrderStatusKey; reason: string; collect: number }>({
    status: 'confirmed',
    reason: '',
    collect: 0,
  });

  const order = useAsync(() => (id ? getOrder(id) : Promise.resolve(undefined)), [id, version]);
  const payments = useAsync(() => (id ? paymentsForOrder(id) : Promise.resolve([])), [id, version]);
  const totals = useAsync(() => (id ? totalsForOrder(id) : Promise.resolve({ paidIn: 0, refundedOut: 0, netPaid: 0, due: 0 })), [id, version]);
  const events = useAsync(() => (id ? orderEvents(id) : Promise.resolve([])), [id, version]);
  const returnRecords = useAsync(() => (id ? returnsForOrder(id) : Promise.resolve([])), [id, version]);
  const courier = useAsync(async () => (id ? (await db.courierRecords.where('orderId').equals(id).toArray()) : []), [id, version]);

  const due = useMemo(() => {
    if (!order.data || !totals.data) return 0;
    return Math.max(order.data.total - totals.data.netPaid, 0);
  }, [order.data, totals.data]);

  if (order.loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40" />
        <Skeleton className="h-56" />
      </div>
    );
  }

  if (!order.data) {
    return (
      <EmptyState
        icon="orders"
        title="অর্ডার পাওয়া যায়নি"
        description="এই অর্ডারটি মুছে ফেলা হয়েছে অথবা লিঙ্কটি সঠিক নয়।"
        action={<LinkButton to="/orders">অর্ডার তালিকায় যান</LinkButton>}
      />
    );
  }

  const current = order.data;

  const submitPayment = async () => {
    if (!id) return;
    if (paymentForm.amount <= 0) {
      setError('পরিমাণ ০ এর বেশি দিন');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recordOrderPayment({
        orderId: id,
        amount: paymentForm.amount,
        method: paymentForm.method,
        date: fromDateInputValue(paymentForm.date) ?? nowMs(),
        note: paymentForm.note,
      });
      await refresh();
      setPaymentOpen(false);
      setPaymentForm({ amount: 0, method: 'cash', date: toDateInputValue(nowMs()), note: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submitStatus = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await changeOrderStatus({
        id,
        status: statusForm.status,
        reason: statusForm.reason,
        collectPayment: statusForm.collect > 0 ? { amount: statusForm.collect, method: 'cash' } : null,
      });
      await refresh();
      setStatusOpen(false);
      setStatusForm({ status: 'confirmed', reason: '', collect: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runConfirm = async () => {
    if (!id || !confirm) return;
    setBusy(true);
    try {
      if (confirm === 'archive') await archiveOrder(id);
      if (confirm === 'restore') await restoreOrder(id);
      if (confirm === 'duplicate') {
        const copy = await duplicateOrder(id);
        await refresh();
        navigate(`/orders/${copy.id}`);
        return;
      }
      if (confirm === 'delete') {
        await hardDeleteOrder(id);
        await refresh();
        navigate('/orders');
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const openDelete = async () => {
    if (!id) return;
    const check = await checkOrderDelete(id);
    setDeleteInfo(check.reason);
    setConfirm('delete');
  };

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={current.orderNumber}
          subtitle={`${formatDate(current.orderDate)} • ${current.customerName || 'নগদ কাস্টমার'}`}
          back
          actions={
            <>
              <Button variant="outline" icon="print" onClick={() => window.print()}>
                প্রিন্ট
              </Button>
              <Button variant="outline" icon="edit" onClick={() => navigate(`/orders/${current.id}/edit`)}>
                সম্পাদনা
              </Button>
            </>
          }
        />

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        {current.archivedAt && (
          <WarningBanner
            action={
              <Button size="sm" variant="outline" onClick={() => setConfirm('restore')}>
                পুনরুদ্ধার
              </Button>
            }
          >
            এই অর্ডারটি আর্কাইভ করা আছে। আর্কাইভ করা অর্ডার ড্যাশবোর্ড ও রিপোর্টের মূল হিসাবে ধরা হয় না।
          </WarningBanner>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardHeader
                title="অর্ডার স্ট্যাটাস"
                action={<StatusBadge status={current.status} label={statusMeta.label(current.status)} tone={statusMeta.tone(current.status)} />}
              />
              <CardBody className="flex flex-wrap items-center gap-2">
                <Button icon="refresh" onClick={() => { setStatusForm({ status: current.status, reason: '', collect: 0 }); setStatusOpen(true); }}>
                  স্ট্যাটাস পরিবর্তন
                </Button>
                <Button variant="outline" icon="payments" onClick={() => setPaymentOpen(true)}>
                  পেমেন্ট যোগ
                </Button>
                <Button variant="ghost" icon="courier" onClick={() => navigate(`/courier?action=new&order=${current.id}`)}>
                  কুরিয়ার রেকর্ড
                </Button>
                <Button variant="ghost" icon="returns" onClick={() => navigate(`/returns?action=new&order=${current.id}`)}>
                  রিটার্ন নথিভুক্ত
                </Button>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="পণ্য ও হিসাব" />
              <CardBody className="px-0 py-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b border-ink-200 bg-ink-50/70 text-xs text-ink-600">
                        <th className="px-4 py-2 text-left font-semibold">পণ্য</th>
                        <th className="px-2 py-2 text-right font-semibold">পরিমাণ</th>
                        <th className="px-2 py-2 text-right font-semibold">দর</th>
                        <th className="px-4 py-2 text-right font-semibold">মোট</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.items.map((item) => (
                        <tr key={item.id} className="border-b border-ink-100">
                          <td className="px-4 py-2">
                            <p className="font-medium text-ink-800">{item.name}</p>
                            {item.sku && <p className="text-[11px] text-ink-400">SKU: {item.sku}</p>}
                          </td>
                          <td className="tabular px-2 py-2 text-right">
                            {item.quantity} {item.unit}
                          </td>
                          <td className="tabular px-2 py-2 text-right">{formatMoney(item.unitPrice)}</td>
                          <td className="tabular px-4 py-2 text-right font-medium">{formatMoney(item.lineTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <dl className="space-y-1.5 border-t border-ink-100 px-4 py-3 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-ink-600">সাবটোটাল</dt>
                    <dd className="tabular">{formatMoney(current.subtotal)}</dd>
                  </div>
                  {current.discount > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-ink-600">ছাড়</dt>
                      <dd className="tabular">- {formatMoney(current.discount)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-ink-600">ডেলিভারি চার্জ</dt>
                    <dd className="tabular">{formatMoney(current.deliveryCharge)}</dd>
                  </div>
                  {current.otherCharge > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-ink-600">অন্যান্য চার্জ</dt>
                      <dd className="tabular">{formatMoney(current.otherCharge)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-ink-200 pt-1.5 text-base font-bold">
                    <dt>সর্বমোট</dt>
                    <dd className="tabular">{formatMoney(current.total)}</dd>
                  </div>
                  <div className="flex justify-between text-brand-700">
                    <dt>পরিশোধিত</dt>
                    <dd className="tabular">{formatMoney(totals.data?.paidIn ?? 0)}</dd>
                  </div>
                  {(totals.data?.refundedOut ?? 0) > 0 && (
                    <div className="flex justify-between text-rose-600">
                      <dt>রিফান্ড</dt>
                      <dd className="tabular">{formatMoney(totals.data?.refundedOut ?? 0)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold text-amber-700">
                    <dt>বাকি</dt>
                    <dd className="tabular">{formatMoney(due)}</dd>
                  </div>
                  <div className="mt-2 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500">
                    আনুমানিক লাভ (পণ্যের ক্রয়মূল্য বাদ): {formatMoney(current.subtotal - current.discount - current.cogs)}
                  </div>
                </dl>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="পেমেন্ট ইতিহাস"
                action={
                  <Button size="sm" variant="subtle" icon="plus" onClick={() => setPaymentOpen(true)}>
                    পেমেন্ট
                  </Button>
                }
              />
              <CardBody className="px-0 py-0">
                {(payments.data ?? []).length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-ink-400">এই অর্ডারে কোনো পেমেন্ট নথিভুক্ত হয়নি।</p>
                ) : (
                  <ul className="divide-y divide-ink-100">
                    {(payments.data ?? []).map((payment) => (
                      <li key={payment.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-ink-800">
                            {PAYMENT_KIND_LABEL[payment.kind] ?? payment.kind} • {payment.method}
                          </p>
                          <p className="truncate text-xs text-ink-400">
                            {formatDate(payment.date)}
                            {payment.note ? ` • ${payment.note}` : ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={`tabular text-sm font-semibold ${payment.direction === 'in' ? 'text-brand-700' : 'text-rose-600'}`}>
                            {payment.direction === 'in' ? '+' : '-'}
                            {formatMoney(payment.amount)}
                          </p>
                          {payment.voidedAt && <Badge tone="bg-ink-100 text-ink-500 ring-ink-200">বাতিল</Badge>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="কার্যক্রম ইতিহাস" icon={<Icon name="clock" size={16} />} />
              <CardBody className="px-0 py-0">
                <ul className="divide-y divide-ink-100">
                  {(events.data ?? []).map((event) => (
                    <li key={event.id} className="px-4 py-2.5">
                      <p className="text-sm text-ink-800">{event.message}</p>
                      <p className="text-xs text-ink-400">{formatDateTime(event.createdAt)}</p>
                    </li>
                  ))}
                  {(events.data ?? []).length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-400">কোনো কার্যক্রম নেই।</li>}
                </ul>
              </CardBody>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader title="কাস্টমার ও ডেলিভারি" />
              <CardBody className="space-y-2 text-sm">
                <Row label="নাম" value={current.customerName || 'নগদ কাস্টমার'} />
                <Row label="ফোন" value={current.customerPhone || '—'} />
                <Row label="ঠিকানা" value={current.deliveryAddress || '—'} />
                <Row label="চ্যানেল" value={current.channel} />
                <Row label="কুরিয়ার" value={current.courierName || '—'} />
                <Row label="কনসাইনমেন্ট" value={current.trackingNumber || '—'} />
                <Row label="পেমেন্ট স্ট্যাটাস">
                  <Badge tone={PAYMENT_STATUS_TONE[current.paymentStatus]}>{PAYMENT_STATUS_LABEL[current.paymentStatus]}</Badge>
                </Row>
                {current.customerId && (
                  <LinkButton to={`/customers/${current.customerId}`} variant="outline" size="sm" block icon="user" className="mt-2">
                    কাস্টমার প্রোফাইল
                  </LinkButton>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="নোট" />
              <CardBody className="space-y-2 text-sm">
                {current.customerInstructions && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                    <span className="font-medium">কাস্টমারের নির্দেশ: </span>
                    {current.customerInstructions}
                  </p>
                )}
                {current.notes ? <p className="whitespace-pre-line text-ink-700">{current.notes}</p> : <p className="text-ink-400">কোনো নোট নেই।</p>}
                {current.cancelReason && <p className="rounded-lg bg-rose-50 px-3 py-2 text-rose-800">{current.cancelReason}</p>}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="কুরিয়ার ও রিটার্ন" />
              <CardBody className="space-y-3 text-sm">
                <div>
                  <p className="mb-1 text-xs font-semibold text-ink-500">কুরিয়ার রেকর্ড</p>
                  {(courier.data ?? []).length === 0 ? (
                    <p className="text-ink-400">কোনো কুরিয়ার রেকর্ড নেই।</p>
                  ) : (
                    <ul className="space-y-1">
                      {(courier.data ?? []).map((record) => (
                        <li key={record.id} className="flex items-center justify-between gap-2 rounded-lg border border-ink-200 px-2.5 py-1.5">
                          <span className="min-w-0 truncate">{record.courierName}</span>
                          <span className="shrink-0 text-xs text-ink-500">{record.consignmentId || '—'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold text-ink-500">রিটার্ন</p>
                  {(returnRecords.data ?? []).length === 0 ? (
                    <p className="text-ink-400">কোনো রিটার্ন নেই।</p>
                  ) : (
                    <ul className="space-y-1">
                      {(returnRecords.data ?? []).map((record) => (
                        <li key={record.id} className="flex items-center justify-between gap-2 rounded-lg border border-ink-200 px-2.5 py-1.5">
                          <span className="min-w-0 truncate">{record.returnNumber}</span>
                          <span className="shrink-0 text-xs text-ink-500">{formatMoney(record.refundAmount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="অন্যান্য কাজ" />
              <CardBody className="space-y-2">
                <Button variant="outline" block icon="copy" onClick={() => setConfirm('duplicate')}>
                  অর্ডার কপি করুন
                </Button>
                <Button variant="outline" block icon="archive" onClick={() => setConfirm('archive')}>
                  আর্কাইভ করুন
                </Button>
                <Button variant="ghost" block icon="trash" onClick={openDelete} className="text-rose-600">
                  স্থায়ীভাবে মুছুন
                </Button>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>

      <InvoicePrint order={current} settings={settings} paidIn={totals.data?.paidIn ?? 0} refunded={totals.data?.refundedOut ?? 0} />

      <Modal
        open={paymentOpen}
        title="পেমেন্ট নথিভুক্ত করুন"
        onClose={() => setPaymentOpen(false)}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setPaymentOpen(false)}>
              বাতিল
            </Button>
            <Button onClick={submitPayment} loading={busy}>
              সংরক্ষণ
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <ErrorBanner message={error} />}
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm">
            সর্বমোট {formatMoney(current.total)} • পরিশোধিত {formatMoney(totals.data?.paidIn ?? 0)} • বাকি {formatMoney(due)}
          </p>
          <Field label="পরিমাণ" required>
            {({ id }) => <MoneyInput id={id} value={paymentForm.amount} onChange={(value) => setPaymentForm({ ...paymentForm, amount: value })} />}
          </Field>
          <Field label="মাধ্যম">
            {({ id }) => (
              <Select id={id} options={paymentMethods.options} value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })} />
            )}
          </Field>
          <Field label="তারিখ">
            {({ id }) => <Input id={id} type="date" value={paymentForm.date} onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })} />}
          </Field>
          <Field label="নোট">
            {({ id }) => <Input id={id} value={paymentForm.note} onChange={(e) => setPaymentForm({ ...paymentForm, note: e.target.value })} />}
          </Field>
        </div>
      </Modal>

      <Modal
        open={statusOpen}
        title="স্ট্যাটাস পরিবর্তন"
        onClose={() => setStatusOpen(false)}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setStatusOpen(false)}>
              বাতিল
            </Button>
            <Button onClick={submitStatus} loading={busy}>
              হালনাগাদ
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <ErrorBanner message={error} />}
          <Field label="নতুন স্ট্যাটাস">
            {({ id }) => (
              <Select
                id={id}
                options={statuses.map((s) => ({ value: s.value, label: s.label }))}
                value={statusForm.status}
                onChange={(e) => setStatusForm({ ...statusForm, status: e.target.value as OrderStatusKey })}
              />
            )}
          </Field>
          {statusForm.status === 'cancelled' && (
            <Field label="বাতিলের কারণ">
              {({ id }) => <Input id={id} value={statusForm.reason} onChange={(e) => setStatusForm({ ...statusForm, reason: e.target.value })} />}
            </Field>
          )}
          {statusForm.status === 'delivered' && (
            <Field label="ডেলিভারির সময় টাকা পেলে সেই পরিমাণ" hint="COD হলে এখানে লিখুন">
              {({ id }) => <MoneyInput id={id} value={statusForm.collect} onChange={(value) => setStatusForm({ ...statusForm, collect: value })} />}
            </Field>
          )}
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
            স্ট্যাটাস “কনফার্মড” বা তার পরের ধাপে গেলে স্টক কেটে যায়। “বাতিল” করলে কাটা স্টক ফেরত আসে। রিটার্নের ক্ষেত্রে স্টক ফেরত রিটার্ন মডিউল থেকে হয়।
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === 'archive'
            ? 'অর্ডার আর্কাইভ করবেন?'
            : confirm === 'duplicate'
              ? 'অর্ডার কপি করবেন?'
              : confirm === 'restore'
                ? 'অর্ডার পুনরুদ্ধার করবেন?'
                : 'অর্ডার মুছে ফেলবেন?'
        }
        message={
          confirm === 'archive'
            ? 'আর্কাইভ করা অর্ডার তালিকা ও রিপোর্ট থেকে সরে যায়, কিন্তু তথ্য মুছে যায় না।'
            : confirm === 'duplicate'
              ? 'একই পণ্য ও কাস্টমার দিয়ে নতুন একটি অর্ডার তৈরি হবে। পেমেন্ট কপি করা হবে না।'
              : confirm === 'restore'
                ? 'অর্ডারটি আবার সাধারণ তালিকায় ফিরে আসবে।'
                : deleteInfo
        }
        tone={confirm === 'delete' ? 'danger' : 'primary'}
        confirmLabel={confirm === 'delete' ? 'মুছে ফেলুন' : 'নিশ্চিত'}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={runConfirm}
      />
    </>
  );
}

function Row({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-ink-500">{label}</span>
      {children ?? <span className="min-w-0 text-right text-ink-800">{value}</span>}
    </div>
  );
}
