import type { ReactNode } from 'react';

export interface BadgeProps {
  children: ReactNode;
  className?: string;
  tone?: string;
}

/** Status pill. `tone` is a Tailwind class set (see src/domain/constants.ts). */
export function Badge({ children, className = '', tone = 'bg-ink-100 text-ink-700 ring-ink-200' }: BadgeProps) {
  return (
    <span
      className={`inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone} ${className}`}
    >
      {children}
    </span>
  );
}
