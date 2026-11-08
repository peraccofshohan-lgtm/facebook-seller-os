import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './Button';
import { Icon } from './Icon';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  back?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}

export function PageHeader({ title, subtitle, back = false, actions, children }: PageHeaderProps) {
  const navigate = useNavigate();
  return (
    <header className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {back && (
            <Button variant="ghost" size="icon" aria-label="পেছনে যান" onClick={() => navigate(-1)} className="-ml-2 mt-0.5">
              <Icon name="chevronLeft" />
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-tight text-ink-900 sm:text-2xl">{title}</h1>
            {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </header>
  );
}
