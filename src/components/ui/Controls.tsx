import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Input, Select } from './Field';
import { fromDateInputValue, rangeForPreset, toDateInputValue, type DateRange, type DateRangePreset } from '@/lib/date';
import { formatMoney, parseMoney, toLatinDigits } from '@/lib/money';

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export function SearchInput({
  value,
  onChange,
  placeholder = 'খুঁজুন…',
  className = '',
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={`relative ${className}`}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">
        <Icon name="search" size={18} />
      </span>
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="pl-10"
        aria-label={placeholder}
        autoFocus={autoFocus}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Segmented control                                                   */
/* ------------------------------------------------------------------ */

export interface SegmentedOption {
  value: string;
  label: string;
}

export function SegmentedControl({
  options,
  value,
  onChange,
  size = 'md',
  className = '',
  ariaLabel,
}: {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={`inline-flex rounded-lg bg-ink-100 p-1 ${className}`}>
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          type="button"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-md font-medium transition-colors ${
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
          } ${value === option.value ? 'bg-white text-brand-800 shadow-sm' : 'text-ink-500 hover:text-ink-700'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Date range picker                                                   */
/* ------------------------------------------------------------------ */

const PRESET_LABELS: { value: DateRangePreset; label: string }[] = [
  { value: 'today', label: 'আজ' },
  { value: 'yesterday', label: 'গতকাল' },
  { value: 'last7', label: 'গত ৭ দিন' },
  { value: 'last30', label: 'গত ৩০ দিন' },
  { value: 'thisMonth', label: 'চলতি মাস' },
  { value: 'lastMonth', label: 'গত মাস' },
  { value: 'thisYear', label: 'চলতি বছর' },
  { value: 'all', label: 'সব সময়' },
  { value: 'custom', label: 'নির্দিষ্ট সময়' },
];

export interface DateRangePickerProps {
  preset: DateRangePreset;
  range: DateRange;
  onChange: (preset: DateRangePreset, range: DateRange) => void;
  className?: string;
}

export function DateRangePicker({ preset, range, onChange, className = '' }: DateRangePickerProps) {
  const from = range.from ? toDateInputValue(range.from) : '';
  const to = range.to ? toDateInputValue(range.to - 1) : '';

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {PRESET_LABELS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value, rangeForPreset(option.value))}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              preset === option.value
                ? 'border-brand-600 bg-brand-700 text-white'
                : 'border-ink-200 bg-white text-ink-600 hover:border-brand-300 hover:bg-brand-50'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="শুরুর তারিখ"
            value={from}
            onChange={(event) => {
              const next = fromDateInputValue(event.target.value);
              onChange('custom', { from: next, to: range.to });
            }}
            className="h-10 w-auto"
          />
          <span className="text-ink-400">–</span>
          <Input
            type="date"
            aria-label="শেষ তারিখ"
            value={to}
            onChange={(event) => {
              const next = fromDateInputValue(event.target.value);
              onChange('custom', { from: range.from, to: next === null ? null : next + 86400000 });
            }}
            className="h-10 w-auto"
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Money input                                                         */
/* ------------------------------------------------------------------ */

export interface MoneyInputProps {
  /** Minor units (paisa). */
  value: number;
  onChange: (minor: number) => void;
  id?: string;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  bengaliDigits?: boolean;
  onBlur?: () => void;
  className?: string;
  'aria-describedby'?: string;
}

/**
 * Money input that accepts Bengali or Latin digits.
 * The raw text is kept while typing so partial input like "১২." is not destroyed.
 */
export function MoneyInput({
  value,
  onChange,
  id,
  placeholder = '0',
  invalid,
  disabled,
  bengaliDigits = false,
  onBlur,
  className = '',
  ...rest
}: MoneyInputProps) {
  const [text, setText] = useState(() => (value ? toDisplay(value, bengaliDigits) : ''));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value ? toDisplay(value, bengaliDigits) : '');
  }, [value, bengaliDigits]);

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">৳</span>
      <Input
        id={id}
        inputMode="decimal"
        dir="ltr"
        value={text}
        placeholder={placeholder}
        invalid={invalid}
        disabled={disabled}
        className={`pl-7 text-left tabular ${className}`}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          const cleaned = toLatinDigits(raw).replace(/[^\d.]/g, '');
          if (cleaned === '' || cleaned === '.') {
            onChange(0);
            return;
          }
          try {
            onChange(parseMoney(cleaned));
          } catch {
            /* keep the typed text; validation surfaces on submit */
          }
        }}
        onBlur={() => {
          focused.current = false;
          setText(value ? toDisplay(value, bengaliDigits) : '');
          onBlur?.();
        }}
        {...rest}
      />
    </div>
  );
}

function toDisplay(minor: number, bengali: boolean): string {
  const decimal = (minor / 100).toFixed(2).replace(/\.00$/, '');
  if (!bengali) return decimal;
  return decimal.replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);
}

/* ------------------------------------------------------------------ */
/* Filter bar                                                          */
/* ------------------------------------------------------------------ */

export function FilterBar({ children, onReset }: { children: ReactNode; onReset?: () => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-ink-200 bg-white p-3">
      {children}
      {onReset && (
        <button type="button" onClick={onReset} className="ml-auto text-xs font-medium text-brand-700 hover:underline">
          ফিল্টার সরিয়ে দিন
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="no-scrollbar -mb-px flex gap-1 overflow-x-auto" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          type="button"
          aria-selected={active === tab.key}
          onClick={() => onChange(tab.key)}
          className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            active === tab.key ? 'border-brand-600 text-brand-800' : 'border-transparent text-ink-500 hover:text-ink-700'
          }`}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] ${active === tab.key ? 'bg-brand-100 text-brand-800' : 'bg-ink-100 text-ink-500'}`}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Small helper that renders a formatted money value with consistent styling. */
export function Money({ value, className = '', compact = false }: { value: number; className?: string; compact?: boolean }) {
  return <span className={`tabular ${className}`}>{formatMoney(value, { compact })}</span>;
}

/** Debounce hook used by search inputs. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Persist a filter object in the URL query string so back-navigation restores it. */
export function useQueryState<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return defaults;
    const params = new URLSearchParams(window.location.search);
    const next = { ...defaults };
    (Object.keys(defaults) as (keyof T)[]).forEach((key) => {
      const value = params.get(String(key));
      if (value !== null) next[key] = value as T[keyof T];
    });
    return next;
  });

  const patch = (update: Partial<T>) => {
    setState((prev) => {
      const merged = { ...prev, ...update };
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        Object.entries(merged).forEach(([key, value]) => {
          if (value) params.set(key, String(value));
          else params.delete(key);
        });
        window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
      }
      return merged;
    });
  };

  return [state, patch];
}

export function useSelectOptions<T>(items: T[], get: { value: (item: T) => string; label: (item: T) => string }) {
  return useMemo(() => items.map((item) => ({ value: get.value(item), label: get.label(item) })), [items, get]);
}

export { Select };
