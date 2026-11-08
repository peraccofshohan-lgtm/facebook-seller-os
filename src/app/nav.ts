import type { IconName } from '@/components/ui/Icon';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Shown in the mobile bottom bar. */
  primary?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'ড্যাশবোর্ড', icon: 'dashboard', primary: true },
  { to: '/orders', label: 'অর্ডার', icon: 'orders', primary: true },
  { to: '/customers', label: 'কাস্টমার', icon: 'customers' },
  { to: '/products', label: 'পণ্য', icon: 'products', primary: true },
  { to: '/inventory', label: 'স্টক', icon: 'inventory' },
  { to: '/courier', label: 'কুরিয়ার', icon: 'courier' },
  { to: '/payments', label: 'পেমেন্ট', icon: 'payments' },
  { to: '/returns', label: 'রিটার্ন', icon: 'returns' },
  { to: '/expenses', label: 'খরচ', icon: 'expenses' },
  { to: '/reports', label: 'রিপোর্ট', icon: 'reports', primary: true },
  { to: '/backup', label: 'ব্যাকআপ', icon: 'backup' },
  { to: '/settings', label: 'সেটিংস', icon: 'settings' },
  { to: '/help', label: 'ব্যবহারবিধি', icon: 'help' },
];

export interface QuickAction {
  to: string;
  label: string;
  icon: IconName;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { to: '/orders/new', label: 'নতুন অর্ডার', icon: 'orders' },
  { to: '/customers/new', label: 'নতুন কাস্টমার', icon: 'customers' },
  { to: '/products/new', label: 'নতুন পণ্য', icon: 'products' },
  { to: '/inventory?action=adjust', label: 'স্টক সমন্বয়', icon: 'inventory' },
  { to: '/payments?action=new', label: 'পেমেন্ট নিন', icon: 'payments' },
  { to: '/expenses?action=new', label: 'খরচ লিখুন', icon: 'expenses' },
  { to: '/courier?action=new', label: 'কুরিয়ার রেকর্ড', icon: 'courier' },
  { to: '/returns?action=new', label: 'রিটার্ন নথিভুক্ত', icon: 'returns' },
];
