import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  addMoney,
  allocate,
  allocateByWeights,
  formatMoney,
  fromMinor,
  mulQty,
  parseMoney,
  percentOf,
  subMoney,
  sumMoney,
  toBengaliDigits,
  toLatinDigits,
  toMinor,
} from '@/lib/money';

describe('parseMoney', () => {
  it('parses plain taka amounts into paisa', () => {
    expect(parseMoney('1200')).toBe(120000);
    expect(parseMoney('12.5')).toBe(1250);
    expect(parseMoney('0.05')).toBe(5);
    expect(parseMoney('99.99')).toBe(9999);
  });

  it('parses Bengali digits and taka symbols', () => {
    expect(parseMoney('১২০০')).toBe(120000);
    expect(parseMoney('৳ ৩৫.৫০')).toBe(3550);
    expect(parseMoney('1,25,000.75')).toBe(12500075);
  });

  it('rounds the third decimal half-up without float drift', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in paisa it must be exactly 30.
    expect(parseMoney(0.1) + parseMoney(0.2)).toBe(30);
    expect(parseMoney('0.005')).toBe(1);
    expect(parseMoney('0.004')).toBe(0);
    expect(parseMoney('10.999')).toBe(1100);
  });

  it('treats empty input as zero and rejects garbage', () => {
    expect(parseMoney('')).toBe(0);
    expect(parseMoney(null)).toBe(0);
    expect(parseMoney(undefined)).toBe(0);
    expect(() => parseMoney('abc.12.34')).toThrow(MoneyError);
    expect(() => parseMoney(Number.NaN)).toThrow(MoneyError);
  });
});

describe('integer money arithmetic', () => {
  it('adds and subtracts exactly', () => {
    expect(addMoney(1, 2, 3)).toBe(6);
    expect(subMoney(100, 33, 33)).toBe(34);
    expect(sumMoney([1, 2, 3, 4])).toBe(10);
  });

  it('multiplies by quantity without float error', () => {
    expect(mulQty(parseMoney('0.07'), 3)).toBe(21);
    expect(mulQty(parseMoney('19.99'), 7)).toBe(13993);
  });

  it('computes percentages deterministically', () => {
    expect(percentOf(100000, 10)).toBe(10000);
    expect(percentOf(99999, 2.5)).toBe(2500);
  });

  it('allocates every paisa without losing or inventing money', () => {
    expect(allocate(100, 3).reduce((a, b) => a + b, 0)).toBe(100);
    expect(allocate(100, 3)).toEqual([34, 33, 33]);

    const weighted = allocateByWeights(1000, [1, 1, 1, 1, 1, 1]);
    expect(weighted.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('round-trips minor units', () => {
    expect(toMinor(12.34)).toBe(1234);
    expect(fromMinor(1234)).toBe(12.34);
  });
});

describe('digit conversion', () => {
  it('converts between Bengali and Latin digits', () => {
    expect(toBengaliDigits('1200')).toBe('১২০০');
    expect(toLatinDigits('১২৩৪.৫')).toBe('1234.5');
    expect(toBengaliDigits(1200)).toBe('১২০০');
  });
});

describe('formatMoney', () => {
  it('formats paisa as taka with the ৳ symbol', () => {
    expect(formatMoney(120000)).toBe('৳1,200');
    expect(formatMoney(120000, { alwaysDecimals: true })).toBe('৳1,200.00');
    expect(formatMoney(120000, { alwaysDecimals: true, bengaliDigits: true })).toBe('৳১,২০০.০০');
  });

  it('formats zero and negative amounts', () => {
    expect(formatMoney(0)).toBe('৳0');
    expect(formatMoney(0, { alwaysDecimals: true })).toBe('৳0.00');
    expect(formatMoney(-5000)).toBe('-৳50');
  });

  it('formats compact amounts for dashboards', () => {
    expect(formatMoney(15000000, { compact: true })).toBe('৳1.50 লাখ');
    expect(formatMoney(12345000, { compact: true })).toBe('৳1.23 লাখ');
    expect(formatMoney(500000, { compact: true })).toBe('৳5.0 হাজার');
    expect(formatMoney(2500000000, { compact: true })).toBe('৳2.50 কোটি');
  });
});
