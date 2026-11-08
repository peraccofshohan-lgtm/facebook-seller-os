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

/**
 * BusinessProfile — the SELLER's own identity.
 *
 * IMPORTANT IDENTITY RULE (V2): these fields describe the person/business that runs the
 * shop. The software's developer (Shohan Khan) is credited in Settings → About only and
 * must never be substituted into an invoice, report, courier slip or customer document.
 */
export interface BusinessProfile {
  name: string;
  /** Proprietor / owner name (V2). */
  ownerName: string;
  logoDataUrl: string | null;
  address: string;
  /** Area / thana part of the business address (V2). */
  area: string;
  /** District part of the business address (V2). */
  district: string;
  phone: string;
  /** Second contact number (V2). */
  altPhone: string;
  email: string;
  website: string;
  /** Short description of the business (V2). */
  description: string;
  /** Thank-you message printed on invoices (V2). */
  thankYouMessage: string;
  /** Optional trade licence / TIN shown on invoices. */
  registrationNote: string;
}

/**
 * A frozen copy of the business identity taken when a document was produced, so that
 * reprinting an old courier slip or invoice shows what the business looked like then.
 */
export interface BusinessSnapshot {
  name: string;
  ownerName: string;
  logoDataUrl: string | null;
  address: string;
  area: string;
  district: string;
  phone: string;
  altPhone: string;
  email: string;
  website: string;
}

/**
 * BrandingSettings — how the business identity is presented on documents (V2).
 * Kept separate from BusinessProfile so that changing a phone number does not
 * silently reshape every layout choice the seller made.
 */
export interface BrandingSettings {
  tagline: string;
  /** Footer line used on reports and non-invoice documents. */
  documentFooter: string;
  /** Where the logo is printed. */
  showLogoOn: {
    invoice: boolean;
    courierSlip: boolean;
    parcelLabel: boolean;
    reports: boolean;
  };
  showSignature: boolean;
  signatureLabel: string;
  /** Printed under the signature line; defaults to the owner name. */
  signatureName: string;
  /** One of a small set of validated presets — never arbitrary CSS. */
  accent: 'indigo' | 'emerald' | 'rose' | 'amber' | 'slate';
  fontScale: 'small' | 'normal' | 'large';
  align: 'left' | 'center' | 'right';
  showBusinessDescription: boolean;
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

/** Courier booking slip / parcel label / print behaviour (V2). */
export interface DocumentSettings {
  courierSlipPaper: 'a4' | 'pos';
  /** Physical parcel label size. */
  labelSize: 'small' | 'medium';
  /** Note template pre-selected when a slip is created. */
  defaultNoteTemplateId: ID | null;
  showBarcode: boolean;
  showQr: boolean;
  /** Printed on every parcel label. */
  fragileByDefault: boolean;
  /** Page-break strategy for bulk printing. */
  bulkPrintSpacing: 'compact' | 'page';
}

/** Promotion engine configuration (V2). */
export interface PromotionSettings {
  enabled: boolean;
  /** Allow two or more promotions to apply to the same order at all. */
  allowStacking: boolean;
  loyaltyEnabled: boolean;
  /** Points earned per whole 100 BDT of net sales. Integer. */
  pointsPerHundredTaka: number;
  /** Paisa of discount per redeemed point. */
  paisaPerPoint: number;
  referralEnabled: boolean;
  /** Default reward when a referral converts (V2). */
  referralPoints: number;
}

/** Which dashboard blocks the seller wants to see, and in what order (V2). */
export interface DashboardSettings {
  /** Keys of the KPI cards to show; empty means "show the defaults". */
  visibleCards: string[];
  showCharts: boolean;
  showAttentionList: boolean;
  showActivityFeed: boolean;
  /** Comparison window for the headline deltas. */
  trendWindowDays: number;
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
  /** V2: document/branding, promotion and dashboard preferences. */
  branding: BrandingSettings;
  documents: DocumentSettings;
  promotions: PromotionSettings;
  dashboard: DashboardSettings;
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

  /* -------------------------------------------------------------- */
  /* V2: segmentation, loyalty, referral                             */
  /* -------------------------------------------------------------- */

  /** Free-text segment label, e.g. "পাইকারি", "নতুন", "VIP" (V2). */
  segment: string;
  /** Running loyalty point balance (V2). Recomputed from the loyalty ledger. */
  loyaltyPoints: number;
  /** Short code a new customer can quote to credit this customer (V2). */
  referralCode: string;
  /** Who referred this customer, if known (V2). */
  referredByCustomerId: ID | null;
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
  /**
   * V2: true when this line was given away by a promotion (BOGO, Buy X Get Y, free gift).
   * A free line has unitPrice 0, so it never counts as paid sales — but its unitCost is
   * still real money and still lands in COGS.
   */
  isFreeGift: boolean;
  /** V2: the promotion that produced this line's discount or freeness. */
  promotionId: ID | null;
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

  /* -------------------------------------------------------------- */
  /* V2: promotions, loyalty, referral                               */
  /* -------------------------------------------------------------- */

  /** Promotions that actually applied to this order (V2). */
  promotionIds: ID[];
  /** Total discount produced by promotions (V2). Part of `discount`. */
  promotionDiscount: Minor;
  /** Coupon code the customer used, if any (V2). */
  couponCode: string;
  /** Loyalty points earned by this order (V2). */
  loyaltyPointsEarned: number;
  /** Loyalty points spent on this order (V2). */
  loyaltyPointsRedeemed: number;
  /** Paisa of discount obtained by redeeming points (V2). Part of `discount`. */
  loyaltyDiscount: Minor;
  /** Referral record rewarded by this order (V2). */
  referralId: ID | null;
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

  /* -------------------------------------------------------------- */
  /* V2: courier booking slip & parcel label                         */
  /* -------------------------------------------------------------- */

  /** Number of physical parcels in this consignment (V2). */
  parcelCount: number;
  /** Declared value of the goods (V2). Snapshot of the order's net sales. */
  declaredValue: Minor;
  /** What the customer already paid before shipment (V2). Snapshot. */
  advancePaid: Minor;
  /** Fragile / handle-with-care markers (V2). */
  fragile: boolean;
  handleWithCare: boolean;
  /** Handling instructions printed on the slip (V2). */
  specialInstructions: string;
  /** Seller's own note printed on the slip (V2). */
  sellerNote: string;
  /** Note template used when the slip was last printed (V2). */
  noteTemplateId: ID | null;

  /** Recipient snapshot, taken from the order/customer at booking time (V2). */
  recipientName: string;
  recipientPhone: string;
  recipientAltPhone: string;
  recipientAddress: string;
  area: string;
  district: string;
  postcode: string;
  /** Product names and quantities, frozen at booking time (V2). */
  contentsSummary: string;

  /** Sender (business) snapshot, frozen when the slip was first produced (V2). */
  senderSnapshot: BusinessSnapshot | null;
  /** When a booking slip was last produced, for reprint history (V2). */
  lastSlipPrintedAt: Timestamp | null;
  slipPrintCount: number;
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

/* ------------------------------------------------------------------ */
/* V2: Promotions, loyalty, referrals                                  */
/* ------------------------------------------------------------------ */

/**
 * The seventeen offer shapes the seller can configure. Each name is a distinct,
 * genuinely-implemented preset: it selects a default `mechanism`, a default set of
 * eligibility fields and the wording shown in the UI. Nothing here is a label over a
 * no-op — every type produces a real, tested discount calculation.
 */
export type PromotionType =
  | 'percent'
  | 'fixed'
  | 'bogo'
  | 'buy_x_get_y'
  | 'free_gift'
  | 'free_delivery'
  | 'bundle'
  | 'coupon'
  | 'min_purchase'
  | 'first_order'
  | 'repeat_customer'
  | 'seasonal'
  | 'limited_time'
  | 'product_specific'
  | 'category_specific'
  | 'loyalty_points'
  | 'referral';

/**
 * HOW the discount is computed. Two promotion types may share a mechanism
 * (a "seasonal" and a "percent" offer both take a percentage off) while differing in
 * eligibility and reporting.
 */
export type PromotionMechanism =
  | 'percent_off'
  | 'amount_off'
  | 'free_items'
  | 'bundle_price'
  | 'free_delivery'
  | 'loyalty_points'
  | 'referral_reward';

export type PromotionStatus = 'draft' | 'active' | 'paused';

export interface BundleItem {
  productId: ID | null;
  variantId: ID | null;
  name: string;
  quantity: number;
}

export interface GiftItem {
  productId: ID | null;
  variantId: ID | null;
  name: string;
  quantity: number;
}

export interface Promotion extends Auditable {
  name: string;
  description: string;
  type: PromotionType;
  mechanism: PromotionMechanism;
  status: PromotionStatus;

  /* Discount shape — only the fields relevant to `mechanism` are read. */
  /** Whole or half percent, e.g. 10 or 12.5. */
  percentOff: number;
  amountOff: Minor;
  /** Buy X… */
  buyQuantity: number;
  /** …get Y free (BOGO = buy 1 get 1). */
  getQuantity: number;
  bundleItems: BundleItem[];
  /** Price for the whole bundle. */
  bundlePrice: Minor;
  giftItems: GiftItem[];

  /* Eligibility */
  startsAt: Timestamp;
  /** null = runs forever. */
  endsAt: Timestamp | null;
  /** Empty = every product. */
  productIds: ID[];
  /** Empty = every category. */
  categoryIds: ID[];
  minOrderAmount: Minor;
  /** Cap on the discount this promotion may produce, 0 = no cap. */
  maxDiscount: Minor;
  /** Total redemptions allowed; null = unlimited. */
  usageLimit: number | null;
  /** Denormalised redemption count, maintained by promotionService. */
  usageCount: number;
  /** Redemptions allowed per customer; null = unlimited. */
  perCustomerLimit: number | null;
  customerEligibility: 'all' | 'first_order' | 'repeat';
  /** Only customers carrying one of these segments, empty = any. */
  customerSegments: string[];
  couponCode: string;

  /* Stacking */
  /** false = this promotion refuses to combine with any other. */
  stackable: boolean;
  /** Lower number wins when two promotions compete. */
  priority: number;
  /** Promotions sharing a non-empty group never apply together. */
  combinationGroup: string;

  terms: string;
}

/** What one promotion decided to do to one basket. */
export interface PromotionResult {
  promotionId: ID;
  name: string;
  type: PromotionType;
  mechanism: PromotionMechanism;
  /** Discount taken off item prices (paisa). */
  itemDiscount: Minor;
  /** Discount taken off the order as a whole (paisa). */
  orderDiscount: Minor;
  /** Delivery charge waived (paisa). */
  deliveryDiscount: Minor;
  /** Lines that become free. */
  freeItems: Array<{ productId: ID | null; variantId: ID | null; name: string; quantity: number }>;
  /** Loyalty points earned by the basket. */
  pointsEarned: number;
  /** Bengali explanation shown next to the order total. */
  message: string;
}

/** One redemption, recorded so the promotion performance report can use real data. */
export interface PromotionUsage extends Auditable {
  promotionId: ID;
  promotionName: string;
  promotionType: PromotionType;
  orderId: ID;
  orderNumber: string;
  customerId: ID | null;
  customerName: string;
  date: Timestamp;
  itemDiscount: Minor;
  orderDiscount: Minor;
  deliveryDiscount: Minor;
  /** itemDiscount + orderDiscount + deliveryDiscount */
  totalDiscount: Minor;
  /** Order total AFTER the discount, so "sales associated with the promotion" is honest. */
  orderTotal: Minor;
  orderNetSales: Minor;
}

export type LoyaltyEntryType = 'earn' | 'redeem' | 'adjust';

export interface LoyaltyEntry extends Auditable {
  customerId: ID;
  orderId: ID | null;
  promotionId: ID | null;
  type: LoyaltyEntryType;
  /** Signed: positive for earn/adjust-in, negative for redeem/adjust-out. */
  points: number;
  note: string;
  date: Timestamp;
}

export type ReferralStatus = 'pending' | 'rewarded' | 'cancelled';
export type ReferralRewardType = 'points' | 'discount' | 'cash';

export interface Referral extends Auditable {
  referrerCustomerId: ID;
  referrerName: string;
  /** New customer brought in; null while the referral is still just a lead. */
  referredCustomerId: ID | null;
  referredName: string;
  /** Order that triggered the reward. */
  orderId: ID | null;
  status: ReferralStatus;
  rewardType: ReferralRewardType;
  rewardPoints: number;
  rewardAmount: Minor;
  note: string;
  date: Timestamp;
  rewardedAt: Timestamp | null;
}

/* ------------------------------------------------------------------ */
/* V2: Document note templates                                         */
/* ------------------------------------------------------------------ */

export type NoteTemplateKind = 'courier_slip' | 'parcel_label' | 'invoice' | 'general';
export type TextAlign = 'left' | 'center' | 'right';
export type FontScale = 'small' | 'normal' | 'large';

export interface NoteTemplate extends Auditable {
  kind: NoteTemplateKind;
  name: string;
  body: string;
  footer: string;
  align: TextAlign;
  fontScale: FontScale;
  isActive: boolean;
  /** Pre-selected for new documents of its kind. */
  isDefault: boolean;
}

/* ------------------------------------------------------------------ */
/* V2: Recurring expenses & reminders                                  */
/* ------------------------------------------------------------------ */

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurringExpense extends Auditable {
  name: string;
  categoryId: ID | null;
  amount: Minor;
  method: string;
  payee: string;
  description: string;
  note: string;
  frequency: RecurrenceFrequency;
  startDate: Timestamp;
  /** Next date due. Advanced every time an expense is generated. */
  nextRunDate: Timestamp;
  /** null = repeats forever. */
  endDate: Timestamp | null;
  isActive: boolean;
  lastGeneratedAt: Timestamp | null;
  generatedCount: number;
}

export type ReminderPriority = 'low' | 'normal' | 'high';
export type ReminderReferenceType = 'order' | 'customer' | 'courier' | 'expense' | 'general';

/** A purely local reminder. No push server, no external messaging service. */
export interface Reminder extends Auditable {
  title: string;
  note: string;
  dueAt: Timestamp;
  doneAt: Timestamp | null;
  snoozedUntil: Timestamp | null;
  referenceType: ReminderReferenceType;
  referenceId: ID | null;
  priority: ReminderPriority;
}

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
  /** V2: set when a recurring-expense rule generated this expense. */
  recurringExpenseId: ID | null;
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
