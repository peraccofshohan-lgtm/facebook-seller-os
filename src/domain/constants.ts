/** System defaults: order statuses, channels, payment methods, courier providers, categories. */

import type {
  CourierDeliveryStatus,
  OrderChannelDefinition,
  OrderStatusDefinition,
  ReturnCondition,
  ReturnReason,
  ReturnType,
  StockMovementType,
} from './types';

export const APP_NAME = 'Facebook Seller OS';
export const APP_NAME_BN = 'ফেসবুক সেলার ওএস';
export const DEFAULT_TIME_ZONE = 'Asia/Dhaka';

export const DEFAULT_ORDER_STATUSES: OrderStatusDefinition[] = [
  { key: 'new', label: 'নতুন', tone: 'info', isDefault: true, isOpen: true, sortOrder: 1 },
  { key: 'pending', label: 'কনফার্ম বাকি', tone: 'warning', isDefault: false, isOpen: true, sortOrder: 2 },
  { key: 'confirmed', label: 'কনফার্মড', tone: 'info', isDefault: false, isOpen: true, sortOrder: 3 },
  { key: 'processing', label: 'প্রসেসিং', tone: 'purple', isDefault: false, isOpen: true, sortOrder: 4 },
  { key: 'ready', label: 'প্যাকিং ডান', tone: 'purple', isDefault: false, isOpen: true, sortOrder: 5 },
  { key: 'shipped', label: 'পাঠানো হয়েছে', tone: 'info', isDefault: false, isOpen: true, sortOrder: 6 },
  { key: 'delivered', label: 'ডেলিভার্ড', tone: 'success', isDefault: false, isOpen: false, sortOrder: 7 },
  { key: 'cancelled', label: 'বাতিল', tone: 'danger', isDefault: false, isOpen: false, sortOrder: 8 },
  { key: 'returned', label: 'রিটার্ন', tone: 'danger', isDefault: false, isOpen: false, sortOrder: 9 },
  { key: 'exchanged', label: 'এক্সচেঞ্জ', tone: 'warning', isDefault: false, isOpen: false, sortOrder: 10 },
];

export const DEFAULT_CHANNELS: OrderChannelDefinition[] = [
  { key: 'facebook', label: 'ফেসবুক পেজ' },
  { key: 'messenger', label: 'মেসেঞ্জার' },
  { key: 'whatsapp', label: 'হোয়াটসঅ্যাপ' },
  { key: 'phone', label: 'ফোন কল' },
  { key: 'website', label: 'ওয়েবসাইট' },
  { key: 'walkin', label: 'সরাসরি (Walk-in)' },
  { key: 'other', label: 'অন্যান্য' },
];

export const DEFAULT_PAYMENT_METHODS: { key: string; name: string; note: string }[] = [
  { key: 'cash', name: 'নগদ', note: '' },
  { key: 'bkash', name: 'বিকাশ', note: '' },
  { key: 'nagad', name: 'নগদ (Nagad)', note: '' },
  { key: 'rocket', name: 'রকেট', note: '' },
  { key: 'bank', name: 'ব্যাংক ট্রান্সফার', note: '' },
  { key: 'card', name: 'কার্ড', note: '' },
  { key: 'cod', name: 'ক্যাশ অন ডেলিভারি', note: 'কুরিয়ারের মাধ্যমে আদায়' },
  { key: 'other', name: 'অন্যান্য', note: '' },
];

export const DEFAULT_COURIER_PROVIDERS = ['Pathao', 'Steadfast', 'RedX', 'eCourier', 'Sundarban', 'SA Paribahan', 'Paperfly'];

export const DEFAULT_PRODUCT_CATEGORIES = ['পোশাক', 'কসমেটিকস', 'গ্যাজেট ও আনুষঙ্গিক', 'খাবার', 'গিফট ও লাইফস্টাইল', 'অন্যান্য'];

export const DEFAULT_EXPENSE_CATEGORIES = [
  'বিজ্ঞাপন',
  'প্যাকেজিং',
  'কুরিয়ার',
  'ভাড়া',
  'ইন্টারনেট',
  'বিদ্যুৎ',
  'কর্মচারী',
  'পণ্য ক্রয়',
  'সরঞ্জাম',
  'যাতায়াত',
  'অন্যান্য',
];

export const DEFAULT_UNITS = ['পিস', 'যোড়া', 'সেট', 'কেজি', 'গ্রাম', 'লিটার', 'মিটার', 'প্যাকেট', 'ডজন'];

export const ORDER_STATUS_TONE_CLASS: Record<string, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200',
  purple: 'bg-violet-50 text-violet-700 ring-violet-200',
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  unpaid: 'বাকি',
  partial: 'আংশিক পেইড',
  paid: 'পেইড',
  refunded: 'রিফান্ডেড',
  overpaid: 'অতিরিক্ত পেইড',
};

export const PAYMENT_STATUS_TONE: Record<string, string> = {
  unpaid: 'bg-rose-50 text-rose-700 ring-rose-200',
  partial: 'bg-amber-50 text-amber-800 ring-amber-200',
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  refunded: 'bg-slate-100 text-slate-700 ring-slate-200',
  overpaid: 'bg-sky-50 text-sky-700 ring-sky-200',
};

export const COURIER_STATUS_LABEL: Record<CourierDeliveryStatus, string> = {
  pending: 'পিকআপ বাকি',
  in_transit: 'পথে আছে',
  delivered: 'ডেলিভার্ড',
  partial_delivered: 'আংশিক ডেলিভার্ড',
  cancelled: 'বাতিল',
  returned: 'রিটার্নড',
  lost: 'হারিয়েছে',
  hold: 'হোল্ড',
};

export const STOCK_MOVEMENT_LABEL: Record<StockMovementType, string> = {
  opening: 'ওপেনিং স্টক',
  purchase: 'স্টক ক্রয়',
  sale: 'বিক্রয়',
  sale_reversal: 'বিক্রয় বাতিল',
  return_in: 'রিটার্ন (স্টকে ফেরত)',
  return_out: 'রিটার্ন (স্টক থেকে বাদ)',
  exchange_out: 'এক্সচেঞ্জ (বের)',
  exchange_in: 'এক্সচেঞ্জ (ঢুকেছে)',
  damage: 'নষ্ট',
  loss: 'হারিয়েছে',
  adjustment: 'ম্যানুয়াল সমন্বয়',
  transfer_in: 'ট্রান্সফার (ইন)',
  transfer_out: 'ট্রান্সফার (আউট)',
  order_edit: 'অর্ডার সম্পাদনা',
};

export const RETURN_TYPE_LABEL: Record<ReturnType, string> = {
  return: 'রিটার্ন',
  exchange: 'এক্সচেঞ্জ',
  refund_only: 'শুধু রিফান্ড',
};

export const RETURN_REASON_LABEL: Record<ReturnReason, string> = {
  damaged: 'ক্ষতিগ্রস্ত পণ্য',
  wrong_item: 'ভুল পণ্য',
  size_issue: 'সাইজ সমস্যা',
  quality_issue: 'মান সমস্যা',
  customer_rejected: 'কাস্টমার নিতে চায়নি',
  failed_delivery: 'ডেলিভারি ব্যর্থ',
  late_delivery: 'দেরিতে ডেলিভারি',
  other: 'অন্যান্য',
};

export const RETURN_CONDITION_LABEL: Record<ReturnCondition, string> = {
  resellable: 'পুনরায় বিক্রয়যোগ্য',
  damaged: 'ক্ষতিগ্রস্ত',
  defective: 'ত্রুটিপূর্ণ',
  missing_parts: 'অংশ অনুপস্থিত',
};

export const PAYMENT_KIND_LABEL: Record<string, string> = {
  order_payment: 'অর্ডার পেমেন্ট',
  order_refund: 'রিফান্ড',
  courier_payout: 'কুরিয়ার পেআউট',
  cod_collection: 'COD আদায়',
  expense_payment: 'খরচ পরিশোধ',
  adjustment_in: 'সমন্বয় (জমা)',
  adjustment_out: 'সমন্বয় (খরচ)',
};

/* ------------------------------------------------------------------ */
/* V2: Promotions                                                      */
/* ------------------------------------------------------------------ */

import type {
  FontScale,
  PromotionMechanism,
  PromotionStatus,
  PromotionType,
  RecurrenceFrequency,
  ReminderPriority,
  TextAlign,
} from './types';

export const PROMOTION_TYPE_LABEL: Record<PromotionType, string> = {
  percent: 'শতাংশ ছাড়',
  fixed: 'নির্দিষ্ট টাকা ছাড়',
  bogo: 'BOGO — ১ কিনলে ১ ফ্রি',
  buy_x_get_y: 'Buy X Get Y — কিনলে ফ্রি',
  free_gift: 'ফ্রি গিফট',
  free_delivery: 'ফ্রি ডেলিভারি',
  bundle: 'বান্ডেল অফার',
  coupon: 'কুপন কোড',
  min_purchase: 'ন্যূনতম ক্রয়ে ছাড়',
  first_order: 'প্রথম অর্ডারে ছাড়',
  repeat_customer: 'পুনরায় ক্রয়কারী ছাড়',
  seasonal: 'উৎসব/মৌসুমি ক্যাম্পেইন',
  limited_time: 'সীমিত সময়ের অফার',
  product_specific: 'নির্দিষ্ট পণ্যে ছাড়',
  category_specific: 'নির্দিষ্ট ক্যাটেগরিতে ছাড়',
  loyalty_points: 'লয়্যালটি পয়েন্ট',
  referral: 'রেফারেল পুরস্কার',
};

export const PROMOTION_TYPE_HINT: Record<PromotionType, string> = {
  percent: 'পুরো অর্ডার বা নির্বাচিত পণ্যে নির্দিষ্ট শতাংশ ছাড়।',
  fixed: 'পুরো অর্ডার বা নির্বাচিত পণ্যে নির্দিষ্ট টাকা ছাড়।',
  bogo: 'যোগ্য পণ্যের প্রতি ২টিতে ১টি ফ্রি (সস্তাটি ফ্রি হয়)।',
  buy_x_get_y: 'নির্দিষ্ট সংখ্যক কিনলে আরও কয়েকটি ফ্রি — আপনিই X ও Y ঠিক করুন।',
  free_gift: 'শর্ত পূরণ হলে একটি নির্দিষ্ট পণ্য উপহারে যোগ হয়।',
  free_delivery: 'ডেলিভারি চার্জ সম্পূর্ণ মওকুফ।',
  bundle: 'একাধিক পণ্য একসাথে নির্দিষ্ট দামে।',
  coupon: 'একটি কোড দিয়ে ছাড় — কোড মিললে ছাড় পাওয়া যায়।',
  min_purchase: 'ন্যূনতম টাকার ক্রয় করলে ছাড় পাওয়া যায়।',
  first_order: 'যে কাস্টমার প্রথমবার কিনছেন, শুধু তাঁর জন্য।',
  repeat_customer: 'যাঁরা আগে কিনেছেন, শুধু তাঁদের জন্য।',
  seasonal: 'ঈদ, পহেলা বৈশাখ বা যেকোনো উৎসবের ক্যাম্পেইন।',
  limited_time: 'নির্দিষ্ট সময়ের মধ্যেই ছাড় — সময় শেষে স্বয়ংক্রিয়ভাবে বন্ধ।',
  product_specific: 'আপনি যে পণ্যগুলো বেছে দেবেন, শুধু সেগুলোতেই ছাড়।',
  category_specific: 'আপনি যে ক্যাটেগরি বেছে দেবেন, তার সব পণ্যে ছাড়।',
  loyalty_points: 'প্রতি নির্দিষ্ট টাকায় পয়েন্ট জমা হয়; পয়েন্ট দিয়ে ছাড় নেওয়া যায়।',
  referral: 'কে কাকে রেফার করলেন, তার রেকর্ড ও পুরস্কার।',
};

/** Mechanism each type falls back to when the seller has not overridden it. */
export const DEFAULT_MECHANISM: Record<PromotionType, PromotionMechanism> = {
  percent: 'percent_off',
  fixed: 'amount_off',
  bogo: 'free_items',
  buy_x_get_y: 'free_items',
  free_gift: 'free_items',
  free_delivery: 'free_delivery',
  bundle: 'bundle_price',
  coupon: 'percent_off',
  min_purchase: 'amount_off',
  first_order: 'percent_off',
  repeat_customer: 'percent_off',
  seasonal: 'percent_off',
  limited_time: 'percent_off',
  product_specific: 'percent_off',
  category_specific: 'percent_off',
  loyalty_points: 'loyalty_points',
  referral: 'referral_reward',
};

export const MECHANISM_LABEL: Record<PromotionMechanism, string> = {
  percent_off: 'শতাংশ ছাড়',
  amount_off: 'নির্দিষ্ট টাকা ছাড়',
  free_items: 'ফ্রি আইটেম',
  bundle_price: 'বান্ডেল দাম',
  free_delivery: 'ডেলিভারি চার্জ মওকুফ',
  loyalty_points: 'লয়্যালটি পয়েন্ট',
  referral_reward: 'রেফারেল পুরস্কার',
};

export const PROMOTION_STATUS_LABEL: Record<PromotionStatus, string> = {
  draft: 'খসড়া',
  active: 'চালু',
  paused: 'বিরতিতে',
};

export const PROMOTION_STATUS_TONE: Record<PromotionStatus, string> = {
  draft: 'bg-ink-100 text-ink-600',
  active: 'bg-emerald-100 text-emerald-700',
  paused: 'bg-amber-100 text-amber-700',
};

/** Types whose discount is a percentage rather than a fixed amount of money. */
export const PERCENT_MECHANISMS: PromotionMechanism[] = ['percent_off'];
export const AMOUNT_MECHANISMS: PromotionMechanism[] = ['amount_off'];
export const FREE_ITEM_MECHANISMS: PromotionMechanism[] = ['free_items'];

/* ------------------------------------------------------------------ */
/* V2: Branding & documents                                            */
/* ------------------------------------------------------------------ */

export const ACCENT_PRESETS = [
  { value: 'indigo', label: 'নীল (ডিফল্ট)', swatch: '#4f46e5' },
  { value: 'emerald', label: 'সবুজ', swatch: '#059669' },
  { value: 'rose', label: 'গোলাপি', swatch: '#e11d48' },
  { value: 'amber', label: 'আম্বার', swatch: '#d97706' },
  { value: 'slate', label: 'ধূসর', swatch: '#475569' },
] as const;

export const FONT_SCALE_LABEL: Record<FontScale, string> = {
  small: 'ছোট',
  normal: 'সাধারণ',
  large: 'বড়',
};

export const FONT_SCALE_CLASS: Record<FontScale, string> = {
  small: 'text-[11px]',
  normal: 'text-[13px]',
  large: 'text-[15px]',
};

export const ALIGN_LABEL: Record<TextAlign, string> = {
  left: 'বামে',
  center: 'মাঝখানে',
  right: 'ডানে',
};

export const ALIGN_CLASS: Record<TextAlign, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

export const NOTE_KIND_LABEL: Record<string, string> = {
  courier_slip: 'কুরিয়ার বুকিং স্লিপ',
  parcel_label: 'পার্সেল লেবেল',
  invoice: 'ইনভয়েস',
  general: 'সাধারণ',
};

export const REMINDER_PRIORITY_LABEL: Record<ReminderPriority, string> = {
  low: 'কম',
  normal: 'সাধারণ',
  high: 'জরুরি',
};

export const RECURRENCE_LABEL: Record<RecurrenceFrequency, string> = {
  daily: 'প্রতিদিন',
  weekly: 'প্রতি সপ্তাহে',
  monthly: 'প্রতি মাসে',
  yearly: 'প্রতি বছরে',
};

/**
 * The software's own credit. Shown ONLY in Settings → About.
 * It must never be used as (or overwrite) the seller's business identity on an
 * invoice, report, courier slip, parcel label or any other business document.
 */
export const SOFTWARE_DEVELOPER = {
  name: 'Shohan Khan',
  email: 'helloiamshohan@gmail.com',
  role: 'সফটওয়্যার নির্মাতা / ডেভেলপার',
} as const;
