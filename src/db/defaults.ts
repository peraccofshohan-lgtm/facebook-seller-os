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
  BrandingSettings,
  BusinessProfile,
  CourierProvider,
  DashboardSettings,
  DocumentSettings,
  ExpenseCategory,
  NoteTemplate,
  PaymentMethod,
  ProductCategory,
  PromotionSettings,
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
    business: defaultBusinessProfile(),
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
    branding: defaultBranding(),
    documents: defaultDocuments(),
    promotions: defaultPromotions(),
    dashboard: defaultDashboard(),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * A blank business profile. Deliberately empty of any developer identity — everything
 * here belongs to the seller who installs the app.
 */
export function defaultBusinessProfile(): BusinessProfile {
  return {
    name: '',
    ownerName: '',
    logoDataUrl: null,
    address: '',
    area: '',
    district: '',
    phone: '',
    altPhone: '',
    email: '',
    website: '',
    description: '',
    thankYouMessage: '',
    registrationNote: '',
  };
}

export function defaultBranding(): BrandingSettings {
  return {
    tagline: '',
    documentFooter: '',
    showLogoOn: { invoice: true, courierSlip: true, parcelLabel: false, reports: true },
    showSignature: true,
    signatureLabel: 'ক্ষমতাপ্রাপ্ত ব্যক্তির স্বাক্ষর',
    signatureName: '',
    accent: 'indigo',
    fontScale: 'normal',
    align: 'left',
    showBusinessDescription: false,
  };
}

export function defaultDocuments(): DocumentSettings {
  return {
    courierSlipPaper: 'a4',
    labelSize: 'medium',
    defaultNoteTemplateId: null,
    showBarcode: true,
    showQr: true,
    fragileByDefault: false,
    bulkPrintSpacing: 'page',
  };
}

export function defaultPromotions(): PromotionSettings {
  return {
    enabled: true,
    allowStacking: false,
    loyaltyEnabled: true,
    pointsPerHundredTaka: 1,
    paisaPerPoint: 100,
    referralEnabled: true,
    referralPoints: 50,
  };
}

export function defaultDashboard(): DashboardSettings {
  return {
    visibleCards: [],
    showCharts: true,
    showAttentionList: true,
    showActivityFeed: true,
    trendWindowDays: 7,
  };
}

/**
 * Starter note templates. They are only inserted when the seller has none, and the
 * seller can edit or delete every one of them — they are suggestions, not fixed text.
 */
export function defaultNoteTemplates(now: number): NoteTemplate[] {
  const base = { createdAt: now, updatedAt: now, archivedAt: null };
  return [
    {
      ...base,
      id: randomId(),
      kind: 'courier_slip',
      name: 'ধন্যবাদ বার্তা',
      body: 'আপনার অর্ডারের জন্য ধন্যবাদ।',
      footer: 'অনুগ্রহ করে পার্সেলটি সাবধানে হ্যান্ডেল করবেন।',
      align: 'left',
      fontScale: 'normal',
      isActive: true,
      isDefault: true,
    },
    {
      ...base,
      id: randomId(),
      kind: 'courier_slip',
      name: 'সাবধানে হ্যান্ডেল করুন',
      body: 'পার্সেলটি ভঙ্গুর — অনুগ্রহ করে সাবধানে হ্যান্ডেল করবেন।',
      footer: 'ডেলিভারির আগে কাস্টমারকে কল করবেন।',
      align: 'left',
      fontScale: 'normal',
      isActive: true,
      isDefault: false,
    },
    {
      ...base,
      id: randomId(),
      kind: 'parcel_label',
      name: 'ডেলিভারির আগে কল',
      body: 'ডেলিভারির আগে অবশ্যই কাস্টমারকে ফোন করবেন।',
      footer: '',
      align: 'left',
      fontScale: 'small',
      isActive: true,
      isDefault: true,
    },
  ];
}

/** Ensure the settings row exists. Returns the settings record. */
/**
 * Fill in any settings block a settings row is missing.
 *
 * A V1 database has no `branding` / `documents` / `promotions` / `dashboard` block and
 * no extended business profile. Rather than replacing the row (which would throw away
 * the seller's configuration) we add only the keys that are absent, so the same
 * function is safe to call on first run, on every boot and inside the V2 migration.
 */
export function withSettingsDefaults(settings: Settings): Settings {
  return {
    ...settings,
    business: { ...defaultBusinessProfile(), ...(settings.business ?? {}) },
    branding: { ...defaultBranding(), ...(settings.branding ?? {}) },
    documents: { ...defaultDocuments(), ...(settings.documents ?? {}) },
    promotions: { ...defaultPromotions(), ...(settings.promotions ?? {}) },
    dashboard: { ...defaultDashboard(), ...(settings.dashboard ?? {}) },
  } as Settings;
}

export async function ensureSettings(appVersion: string): Promise<Settings> {
  const existing = await db.settings.get('app');
  if (!existing) {
    const settings = defaultSettings(appVersion);
    await db.settings.put(settings);
    return settings;
  }
  // A row written by V1 is missing every V2 block; top it up in place.
  const merged = withSettingsDefaults(existing);
  if (JSON.stringify(merged) !== JSON.stringify(existing)) {
    await db.settings.put({ ...merged, updatedAt: nowMs() });
  }
  return merged;
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

/** Seed the starter note templates, but only when the seller has none (V2). */
export async function ensureNoteTemplates(): Promise<void> {
  const count = await db.noteTemplates.count();
  if (count > 0) return;
  await db.noteTemplates.bulkPut(defaultNoteTemplates(nowMs()));
}

export const DEFAULT_STATUSES = DEFAULT_ORDER_STATUSES;
