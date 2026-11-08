/**
 * types.ts — Domain model for Facebook Seller OS.
 *
 * Money: every `...Minor` / `...Amount` / `...Price` / `...Charge` / `cost` field is an
 * integer number of paisa (1 BDT = 100 paisa). See src/lib/money.ts and FINANCIAL_RULES.md.
 * Time: every `...At` / `date` field is epoch milliseconds (UTC instant) unless the field
 * name ends with `Iso`.
 */

import type { Minor } from '@/lib/money';

export type ID = string;
/** Epoch milliseconds (UTC instant). */
export type Timestamp = number;

export interface Auditable {
  id: ID;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** Soft delete / archive marker. Archived records are hidden from lists but never destroyed. */
  archivedAt?: Timestamp | null;
}

/* ------------------------------------------------------------------ */
/* Settings & configuration                                            */
/* ------------------------------------------------------------------ */

export interface BusinessProfile {
  name: string;
  logoDataUrl: string | null;
  address: string;
  phone: string;
  email: string;
  website: string;
  /** Optional trade licence / TIN shown on invoices. */
  registrationNote: string;
}

export interface CurrencySettings {
  code: 'BDT';
  symbol: string;
  position: 'before' | 'after';
}

export interface LocaleSettings {
  timeZone: string;
  /** Bengali digits for numbers/dates in the UI. */
  bengaliDigits: boolean;
  dateFormat: 'dd MMMM yyyy' | 'dd/MM/yyyy' | 'yyyy-MM-dd';
}

export interface InvoiceSettings {
  prefix: string;
  nextNumber: number;
  footerNote: string;
  terms: string;
  showLogo: boolean;
  paper: 'a4' | 'pos';
}

export interface OrderSettings {
  prefix: string;
  nextNumber: number;
  defaultDeliveryCharge: Minor;
  /** Statuses after which stock is committed (deducted) for an order. */
  stockCommitStatuses: OrderStatusKey[];
}

export interface InventorySettings {
  /** When false (default) the app blocks any movement that would make stock negative. */
  allowNegativeStock: boolean;
  defaultLowStockThreshold: number;
}

export interface SecuritySettings {
  pinEnabled: boolean;
  /** PBKDF2 record; the PIN itself is never stored. */
  pinRecord: {
    v: 1;
    alg: 'PBKDF2-SHA256';
    iterations: number;
    salt: string;
    hash: string;
    failedAttempts: number;
    lockedUntil: number;
  } | null;
}

export interface Settings extends Record<string, unknown> {
  id: 'app';
  schemaVersion: number;
  appVersion: string;
  onboardingCompleted: boolean;
  business: BusinessProfile;
  currency: CurrencySettings;
  locale: LocaleSettings;
  invoice: InvoiceSettings;
  order: OrderSettings;
  inventory: InventorySettings;
  security: SecuritySettings;
  backup: {
    lastBackupAt: Timestamp | null;
    reminderEnabled: boolean;
    reminderDays: number;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/* ------------------------------------------------------------------ */
/* Taxonomies                                                          */
/* ------------------------------------------------------------------ */

export interface ProductCategory extends Auditable {
  name: string;
  description: string;
}

export interface ExpenseCategory extends Auditable {
  name: string;
  description: string;
}

export interface PaymentMethod extends Auditable {
  /** Stable machine key ('cash' | 'bkash' | custom id). */
  key: string;
  name: string;
  isActive: boolean;
  /** Applied as a note on transactions only; no hidden fees are ever computed. */
  note: string;
}

export interface CourierProvider extends Auditable {
  name: string;
  phone: string;
  isActive: boolean;
  note: string;
}

/* ------------------------------------------------------------------ */
/* Products & inventory                                                */
/* ------------------------------------------------------------------ */

export interface ProductVariant extends Auditable {
  productId: ID;
  sku: string;
  /** Human label e.g. "লাল / L". */
  label: string;
  attributes: {
    size: string;
    color: string;
    weight: string;
    custom: string;
  };
  costPrice: Minor;
  sellingPrice: Minor;
  isActive: boolean;
}

export interface Product extends Auditable {
  sku: string;
  name: string;
  description: string;
  categoryId: ID | null;
  brand: string;
  /** Default cost for single (non-variant) products. */
  costPrice: Minor;
  /** Default selling price for single (non-variant) products. */
  sellingPrice: Minor;
  discountPrice: Minor | null;
  unit: string;
  barcode: string;
  /** Data URL of a user-supplied image (stored locally in IndexedDB). */
  imageDataUrl: string | null;
  hasVariants: boolean;
  lowStockThreshold: number;
  isActive: boolean;
}

export type StockMovementType =
  | 'opening'
  | 'purchase'
  | 'sale'
  | 'sale_reversal'
  | 'return_in'
  | 'return_out'
  | 'exchange_out'
  | 'exchange_in'
  | 'damage'
  | 'loss'
  | 'adjustment'
  | 'transfer_in'
  | 'transfer_out'
  | 'order_edit';

export type StockReferenceType = 'order' | 'return' | 'manual' | 'import' | 'opening' | 'delete' | 'exchange';

export interface StockMovement {
  id: ID;
  productId: ID;
  /** null for products without variants. */
  variantId: ID | null;
  /** Signed quantity. Negative = stock leaves the business. */
  quantity: number;
  type: StockMovementType;
  referenceType: StockReferenceType;
  referenceId: ID | null;
  /** Cost per unit at the time of the movement (used for valuation). */
  unitCost: Minor;
  reason: string;
  /** Counterparty (supplier/customer) if relevant. */
  party: string;
  note: string;
  createdAt: Timestamp;
}

export interface StockLevel {
  /** `${productId}::${variantId ?? '-'}` — deterministic so it can be upserted. */
  id: string;
  productId: ID;
  variantId: ID | null;
  quantity: number;
  /** Weighted-average unit cost (paisa) used for inventory valuation. */
  avgCost: Minor;
  updatedAt: Timestamp;
}

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

export type CustomerStatus = 'active' | 'blocked' | 'vip';

export interface Customer extends Auditable {
  code: string;
  name: string;
  phone: string;
  altPhone: string;
  address: string;
  district: string;
  area: string;
  notes: string;
  tags: string[];
  status: CustomerStatus;
  /** Denormalised counters (recomputed by the customer service, never hand-edited). */
  lastOrderAt: Timestamp | null;
}

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

export type OrderStatusKey =
  | 'new'
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'ready'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'returned'
  | 'exchanged';

export interface OrderStatusDefinition {
  key: OrderStatusKey;
  label: string;
  /** Tailwind-ish colour token name. */
  tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'purple';
  isDefault: boolean;
  /** Whether an order in this status counts as "open"/active work. */
  isOpen: boolean;
  sortOrder: number;
}

export type OrderChannelKey = 'facebook' | 'messenger' | 'whatsapp' | 'phone' | 'website' | 'walkin' | 'other';

export interface OrderChannelDefinition {
  key: OrderChannelKey;
  label: string;
}

export interface OrderItem {
  id: ID;
  productId: ID | null;
  variantId: ID | null;
  /** Snapshot of the product name (products can be renamed later). */
  name: string;
  sku: string;
  unit: string;
  quantity: number;
  unitPrice: Minor;
  /** Snapshot of cost at order time — used for profit, not for inventory valuation. */
  unitCost: Minor;
  discount: Minor;
  /** (unitPrice * quantity) - discount */
  lineTotal: Minor;
}

export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'refunded' | 'overpaid';

export interface Order extends Auditable {
  orderNumber: string;
  /** When the order was placed (Dhaka calendar day, stored as epoch ms). */
  orderDate: Timestamp;
  channel: OrderChannelKey;
  customerId: ID | null;
  /** Snapshot taken at creation so printed invoices stay historically accurate. */
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  items: OrderItem[];
  /** Sum of item line totals before order-level discount. */
  subtotal: Minor;
  /** Order-level discount (in addition to per-item discounts). */
  discount: Minor;
  deliveryCharge: Minor;
  /** Packaging / gift wrap / any other charge the customer pays. */
  otherCharge: Minor;
  /** subtotal - discount + deliveryCharge + otherCharge */
  total: Minor;
  /** Cost of goods sold snapshot: Σ(unitCost * qty). */
  cogs: Minor;
  status: OrderStatusKey;
  paymentStatus: PaymentStatus;
  paymentMethod: string;
  courierProviderId: ID | null;
  courierName: string;
  trackingNumber: string;
  notes: string;
  customerInstructions: string;
  cancelReason: string;
  /** True once stock has been committed for this order (prevents double deduction). */
  stockCommitted: boolean;
  /** True once returned items have been restocked (prevents double restoration). */
  returnRestocked: boolean;
  /** Courier COD amount declared at shipment. */
  codAmount: Minor;
}

export type OrderEventType =
  | 'created'
  | 'updated'
  | 'status_changed'
  | 'payment'
  | 'refund'
  | 'courier'
  | 'return'
  | 'note'
  | 'archived'
  | 'restored';

export interface OrderEvent {
  id: ID;
  orderId: ID;
  type: OrderEventType;
  /** Bengali human-readable message shown in the activity timeline. */
  message: string;
  meta: Record<string, string | number | null>;
  createdAt: Timestamp;
}

/* ------------------------------------------------------------------ */
/* Payments / transaction ledger                                       */
/* ------------------------------------------------------------------ */

export type PaymentKind =
  | 'order_payment'
  | 'order_refund'
  | 'courier_payout'
  | 'cod_collection'
  | 'expense_payment'
  | 'adjustment_in'
  | 'adjustment_out';

export type PaymentDirection = 'in' | 'out';

export interface Payment extends Auditable {
  kind: PaymentKind;
  direction: PaymentDirection;
  amount: Minor;
  method: string;
  orderId: ID | null;
  customerId: ID | null;
  courierRecordId: ID | null;
  expenseId: ID | null;
  /** Business date of the transaction (Dhaka day). */
  date: Timestamp;
  reference: string;
  note: string;
  /**
   * Soft-void marker. Correcting a payment never deletes history: the original row is
   * voided and a new compensating row may be created.
   */
  voidedAt: Timestamp | null;
}

/* ------------------------------------------------------------------ */
/* Courier                                                             */
/* ------------------------------------------------------------------ */

export type CourierDeliveryStatus =
  | 'pending'
  | 'in_transit'
  | 'delivered'
  | 'partial_delivered'
  | 'cancelled'
  | 'returned'
  | 'lost'
  | 'hold';

export interface CourierRecord extends Auditable {
  providerId: ID | null;
  courierName: string;
  consignmentId: string;
  orderId: ID | null;
  orderNumber: string;
  shipmentDate: Timestamp;
  status: CourierDeliveryStatus;
  /** Charge billed by the courier to the business. */
  deliveryCharge: Minor;
  /** Charge the business collects from the customer (may differ from the courier charge). */
  customerDeliveryCharge: Minor;
  codAmount: Minor;
  /** Amount the courier says it collected from the customer. */
  collectedAmount: Minor;
  courierFee: Minor;
  returnFee: Minor;
  /** Manual adjustment (+/-) with a mandatory reason note. */
  adjustment: Minor;
  payoutDate: Timestamp | null;
  payoutReference: string;
  note: string;
}

/* ------------------------------------------------------------------ */
/* Returns, refunds, exchanges                                         */
/* ------------------------------------------------------------------ */

export type ReturnType = 'return' | 'exchange' | 'refund_only';
export type ReturnReason =
  | 'damaged'
  | 'wrong_item'
  | 'size_issue'
  | 'quality_issue'
  | 'customer_rejected'
  | 'failed_delivery'
  | 'late_delivery'
  | 'other';
export type ReturnCondition = 'resellable' | 'damaged' | 'defective' | 'missing_parts';

export interface ReturnItem {
  id: ID;
  orderItemId: ID | null;
  productId: ID | null;
  variantId: ID | null;
  name: string;
  sku: string;
  /** Quantity returned/exchanged. */
  quantity: number;
  unitPrice: Minor;
  refundAmount: Minor;
  /** Whether this line's quantity goes back into sellable stock. */
  restock: boolean;
  /** Replacement product for exchanges. */
  replacementProductId: ID | null;
  replacementVariantId: ID | null;
  replacementQuantity: number;
}

export interface ReturnRecord extends Auditable {
  returnNumber: string;
  orderId: ID;
  type: ReturnType;
  date: Timestamp;
  reason: ReturnReason;
  condition: ReturnCondition;
  items: ReturnItem[];
  /** Total cash refunded to the customer (equals Σ refundAmount when fully refunded). */
  refundAmount: Minor;
  /** Extra courier cost borne by the business for the return. */
  courierFee: Minor;
  status: 'draft' | 'completed' | 'cancelled';
  note: string;
  /** Payment row created for the refund (so cancelling the return can void it). */
  refundPaymentId: ID | null;
  /** Order status before the return was processed (used when the return is cancelled). */
  previousOrderStatus: OrderStatusKey | null;
}

/* ------------------------------------------------------------------ */
/* Expenses                                                            */
/* ------------------------------------------------------------------ */

export interface Expense extends Auditable {
  expenseNumber: string;
  date: Timestamp;
  categoryId: ID | null;
  categoryName: string;
  amount: Minor;
  method: string;
  payee: string;
  reference: string;
  description: string;
  note: string;
  /** Soft-void marker. Voided expenses stay in history and are excluded from totals. */
  voidedAt: Timestamp | null;
  /**
   * Set when the expense was generated from a courier record, so reporting can avoid
   * counting the same courier cost twice.
   */
  courierRecordId: ID | null;
}

/* ------------------------------------------------------------------ */
/* Backup envelope                                                     */
/* ------------------------------------------------------------------ */

export interface BackupTableCounts {
  [table: string]: number;
}

export interface BackupPayload {
  products: Product[];
  productVariants: ProductVariant[];
  productCategories: ProductCategory[];
  expenseCategories: ExpenseCategory[];
  paymentMethods: PaymentMethod[];
  courierProviders: CourierProvider[];
  stockLevels: StockLevel[];
  stockMovements: StockMovement[];
  customers: Customer[];
  orders: Order[];
  orderEvents: OrderEvent[];
  payments: Payment[];
  courierRecords: CourierRecord[];
  returns: ReturnRecord[];
  expenses: Expense[];
  settings: Settings[];
}

export interface BackupMeta {
  format: 'facebook-seller-os-backup';
  formatVersion: number;
  appVersion: string;
  schemaVersion: number;
  createdAtIso: string;
  createdAtMs: Timestamp;
  deviceLabel: string;
  counts: BackupTableCounts;
  checksum: string;
  encrypted: boolean;
}

/** Unencrypted backup file (JSON). */
export interface BackupFile {
  meta: BackupMeta;
  data: BackupPayload;
}

/** Password-protected backup file: `data` is replaced by an AES-GCM envelope. */
export interface EncryptedBackupFile {
  meta: Omit<BackupMeta, 'checksum'> & { checksum: '' };
  envelope: unknown;
}
