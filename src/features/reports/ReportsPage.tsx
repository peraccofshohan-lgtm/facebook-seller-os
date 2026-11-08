import { useMemo, useState } from 'react';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { DateRangePicker, Money } from '@/components/ui/Controls';
import { DataTable, type Column } from '@/components/ui/Table';
import { EmptyState, ErrorBanner, InfoBanner } from '@/components/ui/Feedback';
import { Badge } from '@/components/ui/Badge';
import { TrendChart } from '@/components/charts/Charts';
import { useAsync } from '@/hooks/useAsync';
import { useAppContext } from '@/app/AppContext';
import {
  codReconciliationReport,
  customerReport,
  inventoryReport,
  outstandingReport,
  paymentCollectionReport,
  productSalesReport,
  profitLossReport,
  returnReport,
  salesReport,
  salesTrend,
  stockMovementReport,
} from '@/services/reportService';
import { categoryTotals } from '@/services/expenseService';
import { courierReport } from '@/services/reportService';
import { toCsv } from '@/lib/csv';
import { downloadCsv } from '@/lib/download';
import { formatDate, rangeForPreset, toDateInputValue, type DateRange, type DateRangePreset } from '@/lib/date';
import { formatMoney, moneyToDecimalString } from '@/lib/money';
import { COURIER_STATUS_LABEL, PAYMENT_KIND_LABEL, PAYMENT_STATUS_LABEL, RETURN_REASON_LABEL, RETURN_TYPE_LABEL, STOCK_MOVEMENT_LABEL } from '@/domain/constants';

type ReportKey =
  | 'sales'
  | 'profit'
  | 'products'
  | 'customers'
  | 'expenses'
  | 'courier'
  | 'cod'
  | 'returns'
  | 'inventory'
  | 'stock'
  | 'payments'
  | 'outstanding';

const REPORT_OPTIONS: { value: ReportKey; label: string }[] = [
  { value: 'sales', label: 'বিক্রয় রিপোর্ট' },
  { value: 'profit', label: 'লাভ-ক্ষতি রিপোর্ট' },
  { value: 'products', label: 'পণ্য বিক্রয়' },
  { value: 'customers', label: 'কাস্টমার রিপোর্ট' },
  { value: 'expenses', label: 'খরচ রিপোর্ট' },
  { value: 'courier', label: 'কুরিয়ার রিপোর্ট' },
  { value: 'cod', label: 'COD হিসাব মিলানো' },
  { value: 'returns', label: 'রিটার্ন রিপোর্ট' },
  { value: 'inventory', label: 'ইনভেন্টরি রিপোর্ট' },
  { value: 'stock', label: 'স্টক মুভমেন্ট' },
  { value: 'payments', label: 'আদায় রিপোর্ট' },
  { value: 'outstanding', label: 'বাকি রিপোর্ট' },
];

interface Built<T> {
  title: string;
  subtitle?: string;
  columns: Column<T>[];
  rows: T[];
  csv: string[][];
  summary?: { label: string; value: string }[];
}

export default function ReportsPage() {
  const { version } = useAppContext();
  const [report, setReport] = useState<ReportKey>('sales');
  const [preset, setPreset] = useState<DateRangePreset>('thisMonth');
  const [range, setRange] = useState<DateRange>(() => rangeForPreset('thisMonth'));
  const [limit, setLimit] = useState(200);

  const data = useAsync(async () => {
    switch (report) {
      case 'sales': {
        const [rows, trend] = await Promise.all([salesReport(range, limit), salesTrend(range, 'day')]);
        return {
          kind: 'sales' as const,
          rows,
          trend,
        };
      }
      case 'profit':
        return { kind: 'profit' as const, data: await profitLossReport(range) };
      case 'products':
        return { kind: 'products' as const, rows: await productSalesReport(range, limit) };
      case 'customers':
        return { kind: 'customers' as const, rows: await customerReport(range, limit) };
      case 'expenses':
        return { kind: 'expenses' as const, rows: await categoryTotals({ from: range.from, to: range.to }) };
      case 'courier':
        return { kind: 'courier' as const, rows: await courierReport(range, limit) };
      case 'cod':
        return { kind: 'cod' as const, data: await codReconciliationReport() };
      case 'returns':
        return { kind: 'returns' as const, data: await returnReport(range, limit) };
      case 'inventory':
        return { kind: 'inventory' as const, data: await inventoryReport() };
      case 'stock':
        return { kind: 'stock' as const, rows: await stockMovementReport(range, limit) };
      case 'payments':
        return { kind: 'payments' as const, rows: await paymentCollectionReport(range, limit) };
      case 'outstanding':
        return { kind: 'outstanding' as const, data: await outstandingReport() };
      default:
        return { kind: 'sales' as const, rows: [], trend: [] };
    }
  }, [version, report, range.from, range.to, limit]);

  const built = useMemo<Built<never> | null>(() => {
    if (!data.data) return null;
    const source = data.data;
    switch (source.kind) {
      case 'sales': {
        type Row = (typeof source.rows)[number];
        const totalSales = source.rows.reduce((sum, row) => sum + row.order.total, 0);
        const totalDue = source.rows.reduce((sum, row) => sum + row.due, 0);
        const totalProfit = source.rows.reduce((sum, row) => sum + row.profit, 0);
        return {
          title: 'বিক্রয় রিপোর্ট',
          columns: [
            { key: 'orderNumber', header: 'অর্ডার', render: (row: Row) => row.order.orderNumber },
            { key: 'date', header: 'তারিখ', render: (row: Row) => formatDate(row.order.orderDate) },
            { key: 'customer', header: 'কাস্টমার', render: (row: Row) => row.order.customerName || 'নগদ' },
            { key: 'total', header: 'মোট', align: 'right', render: (row: Row) => <Money value={row.order.total} /> },
            { key: 'paid', header: 'পরিশোধ', align: 'right', render: (row: Row) => <Money value={row.paidIn} /> },
            { key: 'due', header: 'বাকি', align: 'right', render: (row: Row) => <Money value={row.due} className="text-amber-700" /> },
            { key: 'profit', header: 'লাভ', align: 'right', render: (row: Row) => <Money value={row.profit} /> },
            { key: 'status', header: 'স্ট্যাটাস', align: 'center', render: (row: Row) => <Badge>{row.order.status}</Badge> },
          ] as Column<never>[],
          rows: source.rows as never[],
          csv: [
            ['অর্ডার', 'তারিখ', 'কাস্টমার', 'মোট', 'পরিশোধ', 'বাকি', 'লাভ', 'স্ট্যাটাস'],
            ...source.rows.map((row) => [
              row.order.orderNumber,
              toDateInputValue(row.order.orderDate),
              row.order.customerName,
              moneyToDecimalString(row.order.total),
              moneyToDecimalString(row.paidIn),
              moneyToDecimalString(row.due),
              moneyToDecimalString(row.profit),
              row.order.status,
            ]),
          ],
          summary: [
            { label: 'মোট বিক্রয়', value: formatMoney(totalSales) },
            { label: 'মোট বাকি', value: formatMoney(totalDue) },
            { label: 'আনুমানিক লাভ', value: formatMoney(totalProfit) },
            { label: 'অর্ডার সংখ্যা', value: String(source.rows.length) },
          ],
        } as Built<never>;
      }
      case 'profit': {
        const d = source.data;
        return {
          title: 'লাভ-ক্ষতি রিপোর্ট',
          columns: [] as Column<never>[],
          rows: [] as never[],
          csv: [
            ['বিবরণ', 'পরিমাণ'],
            ['মোট বিক্রয়', moneyToDecimalString(d.grossSales)],
            ['ছাড়', moneyToDecimalString(d.discounts)],
            ['রিফান্ড', moneyToDecimalString(d.refunds)],
            ['নিট আয়', moneyToDecimalString(d.netRevenue)],
            ['পণ্যের ক্রয়মূল্য (COGS)', moneyToDecimalString(d.cogs)],
            ['স্থূল লাভ', moneyToDecimalString(d.grossProfit)],
            ...d.expenseByCategory.map((row) => [`খরচ: ${row.name}`, moneyToDecimalString(row.amount)]),
            ['মোট খরচ', moneyToDecimalString(d.operatingExpenses)],
            ['পরিচালন লাভ', moneyToDecimalString(d.operatingProfit)],
            ['আনুমানিক লাভ (সব অর্ডার)', moneyToDecimalString(d.estimatedProfit)],
            ['বাস্তবায়িত লাভ (ডেলিভার্ড+পেইড)', moneyToDecimalString(d.realizedProfit)],
          ],
          summary: [
            { label: 'নিট আয়', value: formatMoney(d.netRevenue) },
            { label: 'স্থূল লাভ', value: formatMoney(d.grossProfit) },
            { label: 'পরিচালন লাভ', value: formatMoney(d.operatingProfit) },
            { label: 'আনুমানিক লাভ', value: formatMoney(d.estimatedProfit) },
            { label: 'বাস্তবায়িত লাভ', value: formatMoney(d.realizedProfit) },
          ],
        } as Built<never>;
      }
      case 'products': {
        type Row = (typeof source.rows)[number];
        return {
          title: 'পণ্য বিক্রয় রিপোর্ট',
          columns: [
            { key: 'name', header: 'পণ্য', render: (row: Row) => row.name },
            { key: 'sku', header: 'SKU', render: (row: Row) => row.sku || '—' },
            { key: 'qty', header: 'বিক্রিত', align: 'right', render: (row: Row) => String(row.quantity) },
            { key: 'revenue', header: 'বিক্রয়', align: 'right', render: (row: Row) => <Money value={row.revenue} /> },
            { key: 'cost', header: 'ক্রয়মূল্য', align: 'right', render: (row: Row) => <Money value={row.cost} /> },
            { key: 'profit', header: 'লাভ', align: 'right', render: (row: Row) => <Money value={row.profit} className="text-brand-700" /> },
          ] as Column<never>[],
          rows: source.rows as never[],
          csv: [
            ['পণ্য', 'SKU', 'পরিমাণ', 'বিক্রয়', 'ক্রয়মূল্য', 'লাভ'],
            ...source.rows.map((row) => [row.name, row.sku, String(row.quantity), moneyToDecimalString(row.revenue), moneyToDecimalString(row.cost), moneyToDecimalString(row.profit)]),
          ],
        } as Built<never>;
      }
      case 'customers': {
        type Row = (typeof source.rows)[number];
        return {
          title: 'কাস্টমার রিপোর্ট',
          columns: [
            { key: 'name', header: 'নাম', render: (row: Row) => row.name },
            { key: 'phone', header: 'ফোন', render: (row: Row) => row.phone || '—' },
            { key: 'orders', header: 'অর্ডার', align: 'right', render: (row: Row) => String(row.orders) },
            { key: 'revenue', header: 'মোট কেনা', align: 'right', render: (row: Row) => <Money value={row.revenue} /> },
            { key: 'paid', header: 'পরিশোধ', align: 'right', render: (row: Row) => <Money value={row.paid} /> },
            { key: 'due', header: 'বাকি', align: 'right', render: (row: Row) => <Money value={row.due} className="text-amber-700" /> },
            { key: 'returns', header: 'রিটার্ন', align: 'right', render: (row: Row) => String(row.returns) },
          ] as Column<never>[],
          rows: source.rows as never[],
          csv: [
            ['নাম', 'ফোন', 'অর্ডার', 'মোট কেনা', 'পরিশোধ', 'বাকি', 'রিটার্ন'],
            ...source.rows.map((row) => [row.name, row.phone, String(row.orders), moneyToDecimalString(row.revenue), moneyToDecimalString(row.paid), moneyToDecimalString(row.due), String(row.returns)]),
          ],
        } as Built<never>;
      }
      case 'expenses': {
        type Row = (typeof source.rows)[number];
        return {
          title: 'খরচ রিপোর্ট (খাত অনুযায়ী)',
          columns: [
            { key: 'name', header: 'খাত', render: (row: Row) => row.categoryName },
            { key: 'count', header: 'সংখ্যা', align: 'right', render: (row: Row) => String(row.count) },
            { key: 'amount', header: 'পরিমাণ', align: 'right', render: (row: Row) => <Money value={row.amount} /> },
          ] as Column<never>[],
          rows: source.rows as never[],
          csv: [
            ['খাত', 'সংখ্যা', 'পরিমাণ'],
            ...source.rows.map((row) => [row.categoryName, String(row.count), moneyToDecimalString(row.amount)]),
          ],
        } as Built<never>;
      }
      case 'courier': {
        type Row = (typeof source.rows)[number];
        return {
          title: 'কুরিয়ার রিপোর্ট',
          columns: [
            { key: 'courier', header: 'কুরিয়ার', render: (row: Row) => row.record.courierName },
            { key: 'consignment', header: 'কনসাইনমেন্ট', render: (row: Row) => row.record.consignmentId || '—' },
            { key: 'status', header: 'স্ট্যাটাস', align: 'center', render: (row: Row) => <Badge>{COURIER_STATUS_LABEL[row.record.status]}</Badge> },
            { key: 'cod', header: 'COD', align: 'right', render: (row: Row) => <Money value={row.record.codAmount} /> },
            { key: 'expected', header: 'প্রত্যাশিত', align: 'right', render: (row: Row) => <Money value={row.expected} /> },
            { key: 'received', header: 'পেয়েছেন', align: 'right', render: (row: Row) => <Money value={row.received} /> },
            { key: 'remaining', header: 'বাকি', align: 'right', render: (row: Row) => <Money value={row.remaining} className="text-amber-700" /> },
          ] as Column<never>[],
          rows: source.rows as never[],
          csv: [
            ['কুরিয়ার', 'কনসাইনমেন্ট', 'স্ট্যাটাস', 'COD', 'প্রত্যাশিত', 'পেয়েছেন', 'বাকি'],
            ...source.rows.map((row) => [
              row.record.courierName,
              row.record.consignmentId,
              COURIER_STATUS_LABEL[row.record.status],
              moneyToDecimalString(row.record.codAmount),
              moneyToDecimalString(row.expected),
              moneyToDecimalString(row.received),
              moneyToDecimalString(row.remaining),
            ]),
          ],
        } as Built<never>;
      }
      case 'cod': {
        const d = source.data;
        return {
          title: 'COD হিসাব মিলানো',
          columns: [] as Column<never>[],
          rows: [] as never[],
          csv: [
            ['বিবরণ', 'পরিমাণ'],
            ['পাইপলাইন COD', moneyToDecimalString(d.summary.pipelineCod)],
            ['প্রত্যাশিত নিট (ডেলিভার্ড)', moneyToDecimalString(d.summary.expectedNet)],
            ['পেয়েছেন', moneyToDecimalString(d.summary.received)],
            ['বাকি', moneyToDecimalString(d.summary.remaining)],
            ['রিটার্ন খরচ', moneyToDecimalString(d.summary.returnCosts)],
          ],
          summary: [
            { label: 'প্রত্যাশিত নিট', value: formatMoney(d.summary.expectedNet) },
            { label: 'পেয়েছেন', value: formatMoney(d.summary.received) },
            { label: 'বাকি', value: formatMoney(d.summary.remaining) },
            { label: 'রিটার্ন খরচ', value: formatMoney(d.summary.returnCosts) },
          ],
        } as Built<never>;
      }
      case 'returns': {
        type Row = (typeof source.data.rows)[number];
        return {
          title: 'রিটার্ন রিপোর্ট',
          columns: [
            { key: 'number', header: 'নম্বর', render: (row: Row) => row.returnNumber },
            { key: 'date', header: 'তারিখ', render: (row: Row) => formatDate(row.date) },
            { key: 'type', header: 'ধরন', render: (row: Row) => RETURN_TYPE_LABEL[row.type] },
            { key: 'reason', header: 'কারণ', render: (row: Row) => RETURN_REASON_LABEL[row.reason] },
            { key: 'qty', header: 'পরিমাণ', align: 'right', render: (row: Row) => String(row.items.reduce((sum, item) => sum + item.quantity, 0)) },
            { key: 'refund', header: 'রিফান্ড', align: 'right', render: (row: Row) => <Money value={row.refundAmount} /> },
          ] as Column<never>[],
          rows: source.data.rows as never[],
          csv: [
            ['নম্বর', 'তারিখ', 'ধরন', 'কারণ', 'পরিমাণ', 'রিফান্ড'],
            ...source.data.rows.map((row) => [
              row.returnNumber,
              toDateInputValue(row.date),
              RETURN_TYPE_LABEL[row.type],
              RETURN_REASON_LABEL[row.reason],
              String(row.items.reduce((sum, item) => sum + item.quantity, 0)),
              moneyToDecimalString(row.refundAmount),
            ]),
          ],
          summary: [
            { label: 'রিটার্ন সংখ্যা', value: String(source.data.summary.count) },
            { label: 'রিফান্ড', value: formatMoney(source.data.summary.refunded) },
            { label: 'স্টকে ফেরত', value: `${source.data.summary.restockedUnits} পিস` },
            { label: 'নষ্ট/লেখাবদ্ধ', value: `${source.data.summary.writtenOffUnits} পিস` },
          ],
        } as Built<never>;
      }
      case 'inventory': {
        type Row = (typeof source.data.rows)[number];
        const totalValue = source.data.rows.reduce((sum, row) => sum + row.value, 0);
        return {
          title: 'ইনভেন্টরি রিপোর্ট',
          columns: [
            { key: 'name', header: 'পণ্য', render: (row: Row) => row.name },
            { key: 'sku', header: 'SKU', render: (row: Row) => row.sku || '—' },
            { key: 'qty', header: 'স্টক', align: 'right', render: (row: Row) => String(row.quantity) },
            { key: 'avg', header: 'গড় ক্রয়মূল্য', align: 'right', render: (row: Row) => <Money value={row.avgCost} /> },
            { key: 'value', header: 'মূল্য', align: 'right', render: (row: Row) => <Money value={row.value} /> },
            {
              key: 'status',
              header: 'অবস্থা',
              align: 'center',
              render: (row: Row) =>
                row.isOut ? <Badge tone="bg-rose-50 text-rose-700 ring-rose-200">নেই</Badge> : row.isLow ? <Badge tone="bg-amber-50 text-amber-800 ring-amber-200">কম</Badge> : <Badge tone="bg-emerald-50 text-emerald-700 ring-emerald-200">আছে</Badge>,
            },
          ] as Column<never>[],
          rows: source.data.rows as never[],
          csv: [
            ['পণ্য', 'SKU', 'স্টক', 'গড় ক্রয়মূল্য', 'মূল্য'],
            ...source.data.rows.map((row) => [row.name, row.sku, String(row.quantity), moneyToDecimalString(row.avgCost), moneyToDecimalString(row.value)]),
          ],
          summary: [{ label: 'মোট স্টক মূল্য', value: formatMoney(totalValue) }],
        } as Built<never>;
      }
      case 'stock': {
        type Row = (typeof source.rows)[number];
        return {
          title: 'স্টক মুভমেন্ট রিপোর্ট',
          columns: [
            { key: 'date', header: 'সময়', render: (row: Row) => formatDate(row.date) },
            { key: 'product', header: 'পণ্য', render: (row: Row) => row.productName },
            { key: 'type', header: 'ধরন', render: (row: Row) => <Badge>{STOCK_MOVEMENT_LABEL[row.type as keyof typeof STOCK_MOVEMENT_LABEL] ?? row.type}</Badge> },
            { key: 'qty', header: 'পরিমাণ', align: 'right', render: (row: Row) => String(row.quantity) },
            { key: 'reason', header: 'কারণ', render: (row: Row) => row.reason || '—' },
          ] as Column<never>[],
          rows: source.rows as never[],
          csv: [
            ['তারিখ', 'পণ্য', 'ধরন', 'পরিমাণ', 'কারণ'],
            ...source.rows.map((row) => [toDateInputValue(row.date), row.productName, row.type, String(row.quantity), row.reason]),
          ],
        } as Built<never>;
      }
      case 'payments': {
        type Row = (typeof source.rows)[number];
        const totalIn = source.rows.filter((row) => row.direction === 'in').reduce((sum, row) => sum + row.amount, 0);
        const totalOut = source.rows.filter((row) => row.direction === 'out').reduce((sum, row) => sum + row.amount, 0);
        return {
          title: 'আদায় রিপোর্ট',
          columns: [
            { key: 'date', header: 'তারিখ', render: (row: Row) => formatDate(row.date) },
            { key: 'kind', header: 'ধরন', render: (row: Row) => PAYMENT_KIND_LABEL[row.kind] ?? row.kind },
            { key: 'method', header: 'মাধ্যম', render: (row: Row) => <Badge>{row.method}</Badge> },
            { key: 'order', header: 'অর্ডার', render: (row: Row) => row.orderNumber || '—' },
            { key: 'amount', header: 'পরিমাণ', align: 'right', render: (row: Row) => <Money value={row.amount} className={row.direction === 'in' ? 'text-brand-700' : 'text-rose-600'} /> },
          ] as Column<never>[],
          rows: source.rows as never[],
          csv: [
            ['তারিখ', 'ধরন', 'মাধ্যম', 'অর্ডার', 'পরিমাণ', 'দিক'],
            ...source.rows.map((row) => [toDateInputValue(row.date), row.kind, row.method, row.orderNumber, moneyToDecimalString(row.amount), row.direction]),
          ],
          summary: [
            { label: 'মোট জমা', value: formatMoney(totalIn) },
            { label: 'মোট প্রদান', value: formatMoney(totalOut) },
            { label: 'নিট', value: formatMoney(totalIn - totalOut) },
          ],
        } as Built<never>;
      }
      case 'outstanding': {
        type Row = (typeof source.data.orders)[number];
        return {
          title: 'বাকির রিপোর্ট',
          columns: [
            { key: 'order', header: 'অর্ডার', render: (row: Row) => row.order.orderNumber },
            { key: 'customer', header: 'কাস্টমার', render: (row: Row) => row.order.customerName || 'নগদ' },
            { key: 'phone', header: 'ফোন', render: (row: Row) => row.order.customerPhone || '—' },
            { key: 'date', header: 'তারিখ', render: (row: Row) => formatDate(row.order.orderDate) },
            { key: 'total', header: 'মোট', align: 'right', render: (row: Row) => <Money value={row.order.total} /> },
            { key: 'due', header: 'বাকি', align: 'right', render: (row: Row) => <Money value={row.due} className="font-semibold text-amber-700" /> },
            { key: 'status', header: 'পেমেন্ট', align: 'center', render: (row: Row) => <Badge>{PAYMENT_STATUS_LABEL[row.order.paymentStatus]}</Badge> },
          ] as Column<never>[],
          rows: source.data.orders as never[],
          csv: [
            ['অর্ডার', 'কাস্টমার', 'ফোন', 'তারিখ', 'মোট', 'বাকি'],
            ...source.data.orders.map((row) => [
              row.order.orderNumber,
              row.order.customerName,
              row.order.customerPhone,
              toDateInputValue(row.order.orderDate),
              moneyToDecimalString(row.order.total),
              moneyToDecimalString(row.due),
            ]),
          ],
          summary: [{ label: 'মোট বাকি', value: formatMoney(source.data.total) }],
        } as Built<never>;
      }
      default:
        return null;
    }
  }, [data.data]);

  const trend = data.data?.kind === 'sales' ? data.data.trend : [];

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="রিপোর্ট ও বিশ্লেষণ"
          subtitle="সব হিসাব আপনার ডিভাইসের তথ্য থেকে তৈরি — কোনো অনুমান নেই"
          actions={
            <>
              <Button
                variant="outline"
                icon="print"
                onClick={() => window.print()}
                disabled={!built || built.rows.length === 0}
              >
                প্রিন্ট
              </Button>
              <Button
                variant="outline"
                icon="download"
                disabled={!built}
                onClick={() => {
                  if (!built) return;
                  downloadCsv(toCsv(built.csv), `report-${report}-${Date.now()}.csv`);
                }}
              >
                CSV
              </Button>
            </>
          }
        >
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Select aria-label="রিপোর্ট" options={REPORT_OPTIONS} value={report} onChange={(e) => setReport(e.target.value as ReportKey)} className="h-10 w-auto min-w-[200px]" />
              <Select
                aria-label="সারি সীমা"
                options={[
                  { value: '100', label: '১০০ সারি' },
                  { value: '200', label: '২০০ সারি' },
                  { value: '500', label: '৫০০ সারি' },
                ]}
                value={String(limit)}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="h-10 w-auto"
              />
            </div>
            {!['inventory', 'cod', 'outstanding'].includes(report) && (
              <DateRangePicker preset={preset} range={range} onChange={(nextPreset, nextRange) => { setPreset(nextPreset); setRange(nextRange); }} />
            )}
          </div>
        </PageHeader>
      </div>

      {data.error && <ErrorBanner message={data.error.message} onRetry={data.reload} />}

      {report === 'sales' && trend.length > 0 && (
        <Card className="no-print mb-4">
          <CardHeader title="বিক্রয় প্রবণতা" />
          <CardBody>
            <TrendChart data={trend.map((point) => ({ label: point.label, sales: point.sales, profit: point.profit }))} />
          </CardBody>
        </Card>
      )}

      {built?.summary && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {built.summary.map((item) => (
            <StatCard key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
      )}

      {report === 'profit' && data.data?.kind === 'profit' && (
        <Card className="mb-4">
          <CardHeader title="লাভ-ক্ষতি বিবরণী" subtitle="নির্বাচিত সময়" />
          <CardBody className="px-0 py-0">
            <dl className="divide-y divide-ink-100">
              {[
                ['মোট বিক্রয়', data.data.data.grossSales, 'text-ink-900'],
                ['(-) ছাড়', data.data.data.discounts, 'text-rose-600'],
                ['(-) রিফান্ড', data.data.data.refunds, 'text-rose-600'],
                ['= নিট আয়', data.data.data.netRevenue, 'font-semibold text-ink-900'],
                ['(-) পণ্যের ক্রয়মূল্য', data.data.data.cogs, 'text-rose-600'],
                ['= স্থূল লাভ', data.data.data.grossProfit, 'font-semibold text-brand-700'],
                ['(-) পরিচালন খরচ', data.data.data.operatingExpenses, 'text-rose-600'],
                ['= পরিচালন লাভ', data.data.data.operatingProfit, 'font-semibold text-brand-700'],
              ].map(([label, value, className]) => (
                <div key={String(label)} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <dt className="text-ink-600">{label}</dt>
                  <dd className={`tabular ${className}`}>{formatMoney(Number(value))}</dd>
                </div>
              ))}
            </dl>
            <div className="border-t border-ink-100 px-4 py-3 text-xs text-ink-500">
              <p>
                <strong>আনুমানিক লাভ:</strong> বাতিল না হওয়া সব অর্ডার থেকে (অর্ডারের সময়কার ক্রয়মূল্য ও কুরিয়ার খরচ অনুযায়ী)।
              </p>
              <p>
                <strong>বাস্তবায়িত লাভ:</strong> শুধু ডেলিভার্ড ও সম্পূর্ণ পরিশোধিত অর্ডার থেকে, তারপর ওই সময়ের খরচ বাদ।
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {report === 'cod' && data.data?.kind === 'cod' && data.data.data.discrepancies.length > 0 && (
        <Card className="mb-4">
          <CardHeader title="পার্থক্য থাকা কনসাইনমেন্ট" />
          <CardBody className="px-0 py-0">
            <ul className="divide-y divide-ink-100">
              {data.data.data.discrepancies.map((item) => (
                <li key={item.record.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 truncate">
                    {item.record.courierName} — {item.record.consignmentId || 'কনসাইনমেন্ট নেই'}
                  </span>
                  <span className="tabular shrink-0 font-semibold text-amber-700">{formatMoney(item.difference)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card className="print-sheet">
        <CardHeader title={built?.title ?? 'রিপোর্ট'} subtitle={`${formatDate(range.from ?? Date.now())} — ${formatDate((range.to ?? Date.now()) - 1)}`} />
        <CardBody className="px-0 py-0">
          {data.loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-ink-100" />
              ))}
            </div>
          ) : built && built.rows.length > 0 ? (
            <DataTable columns={built.columns} rows={built.rows} rowKey={(_, index) => String(index)} />
          ) : built ? (
            <div className="p-4">
              <EmptyState icon="reports" title="এই রিপোর্টে দেখানোর মতো তথ্য নেই" description="সময়সীমা বদলে আবার চেষ্টা করুন, অথবা নতুন অর্ডার/খরচ যোগ করুন।" />
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="no-print mt-4">
        <InfoBanner>
          প্রতিটি রিপোর্ট সরাসরি আপনার ডিভাইসের ডেটাবেস থেকে তৈরি হয়। বড় ডেটাসেটে টেবিলে সর্বোচ্চ {limit} সারি দেখানো হয়; CSV তে একই ফিল্টারের সব সারি থাকে (সর্বোচ্চ {limit})।
        </InfoBanner>
      </div>
    </>
  );
}
