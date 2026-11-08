/**
 * date.ts — Timezone-safe date helpers.
 *
 * Strategy:
 *  - All timestamps are stored as epoch milliseconds (UTC instant) or ISO-8601 UTC strings.
 *  - All *display* and all *calendar day* calculations use Asia/Dhaka (UTC+06:00, no DST
 *    observed in Bangladesh since 2009). The offset is derived through Intl so the code
 *    stays correct even if the IANA database changes.
 */

export const DEFAULT_TIME_ZONE = 'Asia/Dhaka';

export function nowMs(): number {
  return Date.now();
}

export function nowIso(): string {
  return new Date(Date.now()).toISOString();
}

/** Offset in minutes that must be ADDED to UTC to get wall-clock time in `timeZone`. */
export function tzOffsetMinutes(date: Date, timeZone: string = DEFAULT_TIME_ZONE): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // Intl renders hour "24" for midnight in some environments.
  let hour = get('hour');
  if (hour === 24) hour = 0;
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return (asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000;
}

export interface DhakaParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
}

export function dhakaParts(value: Date | number | string, timeZone: string = DEFAULT_TIME_ZONE): DhakaParts {
  const date = toDate(value);
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  let hour = get('hour');
  if (hour === 24) hour = 0;
  return { year: get('year'), month: get('month'), day: get('day'), hour, minute: get('minute') };
}

export function toDate(value: Date | number | string): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return new Date(NaN);
  return new Date(parsed);
}

/** 'YYYY-MM-DD' in Dhaka calendar time. */
export function dhakaDateKey(value: Date | number | string, timeZone = DEFAULT_TIME_ZONE): string {
  const p = dhakaParts(value, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Epoch ms of midnight (start of day) in `timeZone` for the day containing `value`. */
export function startOfDay(value: Date | number | string, timeZone = DEFAULT_TIME_ZONE): number {
  const p = dhakaParts(value, timeZone);
  const utcMidnightGuess = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0, 0);
  const offset = tzOffsetMinutes(new Date(utcMidnightGuess), timeZone);
  return utcMidnightGuess - offset * 60000;
}

/** Epoch ms of the instant just before the next day starts (exclusive upper bound). */
export function endOfDay(value: Date | number | string, timeZone = DEFAULT_TIME_ZONE): number {
  const p = dhakaParts(value, timeZone);
  const nextUtc = Date.UTC(p.year, p.month - 1, p.day + 1, 0, 0, 0, 0);
  const offset = tzOffsetMinutes(new Date(nextUtc), timeZone);
  return nextUtc - offset * 60000;
}

export function addDays(value: Date | number | string, days: number, timeZone = DEFAULT_TIME_ZONE): number {
  return startOfDay(value, timeZone) + days * 86400000;
}

export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'lastYear'
  | 'all'
  | 'custom';

export interface DateRange {
  /** Inclusive lower bound (epoch ms) or null for "beginning of time". */
  from: number | null;
  /** Exclusive upper bound (epoch ms) or null for "no upper bound". */
  to: number | null;
}

export function rangeForPreset(preset: DateRangePreset, now: number = nowMs(), timeZone = DEFAULT_TIME_ZONE): DateRange {
  const todayStart = startOfDay(now, timeZone);
  switch (preset) {
    case 'today':
      return { from: todayStart, to: endOfDay(now, timeZone) };
    case 'yesterday': {
      const y = addDaysByStart(todayStart, -1, timeZone);
      return { from: y, to: y + 86400000 };
    }
    case 'last7':
      return { from: addDaysByStart(todayStart, -6, timeZone), to: endOfDay(now, timeZone) };
    case 'last30':
      return { from: addDaysByStart(todayStart, -29, timeZone), to: endOfDay(now, timeZone) };
    case 'thisMonth': {
      const p = dhakaParts(now, timeZone);
      return { from: monthStart(p.year, p.month, timeZone), to: monthStart(p.year, p.month + 1, timeZone) };
    }
    case 'lastMonth': {
      const p = dhakaParts(now, timeZone);
      return { from: monthStart(p.year, p.month - 1, timeZone), to: monthStart(p.year, p.month, timeZone) };
    }
    case 'thisYear': {
      const p = dhakaParts(now, timeZone);
      return { from: monthStart(p.year, 1, timeZone), to: monthStart(p.year + 1, 1, timeZone) };
    }
    case 'lastYear': {
      const p = dhakaParts(now, timeZone);
      return { from: monthStart(p.year - 1, 1, timeZone), to: monthStart(p.year, 1, timeZone) };
    }
    case 'all':
      return { from: null, to: null };
    case 'custom':
    default:
      return { from: todayStart, to: endOfDay(now, timeZone) };
  }
}

function addDaysByStart(startMs: number, days: number, timeZone: string): number {
  // Adding calendar days in Dhaka time: use UTC arithmetic then re-anchor to day start.
  const d = new Date(startMs + days * 86400000);
  return startOfDay(d, timeZone);
}

function monthStart(year: number, month1: number, timeZone: string): number {
  const y = year + Math.floor((month1 - 1) / 12);
  const m = ((month1 - 1) % 12 + 12) % 12;
  const utcGuess = Date.UTC(y, m, 1, 0, 0, 0, 0);
  const offset = tzOffsetMinutes(new Date(utcGuess), timeZone);
  return utcGuess - offset * 60000;
}

export function inRange(ts: number, range: DateRange): boolean {
  if (range.from !== null && ts < range.from) return false;
  if (range.to !== null && ts >= range.to) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const MONTHS_BN = [
  'জানুয়ারি',
  'ফেব্রুয়ারি',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টেম্বর',
  'অক্টোবর',
  'নভেম্বর',
  'ডিসেম্বর',
];

export interface FormatDateOptions {
  bengaliDigits?: boolean;
  withTime?: boolean;
  timeZone?: string;
}

/** Default display format: "৮ নভেম্বর ২০২৬" (Bengali month names, Bengali digits by default). */
export function formatDate(value: Date | number | string | null | undefined, options: FormatDateOptions = {}): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return '—';
  const { bengaliDigits = true, withTime = false, timeZone = DEFAULT_TIME_ZONE } = options;
  const p = dhakaParts(date, timeZone);
  let text = `${p.day} ${MONTHS_BN[p.month - 1]} ${p.year}`;
  if (withTime) {
    const hh = String(p.hour).padStart(2, '0');
    const mm = String(p.minute).padStart(2, '0');
    text += `, ${hh}:${mm}`;
  }
  return bengaliDigits ? toBengaliDigitsLocal(text) : text;
}

export function formatDateTime(value: Date | number | string | null | undefined, options: FormatDateOptions = {}): string {
  return formatDate(value, { ...options, withTime: true });
}

/** 'YYYY-MM-DD' Dhaka date, useful for `<input type="date">` and CSV export. */
export function toDateInputValue(value: Date | number | string | null | undefined, timeZone = DEFAULT_TIME_ZONE): string {
  if (value === null || value === undefined || value === '') return '';
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return '';
  return dhakaDateKey(date, timeZone);
}

/** Parse a 'YYYY-MM-DD' input (Dhaka calendar day) into the epoch ms of its Dhaka midnight. */
export function fromDateInputValue(value: string, timeZone = DEFAULT_TIME_ZONE): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return monthStartDay(y, m, d, timeZone);
}

function monthStartDay(year: number, month1: number, day: number, timeZone: string): number {
  const utcGuess = Date.UTC(year, month1 - 1, day, 0, 0, 0, 0);
  const offset = tzOffsetMinutes(new Date(utcGuess), timeZone);
  return utcGuess - offset * 60000;
}

/** Convert a date input (Dhaka day) plus optional time to epoch ms. */
export function fromDateTimeInput(dateValue: string, timeValue?: string, timeZone = DEFAULT_TIME_ZONE): number | null {
  const dayStart = fromDateInputValue(dateValue, timeZone);
  if (dayStart === null) return null;
  if (!timeValue) return dayStart;
  const [h, m] = timeValue.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return dayStart;
  return dayStart + h * 3600000 + m * 60000;
}

function toBengaliDigitsLocal(text: string): string {
  return text.replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);
}

export function monthLabel(ts: number, timeZone = DEFAULT_TIME_ZONE): string {
  const p = dhakaParts(ts, timeZone);
  return `${MONTHS_BN[p.month - 1]} ${p.year}`;
}

export function shortMonthLabel(ts: number, timeZone = DEFAULT_TIME_ZONE): string {
  const p = dhakaParts(ts, timeZone);
  return MONTHS_BN[p.month - 1].slice(0, 3);
}

export function relativeTime(value: Date | number | string, now: number = nowMs()): string {
  const ts = toDate(value).getTime();
  if (Number.isNaN(ts)) return '—';
  const diff = now - ts;
  const abs = Math.abs(diff);
  const minute = 60000;
  const hour = 3600000;
  const day = 86400000;
  const suffix = diff >= 0 ? 'আগে' : 'পরে';
  if (abs < minute) return 'এইমাত্র';
  if (abs < hour) return `${Math.floor(abs / minute)} মিনিট ${suffix}`;
  if (abs < day) return `${Math.floor(abs / hour)} ঘণ্টা ${suffix}`;
  if (abs < day * 30) return `${Math.floor(abs / day)} দিন ${suffix}`;
  return formatDate(ts);
}
