/**
 * v1-database.ts — a byte-faithful copy of the SHIPPED V1 schema.
 *
 * Why this file exists
 * --------------------
 * "V1 data survives the V2 migration" is only worth something if the test starts from a
 * database that V1 actually wrote. So this class declares **only** `version(1)` with the
 * exact store/index list from the released V1 `db.ts` — including the indexes V2 later
 * changed (`customers` has no `segment`, `orders` has no `*promotionIds`, `courierRecords`
 * has no `payoutDate`, `expenses` has no `recurringExpenseId`) — and the helper seeds rows
 * that are missing every V2 field.
 *
 * The test then opens the REAL `SellerDatabase` (v1 + v2) over that same file and runs the
 * migration against it, so both the Dexie structural upgrade and the data backfill are
 * exercised, not one of them.
 */

import Dexie, { type Table } from 'dexie';

/** The V1 schema, verbatim. */
export const V1_STORES = {
  settings: 'id',
  productCategories: 'id, name, createdAt',
  expenseCategories: 'id, name, createdAt',
  paymentMethods: 'id, key, name, isActive',
  courierProviders: 'id, name, isActive',
  products: 'id, sku, name, categoryId, isActive, archivedAt, createdAt, updatedAt',
  productVariants: 'id, productId, sku, [productId+sku], isActive',
  stockLevels: 'id, productId, variantId, [productId+variantId], quantity',
  stockMovements:
    'id, productId, variantId, [productId+variantId], type, referenceType, referenceId, createdAt',
  customers: 'id, code, name, phone, status, archivedAt, createdAt, updatedAt',
  orders:
    'id, orderNumber, orderDate, status, customerId, channel, paymentStatus, courierProviderId, trackingNumber, archivedAt, createdAt, updatedAt',
  orderEvents: 'id, orderId, type, createdAt, [orderId+createdAt]',
  payments: 'id, orderId, customerId, courierRecordId, expenseId, kind, direction, date, createdAt',
  courierRecords: 'id, consignmentId, orderId, providerId, status, shipmentDate, createdAt',
  returns: 'id, returnNumber, orderId, type, status, date, createdAt',
  expenses: 'id, expenseNumber, date, categoryId, categoryName, method, voidedAt, createdAt',
} as const;

export class V1Database extends Dexie {
  settings!: Table<Record<string, unknown>, string>;
  productCategories!: Table<Record<string, unknown>, string>;
  expenseCategories!: Table<Record<string, unknown>, string>;
  paymentMethods!: Table<Record<string, unknown>, string>;
  courierProviders!: Table<Record<string, unknown>, string>;
  products!: Table<Record<string, unknown>, string>;
  productVariants!: Table<Record<string, unknown>, string>;
  stockLevels!: Table<Record<string, unknown>, string>;
  stockMovements!: Table<Record<string, unknown>, string>;
  customers!: Table<Record<string, unknown>, string>;
  orders!: Table<Record<string, unknown>, string>;
  orderEvents!: Table<Record<string, unknown>, string>;
  payments!: Table<Record<string, unknown>, string>;
  courierRecords!: Table<Record<string, unknown>, string>;
  returns!: Table<Record<string, unknown>, string>;
  expenses!: Table<Record<string, unknown>, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores(V1_STORES);
  }
}

const T0 = Date.UTC(2026, 0, 15, 6, 0, 0); // 15 Jan 2026, midday Dhaka

/**
 * A small but realistic V1 shop: one customer, one product, one paid order, one
 * in-transit courier consignment and one expense. Every row is deliberately missing the
 * V2 fields — that is the whole point.
 */
export function v1SeedRows() {
  const settings = {
    id: 'app',
    schemaVersion: 1,
    appVersion: '1.0.0',
    onboardingCompleted: true,
    business: {
      name: 'শাহান ট্রেডার্স',
      logoDataUrl: null,
      address: 'টাঙ্গাইল সদর',
      phone: '01711111111',
      email: 'shop@example.com',
      website: '',
      registrationNote: 'ট্রেড লাইসেন্স: ১২৩৪৫৬',
    },
    currency: { code: 'BDT', symbol: '৳', position: 'before' },
    locale: { timeZone: 'Asia/Dhaka', bengaliDigits: true, dateFormat: 'dd MMMM yyyy' },
    invoice: {
      prefix: 'INV',
      nextNumber: 2,
      footerNote: 'পণ্য ফেরত নেওয়া হবে না। ধন্যবাদ।',
      terms: '',
      showLogo: true,
      paper: 'a4',
    },
    order: {
      prefix: 'ORD',
      nextNumber: 2,
      defaultDeliveryCharge: 6000,
      stockCommitStatuses: ['confirmed', 'processing', 'ready', 'shipped', 'delivered'],
    },
    inventory: { allowNegativeStock: false, defaultLowStockThreshold: 5 },
    security: { pinEnabled: false, pinRecord: null },
    backup: { lastBackupAt: null, reminderEnabled: true, reminderDays: 7 },
    createdAt: T0,
    updatedAt: T0,
  };

  const customer = {
    id: 'cus-v1-1',
    code: 'C0001',
    name: 'রিমা আক্তার',
    phone: '01712345678',
    altPhone: '',
    address: 'ধনবাড়ী, টাঙ্গাইল',
    district: 'টাঙ্গাইল',
    area: 'ধনবাড়ী',
    notes: 'নিয়মিত কাস্টমার',
    tags: ['পাইকারি'],
    status: 'active',
    lastOrderAt: T0,
    createdAt: T0,
    updatedAt: T0,
    archivedAt: null,
  };

  const product = {
    id: 'prd-v1-1',
    name: 'থ্রি-পিস লন',
    sku: 'TP-001',
    description: '',
    categoryId: null,
    brand: '',
    costPrice: 80000,
    sellingPrice: 120000,
    discountPrice: null,
    unit: 'পিস',
    barcode: '',
    imageDataUrl: null,
    hasVariants: false,
    lowStockThreshold: 5,
    isActive: true,
    createdAt: T0,
    updatedAt: T0,
    archivedAt: null,
  };

  const stockLevel = {
    id: 'stk-v1-1',
    productId: 'prd-v1-1',
    variantId: null,
    quantity: 8,
    averageCost: 80000,
    updatedAt: T0,
  };

  // NOTE: no `isFreeGift`, no `promotionId` — this is a V1 line.
  const orderItem = {
    id: 'itm-v1-1',
    productId: 'prd-v1-1',
    variantId: null,
    name: 'থ্রি-পিস লন',
    sku: 'TP-001',
    unit: 'পিস',
    quantity: 2,
    unitPrice: 120000,
    unitCost: 80000,
    discount: 0,
    lineTotal: 240000,
  };

  const order = {
    id: 'ord-v1-1',
    orderNumber: 'ORD-00001',
    orderDate: T0,
    channel: 'facebook',
    customerId: 'cus-v1-1',
    customerName: 'রিমা আক্তার',
    customerPhone: '01712345678',
    deliveryAddress: 'ধনবাড়ী, টাঙ্গাইল',
    items: [orderItem],
    subtotal: 240000,
    discount: 0,
    deliveryCharge: 6000,
    otherCharge: 0,
    total: 246000,
    cogs: 160000,
    status: 'shipped',
    paymentStatus: 'partial',
    paymentMethod: 'cash',
    courierProviderId: 'cp-v1-1',
    courierName: 'Pathao',
    trackingNumber: 'PT-998877',
    notes: '',
    customerInstructions: '',
    cancelReason: '',
    stockCommitted: true,
    returnRestocked: false,
    codAmount: 246000,
    createdAt: T0,
    updatedAt: T0,
    archivedAt: null,
  };

  const payment = {
    id: 'pay-v1-1',
    kind: 'order_payment',
    direction: 'in',
    amount: 100000,
    method: 'cash',
    orderId: 'ord-v1-1',
    customerId: 'cus-v1-1',
    courierRecordId: null,
    expenseId: null,
    date: T0,
    reference: '',
    note: 'অগ্রিম',
    voidedAt: null,
    createdAt: T0,
    updatedAt: T0,
    archivedAt: null,
  };

  const courierRecord = {
    id: 'crr-v1-1',
    providerId: 'cp-v1-1',
    courierName: 'Pathao',
    consignmentId: 'PT-998877',
    orderId: 'ord-v1-1',
    orderNumber: 'ORD-00001',
    shipmentDate: T0,
    status: 'in_transit',
    deliveryCharge: 6000,
    customerDeliveryCharge: 6000,
    codAmount: 246000,
    collectedAmount: 0,
    courierFee: 0,
    returnFee: 0,
    adjustment: 0,
    payoutDate: null,
    payoutReference: '',
    note: '',
    createdAt: T0,
    updatedAt: T0,
    archivedAt: null,
  };

  const expense = {
    id: 'exp-v1-1',
    expenseNumber: 'EXP-00001',
    date: T0,
    categoryId: null,
    categoryName: 'প্যাকেজিং',
    amount: 25000,
    method: 'cash',
    payee: '',
    reference: '',
    description: 'কার্টুন বাক্স',
    note: '',
    voidedAt: null,
    courierRecordId: null,
    createdAt: T0,
    updatedAt: T0,
    archivedAt: null,
  };

  const courierProvider = {
    id: 'cp-v1-1',
    name: 'Pathao',
    phone: '',
    note: '',
    isActive: true,
    createdAt: T0,
    updatedAt: T0,
    archivedAt: null,
  };

  return { settings, customer, product, stockLevel, order, payment, courierRecord, expense, courierProvider };
}

/** Write the V1 snapshot into a V1 database. */
export async function seedV1(database: V1Database): Promise<void> {
  const rows = v1SeedRows();
  await database.settings.put(rows.settings);
  await database.customers.put(rows.customer);
  await database.products.put(rows.product);
  await database.stockLevels.put(rows.stockLevel);
  await database.orders.put(rows.order);
  await database.payments.put(rows.payment);
  await database.courierRecords.put(rows.courierRecord);
  await database.expenses.put(rows.expense);
  await database.courierProviders.put(rows.courierProvider);
}
