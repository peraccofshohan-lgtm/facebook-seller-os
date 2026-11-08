/**
 * customerService.ts — Customer CRUD plus derived statistics.
 *
 * Duplicate policy: two customers with similar names are NOT assumed to be the same person.
 * A phone match is treated as a *warning* only; the user decides.
 */

import { db } from '@/db/db';
import { nowMs } from '@/lib/date';
import { randomId } from '@/lib/id';
import { matchesQuery, namesLookSimilar, normalizePhone, searchKey } from '@/lib/search';
import type { Customer, ID, Order } from '@/domain/types';
import type { CustomerInput } from '@/domain/schemas';
import type { Minor } from '@/lib/money';

export interface CustomerQuery {
  query?: string;
  status?: Customer['status'];
  archived?: boolean;
  limit?: number;
  offset?: number;
}

export async function listCustomers(q: CustomerQuery = {}): Promise<{ rows: Customer[]; total: number }> {
  let rows = await db.customers.toArray();
  rows = q.archived ? rows.filter((c) => Boolean(c.archivedAt)) : rows.filter((c) => !c.archivedAt);
  if (q.status) rows = rows.filter((c) => c.status === q.status);
  if (q.query) {
    const hay = rows.map((c) => searchKey(c.name, c.phone, c.altPhone, c.address, c.area, c.district, c.tags.join(' ')));
    rows = rows.filter((_, i) => matchesQuery(hay[i], q.query as string));
  }
  const total = rows.length;
  rows.sort((a, b) => (b.lastOrderAt ?? b.createdAt) - (a.lastOrderAt ?? a.createdAt));
  const offset = q.offset ?? 0;
  const limit = q.limit ?? 50;
  return { rows: rows.slice(offset, offset + limit), total };
}

export async function getCustomer(id: ID): Promise<Customer | undefined> {
  return db.customers.get(id);
}

export async function findByPhone(phone: string): Promise<Customer[]> {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];
  const all = await db.customers.filter((c) => !c.archivedAt).toArray();
  return all.filter((c) => normalizePhone(c.phone) === normalized || (c.altPhone && normalizePhone(c.altPhone) === normalized));
}

export interface DuplicateWarning {
  customer: Customer;
  reason: 'phone' | 'name';
}

/** Cautious duplicate hints — the UI must never auto-merge. */
export async function duplicateWarnings(input: { name: string; phone: string }, exceptId?: ID): Promise<DuplicateWarning[]> {
  const warnings: DuplicateWarning[] = [];
  const byPhone = await findByPhone(input.phone);
  for (const c of byPhone) {
    if (c.id !== exceptId) warnings.push({ customer: c, reason: 'phone' });
  }
  if (input.name.trim().length > 2) {
    const all = await db.customers.filter((c) => !c.archivedAt).toArray();
    for (const c of all) {
      if (c.id === exceptId) continue;
      if (warnings.some((w) => w.customer.id === c.id)) continue;
      if (namesLookSimilar(c.name, input.name)) warnings.push({ customer: c, reason: 'name' });
    }
  }
  return warnings.slice(0, 5);
}

async function nextCustomerCode(): Promise<string> {
  const count = await db.customers.count();
  return `C${String(count + 1).padStart(4, '0')}`;
}

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  const now = nowMs();
  const customer: Customer = {
    id: randomId(),
    code: await nextCustomerCode(),
    name: input.name,
    // Numbers are stored in a single canonical form so the same person is never
    // saved twice just because the number was typed differently.
    phone: normalizePhone(input.phone ?? ''),
    altPhone: normalizePhone(input.altPhone ?? ''),
    address: input.address ?? '',
    district: input.district ?? '',
    area: input.area ?? '',
    notes: input.notes ?? '',
    tags: input.tags ?? [],
    status: input.status ?? 'active',
    lastOrderAt: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  await db.customers.add(customer);
  return customer;
}

export async function updateCustomer(id: ID, patch: Partial<CustomerInput>): Promise<Customer> {
  const existing = await db.customers.get(id);
  if (!existing) throw new Error('কাস্টমার পাওয়া যায়নি।');
  const next: Customer = { ...existing, ...patch, id, updatedAt: nowMs() };
  if (patch.phone !== undefined) next.phone = normalizePhone(patch.phone ?? '');
  if (patch.altPhone !== undefined) next.altPhone = normalizePhone(patch.altPhone ?? '');
  await db.customers.put(next);
  return next;
}

export async function archiveCustomer(id: ID): Promise<void> {
  await db.customers.update(id, { archivedAt: nowMs(), updatedAt: nowMs() });
}

export async function restoreCustomer(id: ID): Promise<void> {
  await db.customers.update(id, { archivedAt: null, updatedAt: nowMs() });
}

export interface CustomerStats {
  orderCount: number;
  totalPurchase: Minor;
  totalPaid: Minor;
  outstanding: Minor;
  lastOrderAt: number | null;
  cancelledCount: number;
  returnedCount: number;
}

export async function customerStats(customerId: ID): Promise<CustomerStats> {
  const orders = await db.orders.filter((o) => o.customerId === customerId && !o.archivedAt).toArray();
  const payments = await db.payments.where('customerId').equals(customerId).toArray();
  let totalPurchase = 0;
  let totalPaid = 0;
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    totalPurchase += o.total;
  }
  for (const p of payments) {
    if (p.kind === 'order_payment' && p.direction === 'in') totalPaid += p.amount;
    if (p.kind === 'order_refund' && p.direction === 'out') totalPaid -= p.amount;
  }
  const outstanding = Math.max(totalPurchase - totalPaid, 0);
  const dates = orders.map((o) => o.orderDate).filter(Boolean);
  return {
    orderCount: orders.length,
    totalPurchase,
    totalPaid,
    outstanding,
    lastOrderAt: dates.length ? Math.max(...dates) : null,
    cancelledCount: orders.filter((o) => o.status === 'cancelled').length,
    returnedCount: orders.filter((o) => o.status === 'returned').length,
  };
}

/** Refresh the denormalised `lastOrderAt` counter after order changes. */
export async function refreshLastOrder(customerId: ID | null): Promise<void> {
  if (!customerId) return;
  const orders = await db.orders.where('customerId').equals(customerId).toArray();
  const dates = orders.filter((o) => !o.archivedAt).map((o) => o.orderDate);
  await db.customers.update(customerId, {
    lastOrderAt: dates.length ? Math.max(...dates) : null,
    updatedAt: nowMs(),
  });
}

export async function addTag(customerId: ID, tag: string): Promise<void> {
  const customer = await db.customers.get(customerId);
  if (!customer) return;
  const clean = tag.trim();
  if (!clean || customer.tags.includes(clean)) return;
  await db.customers.update(customerId, { tags: [...customer.tags, clean], updatedAt: nowMs() });
}

export function allTags(customers: Customer[]): string[] {
  const set = new Set<string>();
  for (const c of customers) for (const t of c.tags) set.add(t);
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'bn'));
}

export function ordersForCustomer(orders: Order[], customerId: ID): Order[] {
  return orders.filter((o) => o.customerId === customerId).sort((a, b) => b.orderDate - a.orderDate);
}
