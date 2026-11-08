import { beforeEach, describe, expect, it } from 'vitest';
import {
  categoryTotals,
  createExpense,
  deleteExpense,
  getExpense,
  listExpenses,
  restoreExpense,
  totalExpenses,
  updateExpense,
  voidExpense,
} from '@/services/expenseService';
import { parseMoney } from '@/lib/money';
import { nowMs, startOfDay, endOfDay } from '@/lib/date';
import { db } from '@/db/db';

const tk = parseMoney;

async function expense(partial: {
  amount?: string;
  categoryId?: string | null;
  method?: string;
  date?: number;
  payee?: string;
  description?: string;
} = {}) {
  return createExpense({
    date: partial.date ?? nowMs(),
    categoryId: partial.categoryId ?? null,
    amount: tk(partial.amount ?? '500'),
    method: partial.method ?? 'cash',
    payee: partial.payee ?? 'রিক্সাওয়ালা',
    reference: '',
    description: partial.description ?? 'পণ্য আনা-নেওয়া',
    note: '',
  });
}

describe('expenses', () => {
  beforeEach(async () => {
    await db.expenses.clear();
  });

  it('records an expense in paisa and reads it back unchanged', async () => {
    const created = await expense({ amount: '1,250.50' });
    expect(created.amount).toBe(125050);

    const stored = await getExpense(created.id);
    expect(stored?.amount).toBe(125050);
    expect(stored?.voidedAt).toBeNull();
  });

  it('refuses a zero or negative expense', async () => {
    await expect(createExpense({ date: nowMs(), categoryId: null, amount: 0, method: 'cash', payee: '', reference: '', description: '', note: '' })).rejects.toThrow();
    await expect(
      createExpense({ date: nowMs(), categoryId: null, amount: -500, method: 'cash', payee: '', reference: '', description: '', note: '' }),
    ).rejects.toThrow();
  });

  it('edits an expense', async () => {
    const created = await expense({ amount: '500' });
    await updateExpense(created.id, { amount: tk('750'), description: 'প্যাকেজিং খরচ' });
    const updated = await getExpense(created.id);
    expect(updated?.amount).toBe(75000);
    expect(updated?.description).toBe('প্যাকেজিং খরচ');
  });

  it('voiding keeps the row but removes it from totals; it can be restored', async () => {
    const created = await expense({ amount: '500' });
    await expect(totalExpenses()).resolves.toBe(50000);

    await voidExpense(created.id, 'ভুল এন্ট্রি');
    expect((await getExpense(created.id))?.voidedAt).not.toBeNull();
    // The row still exists — the audit trail is not destroyed.
    expect(await db.expenses.get(created.id)).toBeDefined();
    await expect(totalExpenses()).resolves.toBe(0);

    await restoreExpense(created.id);
    expect((await getExpense(created.id))?.voidedAt).toBeNull();
    await expect(totalExpenses()).resolves.toBe(50000);
  });

  it('only permanently deletes on explicit request', async () => {
    const created = await expense();
    await deleteExpense(created.id);
    expect(await db.expenses.get(created.id)).toBeUndefined();
  });

  it('filters by date range', async () => {
    const today = nowMs();
    const old = startOfDay(today) - 30 * 24 * 60 * 60 * 1000;
    await expense({ amount: '100', date: old });
    await expense({ amount: '200', date: today });

    const all = await listExpenses({});
    expect(all.total).toBe(2);

    const todayOnly = await listExpenses({ from: startOfDay(today), to: endOfDay(today) });
    expect(todayOnly.total).toBe(1);
    expect(todayOnly.rows[0]?.amount).toBe(20000);

    await expect(totalExpenses({ from: startOfDay(today), to: endOfDay(today) })).resolves.toBe(20000);
    await expect(totalExpenses()).resolves.toBe(30000);
  });

  it('groups spending by category', async () => {
    const categories = await db.expenseCategories.toArray();
    const ads = categories.find((c) => c.name.includes('বিজ্ঞাপন'))!;
    const packaging = categories.find((c) => c.name.includes('প্যাকেজিং'))!;

    await expense({ amount: '1000', categoryId: ads.id });
    await expense({ amount: '500', categoryId: ads.id });
    await expense({ amount: '250', categoryId: packaging.id });

    const totals = await categoryTotals();
    const byName = new Map(totals.map((row) => [row.categoryName, row.amount]));
    expect(byName.get(ads.name)).toBe(150000);
    expect(byName.get(packaging.name)).toBe(25000);
    // Categories add up to the overall total — no double counting, no gaps.
    expect(totals.reduce((sum, row) => sum + row.amount, 0)).toBe(175000);
    expect(totals.reduce((sum, row) => sum + row.count, 0)).toBe(3);
  });

  it('never lets a paisa slip through as a fraction', async () => {
    await expense({ amount: '0.01' });
    await expense({ amount: '0.02' });
    const total = await totalExpenses();
    expect(Number.isInteger(total)).toBe(true);
    expect(total).toBe(3);
  });
});
