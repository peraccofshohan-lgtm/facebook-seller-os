import type { HTMLAttributes, ReactNode } from 'react';

export function Card({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <section
      className={`rounded-xl border border-ink-200 bg-white shadow-card ${className}`}
      {...rest}
    >
      {children}
    </section>
  );
}

export interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

export function CardHeader({ title, subtitle, action, icon }: CardHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-ink-100 px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-brand-700">{icon}</span>}
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-ink-800">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function CardBody({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`px-4 py-4 sm:px-5 ${className}`}>{children}</div>;
}

export function CardFooter({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`border-t border-ink-100 px-4 py-3 sm:px-5 ${className}`}>{children}</div>;
}

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'default' | 'positive' | 'negative' | 'warning' | 'info';
  icon?: ReactNode;
  onClick?: () => void;
}

const TONES: Record<string, string> = {
  default: 'text-ink-900',
  positive: 'text-brand-700',
  negative: 'text-rose-600',
  warning: 'text-amber-600',
  info: 'text-sky-700',
};

export function StatCard({ label, value, hint, tone = 'default', icon, onClick }: StatCardProps) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink-500">{label}</p>
        {icon && <span className="text-ink-400">{icon}</span>}
      </div>
      <p className={`tabular mt-1.5 text-xl font-semibold leading-tight sm:text-2xl ${TONES[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-ink-400">{hint}</p>}
    </>
  );
  const className = 'rounded-xl border border-ink-200 bg-white p-3.5 shadow-card';
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${className} w-full text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40`}>
        {content}
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}
