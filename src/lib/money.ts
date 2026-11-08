/**
 * money.ts — Decimal-safe money arithmetic for Bangladeshi Taka (BDT).
 *
 * RULE: every monetary amount in the application is stored and calculated as an
 * integer number of *minor units* (paisa). 1 BDT = 100 paisa.
 * Ordinary JavaScript floating point arithmetic is NEVER used for money.
 *
 * Safe integer range: Number.MAX_SAFE_INTEGER / 100 = 90,071,992,547,409.90 BDT,
 * which is far above any realistic small-business value.
 */

import { prefersBengaliDigits } from './format-prefs';

export type Minor = number;

const MINOR_UNITS = 100;
const MAX_MINOR = Number.MAX_SAFE_INTEGER;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Assert a value is a safe integer minor amount. */
export function assertMinor(value: unknown, field = 'amount'): Minor {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MoneyError(`${field}: সঠিক সংখ্যা নয় (${String(value)})`);
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${field}: অর্থের মান পূর্ণসংখ্যা পয়সায় থাকতে হবে (${value})`);
  }
  if (Math.abs(value) > MAX_MINOR) {
    throw new MoneyError(`${field}: অঙ্কটি খুব বড়`);
  }
  return value;
}

/**
 * Parse user input (Bengali or Latin digits, with or without ৳ / , / spaces) into minor units.
 * Uses string-based parsing so that 0.1 + 0.2 style float errors can never appear.
 */
export function parseMoney(input: string | number | null | undefined): Minor {
  if (input === null || input === undefined || input === '') return 0;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new MoneyError('সঠিক অঙ্ক দিন');
    return toMinor(input);
  }
  let s = String(input).trim();
  if (!s) return 0;
  s = toLatinDigits(s);
  s = s.replace(/[^\d.-]/g, '');
  if (s === '' || s === '-' || s === '.') return 0;
  const negative = s.startsWith('-');
  s = s.replace(/-/g, '');
  const parts = s.split('.');
  if (parts.length > 2) throw new MoneyError('সঠিক অঙ্ক দিন');
  const whole = parts[0] === '' ? '0' : parts[0];
  let frac = parts[1] ?? '';
  if (frac.length > 2) {
    // Round half-up on the 3rd decimal digit.
    const third = frac.charCodeAt(2) - 48;
    frac = frac.slice(0, 2);
    let minor = Number(whole) * MINOR_UNITS + Number(frac.padEnd(2, '0'));
    if (third >= 5) minor += 1;
    return negative ? -minor : minor;
  }
  const minor = Number(whole) * MINOR_UNITS + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor)) throw new MoneyError('অঙ্কটি খুব বড়');
  return negative ? -minor : minor;
}

/** Convert a plain number (e.g. 12.34) to minor units without float drift. */
export function toMinor(value: number): Minor {
  if (!Number.isFinite(value)) throw new MoneyError('সঠিক অঙ্ক দিন');
  // Number.toString() may produce exponential notation for tiny/huge values; avoid it.
  const rounded = Math.round(value * MINOR_UNITS);
  if (!Number.isSafeInteger(rounded)) throw new MoneyError('অঙ্কটি খুব বড়');
  return rounded;
}

/** Convert minor units back to a decimal number (for display/export only). */
export function fromMinor(minor: Minor): number {
  return minor / MINOR_UNITS;
}

/** Add any number of minor amounts. */
export function addMoney(...values: Minor[]): Minor {
  let total = 0;
  for (const v of values) {
    assertMinor(v);
    total += v;
  }
  return total;
}

/** Subtract: a - b - c ... */
export function subMoney(a: Minor, ...values: Minor[]): Minor {
  assertMinor(a);
  let total = a;
  for (const v of values) {
    assertMinor(v);
    total -= v;
  }
  return total;
}

/** Multiply a unit price by a quantity. Quantity may be fractional (e.g. 1.5 kg). */
export function mulQty(unitPrice: Minor, quantity: number): Minor {
  assertMinor(unitPrice);
  if (!Number.isFinite(quantity)) throw new MoneyError('সঠিক পরিমাণ দিন');
  // Keep exactness: price is integer paisa, quantity scaled to 3 decimals.
  const qScaled = Math.round(quantity * 1000);
  const result = (unitPrice * qScaled) / 1000;
  return Math.round(result);
}

/** Apply a percentage rate (e.g. 2.5 for 2.5%) to an amount, rounded half-up. */
export function percentOf(amount: Minor, ratePercent: number): Minor {
  assertMinor(amount);
  if (!Number.isFinite(ratePercent)) throw new MoneyError('সঠিক শতাংশ দিন');
  const scaled = Math.round(ratePercent * 100);
  return Math.round((amount * scaled) / 10000);
}

/**
 * Split an amount into `n` equal-ish parts. The remainder paisa is distributed
 * to the first parts so the parts always sum exactly to the original amount.
 */
export function allocate(amount: Minor, n: number): Minor[] {
  assertMinor(amount);
  if (!Number.isInteger(n) || n <= 0) return [];
  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);
  const base = Math.floor(abs / n);
  let remainder = abs - base * n;
  const out: Minor[] = [];
  for (let i = 0; i < n; i += 1) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    out.push(sign * (base + extra));
  }
  return out;
}

/** Proportionally split `amount` across `weights` (integer-safe, exact total). */
export function allocateByWeights(amount: Minor, weights: Minor[] | number[]): Minor[] {
  assertMinor(amount);
  const totalWeight = weights.reduce((s, w) => s + (typeof w === 'number' ? w : 0), 0);
  if (totalWeight <= 0) return allocate(amount, weights.length);
  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);
  const raw = weights.map((w) => (abs * Math.abs(w)) / totalWeight);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = abs - floored.reduce((s, v) => s + v, 0);
  // Distribute leftover paisa to the largest fractional remainders.
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; remainder > 0 && order.length > 0; k += 1) {
    floored[order[k % order.length].i] += 1;
    remainder -= 1;
  }
  return floored.map((v) => sign * v);
}

export function sumMoney(values: Minor[]): Minor {
  return values.reduce((s, v) => s + v, 0);
}

export function maxMoney(a: Minor, b: Minor): Minor {
  return a >= b ? a : b;
}

export function minMoney(a: Minor, b: Minor): Minor {
  return a <= b ? a : b;
}

/** Is the amount zero? */
export function isZero(amount: Minor): boolean {
  return amount === 0;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const BENGALI_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toLatinDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code >= 0x09e6 && code <= 0x09ef) out += String(code - 0x09e6);
    else if (code >= 0x06f0 && code <= 0x06f9) out += String(code - 0x06f0);
    else out += ch;
  }
  return out;
}

export function toBengaliDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => BENGALI_DIGITS[Number(d)]);
}

export interface FormatMoneyOptions {
  /** Use Bengali digits (default follows app settings; here default = false). */
  bengaliDigits?: boolean;
  /** Show the ৳ symbol (default true). */
  symbol?: boolean;
  /** Force decimals even when the amount is whole (default false). */
  alwaysDecimals?: boolean;
  /** Compact thousands/lakh/crore grouping for dashboards. */
  compact?: boolean;
}

/** Format minor units as a Taka string. Never loses precision (input is already paisa). */
export function formatMoney(minor: Minor, options: FormatMoneyOptions = {}): string {
  const { bengaliDigits = prefersBengaliDigits(), symbol = true, alwaysDecimals = false, compact = false } = options;
  const negative = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const paisa = abs % 100;
  const taka = Math.floor(abs / 100);

  if (compact) {
    const compactText = compactTaka(taka, paisa, alwaysDecimals);
    return `${negative ? '-' : ''}${symbol ? '৳' : ''}${bengaliDigits ? toBengaliDigits(compactText) : compactText}`;
  }

  const takaText = groupThousands(taka);
  const decimals = alwaysDecimals || paisa !== 0 ? `.${String(paisa).padStart(2, '0')}` : '';
  let text = `${takaText}${decimals}`;
  if (bengaliDigits) text = toBengaliDigits(text);
  return `${negative ? '-' : ''}${symbol ? '৳' : ''}${text}`;
}

function groupThousands(value: number): string {
  // Western grouping is the common convention for BDT in business software.
  const s = String(value);
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function compactTaka(taka: number, paisa: number, alwaysDecimals: boolean): string {
  const crore = 10000000;
  const lakh = 100000;
  if (taka >= crore) {
    const v = (taka + paisa / 100) / crore;
    return `${v.toFixed(v >= 100 ? 0 : 2)} কোটি`;
  }
  if (taka >= lakh) {
    const v = (taka + paisa / 100) / lakh;
    return `${v.toFixed(v >= 100 ? 0 : 2)} লাখ`;
  }
  if (taka >= 1000) {
    const v = (taka + paisa / 100) / 1000;
    return `${v.toFixed(v >= 100 ? 0 : 1)} হাজার`;
  }
  return `${taka}${alwaysDecimals || paisa ? `.${String(paisa).padStart(2, '0')}` : ''}`;
}

/** Plain decimal string for CSV/JSON export (e.g. "1234.50"). */
export function moneyToDecimalString(minor: Minor): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const paisa = abs % 100;
  const taka = Math.floor(abs / 100);
  return `${negative ? '-' : ''}${taka}.${String(paisa).padStart(2, '0')}`;
}
