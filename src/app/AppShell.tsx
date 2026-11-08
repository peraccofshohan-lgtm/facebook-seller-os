import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useOnline } from '@/hooks/useOnline';
import { NAV_ITEMS, QUICK_ACTIONS } from './nav';
import { useAppContext } from './AppContext';
import { isBackupDue, markBackupTaken } from '@/services/backupService';
import { LockScreen } from '@/features/settings/LockScreen';
import { formatDate } from '@/lib/date';

export function AppShell() {
  const online = useOnline();
  const location = useLocation();
  const navigate = useNavigate();
  const { settings, refreshSettings, locked } = useAppContext();
  const [moreOpen, setMoreOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [updateBanner, setUpdateBanner] = useState<{ apply: () => void } | null>(null);
  const [backupNotice, setBackupNotice] = useState(false);

  const businessName = settings?.business?.name?.trim() || 'আমার ব্যবসা';

  const primaryNav = useMemo(() => NAV_ITEMS.filter((item) => item.primary), []);
  const secondaryNav = useMemo(() => NAV_ITEMS.filter((item) => !item.primary), []);

  useEffect(() => {
    setMoreOpen(false);
    setQuickOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!settings) return;
    if (isBackupDue(settings.backup.lastBackupAt, settings.backup.reminderDays)) setBackupNotice(true);
  }, [settings]);

  const onUpdate = (apply: () => void) => setUpdateBanner({ apply });

  useEffect(() => {
    // registerServiceWorker is imported lazily so unit tests never touch the SW API.
    void import('@/pwa/register').then(({ registerServiceWorker }) => {
      registerServiceWorker({
        onNeedRefresh: (apply) => onUpdate(apply),
        onOfflineReady: () => undefined,
      });
    });
  }, []);

  // PIN lock: gate the whole shell (the database itself is not encrypted by the PIN).
  if (locked && settings?.security?.pinEnabled && settings.security.pinRecord) {
    return <LockScreen />;
  }

  return (
    <div className="min-h-full bg-ink-50">
      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-ink-200 bg-white lg:flex">
        <div className="flex items-center gap-2.5 border-b border-ink-100 px-4 py-4">
          <Logo />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink-900">Facebook Seller OS</p>
            <p className="truncate text-[11px] text-ink-500">{businessName}</p>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="প্রধান নেভিগেশন">
          {NAV_ITEMS.map((item) => (
            <NavItemLink key={item.to} to={item.to} icon={item.icon} label={item.label} />
          ))}
        </nav>
        <div className="border-t border-ink-100 p-3">
          <Button block icon="plus" onClick={() => setQuickOpen(true)}>
            দ্রুত কাজ
          </Button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="no-print sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-ink-200 bg-white/95 px-3 py-2.5 backdrop-blur lg:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <Logo compact />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink-900">{businessName}</p>
            <ConnectionPill online={online} />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="দ্রুত কাজ" onClick={() => setQuickOpen(true)}>
            <Icon name="plus" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="আরও মেনু" onClick={() => setMoreOpen(true)}>
            <Icon name="menu" />
          </Button>
        </div>
      </header>

      {/* Desktop top strip */}
      <div className="no-print sticky top-0 z-10 hidden items-center justify-between gap-3 border-b border-ink-200 bg-white/95 px-6 py-2.5 backdrop-blur lg:flex lg:pl-64">
        <p className="text-sm text-ink-500">
          {settings?.business?.name ? settings.business.name : 'ব্যবসার নাম সেট করা হয়নি'}
        </p>
        <div className="flex items-center gap-3">
          {settings?.backup?.lastBackupAt ? (
            <span className="hidden text-xs text-ink-400 sm:inline">
              সর্বশেষ ব্যাকআপ: {formatDate(settings.backup.lastBackupAt)}
            </span>
          ) : null}
          <ConnectionPill online={online} />
        </div>
      </div>

      {updateBanner && (
        <div className="no-print sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 border-b border-brand-200 bg-brand-50 px-4 py-2.5 text-sm text-brand-900 lg:pl-64">
          <span>অ্যাপের নতুন সংস্করণ পাওয়া গেছে। এখনই লোড করলে নতুন ফিচার পাবেন — আপনার তথ্য অক্ষত থাকবে।</span>
          <Button size="sm" onClick={() => updateBanner.apply()}>
            রিলোড করুন
          </Button>
        </div>
      )}

      {backupNotice && settings && (
        <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 lg:pl-64">
          <span>বেশ কয়েকদিন ব্যাকআপ নেওয়া হয়নি। ফোন হারালে বা ব্রাউজারের তথ্য মুছে গেলে তথ্য ফেরত পাওয়া যাবে না।</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setBackupNotice(false)}>
              পরে
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setBackupNotice(false);
                void markBackupTaken().then(refreshSettings);
                navigate('/backup');
              }}
            >
              ব্যাকআপ নিন
            </Button>
          </div>
        </div>
      )}

      <main className="px-3 pb-24 pt-4 sm:px-5 lg:pb-10 lg:pl-64">
        <div className="mx-auto w-full max-w-6xl">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom navigation */}
      <nav
        className="no-print fixed inset-x-0 bottom-0 z-30 flex border-t border-ink-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label="নিচের নেভিগেশন"
      >
        {primaryNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                isActive ? 'text-brand-700' : 'text-ink-500'
              }`
            }
          >
            <Icon name={item.icon} size={20} />
            {item.label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-ink-500"
        >
          <Icon name="menu" size={20} />
          আরও
        </button>
      </nav>

      <Modal open={moreOpen} title="সব মেনু" onClose={() => setMoreOpen(false)} size="sm">
        <div className="grid grid-cols-3 gap-2">
          {[...primaryNav, ...secondaryNav].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMoreOpen(false)}
              className="flex flex-col items-center gap-1.5 rounded-lg border border-ink-200 p-3 text-xs font-medium text-ink-700 hover:border-brand-300 hover:bg-brand-50"
            >
              <Icon name={item.icon} size={22} />
              <span className="text-center leading-tight">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </Modal>

      <Modal open={quickOpen} title="দ্রুত কাজ" onClose={() => setQuickOpen(false)} size="sm">
        <div className="grid grid-cols-2 gap-2">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.to}
              type="button"
              onClick={() => {
                setQuickOpen(false);
                navigate(action.to);
              }}
              className="flex items-center gap-2.5 rounded-lg border border-ink-200 p-3 text-left text-sm text-ink-700 hover:border-brand-300 hover:bg-brand-50"
            >
              <Icon name={action.icon} size={20} className="text-brand-700" />
              {action.label}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function NavItemLink({ to, icon, label }: { to: string; icon: IconName; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
          isActive ? 'bg-brand-50 text-brand-800' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900'
        }`
      }
    >
      <Icon name={icon} size={19} />
      {label}
    </NavLink>
  );
}

function ConnectionPill({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium ${online ? 'text-brand-700' : 'text-amber-700'}`}
      title={online ? 'ইন্টারনেট চালু আছে' : 'ইন্টারনেট নেই — অ্যাপটি তবুও কাজ করবে'}
    >
      <Icon name={online ? 'online' : 'offline'} size={13} />
      {online ? 'অনলাইন' : 'অফলাইন'}
    </span>
  );
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-lg bg-brand-700 font-bold text-white ${compact ? 'h-8 w-8 text-sm' : 'h-9 w-9 text-base'}`}
      aria-hidden="true"
    >
      ফ
    </span>
  );
}
