/**
 * profit.ts — Profit & loss arithmetic.
 *
 * KEY DISTINCTION (documented in FINANCIAL_RULES.md and shown in the UI):
 *
 *  - ESTIMATED profit: computed for every non-cancelled order using the cost snapshot taken
 *    when the order was created. It is a forecast: the order may still be cancelled, returned,
 *    or the customer may not pay.
 *  - REALIZED profit: only counts orders that are DELIVERED and FULLY PAID (or COD-settled),
 *    minus refunds, minus courier costs actually incurred, minus the period's operating
 *    expenses. It is the conservative number.
 *
 * Delivery charges collected from customers are NOT revenue. They are a recovery of a
 * delivery cost and are reported on their own line.
 */

import { addMoney, subMoney, sumMoney, type Minor } from '@/lib/money';
import type { CourierRecord, Expense, Order } from '@/domain/types';

export interface OrderProfit {
  /** Σ line totals after item discounts. */
  grossSales: Minor;
  /** Item discounts + order-level discount. */
  discounts: Minor;
  /** grossSales - discounts. This is revenue. */
  netSales: Minor;
  /** Cost of goods sold snapshot. */
  cogs: Minor;
  /** netSales - cogs. */
  grossProfit: Minor;
  /** Delivery + other charges billed to the customer (not revenue). */
  customerCharges: Minor;
  /** Courier cost actually borne by the business for this order. */
  courierCost: Minor;
  /** Refunded to the customer. */
  refunds: Minor;
  /** netSales - cogs - courierCost - refunds (delivery charge is a cost recovery, excluded). */
  estimatedProfit: Minor;
  /** Only non-zero when the order is delivered and fully paid. */
  realizedProfit: Minor;
  isRealized: boolean;
}

export function orderProfit(
  order: Pick<Order, 'subtotal' | 'discount' | 'cogs' | 'deliveryCharge' | 'otherCharge' | 'total' | 'status' | 'paymentStatus'>,
  options: { refunds?: Minor; courierCost?: Minor; paidIn?: Minor } = {},
): OrderProfit {
  const refunds = options.refunds ?? 0;
  const courierCost = options.courierCost ?? 0;
  const grossSales = order.subtotal ?? 0;
  const discounts = order.discount ?? 0;
  const netSales = subMoney(grossSales, discounts);
  const cogs = order.cogs ?? 0;
  const grossProfit = subMoney(netSales, cogs);
  const customerCharges = addMoney(order.deliveryCharge ?? 0, order.otherCharge ?? 0);
  const estimatedProfit = subMoney(grossProfit, courierCost, refunds);

  const delivered = order.status === 'delivered' || order.status === 'exchanged';
  const fullyPaid = order.paymentStatus === 'paid' || order.paymentStatus === 'overpaid';
  const isRealized = delivered && fullyPaid;
  const realizedProfit = isRealized ? estimatedProfit : 0;

  return {
    grossSales,
    discounts,
    netSales,
    cogs,
    grossProfit,
    customerCharges,
    courierCost,
    refunds,
    estimatedProfit,
    realizedProfit,
    isRealized,
  };
}

/** Courier cost that the business bears for one courier record. */
export function courierCostOf(record: Pick<CourierRecord, 'deliveryCharge' | 'courierFee' | 'returnFee' | 'adjustment'>): Minor {
  return addMoney(record.deliveryCharge ?? 0, record.courierFee ?? 0, record.returnFee ?? 0, record.adjustment ?? 0);
}

/** Net amount the courier should pay the business for a consignment. */
export function courierNetPayable(record: Pick<CourierRecord, 'codAmount' | 'collectedAmount' | 'deliveryCharge' | 'courierFee' | 'returnFee' | 'adjustment' | 'status'>): Minor {
  const collected = record.collectedAmount ?? 0;
  const cost = courierCostOf(record);
  if (record.status === 'returned' || record.status === 'lost' || record.status === 'cancelled') {
    // Nothing was collected from the customer: the business only bears the cost.
    return subMoney(0, cost);
  }
  return subMoney(collected, cost);
}

export interface PeriodProfit {
  grossSales: Minor;
  discounts: Minor;
  refunds: Minor;
  netRevenue: Minor;
  cogs: Minor;
  grossProfit: Minor;
  operatingExpenses: Minor;
  courierCosts: Minor;
  operatingProfit: Minor;
  /** Estimated profit across all in-scope orders (optimistic). */
  estimatedProfit: Minor;
  /** Conservative: only delivered + fully paid orders, after expenses. */
  realizedProfit: Minor;
  orderCount: number;
  deliveredCount: number;
  paidAndDeliveredCount: number;
}

export interface PeriodProfitInput {
  orders: Order[];
  expenses: Expense[];
  courierRecords: CourierRecord[];
  refundsByOrderId: Map<string, Minor>;
  courierCostByOrderId: Map<string, Minor>;
}

export function periodProfit(input: PeriodProfitInput): PeriodProfit {
  let grossSales = 0;
  let discounts = 0;
  let cogs = 0;
  let estimatedProfit = 0;
  let realizedProfit = 0;
  let deliveredCount = 0;
  let paidAndDeliveredCount = 0;

  for (const order of input.orders) {
    if (order.status === 'cancelled') continue;
    const refunds = input.refundsByOrderId.get(order.id) ?? 0;
    const courierCost = input.courierCostByOrderId.get(order.id) ?? 0;
    const p = orderProfit(order, { refunds, courierCost });
    grossSales = addMoney(grossSales, p.grossSales);
    discounts = addMoney(discounts, p.discounts);
    cogs = addMoney(cogs, p.cogs);
    estimatedProfit = addMoney(estimatedProfit, p.estimatedProfit);
    realizedProfit = addMoney(realizedProfit, p.realizedProfit);
    if (order.status === 'delivered' || order.status === 'exchanged') deliveredCount += 1;
    if (p.isRealized) paidAndDeliveredCount += 1;
  }

  const refunds = sumMoney(Array.from(input.refundsByOrderId.values()));
  const netRevenue = subMoney(grossSales, discounts, refunds);
  const grossProfit = subMoney(netRevenue, cogs);
  const operatingExpenses = sumMoney(
    input.expenses
      // An expense generated from a courier record is the SAME money as the
      // courier cost already subtracted inside each order's estimated profit.
      // Counting it here as well would charge the seller twice for one parcel.
      .filter((e) => !e.voidedAt && !e.courierRecordId)
      .map((e) => e.amount),
  );
  const courierCosts = sumMoney(input.courierRecords.map(courierCostOf));
  const operatingProfit = subMoney(grossProfit, operatingExpenses);

  return {
    grossSales,
    discounts,
    refunds,
    netRevenue,
    cogs,
    grossProfit,
    operatingExpenses,
    courierCosts,
    operatingProfit,
    estimatedProfit,
    realizedProfit: subMoney(realizedProfit, operatingExpenses),
    orderCount: input.orders.length,
    deliveredCount,
    paidAndDeliveredCount,
  };
}
