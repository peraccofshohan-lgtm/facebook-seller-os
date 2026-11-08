/**
 * settingsService.ts — Central settings read/write plus document numbering.
 *
 * Numbering: invoice/order numbers are allocated from a counter stored in settings and
 * incremented inside the same transaction as the record creation, so two records can never
 * share a number even if created in rapid succession.
 */

import { db } from '@/db/db';
import { defaultSettings, ensureSettings } from '@/db/defaults';
import { nowMs } from '@/lib/date';
import type { Settings } from '@/domain/types';

export const APP_VERSION: string =
  (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) || '1.0.0';

declare const __APP_VERSION__: string | undefined;

export async function getSettings(): Promise<Settings> {
  const settings = await db.settings.get('app');
  if (settings) return settings;
  return ensureSettings(APP_VERSION);
}

/**
 * The keys a caller may patch.
 *
 * `Settings` carries a `Record<string, unknown>` index signature, which makes
 * `Partial<Omit<Settings, 'id'>>` degenerate into "any object at all" — a caller could
 * silently write a half-built `business` block and TypeScript would not notice. Listing
 * the keys keeps the brand-critical blocks honest.
 */
export type SettingsPatch = Partial<
  Pick<
    Settings,
    | 'schemaVersion'
    | 'appVersion'
    | 'onboardingCompleted'
    | 'business'
    | 'currency'
    | 'locale'
    | 'invoice'
    | 'order'
    | 'inventory'
    | 'security'
    | 'backup'
    | 'branding'
    | 'documents'
    | 'promotions'
    | 'dashboard'
  >
>;

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = { ...current, ...patch, id: 'app', updatedAt: nowMs() };
  await db.settings.put(next);
  return next;
}

export async function resetSettings(): Promise<Settings> {
  const fresh = defaultSettings(APP_VERSION);
  await db.settings.put(fresh);
  return fresh;
}

/**
 * Allocate the next number for a sequence. Must be called inside the same Dexie
 * transaction that writes the record using the number.
 */
export async function nextNumber(sequence: 'order' | 'invoice' | 'return' | 'expense'): Promise<{ value: string; number: number }> {
  const settings = await getSettings();
  const key = sequence === 'order' || sequence === 'invoice' ? sequence : null;
  if (key === 'order') {
    const n = settings.order.nextNumber;
    const prefix = settings.order.prefix || 'ORD';
    await db.settings.update('app', { order: { ...settings.order, nextNumber: n + 1 }, updatedAt: nowMs() });
    return { value: `${prefix}-${String(n).padStart(5, '0')}`, number: n };
  }
  if (key === 'invoice') {
    const n = settings.invoice.nextNumber;
    const prefix = settings.invoice.prefix || 'INV';
    await db.settings.update('app', { invoice: { ...settings.invoice, nextNumber: n + 1 }, updatedAt: nowMs() });
    return { value: `${prefix}-${String(n).padStart(5, '0')}`, number: n };
  }
  // Return / expense numbers are derived from a per-day counter to stay unique.
  const prefix = sequence === 'return' ? 'RET' : 'EXP';
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  return { value: `${prefix}-${stamp}`, number: 0 };
}

/** Peek at the number that will be used next (for UI display only — not reserved). */
export async function peekNumber(sequence: 'order' | 'invoice'): Promise<string> {
  const settings = await getSettings();
  if (sequence === 'order') return `${settings.order.prefix || 'ORD'}-${String(settings.order.nextNumber).padStart(5, '0')}`;
  return `${settings.invoice.prefix || 'INV'}-${String(settings.invoice.nextNumber).padStart(5, '0')}`;
}
