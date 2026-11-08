import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button, LinkButton } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { useAsync } from '@/hooks/useAsync';
import { useAppContext } from '@/app/AppContext';
import { useStatusMeta } from '@/hooks/useTaxonomies';
import { addTag, archiveCustomer, customerStats, getCustomer, restoreCustomer } from '@/services/customerService';
import { db } from '@/db/db';
import { paymentsForOrder } from '@/services/paymentService';
import { formatDate } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE } from '@/domain/constants';
import type { Order } from '@/domain/types';

export default function CustomerDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { version, refresh } = useAppContext();
  const statusMeta = useStatusMeta();
  const [tagOpen, setTagOpen] = useState(false);
  const [tag, setTag] = useState('');

  const customer = useAsync(() => (id ? getCustomer(id) : Promise.resolve(undefined)), [id, version]);
  const stats = useAsync(() => (id ? customerStats(id) : Promise.resolve(null)), [id, version]);
  const orders = useAsync<Order[]>(async () => (id ? (await db.orders.where('customerId').equals(id).toArray()).sort((a, b) => b.orderDate - a.orderDate) : []), [id, version]);

  if (customer.loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (!customer.data) {
    return (
      <EmptyState
        icon="customers"
        title="কাস্টমার পাওয়া যায়নি"
        description="এই প্রোফাইলটি মুছে ফেলা হয়েছে অথবা লিঙ্কটি সঠিক নয়।"
        action={<LinkButton to="/customers">কাস্টমার তালিকায় যান</LinkButton>}
      />
    );
  }

  const current = customer.data;

  return (
    <>
      <PageHeader
        title={current.name}
        subtitle={`${current.phone || 'ফোন নেই'} • যোগদান: ${formatDate(current.createdAt)}`}
        back
        actions={
          <>
            <Button
              variant="outline"
              icon="archive"
              onClick={async () => {
                if (current.archivedAt) await restoreCustomer(current.id);
                else await archiveCustomer(current.id);
                await refresh();
              }}
            >
              {current.archivedAt ? 'পুনরুদ্ধার' : 'আর্কাইভ'}
            </Button>
            <Button variant="outline" icon="edit" onClick={() => navigate(`/customers/${current.id}/edit`)}>
              সম্পাদনা
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="মোট অর্ডার" value={String(stats.data?.orderCount ?? 0)} />
        <StatCard label="মোট কেনাবেচা" value={formatMoney(stats.data?.totalPurchase ?? 0, { compact: true })} tone="positive" />
        <StatCard label="পরিশোধিত" value={formatMoney(stats.data?.totalPaid ?? 0, { compact: true })} tone="info" />
        <StatCard label="বাকি" value={formatMoney(stats.data?.outstanding ?? 0, { compact: true })} tone={(stats.data?.outstanding ?? 0) > 0 ? 'warning' : 'default'} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="অর্ডার ইতিহাস" subtitle={`${orders.data?.length ?? 0} টি অর্ডার`} />
          <CardBody className="px-0 py-0">
            {(orders.data ?? []).length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-400">এই কাস্টমারের কোনো অর্ডার নেই।</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {(orders.data ?? []).map((order) => (
                  <OrderRow key={order.id} order={order} statusLabel={statusMeta.label(order.status)} statusTone={statusMeta.tone(order.status)} />
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="ঠিকানা ও নোট" />
            <CardBody className="space-y-2 text-sm">
              <p className="text-ink-700">{current.address || 'ঠিকানা দেওয়া হয়নি'}</p>
              <p className="text-xs text-ink-500">{[current.area, current.district].filter(Boolean).join(', ')}</p>
              {current.altPhone && <p className="text-xs text-ink-500">বিকল্প ফোন: {current.altPhone}</p>}
              {current.notes && <p className="whitespace-pre-line rounded-lg bg-ink-50 p-2 text-ink-700">{current.notes}</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="ট্যাগ"
              action={
                <Button size="sm" variant="subtle" icon="plus" onClick={() => setTagOpen(true)}>
                  যোগ
                </Button>
              }
            />
            <CardBody>
              {current.tags.length === 0 ? (
                <p className="text-sm text-ink-400">কোনো ট্যাগ নেই।</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {current.tags.map((item) => (
                    <Badge key={item} tone="bg-brand-50 text-brand-800 ring-brand-200">
                      {item}
                    </Badge>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Modal
        open={tagOpen}
        title="নতুন ট্যাগ"
        onClose={() => setTagOpen(false)}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setTagOpen(false)}>
              বাতিল
            </Button>
            <Button
              onClick={async () => {
                if (!tag.trim() || !id) return;
                await addTag(id, tag);
                await refresh();
                setTag('');
                setTagOpen(false);
              }}
            >
              যোগ করুন
            </Button>
          </>
        }
      >
        <Field label="ট্যাগ">
          {({ id: fieldId }) => <Input id={fieldId} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="যেমন: নিয়মিত" />}
        </Field>
      </Modal>
    </>
  );
}

function OrderRow({ order, statusLabel, statusTone }: { order: Order; statusLabel: string; statusTone: string }) {
  const payments = useAsync(() => paymentsForOrder(order.id), [order.id]);
  const paidIn = (payments.data ?? []).filter((p) => !p.voidedAt && p.kind === 'order_payment').reduce((sum, p) => sum + p.amount, 0);
  const toneClass: Record<string, string> = {
    neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
    info: 'bg-sky-50 text-sky-700 ring-sky-200',
    warning: 'bg-amber-50 text-amber-800 ring-amber-200',
    success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    danger: 'bg-rose-50 text-rose-700 ring-rose-200',
    purple: 'bg-violet-50 text-violet-700 ring-violet-200',
  };
  return (
    <li>
      <Link to={`/orders/${order.id}`} className="block px-4 py-3 hover:bg-brand-50/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink-900">{order.orderNumber}</p>
            <p className="text-xs text-ink-400">{formatDate(order.orderDate)}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="tabular text-sm font-semibold text-ink-900">{formatMoney(order.total)}</p>
            <p className="text-xs text-ink-500">পেইড {formatMoney(paidIn)}</p>
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Badge tone={toneClass[statusTone] ?? toneClass.neutral}>{statusLabel}</Badge>
          <Badge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>{PAYMENT_STATUS_LABEL[order.paymentStatus]}</Badge>
        </div>
      </Link>
    </li>
  );
}
