/**
 * expenseService.ts — Business expenses.
 *
 * The expense module is the SINGLE source of truth for operating expenses in the P&L.
 * Courier costs are only counted once: they are added to expenses explicitly (from the
 * courier screen) with `courierRecordId` set, so they can never be double counted.
 * Product purchases that go into inventory must be recorded as a stock purchase, NOT as an
 * expense — otherwise the cost would be counted twice (once as COGS, once as an expense).
 */

import { db } from '@/db/db';
import { nowMs } from '@/lib/date';
import { randomId } from '@/lib/id';
import { addMoney, type Minor } from '@/lib/money';
import type { Expense, ID } from '@/domain/types';
import type { ExpenseInput } from '@/domain/schemas';
import { nextNumber } from './settingsService';

export interface ExpenseQuery {
  query?: string;
  categoryId?: ID;
  method?: string;
  from?: number | null;
  to?: number | null;
  includeVoided?: boolean;
  limit?: number;
  offset?: number;
}

export async function listExpenses(q: ExpenseQuery = {}): Promise<{ rows: Expense[]; total: number }> {
  const useRange = q.from !== undefined && q.from !== null && q.to !== undefined && q.to !== null;
  let rows = useRange
    ? await db.expenses.where('date').between(q.from as number, q.to as number, true, false).toArray()
    : await db.expenses.toArray();
  if (!q.includeVoided) rows = rows.filter((e) => !e.voidedAt);
  if (q.categoryId) rows = rows.filter((e) => e.categoryId === q.categoryId);
  if (q.method && q.method !== 'all') rows = rows.filter((e) => e.method === q.method);
  if (q.query) {
    const needle = q.query.trim().toLowerCase();
    rows = rows.filter((e) =>
      [e.description, e.payee, e.reference, e.note, e.categoryName].join(' ').toLowerCase().includes(needle),
    );
  }
  const total = rows.length;
  rows.sort((a, b) => b.date - a.date);
  const offset = q.offset ?? 0;
  const limit = q.limit ?? 100;
  return { rows: rows.slice(offset, offset + limit), total };
}

export async function getExpense(id: ID): Promise<Expense | undefined> {
  return db.expenses.get(id);
}

async function resolveCategoryName(categoryId: ID | null, fallback = ''): Promise<string> {
  if (!categoryId) return fallback || 'অন্যান্য';
  const category = await db.expenseCategories.get(categoryId);
  return category?.name ?? fallback ?? 'অন্যান্য';
}

export async function createExpense(input: ExpenseInput): Promise<Expense> {
  if (input.amount <= 0) throw new Error('খরচের পরিমাণ ০ এর বেশি হতে হবে।');
  const now = nowMs();
  const numbering = await nextNumber('expense');
  const expense: Expense = {
    id: randomId(),
    expenseNumber: numbering.value,
    date: input.date,
    categoryId: input.categoryId ?? null,
    categoryName: await resolveCategoryName(input.categoryId ?? null),
    amount: input.amount,
    method: input.method || 'cash',
    payee: input.payee,
    reference: input.reference,
    description: input.description,
    note: input.note,
    voidedAt: null,
    courierRecordId: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  await db.expenses.add(expense);
  return expense;
}

export async function updateExpense(id: ID, patch: Partial<ExpenseInput>): Promise<Expense> {
  const existing = await db.expenses.get(id);
  if (!existing) throw new Error('খরচের রেকর্ড পাওয়া যায়নি।');
  const next: Expense = {
    ...existing,
    ...patch,
    categoryName: patch.categoryId !== undefined ? await resolveCategoryName(patch.categoryId) : existing.categoryName,
    id,
    updatedAt: nowMs(),
  };
  await db.expenses.put(next);
  return next;
}

/** Void (never delete) an expense. It stays in history and drops out of totals. */
export async function voidExpense(id: ID, reason = ''): Promise<void> {
  const existing = await db.expenses.get(id);
  if (!existing) throw new Error('খরচের রেকর্ড পাওয়া যায়নি।');
  await db.expenses.update(id, {
    voidedAt: nowMs(),
    note: reason ? `${existing.note}\n[বাতিল] ${reason}`.trim() : existing.note,
    updatedAt: nowMs(),
  });
}

export async function restoreExpense(id: ID): Promise<void> {
  await db.expenses.update(id, { voidedAt: null, updatedAt: nowMs() });
}

export async function deleteExpense(id: ID): Promise<void> {
  const existing = await db.expenses.get(id);
  if (!existing) return;
  if (existing.courierRecordId) {
    throw new Error('এই খরচটি কুরিয়ার রেকর্ড থেকে তৈরি। ডুপ্লিকেট হিসাব এড়াতে কুরিয়ার পর্দা থেকে সরিয়ে দিন।');
  }
  await db.expenses.delete(id);
}

export interface CategoryTotal {
  categoryId: ID | null;
  categoryName: string;
  amount: Minor;
  count: number;
}

export async function categoryTotals(range?: { from: number | null; to: number | null }): Promise<CategoryTotal[]> {
  const { rows } = await listExpenses({ ...range, limit: Number.MAX_SAFE_INTEGER, includeVoided: false });
  const map = new Map<string, CategoryTotal>();
  for (const expense of rows) {
    const key = expense.categoryId ?? 'uncategorized';
    const row = map.get(key) ?? {
      categoryId: expense.categoryId,
      categoryName: expense.categoryName || 'অন্যান্য',
      amount: 0,
      count: 0,
    };
    row.amount = addMoney(row.amount, expense.amount);
    row.count += 1;
    map.set(key, row);
  }
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

export async function totalExpenses(range?: { from: number | null; to: number | null }): Promise<Minor> {
  const { rows } = await listExpenses({ ...range, limit: Number.MAX_SAFE_INTEGER, includeVoided: false });
  return rows.reduce((s, e) => addMoney(s, e.amount), 0);
}

/**
 * Create (or refresh) the expense that mirrors a courier record's cost.
 * Idempotent per courier record: updating the courier cost updates the linked expense.
 */
export async function syncExpenseFromCourier(
  record: { id: ID; courierName: string; consignmentId: string; orderNumber: string; shipmentDate: number },
  cost: Minor,
  categoryId: ID | null,
): Promise<Expense | null> {
  const existing = await db.expenses.filter((e) => e.courierRecordId === record.id).first();
  if (cost <= 0) {
    if (existing && !existing.voidedAt) await voidExpense(existing.id, 'কুরিয়ার খরচ ০ বা ঋণাত্মক হয়েছে');
    return existing ?? null;
  }
  const description = `কুরিয়ার খরচ: ${record.courierName}${record.orderNumber ? ` (${record.orderNumber})` : ''}`;
  if (existing) {
    const updated: Expense = {
      ...existing,
      amount: cost,
      date: record.shipmentDate,
      categoryId,
      categoryName: await resolveCategoryName(categoryId),
      description,
      voidedAt: null,
      updatedAt: nowMs(),
    };
    await db.expenses.put(updated);
    return updated;
  }
  const now = nowMs();
  const numbering = await nextNumber('expense');
  const expense: Expense = {
    id: randomId(),
    expenseNumber: numbering.value,
    date: record.shipmentDate,
    categoryId,
    categoryName: await resolveCategoryName(categoryId),
    amount: cost,
    method: 'cash',
    payee: record.courierName,
    reference: record.consignmentId,
    description,
    note: 'কুরিয়ার রেকর্ড থেকে স্বয়ংক্রিয়ভাবে তৈরি',
    voidedAt: null,
    courierRecordId: record.id,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  await db.expenses.add(expense);
  return expense;
}
