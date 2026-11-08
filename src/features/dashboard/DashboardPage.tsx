import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { DateRangePicker, Money } from '@/components/ui/Controls';
import { EmptyState, ErrorBanner, Skeleton } from '@/components/ui/Feedback';
import { LinkButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { BarChart, DonutChart, HorizontalBars, TrendChart } from '@/components/charts/Charts';
import { useAsync } from '@/hooks/useAsync';
import { useAppContext } from '@/app/AppContext';
import {
  categoryPerformance,
  dashboardMetrics,
  incomeVsExpense,
  loadRange,
  recentActivity,
  salesTrend,
  statusDistribution,
  topProducts,
} from '@/services/reportService';
import { ordersNeedingAttention } from '@/services/orderService';
import { rangeForPreset, type DateRange, type DateRangePreset } from '@/lib/date';
import { formatDate, formatDateTime, relativeTime } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { ORDER_STATUS_TONE_CLASS } from '@/domain/constants';

export default function DashboardPage() {
  const { version, settings } = useAppContext();
  const [preset, setPreset] = useState<DateRangePreset>('last30');
  const [range, setRange] = useState<DateRange>(() => rangeForPreset('last30'));

  const metrics = useAsync(() => dashboardMetrics(range), [version, range.from, range.to]);
  const trend = useAsync(() => salesTrend(range, range.from && range.to && range.to - range.from > 86400000 * 92 ? 'month' : 'day'), [version, range.from, range.to]);
  const statuses = useAsync(() => statusDistribution(range), [version, range.from, range.to]);
  const products = useAsync(() => topProducts(range, 6), [version, range.from, range.to]);
  const categories = useAsync(() => categoryPerformance(range), [version, range.from, range.to]);
  const inOut = useAsync(() => incomeVsExpense(range, 'month'), [version, range.from, range.to]);
  const attention = useAsync(() => ordersNeedingAttention(6), [version]);
  const activity = useAsync(() => recentActivity(6), [version]);
  const rangeOrders = useAsync(() => loadRange(range, 8).then((data) => data.orders), [version, range.from, range.to]);

  const bengali = settings?.locale?.bengaliDigits ?? true;
  const fmtCompact = (value: number) => formatMoney(value, { bengaliDigits: bengali, compact: true });

  const hasData = (metrics.data?.totalOrders ?? 0) > 0;
  const loading = metrics.loading;

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 6) return 'শুভ রাত';
    if (hour < 12) return 'শুভ সকাল';
    if (hour < 17) return 'শুভ অপরাহ্ণ';
    return 'শুভ সন্ধ্যা';
  }, []);

  return (
    <>
      <PageHeader
        title={`${greeting}${settings?.business?.name ? `, ${settings.business.name}` : ''}`}
        subtitle="আপনার ব্যবসার আজকের চিত্র এক নজরে"
        actions={
          <LinkButton to="/orders/new" icon="plus" size="sm">
            নতুন অর্ডার
          </LinkButton>
        }
      >
        <DateRangePicker preset={preset} range={range} onChange={(nextPreset, nextRange) => { setPreset(nextPreset); setRange(nextRange); }} />
      </PageHeader>

      {metrics.error && <ErrorBanner message={metrics.error.message} onRetry={metrics.reload} />}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : !hasData ? (
        <EmptyDashboard />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="মোট বিক্রয়" value={fmtCompact(metrics.data?.rangeSales ?? 0)} hint={`${metrics.data?.totalOrders ?? 0} টি অর্ডার`} tone="positive" />
            <StatCard label="আদায়কৃত পেমেন্ট" value={fmtCompact(metrics.data?.collected ?? 0)} hint="নির্বাচিত সময়ে" tone="info" />
            <StatCard label="বাকি (কাস্টমার)" value={fmtCompact(metrics.data?.outstanding ?? 0)} hint="সব অর্ডার মিলিয়ে" tone="warning" />
            <StatCard label="কুরিয়ার COD বাকি" value={fmtCompact(metrics.data?.codReceivable ?? 0)} hint={metrics.data?.codPipeline ? `পাইপলাইনে ${fmtCompact(metrics.data.codPipeline)}` : 'পেআউট বাকি'} />
            <StatCard label="আনুমানিক লাভ" value={fmtCompact(metrics.data?.estimatedProfit ?? 0)} hint="বিক্রয় − ক্রয়মূল্য − কুরিয়ার" tone="positive" />
            <StatCard label="বাস্তবায়িত লাভ" value={fmtCompact(metrics.data?.realizedProfit ?? 0)} hint="ডেলিভার্ড ও পেইড অর্ডার − খরচ" />
            <StatCard label="খরচ" value={fmtCompact(metrics.data?.expenses ?? 0)} hint="নির্বাচিত সময়ে" tone="negative" />
            <StatCard label="কম স্টকের পণ্য" value={`${metrics.data?.lowStock ?? 0}`} hint={`স্টক শেষ: ${metrics.data?.outOfStock ?? 0}`} tone="warning" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="বিক্রয় ও লাভ প্রবণতা" subtitle="নির্বাচিত সময় অনুযায়ী" />
              <CardBody>
                {trend.loading ? <Skeleton className="h-52" /> : <TrendChart data={(trend.data ?? []).map((p) => ({ label: p.label, sales: p.sales, profit: p.profit }))} />}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="অর্ডার স্ট্যাটাস" subtitle="নির্বাচিত সময়" />
              <CardBody>
                {statuses.loading ? (
                  <Skeleton className="h-44" />
                ) : (
                  <DonutChart
                    slices={(statuses.data ?? []).map((s) => ({ label: s.label, value: s.count }))}
                    centerLabel={String(statuses.data?.reduce((sum, s) => sum + s.count, 0) ?? 0)}
                  />
                )}
              </CardBody>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader title="সর্বাধিক বিক্রিত পণ্য" />
              <CardBody>
                {products.loading ? (
                  <Skeleton className="h-40" />
                ) : (
                  <HorizontalBars items={(products.data ?? []).map((p) => ({ label: p.name, value: p.revenue }))} formatter={fmtCompact} />
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="আয় বনাম খরচ" subtitle="মাসিক" />
              <CardBody>
                {inOut.loading ? (
                  <Skeleton className="h-40" />
                ) : (
                  <BarChart data={(inOut.data ?? []).map((p) => ({ label: p.label, value: p.income - p.expense }))} valueFormatter={fmtCompact} emptyMessage="এই সময়ে তথ্য নেই" />
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="ক্যাটেগরি পারফরম্যান্স" />
              <CardBody>
                {categories.loading ? (
                  <Skeleton className="h-40" />
                ) : (
                  <HorizontalBars items={(categories.data ?? []).slice(0, 6).map((c) => ({ label: c.name, value: c.revenue }))} formatter={fmtCompact} />
                )}
              </CardBody>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="সাম্প্রতিক অর্ডার"
                action={
                  <Link to="/orders" className="text-xs font-medium text-brand-700 hover:underline">
                    সব দেখুন
                  </Link>
                }
              />
              <CardBody className="px-0 py-0">
                {(rangeOrders.data ?? []).length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-ink-400">এই সময়ে কোনো অর্ডার নেই।</p>
                ) : (
                  <ul className="divide-y divide-ink-100">
                    {(rangeOrders.data ?? []).slice(0, 6).map((order) => (
                      <li key={order.id}>
                        <Link to={`/orders/${order.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-brand-50/40">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink-800">{order.customerName || 'নগদ কাস্টমার'}</p>
                            <p className="text-xs text-ink-400">
                              {order.orderNumber} • {formatDate(order.orderDate, { bengaliDigits: bengali })}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <Money value={order.total} className="block text-sm font-semibold text-ink-900" />
                            <Badge tone={ORDER_STATUS_TONE_CLASS[statusToneKey(order.status)] ?? ORDER_STATUS_TONE_CLASS.neutral}>
                              {statusLabel(order.status)}
                            </Badge>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="কার্যক্রম ও মনে করিয়ে দেওয়া" />
              <CardBody className="space-y-4">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">অগ্রাধিকার কাজ</p>
                  {(attention.data ?? []).length === 0 ? (
                    <p className="text-sm text-ink-400">কোনো বকেয়া কাজ নেই — সব ঠিকঠাক আছে।</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {(attention.data ?? []).slice(0, 4).map((order) => (
                        <li key={order.id}>
                          <Link to={`/orders/${order.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 px-3 py-2 text-sm hover:border-brand-300">
                            <span className="min-w-0 truncate">
                              {order.orderNumber} • {order.customerName || 'নগদ কাস্টমার'}
                            </span>
                            <span className="shrink-0 text-xs text-ink-500">{relativeTime(order.orderDate)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">সাম্প্রতিক কার্যক্রম</p>
                  {(activity.data ?? []).length === 0 ? (
                    <p className="text-sm text-ink-400">এখনো কোনো কার্যক্রম নেই।</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {(activity.data ?? []).slice(0, 5).map((item) => (
                        <li key={item.id} className="flex items-start gap-2 text-sm">
                          <Icon name="clock" size={15} className="mt-1 shrink-0 text-ink-300" />
                          <span className="min-w-0 flex-1">
                            <span className="text-ink-700">{item.message}</span>
                            <span className="ml-1 text-xs text-ink-400">({formatDateTime(item.at, { bengaliDigits: bengali })})</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardBody>
            </Card>
          </div>

          <p className="mt-4 text-[11px] text-ink-400">
            আনুমানিক লাভ = বিক্রয় − পণ্যের ক্রয়মূল্য − কুরিয়ার খরচ (অর্ডারের সময়কার হিসাব)। বাস্তবায়িত লাভ শুধু সেই অর্ডারগুলো থেকে যেগুলো ডেলিভার্ড এবং সম্পূর্ণ পরিশোধিত, তারপর সময়ের খরচ বাদ।
            বিস্তারিত: <Link to="/help" className="text-brand-700 hover:underline">ব্যবহারবিধি</Link>।
          </p>
        </>
      )}
    </>
  );
}

function EmptyDashboard() {
  return (
    <Card>
      <CardBody className="py-10">
        <EmptyState
          icon="dashboard"
          title="আপনার ব্যবসার তথ্য এখনো যোগ করা হয়নি"
          description="প্রথমে ব্যবসার তথ্য, পণ্য ও একটি অর্ডার যোগ করুন। তারপর এই ড্যাশবোর্ডে সব হিসাব স্বয়ংক্রিয়ভাবে দেখা যাবে।"
          action={
            <LinkButton to="/products/new" icon="plus">
              প্রথম পণ্য যোগ করুন
            </LinkButton>
          }
          secondaryAction={
            <LinkButton to="/help" variant="outline" icon="help">
              ব্যবহারবিধি দেখুন
            </LinkButton>
          }
        />
        <ol className="mx-auto mt-8 max-w-md space-y-2 text-sm text-ink-600">
          {[
            'ব্যবসার নাম ও ঠিকানা সেট করুন (সেটিংস)',
            'পণ্য যোগ করুন ও স্টক দিন',
            'কাস্টমার যোগ করুন',
            'অর্ডার তৈরি করুন ও পেমেন্ট নথিভুক্ত করুন',
            'কুরিয়ার ও খরচ যোগ করে লাভ দেখুন',
          ].map((step, index) => (
            <li key={step} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-800">
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

const STATUS_LABELS: Record<string, string> = {
  new: 'নতুন',
  pending: 'কনফার্ম বাকি',
  confirmed: 'কনফার্মড',
  processing: 'প্রসেসিং',
  ready: 'প্যাকিং ডান',
  shipped: 'পাঠানো হয়েছে',
  delivered: 'ডেলিভার্ড',
  cancelled: 'বাতিল',
  returned: 'রিটার্ন',
  exchanged: 'এক্সচেঞ্জ',
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

const STATUS_TONES: Record<string, string> = {
  new: 'info',
  pending: 'warning',
  confirmed: 'info',
  processing: 'purple',
  ready: 'purple',
  shipped: 'info',
  delivered: 'success',
  cancelled: 'danger',
  returned: 'danger',
  exchanged: 'warning',
};

function statusToneKey(status: string): string {
  return STATUS_TONES[status] ?? 'neutral';
}
