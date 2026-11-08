/**
 * db.ts — IndexedDB (Dexie) database definition.
 *
 * Design notes
 *  - `schemaVersion` is stored inside the settings row so the application can detect and
 *    migrate data that was written by an older release.
 *  - Dexie `version(n).stores(...)` declarations are append-only. Each future schema change
 *    gets a new version block plus an `.upgrade()` handler registered in `migrations.ts`.
 *  - Nothing here ever deletes business records. Archiving is a soft flag.
 */

import Dexie, { type Table } from 'dexie';
import type {
  CourierProvider,
  CourierRecord,
  Customer,
  Expense,
  ExpenseCategory,
  LoyaltyEntry,
  NoteTemplate,
  Order,
  OrderEvent,
  Payment,
  PaymentMethod,
  Product,
  ProductCategory,
  ProductVariant,
  Promotion,
  PromotionUsage,
  RecurringExpense,
  Referral,
  Reminder,
  ReturnRecord,
  Settings,
  StockLevel,
  StockMovement,
} from '@/domain/types';

export const DB_NAME = 'facebook-seller-os';
export const DB_VERSION = 2;
/** Application-level data format version (stored in every backup and in settings). */
export const SCHEMA_VERSION = 2;

export interface DexieOptions {
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
  addons?: unknown[];
}

export class SellerDatabase extends Dexie {
  settings!: Table<Settings, string>;
  productCategories!: Table<ProductCategory, string>;
  expenseCategories!: Table<ExpenseCategory, string>;
  paymentMethods!: Table<PaymentMethod, string>;
  courierProviders!: Table<CourierProvider, string>;
  products!: Table<Product, string>;
  productVariants!: Table<ProductVariant, string>;
  stockLevels!: Table<StockLevel, string>;
  stockMovements!: Table<StockMovement, string>;
  customers!: Table<Customer, string>;
  orders!: Table<Order, string>;
  orderEvents!: Table<OrderEvent, string>;
  payments!: Table<Payment, string>;
  courierRecords!: Table<CourierRecord, string>;
  returns!: Table<ReturnRecord, string>;
  expenses!: Table<Expense, string>;

  /* ---------------------------------------------------------------- */
  /* V2 tables                                                        */
  /* ---------------------------------------------------------------- */
  promotions!: Table<Promotion, string>;
  promotionUsages!: Table<PromotionUsage, string>;
  loyaltyEntries!: Table<LoyaltyEntry, string>;
  referrals!: Table<Referral, string>;
  noteTemplates!: Table<NoteTemplate, string>;
  recurringExpenses!: Table<RecurringExpense, string>;
  reminders!: Table<Reminder, string>;

  constructor(name: string = DB_NAME, options?: DexieOptions) {
    super(name, options as never);

    // Version 1 is kept verbatim: Dexie replays it before applying version 2, and the
    // migration test builds a real V1 database from this exact declaration.
    this.version(1).stores({
      settings: 'id',
      productCategories: 'id, name, createdAt',
      expenseCategories: 'id, name, createdAt',
      paymentMethods: 'id, key, name, isActive',
      courierProviders: 'id, name, isActive',
      products: 'id, sku, name, categoryId, isActive, archivedAt, createdAt, updatedAt',
      productVariants: 'id, productId, sku, [productId+sku], isActive',
      stockLevels: 'id, productId, variantId, [productId+variantId], quantity',
      stockMovements: 'id, productId, variantId, [productId+variantId], type, referenceType, referenceId, createdAt',
      customers: 'id, code, name, phone, status, archivedAt, createdAt, updatedAt',
      orders:
        'id, orderNumber, orderDate, status, customerId, channel, paymentStatus, courierProviderId, trackingNumber, archivedAt, createdAt, updatedAt',
      orderEvents: 'id, orderId, type, createdAt, [orderId+createdAt]',
      payments: 'id, orderId, customerId, courierRecordId, expenseId, kind, direction, date, createdAt',
      courierRecords: 'id, consignmentId, orderId, providerId, status, shipmentDate, createdAt',
      returns: 'id, returnNumber, orderId, type, status, date, createdAt',
      expenses: 'id, expenseNumber, date, categoryId, categoryName, method, voidedAt, createdAt',
    });

    /**
     * VERSION 2 — Premium Business Edition.
     *
     * Every table is re-declared in full (Dexie expects the complete schema for a
     * version and works out the diff itself). Only three things are new here:
     *   - added indexes on existing tables (never a column removal)
     *   - seven new tables
     * No V1 table, row or column changes meaning. Old rows simply gain V2 defaults
     * through the `migrations.ts` backfill, which is idempotent.
     */
    this.version(2).stores({
      settings: 'id',
      productCategories: 'id, name, createdAt',
      expenseCategories: 'id, name, createdAt',
      paymentMethods: 'id, key, name, isActive',
      courierProviders: 'id, name, isActive',
      products: 'id, sku, name, categoryId, isActive, archivedAt, createdAt, updatedAt',
      productVariants: 'id, productId, sku, [productId+sku], isActive',
      stockLevels: 'id, productId, variantId, [productId+variantId], quantity',
      stockMovements: 'id, productId, variantId, [productId+variantId], type, referenceType, referenceId, createdAt',
      // V2: segment index for customer segmentation queries.
      customers: 'id, code, name, phone, segment, status, archivedAt, createdAt, updatedAt',
      // V2: multi-entry promotion index + coupon lookup.
      orders:
        'id, orderNumber, orderDate, status, customerId, channel, paymentStatus, courierProviderId, trackingNumber, *promotionIds, couponCode, archivedAt, createdAt, updatedAt',
      orderEvents: 'id, orderId, type, createdAt, [orderId+createdAt]',
      payments: 'id, orderId, customerId, courierRecordId, expenseId, kind, direction, date, createdAt',
      // V2: payoutDate index for the courier payout report.
      courierRecords:
        'id, consignmentId, orderId, providerId, status, shipmentDate, payoutDate, createdAt',
      returns: 'id, returnNumber, orderId, type, status, date, createdAt',
      // V2: recurringExpenseId index so a rule's generated rows can be found.
      expenses:
        'id, expenseNumber, date, categoryId, categoryName, method, voidedAt, recurringExpenseId, createdAt',

      promotions: 'id, name, type, mechanism, status, couponCode, priority, startsAt, endsAt, createdAt',
      promotionUsages: 'id, promotionId, orderId, customerId, date, createdAt',
      loyaltyEntries: 'id, customerId, orderId, type, date, createdAt',
      referrals: 'id, referrerCustomerId, referredCustomerId, orderId, status, date, createdAt',
      noteTemplates: 'id, kind, name, isActive, isDefault, createdAt',
      recurringExpenses: 'id, name, categoryId, frequency, nextRunDate, isActive, createdAt',
      reminders: 'id, title, dueAt, doneAt, priority, createdAt',
    });
  }
}

export const db = new SellerDatabase();

/** Tables included in a full backup/restore, in dependency-independent order. */
export const BACKUP_TABLES = [
  'settings',
  'productCategories',
  'expenseCategories',
  'paymentMethods',
  'courierProviders',
  'products',
  'productVariants',
  'stockLevels',
  'stockMovements',
  'customers',
  'orders',
  'orderEvents',
  'payments',
  'courierRecords',
  'returns',
  'expenses',
  // V2
  'promotions',
  'promotionUsages',
  'loyaltyEntries',
  'referrals',
  'noteTemplates',
  'recurringExpenses',
  'reminders',
] as const;

/**
 * Tables that exist only from V2 onwards. A V1 backup does not contain them; restore
 * fills them with empty arrays so an old backup still restores cleanly on a new app
 * (and a V2 backup restored by... a V1 app would simply ignore the extra keys).
 */
export const V2_ONLY_TABLES = [
  'promotions',
  'promotionUsages',
  'loyaltyEntries',
  'referrals',
  'noteTemplates',
  'recurringExpenses',
  'reminders',
] as const;

export type BackupTableName = (typeof BACKUP_TABLES)[number];

export function table(name: BackupTableName): Table {
  return (db as unknown as Record<string, Table>)[name];
}

/** Open the database explicitly; safe to call repeatedly. */
export async function openDatabase(): Promise<SellerDatabase> {
  if (!db.isOpen()) await db.open();
  return db;
}

/**
 * DANGEROUS: permanently deletes all local business data.
 * Only reachable behind an explicit, confirmed user action (Settings → Data management).
 */
export async function destroyAllData(): Promise<void> {
  await db.delete();
  await db.open();
}
