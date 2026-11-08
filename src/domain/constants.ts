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
