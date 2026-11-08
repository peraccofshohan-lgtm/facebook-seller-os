/**
 * migrations.ts — Schema/data migration registry.
 *
 * How migrations work here
 *  1. Dexie `version(n).stores()` declares the *structure* (see db.ts).
 *  2. Anything that cannot be expressed as an index change (backfilling a new field,
 *     normalising values, repairing data) is registered here as a function keyed by the
 *     target schema version.
 *  3. `runMigrations()` is called during application bootstrap, inside a transaction per
 *     migration, and records the applied version in `settings.schemaVersion`.
 *
 * SAFETY CONTRACT
 *  - A migration MUST be idempotent: it may be re-run on a partially migrated database
 *    (the seller may have closed the tab half way through).
 *  - A migration MUST NOT delete, drop or overwrite a business record. It only ever
 *    *adds* missing V2 fields, filling them from data that is already on the row or in a
 *    linked row. Where a value genuinely cannot be known (e.g. the sender snapshot of a
 *    courier slip printed before V2 existed) it is left empty rather than invented.
 *  - Every write is a targeted `.update()` of only the missing keys, so a seller's own
 *    edits are never clobbered.
 */

import { db, SCHEMA_VERSION, type SellerDatabase } from './db';
import { nowMs } from '@/lib/date';
import { randomId } from '@/lib/id';
import { withSettingsDefaults } from './defaults';
import {
  newCourierFields,
  newExpenseFields,
  newOrderFields,
  newOrderItemFields,
} from '@/domain/newRecord';
import type { CourierRecord, Customer, Expense, Order } from '@/domain/types';

export interface Migration {
  version: number;
  description: string;
  /** Runs inside a Dexie read/write transaction. Must be idempotent. */
  run: (database: SellerDatabase) => Promise<void>;
}

/** True when `value` is absent — the field did not exist on the row at all. */
function missing(value: unknown): boolean {
  return value === undefined;
}

/**
 * V2 backfill.
 *
 * Walks every V1 row and adds the fields V2 introduced. Nothing is recalculated: an
 * order's `promotionDiscount` is 0 because V1 had no promotions, not because money was
 * moved around.
 */
async function backfillV2(database: SellerDatabase): Promise<void> {
  /* ---- Orders: promotion / loyalty / referral fields ---------------- */
  const orders = await database.orders.toArray();
  for (const order of orders) {
    const patch: Partial<Order> = {};
    let dirty = false;

    const defaults = newOrderFields();
    for (const [key, value] of Object.entries(defaults) as Array<[keyof typeof defaults, unknown]>) {
      if (missing((order as unknown as Record<string, unknown>)[key])) {
        (patch as Record<string, unknown>)[key] = value;
        dirty = true;
      }
    }

    const items = (order.items ?? []).map((item) => {
      if (!missing(item.isFreeGift) && !missing(item.promotionId)) return item;
      return { ...item, ...newOrderItemFields(), isFreeGift: item.isFreeGift ?? false, promotionId: item.promotionId ?? null };
    });
    if (items.length && items.some((i, index) => i !== order.items[index])) {
      patch.items = items;
      dirty = true;
    }

    if (dirty) await database.orders.update(order.id, patch);
  }

  /* ---- Customers: segmentation, loyalty balance, referral code ------- */
  const customers = await database.customers.toArray();
  for (const customer of customers) {
    const patch: Partial<Customer> = {};
    let dirty = false;

    if (missing(customer.segment)) {
      patch.segment = '';
      dirty = true;
    }
    if (missing(customer.loyaltyPoints)) {
      patch.loyaltyPoints = 0;
      dirty = true;
    }
    if (missing(customer.referredByCustomerId)) {
      patch.referredByCustomerId = null;
      dirty = true;
    }
    // A referral code must be unique-ish and stable; derive it from the customer code,
    // which V1 already guaranteed to be unique, falling back to a random one.
    if (missing(customer.referralCode) || !customer.referralCode) {
      patch.referralCode = customer.code || randomId().slice(0, 8).toUpperCase();
      dirty = true;
    }

    if (dirty) await database.customers.update(customer.id, patch);
  }

  /* ---- Expenses: recurring-expense link ------------------------------ */
  const expenses = await database.expenses.toArray();
  for (const expense of expenses) {
    if (missing(expense.recurringExpenseId)) {
      await database.expenses.update(expense.id, newExpenseFields() as Partial<Expense>);
    }
  }

  /* ---- Courier records: booking-slip / parcel-label fields ----------- */
  const courierRecords = await database.courierRecords.toArray();
  // Linked orders/customers are loaded once so recipient snapshots can be derived
  // from real data rather than left blank.
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const customerById = new Map(customers.map((c) => [c.id, c]));

  for (const record of courierRecords) {
    const patch: Record<string, unknown> = {};
    let dirty = false;

    const defaults = newCourierFields();
    for (const [key, value] of Object.entries(defaults) as Array<[keyof typeof defaults, unknown]>) {
      if (missing((record as unknown as Record<string, unknown>)[key])) {
        patch[key] = value;
        dirty = true;
      }
    }

    // Derive what we honestly can from the linked order / customer.
    const order = record.orderId ? orderById.get(record.orderId) : undefined;
    const customer = order?.customerId ? customerById.get(order.customerId) : undefined;

    if (missing(record.recipientName)) {
      patch.recipientName = order?.customerName ?? '';
    }
    if (missing(record.recipientPhone)) {
      patch.recipientPhone = order?.customerPhone ?? customer?.phone ?? '';
    }
    if (missing(record.recipientAltPhone)) {
      patch.recipientAltPhone = customer?.altPhone ?? '';
    }
    if (missing(record.recipientAddress)) {
      patch.recipientAddress = order?.deliveryAddress ?? customer?.address ?? '';
    }
    if (missing(record.area)) patch.area = customer?.area ?? '';
    if (missing(record.district)) patch.district = customer?.district ?? '';
    // Postcode genuinely did not exist in V1 — leave it empty rather than guess.
    if (missing(record.postcode)) patch.postcode = '';

    if (missing(record.declaredValue) && order) {
      // netSales = subtotal - discount: the value of the goods, excluding delivery.
      patch.declaredValue = Math.max(0, (order.subtotal ?? 0) - (order.discount ?? 0));
    }
    if (missing(record.contentsSummary) && order) {
      patch.contentsSummary = (order.items ?? [])
        .map((item) => `${item.name} × ${item.quantity}`)
        .join(', ');
    }
    // The sender snapshot could only be captured at print time, which never happened
    // under V1. It stays null and is filled the first time the slip is produced.
    if (missing(record.senderSnapshot)) patch.senderSnapshot = null;
    if (missing(record.slipPrintCount)) patch.slipPrintCount = 0;

    if (dirty) {
      await database.courierRecords.update(record.id, patch as Partial<CourierRecord>);
    }
  }

  /* ---- Settings: add the V2 configuration blocks --------------------- */
  const settings = await database.settings.get('app');
  if (settings) {
    const merged = withSettingsDefaults(settings);
    if (JSON.stringify(merged) !== JSON.stringify(settings)) {
      await database.settings.put({ ...merged, schemaVersion: 2, updatedAt: nowMs() });
    } else if (settings.schemaVersion !== 2) {
      await database.settings.update('app', { schemaVersion: 2, updatedAt: nowMs() });
    }
  }

  /* ---- Note templates: seed the starter set -------------------------- */
  const templateCount = await database.noteTemplates.count();
  if (templateCount === 0) {
    const { defaultNoteTemplates } = await import('./defaults');
    await database.noteTemplates.bulkPut(defaultNoteTemplates(nowMs()));
  }
}

export const migrations: Migration[] = [
  // Version 1 is the initial schema; nothing to backfill.
  {
    version: 2,
    description:
      'প্রিমিয়াম বিজনেস এডিশন: প্রমোশন, লয়্যালটি, রেফারেল, নোট টেমপ্লেট, পুনরাবৃত্ত খরচ, রিমাইন্ডার টেবিল এবং বিদ্যমান সব রেকর্ডে V2 ক্ষেত্র যোগ',
    run: backfillV2,
  },
  // Later releases append entries:
  // { version: 3, description: '…', run: async () => { … } }
];

/** Highest schema version this build understands. */
export const targetSchemaVersion = SCHEMA_VERSION;

export interface MigrationResult {
  applied: number[];
  previousVersion: number;
  currentVersion: number;
}

/**
 * Every table a migration may touch. Dexie needs the full list up-front because a
 * transaction cannot acquire a new store after it has started.
 */
function migrationTables(database: SellerDatabase) {
  return [
    database.settings,
    database.products,
    database.orders,
    database.customers,
    database.payments,
    database.expenses,
    database.courierRecords,
    database.noteTemplates,
  ];
}

/**
 * Apply every pending migration, in order, recording progress in settings.
 *
 * Each migration runs in its own transaction so a failure leaves the previous version
 * intact: the app then starts with `schemaVersion` unchanged and shows a Bengali
 * warning rather than a half-migrated database.
 *
 * `target` is injectable so the V2 upgrade can be exercised against a database that was
 * genuinely written by V1 (see tests/integration/migration.test.ts).
 */
export async function runMigrations(target: SellerDatabase = db): Promise<MigrationResult> {
  const settings = await target.settings.get('app');
  const previousVersion = settings?.schemaVersion ?? 0;
  const applied: number[] = [];

  const pending = migrations
    .filter((m) => m.version > previousVersion && m.version <= targetSchemaVersion)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    await target.transaction('rw', migrationTables(target), async () => {
      await migration.run(target);
    });
    applied.push(migration.version);
  }

  const currentVersion = Math.max(previousVersion, targetSchemaVersion);
  if (settings && (applied.length > 0 || settings.schemaVersion !== currentVersion)) {
    await target.settings.update('app', { schemaVersion: currentVersion, updatedAt: nowMs() });
  }

  return { applied, previousVersion, currentVersion };
}

/**
 * Detect a database written by a *newer* version of the app (for example after the user
 * downgrades or a stale service worker serves an old bundle). In that case we refuse to
 * migrate and surface a clear Bengali warning instead of corrupting data.
 */
export async function detectFutureSchema(target: SellerDatabase = db): Promise<boolean> {
  const settings = await target.settings.get('app');
  if (!settings) return false;
  return settings.schemaVersion > targetSchemaVersion;
}
