/**
 * defaults.ts — First-run seeding of settings and default taxonomies.
 * Seeding is idempotent and never overwrites user edits.
 */

import { db } from './db';
import { nowMs } from '@/lib/date';
import { randomId } from '@/lib/id';
import {
  DEFAULT_COURIER_PROVIDERS,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_ORDER_STATUSES,
  DEFAULT_PAYMENT_METHODS,
  DEFAULT_PRODUCT_CATEGORIES,
} from '@/domain/constants';
import type {
  CourierProvider,
  ExpenseCategory,
  PaymentMethod,
  ProductCategory,
  Settings,
} from '@/domain/types';
import { parseMoney } from '@/lib/money';

export function defaultSettings(appVersion: string): Settings {
  const now = nowMs();
  return {
    id: 'app',
    schemaVersion: 1,
    appVersion,
    onboardingCompleted: false,
    business: {
      name: '',
      logoDataUrl: null,
      address: '',
      phone: '',
      email: '',
      website: '',
      registrationNote: '',
    },
    currency: { code: 'BDT', symbol: '৳', position: 'before' },
    locale: { timeZone: 'Asia/Dhaka', bengaliDigits: true, dateFormat: 'dd MMMM yyyy' },
    invoice: {
      prefix: 'INV',
      nextNumber: 1,
      footerNote: 'পণ্য ফেরত নেওয়া হবে না। ধন্যবাদ।',
      terms: '',
      showLogo: true,
      paper: 'a4',
    },
    order: {
      prefix: 'ORD',
      nextNumber: 1,
      defaultDeliveryCharge: parseMoney(60),
      stockCommitStatuses: ['confirmed', 'processing', 'ready', 'shipped', 'delivered'],
    },
    inventory: { allowNegativeStock: false, defaultLowStockThreshold: 5 },
    security: { pinEnabled: false, pinRecord: null },
    backup: { lastBackupAt: null, reminderEnabled: true, reminderDays: 7 },
    createdAt: now,
    updatedAt: now,
  };
}

/** Ensure the settings row exists. Returns the settings record. */
export async function ensureSettings(appVersion: string): Promise<Settings> {
  const existing = await db.settings.get('app');
  if (existing) return existing;
  const settings = defaultSettings(appVersion);
  await db.settings.put(settings);
  return settings;
}

export async function ensureDefaultTaxonomies(): Promise<void> {
  const now = nowMs();

  const categoryCount = await db.productCategories.count();
  if (categoryCount === 0) {
    const rows: ProductCategory[] = DEFAULT_PRODUCT_CATEGORIES.map((name) => ({
      id: randomId(),
      name,
      description: '',
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    }));
    await db.productCategories.bulkPut(rows);
  }

  const expenseCount = await db.expenseCategories.count();
  if (expenseCount === 0) {
    const rows: ExpenseCategory[] = DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
      id: randomId(),
      name,
      description: '',
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    }));
    await db.expenseCategories.bulkPut(rows);
  }

  const methodCount = await db.paymentMethods.count();
  if (methodCount === 0) {
    const rows: PaymentMethod[] = DEFAULT_PAYMENT_METHODS.map((m) => ({
      id: randomId(),
      key: m.key,
      name: m.name,
      note: m.note,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    }));
    await db.paymentMethods.bulkPut(rows);
  }

  const courierCount = await db.courierProviders.count();
  if (courierCount === 0) {
    const rows: CourierProvider[] = DEFAULT_COURIER_PROVIDERS.map((name) => ({
      id: randomId(),
      name,
      phone: '',
      note: '',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    }));
    await db.courierProviders.bulkPut(rows);
  }
}

export const DEFAULT_STATUSES = DEFAULT_ORDER_STATUSES;
