/**
 * reportService.ts — All reporting/analytics queries.
 *
 * Every number here comes from the local IndexedDB records that fall inside the requested
 * date range. Nothing is hardcoded, seeded, or randomised.
 *
 * Performance: date-ranged queries use the `orderDate`/`date`/`shipmentDate` indexes.
 * Aggregation happens in memory after the fetch, and every report accepts a `limit` so the
 * UI can paginate instead of rendering thousands of rows at once.
 */

import { db } from '@/db/db';
import { dhakaParts, shortMonthLabel, startOfDay, type DateRange } from '@/lib/date';
import { addMoney, subMoney, sumMoney, type Minor } from '@/lib/money';
import { derivePaymentStatus } from '@/finance/orderTotals';
import { courierCostOf, orderProfit, periodProfit } from '@/finance/profit';
import { listOrders } from './orderService';
import { listExpenses, totalExpenses } from './expenseService';
import { codSummary, courierPerformance, expectedNetPayable, payoutDiscrepancies } from './courierService';
import { refundsByOrder, returnSummary } from './returnService';
import { cashSummary, outstandingReceivables, totalsForOrders } from './paymentService';
import { stockRows, stockValuation, listMovements } from './inventoryService';
import { getSettings } from './settingsService';
import type { CourierRecord, Expense, ID, Order, OrderStatusKey, ReturnRecord } from '@/domain/types';

export interface RangeData {
  orders: Order[];
  expenses: Expense[];
  courierRecords: CourierRecord[];
  returns: ReturnRecord[];
  refundsByOrderId: Map<ID, Minor>;
  courierCostByOrderId: Map<ID, Minor>;
}

export async function loadRange(range: DateRange, orderLimit = Number.MAX_SAFE_INTEGER): Promise<RangeData> {
  const [{ rows: orders }, { rows: expenses }] = await Promise.all([
    listOrders({ from: range.from, to: range.to, limit: orderLimit }),
    listExpenses({ from: range.from, to: range.to, limit: Number.MAX_SAFE_INTEGER }),
  ]);
  let courierRecords = await db.courierRecords.toArray();
  if (range.from !== null) courierRecords = courierRecords.filter((c) => c.shipmentDate >= (range.from as number));
  if (range.to !== null) courierRecords = courierRecords.filter((c) => c.shipmentDate < (range.to as number));
  let returns = await db.returns.toArray();
  if (range.from !== null) returns = returns.filter((r) => r.date >= (range.from as number));
  if (range.to !== null) returns = returns.filter((r) => r.date < (range.to as number));

  let refunds = await refundsByOrder();
  if (orders.length > 0) {
    const ids = new Set(orders.map((o) => o.id));
    refunds = new Map(Array.from(refunds.entries()).filter(([id]) => ids.has(id)));
  }

  const courierCostByOrderId = new Map<ID, Minor>();
  for (const record of courierRecords) {
    if (!record.orderId) continue;
    const cost = addMoney(courierCostOf(record), record.returnFee > 0 ? 0 : 0);
    courierCostByOrderId.set(record.orderId, addMoney(courierCostByOrderId.get(record.orderId) ?? 0, cost));
  }

  return { orders, expenses, courierRecords, returns, refundsByOrderId: refunds, courierCostByOrderId };
}

export interface DashboardMetrics {
  totalOrders: number;
  todayOrders: number;
  statusCounts: Record<string, number>;
  todaySales: Minor;
  rangeSales: Minor;
  collected: Minor;
  outstanding: Minor;
  codReceivable: Minor;
  codPipeline: Minor;
  expenses: Minor;
  estimatedProfit: Minor;
  realizedProfit: Minor;
  totalProducts: number;
  lowStock: number;
  outOfStock: number;
  inventoryValue: Minor;
  newCustomers: number;
  avgOrderValue: Minor;
  refunds: Minor;
  returnCount: number;
}

export async function dashboardMetrics(range: DateRange): Promise<DashboardMetrics> {
  const settings = await getSettings();
  const now = Date.now();
  const todayStart = startOfDay(now, settings.locale.timeZone);
  const todayEnd = todayStart + 86400000;

  const data = await loadRange(range);
  const [allOrders, paymentTotals, receivables, valuation, customers, cod, products] = await Promise.all([
    db.orders.filter((o) => !o.archivedAt).toArray(),
    totalsForOrders(data.orders.map((o) => o.id)),
    outstandingReceivables(),
    stockValuation(),
    db.customers.filter((c) => !c.archivedAt).toArray(),
    codSummary(),
    db.products.filter((p) => !p.archivedAt).count(),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const key of ['new', 'pending', 'confirmed', 'processing', 'ready', 'shipped', 'delivered', 'cancelled', 'returned', 'exchanged']) {
    statusCounts[key] = 0;
  }
  for (const order of allOrders) statusCounts[order.status] = (statusCounts[order.status] ?? 0) + 1;

  const todayOrders = allOrders.filter((o) => o.orderDate >= todayStart && o.orderDate < todayEnd);
  const todaySales = sumMoney(todayOrders.filter((o) => o.status !== 'cancelled').map((o) => o.total));
  const rangeSales = sumMoney(data.orders.filter((o) => o.status !== 'cancelled').map((o) => o.total));
  const collected = sumMoney(Array.from(paymentTotals.values()).map((t) => t.paidIn));

  const profit = periodProfit({
    orders: data.orders,
    expenses: data.expenses,
    courierRecords: data.courierRecords,
    refundsByOrderId: data.refundsByOrderId,
    courierCostByOrderId: data.courierCostByOrderId,
  });

  const returns = await returnSummary(range);
  const expensesTotal = await totalExpenses(range);

  return {
    totalOrders: allOrders.length,
    todayOrders: todayOrders.length,
    statusCounts,
    todaySales,
    rangeSales,
    collected,
    outstanding: receivables.total,
    codReceivable: cod.remaining,
    codPipeline: cod.pipelineCod,
    expenses: expensesTotal,
    estimatedProfit: profit.estimatedProfit,
    realizedProfit: profit.realizedProfit,
    totalProducts: products,
    lowStock: valuation.lowStockCount,
    outOfStock: valuation.outOfStockCount,
    inventoryValue: valuation.totalValue,
    newCustomers: customers.filter((c) => c.createdAt >= (range.from ?? 0) && (!range.to || c.createdAt < range.to)).length,
    avgOrderValue: data.orders.length ? Math.round(rangeSales / Math.max(data.orders.filter((o) => o.status !== 'cancelled').length, 1)) : 0,
    refunds: returns.refunded,
    returnCount: returns.count,
  };
}

export interface TrendPoint {
  ts: number;
  label: string;
  sales: Minor;
  orders: number;
  profit: Minor;
  expenses: Minor;
}

function bucketStart(ts: number, granularity: 'day' | 'week' | 'month', timeZone: string): number {
  const dayStart = startOfDay(ts, timeZone);
  if (granularity === 'day') return dayStart;
  const p = dhakaParts(dayStart, timeZone);
  if (granularity === 'month') {
    return startOfDay(Date.UTC(p.year, p.month - 1, 1) - 6 * 3600000, timeZone);
  }
  // week: Monday-start
  const jsDate = new Date(dayStart);
  const weekday = (jsDate.getUTCDay() + 6) % 7;
  return dayStart - weekday * 86400000;
}

function bucketLabel(ts: number, granularity: 'day' | 'week' | 'month', timeZone: string): string {
  const p = dhakaParts(ts, timeZone);
  if (granularity === 'month') return shortMonthLabel(ts, timeZone);
  if (granularity === 'week') return `${p.day}/${p.month}`;
  return `${p.day}/${p.month}`;
}

export async function salesTrend(range: DateRange, granularity: 'day' | 'week' | 'month' = 'day'): Promise<TrendPoint[]> {
  const settings = await getSettings();
  const tz = settings.locale.timeZone;
  const data = await loadRange(range);
  const expenseMap = new Map<number, Minor>();
  for (const expense of data.expenses) {
    const key = bucketStart(expense.date, granularity, tz);
    expenseMap.set(key, addMoney(expenseMap.get(key) ?? 0, expense.amount));
  }

  const buckets = new Map<number, TrendPoint>();
  for (const order of data.orders) {
    if (order.status === 'cancelled') continue;
    const key = bucketStart(order.orderDate, granularity, tz);
    const point = buckets.get(key) ?? { ts: key, label: bucketLabel(key, granularity, tz), sales: 0, orders: 0, profit: 0, expenses: 0 };
    point.sales = addMoney(point.sales, order.total);
    point.orders += 1;
    const p = orderProfit(order, {
      refunds: data.refundsByOrderId.get(order.id) ?? 0,
      courierCost: data.courierCostByOrderId.get(order.id) ?? 0,
    });
    point.profit = addMoney(point.profit, p.estimatedProfit);
    buckets.set(key, point);
  }
  for (const [key, amount] of expenseMap) {
    const point = buckets.get(key) ?? { ts: key, label: bucketLabel(key, granularity, tz), sales: 0, orders: 0, profit: 0, expenses: 0 };
    point.expenses = addMoney(point.expenses, amount);
    buckets.set(key, point);
  }
  return Array.from(buckets.values()).sort((a, b) => a.ts - b.ts);
}

export interface TopProductRow {
  productId: ID | null;
  name: string;
  sku: string;
  quantity: number;
  revenue: Minor;
  profit: Minor;
  orderCount: number;
}

export async function topProducts(range: DateRange, limit = 10): Promise<TopProductRow[]> {
  const data = await loadRange(range);
  const map = new Map<string, TopProductRow>();
  for (const order of data.orders) {
    if (order.status === 'cancelled') continue;
    const orderIds = new Set<number>();
    for (const item of order.items) {
      const key = `${item.productId ?? item.name}::${item.variantId ?? ''}`;
      const row =
        map.get(key) ??
        ({ productId: item.productId, name: item.name, sku: item.sku, quantity: 0, revenue: 0, profit: 0, orderCount: 0 } as TopProductRow);
      row.quantity += item.quantity;
      const lineRevenue = subMoney(Math.round(item.unitPrice * item.quantity), item.discount);
      row.revenue = addMoney(row.revenue, lineRevenue);
      row.profit = addMoney(row.profit, subMoney(lineRevenue, Math.round(item.unitCost * item.quantity)));
      if (!orderIds.has(order.orderDate)) {
        row.orderCount += 1;
        orderIds.add(order.orderDate);
      }
      map.set(key, row);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, limit);
}

export interface CategoryRow {
  categoryId: ID | null;
  name: string;
  revenue: Minor;
  quantity: number;
}

export async function categoryPerformance(range: DateRange): Promise<CategoryRow[]> {
  const data = await loadRange(range);
  const [products, categories] = await Promise.all([db.products.toArray(), db.productCategories.toArray()]);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const productCategory = new Map(products.map((p) => [p.id, p.categoryId]));
  const map = new Map<string, CategoryRow>();
  for (const order of data.orders) {
    if (order.status === 'cancelled') continue;
    for (const item of order.items) {
      const categoryId = item.productId ? productCategory.get(item.productId) ?? null : null;
      const key = categoryId ?? 'uncategorized';
      const row =
        map.get(key) ??
        ({ categoryId, name: categoryId ? categoryName.get(categoryId) ?? 'অন্যান্য' : 'ক্যাটেগরিহীন', revenue: 0, quantity: 0 } as CategoryRow);
      row.revenue = addMoney(row.revenue, subMoney(Math.round(item.unitPrice * item.quantity), item.discount));
      row.quantity += item.quantity;
      map.set(key, row);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
}

export interface StatusSlice {
  status: OrderStatusKey;
  label: string;
  count: number;
}

export async function statusDistribution(range: DateRange): Promise<StatusSlice[]> {
  const data = await loadRange(range);
  const counts = new Map<OrderStatusKey, number>();
  for (const order of data.orders) counts.set(order.status, (counts.get(order.status) ?? 0) + 1);
  const labels: Record<OrderStatusKey, string> = {
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
  return Array.from(counts.entries())
    .map(([status, count]) => ({ status, label: labels[status] ?? status, count }))
    .sort((a, b) => b.count - a.count);
}

export interface IncomeExpensePoint {
  ts: number;
  label: string;
  income: Minor;
  expense: Minor;
}

export async function incomeVsExpense(range: DateRange, granularity: 'day' | 'month' = 'day'): Promise<IncomeExpensePoint[]> {
  const trend = await salesTrend(range, granularity);
  return trend.map((p) => ({ ts: p.ts, label: p.label, income: p.sales, expense: p.expenses }));
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export interface SalesReportRow {
  order: Order;
  paidIn: Minor;
  refunded: Minor;
  due: Minor;
  profit: Minor;
  status: string;
}

export async function salesReport(range: DateRange, limit = 200): Promise<SalesReportRow[]> {
  const data = await loadRange(range, limit);
  const totals = await totalsForOrders(data.orders.map((o) => o.id));
  return data.orders.map((order) => {
    const t = totals.get(order.id) ?? { paidIn: 0, refundedOut: 0, netPaid: 0, due: 0 };
    const p = orderProfit(order, {
      refunds: t.refundedOut,
      courierCost: data.courierCostByOrderId.get(order.id) ?? 0,
    });
    return {
      order,
      paidIn: t.paidIn,
      refunded: t.refundedOut,
      due: Math.max(subMoney(order.total, t.netPaid), 0),
      profit: p.estimatedProfit,
      status: derivePaymentStatus(order.total, t.paidIn, t.refundedOut),
    };
  });
}

export interface CustomerReportRow {
  customerId: ID | null;
  name: string;
  phone: string;
  orders: number;
  revenue: Minor;
  paid: Minor;
  due: Minor;
  lastOrderAt: number | null;
  returns: number;
}

export async function customerReport(range: DateRange, limit = 200): Promise<CustomerReportRow[]> {
  const data = await loadRange(range, limit);
  const totals = await totalsForOrders(data.orders.map((o) => o.id));
  const returnCounts = new Map<ID, number>();
  for (const r of data.returns) if (r.status !== 'cancelled') returnCounts.set(r.orderId, (returnCounts.get(r.orderId) ?? 0) + 1);

  const map = new Map<string, CustomerReportRow>();
  for (const order of data.orders) {
    if (order.status === 'cancelled') continue;
    const key = order.customerId ?? `guest:${order.customerPhone || order.customerName}`;
    const t = totals.get(order.id) ?? { paidIn: 0, refundedOut: 0, netPaid: 0, due: 0 };
    const row =
      map.get(key) ??
      ({
        customerId: order.customerId,
        name: order.customerName || 'নগদ কাস্টমার',
        phone: order.customerPhone,
        orders: 0,
        revenue: 0,
        paid: 0,
        due: 0,
        lastOrderAt: null,
        returns: 0,
      } as CustomerReportRow);
    row.orders += 1;
    row.revenue = addMoney(row.revenue, order.total);
    row.paid = addMoney(row.paid, t.paidIn);
    row.due = addMoney(row.due, Math.max(subMoney(order.total, t.netPaid), 0));
    row.lastOrderAt = row.lastOrderAt === null ? order.orderDate : Math.max(row.lastOrderAt, order.orderDate);
    row.returns += returnCounts.get(order.id) ?? 0;
    map.set(key, row);
  }
  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
}

export interface ProductSalesRow {
  productId: ID | null;
  name: string;
  sku: string;
  quantity: number;
  revenue: Minor;
  cost: Minor;
  profit: Minor;
}

export async function productSalesReport(range: DateRange, limit = 200): Promise<ProductSalesRow[]> {
  const rows = await topProducts(range, limit);
  return rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    sku: r.sku,
    quantity: r.quantity,
    revenue: r.revenue,
    cost: subMoney(r.revenue, r.profit),
    profit: r.profit,
  }));
}

export interface ProfitLossReport {
  grossSales: Minor;
  discounts: Minor;
  refunds: Minor;
  netRevenue: Minor;
  cogs: Minor;
  grossProfit: Minor;
  operatingExpenses: Minor;
  courierCosts: Minor;
  operatingProfit: Minor;
  estimatedProfit: Minor;
  realizedProfit: Minor;
  orderCount: number;
  deliveredCount: number;
  paidAndDeliveredCount: number;
  expenseByCategory: { name: string; amount: Minor }[];
}

export async function profitLossReport(range: DateRange): Promise<ProfitLossReport> {
  const data = await loadRange(range);
  const profit = periodProfit({
    orders: data.orders,
    expenses: data.expenses,
    courierRecords: data.courierRecords,
    refundsByOrderId: data.refundsByOrderId,
    courierCostByOrderId: data.courierCostByOrderId,
  });
  const byCategory = new Map<string, Minor>();
  for (const expense of data.expenses) {
    if (expense.voidedAt) continue;
    byCategory.set(expense.categoryName, addMoney(byCategory.get(expense.categoryName) ?? 0, expense.amount));
  }
  return {
    grossSales: profit.grossSales,
    discounts: profit.discounts,
    refunds: profit.refunds,
    netRevenue: profit.netRevenue,
    cogs: profit.cogs,
    grossProfit: profit.grossProfit,
    operatingExpenses: profit.operatingExpenses,
    courierCosts: profit.courierCosts,
    operatingProfit: profit.operatingProfit,
    estimatedProfit: profit.estimatedProfit,
    realizedProfit: profit.realizedProfit,
    orderCount: profit.orderCount,
    deliveredCount: profit.deliveredCount,
    paidAndDeliveredCount: profit.paidAndDeliveredCount,
    expenseByCategory: Array.from(byCategory.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount),
  };
}

export interface CourierReportRow {
  record: CourierRecord;
  expected: Minor;
  received: Minor;
  remaining: Minor;
  cost: Minor;
}

export async function courierReport(range: DateRange, limit = 200): Promise<CourierReportRow[]> {
  const data = await loadRange(range, limit);
  const settled: Map<ID, Minor> = new Map();
  const payments = (await db.payments.toArray()).filter(
    (p) => !p.voidedAt && p.courierRecordId && (p.kind === 'courier_payout' || p.kind === 'cod_collection'),
  );
  for (const p of payments) {
    if (!p.courierRecordId) continue;
    settled.set(p.courierRecordId, addMoney(settled.get(p.courierRecordId) ?? 0, p.amount));
  }
  return data.courierRecords.map((record) => {
    const { net, cost } = expectedNetPayable(record);
    const received = settled.get(record.id) ?? 0;
    return { record, expected: net, received, remaining: subMoney(net, received), cost };
  });
}

export async function codReconciliationReport() {
  const [summary, discrepancies, performance] = await Promise.all([codSummary(), payoutDiscrepancies(), courierPerformance()]);
  return { summary, discrepancies, performance };
}

export interface StockMovementReportRow {
  id: ID;
  date: number;
  productName: string;
  variantLabel: string;
  type: string;
  quantity: number;
  reason: string;
  referenceId: ID | null;
  note: string;
}

export async function stockMovementReport(range: DateRange, limit = 300): Promise<StockMovementReportRow[]> {
  const movements = await listMovements({ from: range.from, to: range.to, limit });
  const [products, variants] = await Promise.all([db.products.toArray(), db.productVariants.toArray()]);
  const productName = new Map(products.map((p) => [p.id, p.name]));
  const variantLabel = new Map(variants.map((v) => [v.id, v.label]));
  return movements.map((m) => ({
    id: m.id,
    date: m.createdAt,
    productName: productName.get(m.productId) ?? 'অজানা পণ্য',
    variantLabel: m.variantId ? variantLabel.get(m.variantId) ?? '' : '',
    type: m.type,
    quantity: m.quantity,
    reason: m.reason,
    referenceId: m.referenceId,
    note: m.note,
  }));
}

export interface InventoryReportRow {
  productId: ID;
  variantId: ID | null;
  name: string;
  sku: string;
  quantity: number;
  avgCost: Minor;
  value: Minor;
  threshold: number;
  isLow: boolean;
  isOut: boolean;
}

export async function inventoryReport(): Promise<{ rows: InventoryReportRow[]; total: number }> {
  const rows = await stockRows();
  return {
    rows: rows.map((r) => ({
      productId: r.product.id,
      variantId: r.variantId,
      name: r.variantLabel ? `${r.product.name} — ${r.variantLabel}` : r.product.name,
      sku: r.sku,
      quantity: r.quantity,
      avgCost: r.avgCost,
      value: r.value,
      threshold: r.threshold,
      isLow: r.isLow,
      isOut: r.isOut,
    })),
    total: rows.length,
  };
}

export interface PaymentCollectionRow {
  date: number;
  method: string;
  kind: string;
  amount: Minor;
  direction: 'in' | 'out';
  reference: string;
  note: string;
  orderNumber: string;
}

export async function paymentCollectionReport(range: DateRange, limit = 300): Promise<PaymentCollectionRow[]> {
  const settings = await getSettings();
  void settings;
  let payments = (await db.payments.toArray()).filter((p) => !p.voidedAt);
  if (range.from !== null) payments = payments.filter((p) => p.date >= (range.from as number));
  if (range.to !== null) payments = payments.filter((p) => p.date < (range.to as number));
  payments.sort((a, b) => b.date - a.date);
  const orders = await db.orders.toArray();
  const orderNumber = new Map(orders.map((o) => [o.id, o.orderNumber]));
  return payments.slice(0, limit).map((p) => ({
    date: p.date,
    method: p.method,
    kind: p.kind,
    amount: p.amount,
    direction: p.direction,
    reference: p.reference,
    note: p.note,
    orderNumber: p.orderId ? orderNumber.get(p.orderId) ?? '' : '',
  }));
}

export async function outstandingReport() {
  return outstandingReceivables();
}

export async function cashBalanceReport(range?: DateRange) {
  return cashSummary(range ? { from: range.from, to: range.to } : undefined);
}

export async function returnReport(range: DateRange, limit = 200) {
  const data = await loadRange(range, limit);
  return {
    rows: data.returns,
    summary: await returnSummary(range),
  };
}

/** Recent activity feed for the dashboard. */
export async function recentActivity(limit = 8): Promise<{ id: ID; order: Order; message: string; at: number }[]> {
  const events = (await db.orderEvents.toArray()).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  const orders = await db.orders.toArray();
  const orderMap = new Map(orders.map((o) => [o.id, o]));
  return events
    .map((e) => {
      const order = orderMap.get(e.orderId);
      return order ? { id: e.id, order, message: e.message, at: e.createdAt } : null;
    })
    .filter((v): v is { id: ID; order: Order; message: string; at: number } => v !== null);
}
