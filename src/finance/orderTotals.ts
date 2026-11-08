/**
 * orderTotals.ts — Single source of truth for order arithmetic.
 *
 * All math goes through src/lib/money.ts (integer paisa). No UI component may recompute
 * a total with floating point arithmetic.
 *
 * FORMULAS (see FINANCIAL_RULES.md):
 *   lineTotal      = unitPrice * quantity - lineDiscount
 *   subtotal       = Σ lineTotal                      (before order-level discount)
 *   cogs           = Σ unitCost * quantity            (cost snapshot at order time)
 *   netSales       = subtotal - orderDiscount         (revenue; excludes delivery charge)
 *   total          = netSales + deliveryCharge + otherCharge   (customer payable)
 *   due            = total - paidIn + refundedOut
 */

import { addMoney, mulQty, subMoney, sumMoney, type Minor } from '@/lib/money';
import type { OrderItem, OrderStatusKey, PaymentStatus } from '@/domain/types';
import type { OrderSettings } from '@/domain/types';

export interface OrderTotalsInput {
  items: OrderItem[];
  discount?: Minor;
  deliveryCharge?: Minor;
  otherCharge?: Minor;
}

export interface OrderTotals {
  subtotal: Minor;
  discount: Minor;
  deliveryCharge: Minor;
  otherCharge: Minor;
  total: Minor;
  netSales: Minor;
  cogs: Minor;
  itemCount: number;
}

export function computeLineTotal(item: Pick<OrderItem, 'unitPrice' | 'quantity' | 'discount'>): Minor {
  const gross = mulQty(item.unitPrice, item.quantity);
  return subMoney(gross, item.discount ?? 0);
}

export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  const items = input.items ?? [];
  const subtotal = sumMoney(items.map(computeLineTotal));
  const cogs = sumMoney(items.map((i) => mulQty(i.unitCost ?? 0, i.quantity)));
  const discount = input.discount ?? 0;
  const deliveryCharge = input.deliveryCharge ?? 0;
  const otherCharge = input.otherCharge ?? 0;
  const netSales = subMoney(subtotal, discount);
  const total = addMoney(netSales, deliveryCharge, otherCharge);
  const itemCount = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  return { subtotal, discount, deliveryCharge, otherCharge, total, netSales, cogs, itemCount };
}

/** Derive the payment status from amounts. Never derived from a stale stored flag alone. */
export function derivePaymentStatus(total: Minor, paidIn: Minor, refundedOut: Minor): PaymentStatus {
  const net = paidIn - refundedOut;
  if (total === 0 && net === 0) return 'paid';
  if (net > total) return 'overpaid';
  if (refundedOut > 0 && net <= 0 && total > 0) return 'refunded';
  if (net <= 0) return 'unpaid';
  if (net >= total) return 'paid';
  return 'partial';
}

export function dueAmount(total: Minor, paidIn: Minor, refundedOut: Minor): Minor {
  const due = subMoney(total, paidIn, -refundedOut);
  return due > 0 ? due : 0;
}

/** Statuses that represent work still in progress (used by dashboards and filters). */
export function isOpenStatus(status: OrderStatusKey, settings?: Pick<OrderSettings, 'stockCommitStatuses'>): boolean {
  void settings;
  return status !== 'delivered' && status !== 'cancelled' && status !== 'returned' && status !== 'exchanged';
}
