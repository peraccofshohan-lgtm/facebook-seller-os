/**
 * schemas.ts — Zod validation for every user-supplied record.
 *
 * Rules enforced here (see SECURITY_AND_PRIVACY.md §Data validation):
 *  - money must be a finite, non-negative (or explicitly signed) decimal with ≤2 decimals
 *  - quantities must be positive and ≤ 1,000,000
 *  - references must be non-empty strings
 *  - dates must parse
 */

import { z } from 'zod';
import { assertMinor, parseMoney, toLatinDigits } from '@/lib/money';
import { fromDateInputValue } from '@/lib/date';
import { isValidBdPhone, normalizePhone } from '@/lib/search';

/**
 * Money field — two very different inputs, two different rules:
 *
 *  - a STRING is seller text or a CSV cell in taka ("1,200", "১২০০", "1200.50")
 *    and is converted to paisa.
 *  - a NUMBER is ALREADY paisa. That is what `MoneyInput` produces, what every
 *    service hands around, and what the tests build. It is validated, never
 *    converted again.
 *
 * The second rule exists because of a real defect: `parseMoney` reads a number
 * as taka, so a price typed as 400 taka arrived here as 40000 paisa and became
 * 4,000,000 — every price entered through the UI was stored 100× too large,
 * which then inflated order totals, profit, stock value and every report.
 */
const moneyField = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    // "abc" would otherwise be stripped to "" and silently read as zero.
    if (typeof v === 'string' && v.trim() !== '' && !/\d/.test(toLatinDigits(v))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'সঠিক টাকার অঙ্ক দিন' });
      return z.NEVER;
    }
    try {
      const minor = typeof v === 'number' ? assertMinor(v) : parseMoney(v);
      if (!Number.isSafeInteger(minor)) throw new Error('overflow');
      return minor;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'সঠিক টাকার অঙ্ক দিন' });
      return z.NEVER;
    }
  });

export const nonNegativeMoney = moneyField.pipe(z.number().min(0, 'ঋণাত্মক হতে পারবে না'));

const quantityField = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'সঠিক পরিমাণ দিন' });
      return z.NEVER;
    }
    return n;
  })
  .pipe(z.number().min(0, 'পরিমাণ ০ বা তার বেশি হতে হবে').max(1_000_000, 'পরিমাণ খুব বড়'));

const dateField = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    if (typeof v === 'number') return v;
    const ms = fromDateInputValue(v);
    if (ms === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'সঠিক তারিখ দিন' });
      return z.NEVER;
    }
    return ms;
  });

const phoneField = z
  .string()
  .trim()
  .transform((v) => normalizePhone(v))
  .refine((v) => v === '' || isValidBdPhone(v), 'সঠিক ফোন নম্বর দিন (যেমন ০১৭১২৩৪৫৬৭৮)');

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

export const productInputSchema = z.object({
  name: z.string().trim().min(1, 'পণ্যের নাম দিন').max(200, 'নাম খুব বড়'),
  sku: z.string().trim().max(64, 'SKU খুব বড়').optional().default(''),
  description: z.string().trim().max(2000).optional().default(''),
  categoryId: z.string().nullable().optional().default(null),
  brand: z.string().trim().max(120).optional().default(''),
  costPrice: nonNegativeMoney,
  sellingPrice: nonNegativeMoney,
  discountPrice: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === '') return null;
      try {
        return typeof v === 'number' ? assertMinor(v) : parseMoney(v);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'সঠিক টাকার অঙ্ক দিন' });
        return z.NEVER;
      }
    }),
  unit: z.string().trim().max(20).optional().default('পিস'),
  barcode: z.string().trim().max(64).optional().default(''),
  imageDataUrl: z.string().nullable().optional().default(null),
  hasVariants: z.boolean().optional().default(false),
  lowStockThreshold: z.coerce.number().int().min(0).max(100000).optional().default(5),
  isActive: z.boolean().optional().default(true),
});

export type ProductInput = z.infer<typeof productInputSchema>;

export const variantInputSchema = z.object({
  productId: z.string().min(1),
  sku: z.string().trim().max(64).optional().default(''),
  label: z.string().trim().min(1, 'ভ্যারিয়েন্টের নাম দিন').max(120),
  size: z.string().trim().max(40).optional().default(''),
  color: z.string().trim().max(40).optional().default(''),
  weight: z.string().trim().max(40).optional().default(''),
  custom: z.string().trim().max(80).optional().default(''),
  costPrice: nonNegativeMoney,
  sellingPrice: nonNegativeMoney,
  isActive: z.boolean().optional().default(true),
});

export type VariantInput = z.infer<typeof variantInputSchema>;

/* ------------------------------------------------------------------ */
/* Customer                                                            */
/* ------------------------------------------------------------------ */

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, 'কাস্টমারের নাম দিন').max(200),
  phone: phoneField,
  altPhone: z
    .string()
    .trim()
    .optional()
    .default('')
    .transform((v) => normalizePhone(v))
    .refine((v) => v === '' || isValidBdPhone(v), 'সঠিক ফোন নম্বর দিন'),
  address: z.string().trim().max(500).optional().default(''),
  district: z.string().trim().max(80).optional().default(''),
  area: z.string().trim().max(120).optional().default(''),
  notes: z.string().trim().max(2000).optional().default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional().default([]),
  status: z.enum(['active', 'blocked', 'vip']).optional().default('active'),
});

export type CustomerInput = z.infer<typeof customerInputSchema>;

/* ------------------------------------------------------------------ */
/* Order                                                               */
/* ------------------------------------------------------------------ */

export const orderItemInputSchema = z.object({
  productId: z.string().nullable().optional().default(null),
  variantId: z.string().nullable().optional().default(null),
  name: z.string().trim().min(1, 'পণ্যের নাম দিন').max(200),
  sku: z.string().trim().max(64).optional().default(''),
  unit: z.string().trim().max(20).optional().default('পিস'),
  quantity: quantityField.pipe(z.number().positive('পরিমাণ ০ এর বেশি হতে হবে')),
  unitPrice: nonNegativeMoney,
  unitCost: nonNegativeMoney,
  discount: nonNegativeMoney,
});

export const orderInputSchema = z.object({
  orderDate: dateField,
  channel: z.enum(['facebook', 'messenger', 'whatsapp', 'phone', 'website', 'walkin', 'other']),
  customerId: z.string().nullable().optional().default(null),
  customerName: z.string().trim().max(200).optional().default(''),
  customerPhone: z
    .string()
    .trim()
    .optional()
    .default('')
    .transform((v) => normalizePhone(v)),
  deliveryAddress: z.string().trim().max(500).optional().default(''),
  items: z.array(orderItemInputSchema).min(1, 'অন্তত একটি পণ্য যোগ করুন').max(200),
  discount: nonNegativeMoney,
  deliveryCharge: nonNegativeMoney,
  otherCharge: nonNegativeMoney,
  status: z
    .enum(['new', 'pending', 'confirmed', 'processing', 'ready', 'shipped', 'delivered', 'cancelled', 'returned', 'exchanged'])
    .optional()
    .default('new'),
  paymentMethod: z.string().trim().max(40).optional().default('cash'),
  courierProviderId: z.string().nullable().optional().default(null),
  courierName: z.string().trim().max(80).optional().default(''),
  trackingNumber: z.string().trim().max(80).optional().default(''),
  notes: z.string().trim().max(2000).optional().default(''),
  customerInstructions: z.string().trim().max(1000).optional().default(''),
  cancelReason: z.string().trim().max(500).optional().default(''),
  /** Advance/initial payment captured while creating the order. */
  advancePayment: nonNegativeMoney.optional().default(0),
  advanceMethod: z.string().trim().max(40).optional().default('cash'),
  /** V2: coupon code typed by the customer. */
  couponCode: z.string().trim().max(40).optional().default(''),
  /** V2: loyalty points the customer is spending on this order. */
  pointsToRedeem: z.coerce.number().int().min(0).max(1_000_000).optional().default(0),
});

export type OrderInput = z.infer<typeof orderInputSchema>;
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;

/* ------------------------------------------------------------------ */
/* Courier                                                             */
/* ------------------------------------------------------------------ */

export const courierInputSchema = z.object({
  providerId: z.string().nullable().optional().default(null),
  courierName: z.string().trim().min(1, 'কুরিয়ারের নাম দিন').max(80),
  consignmentId: z.string().trim().max(80).optional().default(''),
  orderId: z.string().nullable().optional().default(null),
  shipmentDate: dateField,
  status: z
    .enum(['pending', 'in_transit', 'delivered', 'partial_delivered', 'cancelled', 'returned', 'lost', 'hold'])
    .optional()
    .default('pending'),
  deliveryCharge: nonNegativeMoney,
  customerDeliveryCharge: nonNegativeMoney,
  codAmount: nonNegativeMoney,
  collectedAmount: nonNegativeMoney,
  courierFee: nonNegativeMoney,
  returnFee: nonNegativeMoney,
  adjustment: moneyField,
  payoutDate: z.union([dateField, z.null()]).optional().default(null),
  payoutReference: z.string().trim().max(80).optional().default(''),
  note: z.string().trim().max(1000).optional().default(''),
});

export type CourierInput = z.infer<typeof courierInputSchema>;

/* ------------------------------------------------------------------ */
/* Returns                                                             */
/* ------------------------------------------------------------------ */

export const returnItemInputSchema = z.object({
  orderItemId: z.string().nullable().optional().default(null),
  productId: z.string().nullable().optional().default(null),
  variantId: z.string().nullable().optional().default(null),
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(64).optional().default(''),
  quantity: quantityField.pipe(z.number().positive('পরিমাণ ০ এর বেশি হতে হবে')),
  unitPrice: nonNegativeMoney,
  refundAmount: nonNegativeMoney,
  restock: z.boolean().optional().default(true),
  replacementProductId: z.string().nullable().optional().default(null),
  replacementVariantId: z.string().nullable().optional().default(null),
  replacementQuantity: quantityField.optional().default(0),
});

export const returnInputSchema = z.object({
  orderId: z.string().min(1, 'অর্ডার নির্বাচন করুন'),
  type: z.enum(['return', 'exchange', 'refund_only']),
  date: dateField,
  reason: z.enum(['damaged', 'wrong_item', 'size_issue', 'quality_issue', 'customer_rejected', 'failed_delivery', 'late_delivery', 'other']),
  condition: z.enum(['resellable', 'damaged', 'defective', 'missing_parts']),
  items: z.array(returnItemInputSchema).min(1, 'অন্তত একটি পণ্য নির্বাচন করুন'),
  courierFee: nonNegativeMoney,
  note: z.string().trim().max(1000).optional().default(''),
});

export type ReturnInput = z.infer<typeof returnInputSchema>;

/* ------------------------------------------------------------------ */
/* Expense                                                             */
/* ------------------------------------------------------------------ */

export const expenseInputSchema = z.object({
  date: dateField,
  categoryId: z.string().nullable().optional().default(null),
  amount: nonNegativeMoney.pipe(z.number().positive('খরচের পরিমাণ ০ এর বেশি হতে হবে')),
  method: z.string().trim().max(40).optional().default('cash'),
  payee: z.string().trim().max(200).optional().default(''),
  reference: z.string().trim().max(80).optional().default(''),
  description: z.string().trim().max(500).optional().default(''),
  note: z.string().trim().max(1000).optional().default(''),
});

export type ExpenseInput = z.infer<typeof expenseInputSchema>;

/* ------------------------------------------------------------------ */
/* Payment                                                             */
/* ------------------------------------------------------------------ */

export const paymentInputSchema = z.object({
  amount: nonNegativeMoney.pipe(z.number().positive('পরিমাণ ০ এর বেশি হতে হবে')),
  method: z.string().trim().max(40).optional().default('cash'),
  date: dateField,
  reference: z.string().trim().max(80).optional().default(''),
  note: z.string().trim().max(500).optional().default(''),
});

/* ------------------------------------------------------------------ */
/* Stock adjustment                                                    */
/* ------------------------------------------------------------------ */

export const stockAdjustInputSchema = z.object({
  productId: z.string().min(1, 'পণ্য নির্বাচন করুন'),
  variantId: z.string().nullable().optional().default(null),
  /** Signed delta: positive adds stock, negative removes stock. */
  quantity: quantityField,
  type: z
    .enum(['opening', 'purchase', 'damage', 'loss', 'adjustment', 'return_in', 'return_out', 'transfer_in', 'transfer_out'])
    .optional()
    .default('adjustment'),
  unitCost: nonNegativeMoney.optional().default(0),
  party: z.string().trim().max(120).optional().default(''),
  reason: z.string().trim().max(200).optional().default(''),
  note: z.string().trim().max(500).optional().default(''),
});

export type StockAdjustInput = z.infer<typeof stockAdjustInputSchema>;

/** Flatten a ZodError into a field → Bengali message map for form display. */
export function zodErrorMap(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* V2: Promotions                                                      */
/* ------------------------------------------------------------------ */

const PROMOTION_TYPES = [
  'percent', 'fixed', 'bogo', 'buy_x_get_y', 'free_gift', 'free_delivery', 'bundle',
  'coupon', 'min_purchase', 'first_order', 'repeat_customer', 'seasonal',
  'limited_time', 'product_specific', 'category_specific', 'loyalty_points', 'referral',
] as const;

const PROMOTION_MECHANISMS = [
  'percent_off', 'amount_off', 'free_items', 'bundle_price', 'free_delivery',
  'loyalty_points', 'referral_reward',
] as const;

const idList = z.array(z.string().trim().min(1).max(64)).max(500).optional().default([]);

export const promotionInputSchema = z
  .object({
    name: z.string().trim().min(1, 'অফারের নাম দিন').max(200, 'নাম খুব বড়'),
    description: z.string().trim().max(2000).optional().default(''),
    type: z.enum(PROMOTION_TYPES),
    mechanism: z.enum(PROMOTION_MECHANISMS).optional(),
    status: z.enum(['draft', 'active', 'paused']).optional().default('active'),

    percentOff: z.coerce.number().min(0, 'শতাংশ ঋণাত্মক হতে পারবে না').max(100, 'শতাংশ ১০০ এর বেশি হতে পারবে না').optional().default(0),
    amountOff: nonNegativeMoney.optional().default(0),
    buyQuantity: z.coerce.number().int().min(0).max(1000).optional().default(0),
    getQuantity: z.coerce.number().int().min(0).max(1000).optional().default(0),
    bundleItems: z
      .array(
        z.object({
          productId: z.string().nullable().optional().default(null),
          variantId: z.string().nullable().optional().default(null),
          name: z.string().trim().min(1, 'পণ্যের নাম দিন').max(200),
          quantity: z.coerce.number().int().min(1).max(1000),
        }),
      )
      .max(50)
      .optional()
      .default([]),
    bundlePrice: nonNegativeMoney.optional().default(0),
    giftItems: z
      .array(
        z.object({
          productId: z.string().nullable().optional().default(null),
          variantId: z.string().nullable().optional().default(null),
          name: z.string().trim().min(1, 'উপহারের নাম দিন').max(200),
          quantity: z.coerce.number().int().min(1).max(1000),
        }),
      )
      .max(50)
      .optional()
      .default([]),

    startsAt: dateField,
    endsAt: z.union([dateField, z.null()]).optional().default(null),
    productIds: idList,
    categoryIds: idList,
    minOrderAmount: nonNegativeMoney.optional().default(0),
    maxDiscount: nonNegativeMoney.optional().default(0),
    usageLimit: z.union([z.coerce.number().int().min(1).max(1_000_000), z.null()]).optional().default(null),
    perCustomerLimit: z.union([z.coerce.number().int().min(1).max(1_000_000), z.null()]).optional().default(null),
    customerEligibility: z.enum(['all', 'first_order', 'repeat']).optional().default('all'),
    customerSegments: z.array(z.string().trim().min(1).max(40)).max(30).optional().default([]),
    couponCode: z.string().trim().max(40).optional().default(''),

    stackable: z.boolean().optional().default(true),
    priority: z.coerce.number().int().min(0).max(999).optional().default(10),
    combinationGroup: z.string().trim().max(40).optional().default(''),
    terms: z.string().trim().max(2000).optional().default(''),
  })
  .superRefine((value, ctx) => {
    // A window that ends before it starts is always a typing mistake.
    if (value.endsAt != null && value.endsAt < value.startsAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'শেষ তারিখ শুরুর আগে হতে পারবে না' });
    }
    if (value.mechanism === 'percent_off' && value.percentOff <= 0 && value.type !== 'referral') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['percentOff'], message: 'শতাংশ ছাড় ০ এর বেশি দিন' });
    }
    if (value.mechanism === 'amount_off' && value.amountOff <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amountOff'], message: 'ছাড়ের টাকার অঙ্ক ০ এর বেশি দিন' });
    }
    if (value.mechanism === 'bundle_price' && value.bundleItems.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bundleItems'], message: 'বান্ডেলে অন্তত একটি পণ্য দিন' });
    }
    if (value.type === 'free_gift' && value.giftItems.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['giftItems'], message: 'উপহারের পণ্য নির্বাচন করুন' });
    }
    if ((value.type === 'bogo' || value.type === 'buy_x_get_y') && value.getQuantity <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['getQuantity'], message: 'কতটি ফ্রি দেবেন তা দিন' });
    }
  });

export type PromotionInput = z.infer<typeof promotionInputSchema>;

/* ------------------------------------------------------------------ */
/* V2: Note templates                                                  */
/* ------------------------------------------------------------------ */

export const noteTemplateInputSchema = z.object({
  kind: z.enum(['courier_slip', 'parcel_label', 'invoice', 'general']),
  name: z.string().trim().min(1, 'নোটের নাম দিন').max(120),
  body: z.string().trim().max(1000).optional().default(''),
  footer: z.string().trim().max(500).optional().default(''),
  align: z.enum(['left', 'center', 'right']).optional().default('left'),
  fontScale: z.enum(['small', 'normal', 'large']).optional().default('normal'),
  isActive: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
});

export type NoteTemplateInput = z.infer<typeof noteTemplateInputSchema>;

/* ------------------------------------------------------------------ */
/* V2: Recurring expenses & reminders                                  */
/* ------------------------------------------------------------------ */

export const recurringExpenseInputSchema = z
  .object({
    name: z.string().trim().min(1, 'খরচের নাম দিন').max(200),
    categoryId: z.string().nullable().optional().default(null),
    amount: nonNegativeMoney.pipe(z.number().positive('খরচের পরিমাণ ০ এর বেশি হতে হবে')),
    method: z.string().trim().max(40).optional().default('cash'),
    payee: z.string().trim().max(200).optional().default(''),
    description: z.string().trim().max(500).optional().default(''),
    note: z.string().trim().max(1000).optional().default(''),
    frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    startDate: dateField,
    endDate: z.union([dateField, z.null()]).optional().default(null),
    isActive: z.boolean().optional().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.endDate != null && value.endDate < value.startDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'শেষ তারিখ শুরুর আগে হতে পারবে না' });
    }
  });

export type RecurringExpenseInput = z.infer<typeof recurringExpenseInputSchema>;

export const reminderInputSchema = z.object({
  title: z.string().trim().min(1, 'কী মনে করিয়ে দেবে লিখুন').max(200),
  note: z.string().trim().max(1000).optional().default(''),
  dueAt: dateField,
  priority: z.enum(['low', 'normal', 'high']).optional().default('normal'),
  referenceType: z.enum(['order', 'customer', 'courier', 'expense', 'general']).optional().default('general'),
  referenceId: z.string().nullable().optional().default(null),
});

export type ReminderInput = z.infer<typeof reminderInputSchema>;

/* ------------------------------------------------------------------ */
/* V2: Referrals                                                       */
/* ------------------------------------------------------------------ */

export const referralInputSchema = z.object({
  referrerCustomerId: z.string().min(1, 'কে রেফার করলেন নির্বাচন করুন'),
  referredCustomerId: z.string().nullable().optional().default(null),
  referredName: z.string().trim().max(200).optional().default(''),
  rewardType: z.enum(['points', 'discount', 'cash']).optional().default('points'),
  rewardPoints: z.coerce.number().int().min(0).max(1_000_000).optional().default(0),
  rewardAmount: nonNegativeMoney.optional().default(0),
  note: z.string().trim().max(1000).optional().default(''),
  date: dateField,
});

export type ReferralInput = z.infer<typeof referralInputSchema>;
