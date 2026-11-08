import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIME_ZONE,
  addDays,
  dhakaDateKey,
  endOfDay,
  fromDateInputValue,
  rangeForPreset,
  startOfDay,
  toDateInputValue,
  inRange,
  tzOffsetMinutes,
} from '@/lib/date';

describe('Dhaka timezone handling', () => {
  it('reports +6:00 for Asia/Dhaka and +5:30 for Kolkata', () => {
    expect(tzOffsetMinutes(new Date('2026-01-15T00:00:00Z'), 'Asia/Dhaka')).toBe(360);
    expect(tzOffsetMinutes(new Date('2026-07-15T00:00:00Z'), 'Asia/Dhaka')).toBe(360);
    expect(tzOffsetMinutes(new Date('2026-01-15T00:00:00Z'), 'Asia/Kolkata')).toBe(330);
  });

  it('starts and ends the local day at the Dhaka clock, not UTC', () => {
    // 2026-01-15 00:00 Dhaka == 2026-01-14 18:00 UTC
    const from = startOfDay('2026-01-15T10:00:00Z', DEFAULT_TIME_ZONE);
    expect(new Date(from).toISOString()).toBe('2026-01-14T18:00:00.000Z');
    // endOfDay() is an EXCLUSIVE upper bound: the first instant of the following day,
    // which is exactly what inRange() and rangeForPreset() use.
    const to = endOfDay('2026-01-15T10:00:00Z', DEFAULT_TIME_ZONE);
    expect(new Date(to).toISOString()).toBe('2026-01-15T18:00:00.000Z');
  });

  it('produces stable date keys in Dhaka time', () => {
    expect(dhakaDateKey('2026-01-14T19:00:00Z')).toBe('2026-01-15');
    expect(dhakaDateKey('2026-01-14T17:00:00Z')).toBe('2026-01-14');
  });

  it('adds calendar days across DST-free boundaries', () => {
    // 2026 is not a leap year, so the day after 28 February is 1 March.
    const base = fromDateInputValue('2026-02-28') ?? 0;
    expect(dhakaDateKey(base)).toBe('2026-02-28');
    expect(dhakaDateKey(addDays(base, 1, DEFAULT_TIME_ZONE))).toBe('2026-03-01');
    expect(dhakaDateKey(addDays(base, -1, DEFAULT_TIME_ZONE))).toBe('2026-02-27');
  });

  it('round-trips <input type="date"> values', () => {
    const value = toDateInputValue('2026-11-08T05:00:00Z');
    expect(value).toBe('2026-11-08');
    expect(dhakaDateKey(fromDateInputValue(value) ?? 0)).toBe('2026-11-08');
    expect(fromDateInputValue('')).toBeNull();
  });
});

describe('rangeForPreset', () => {
  const now = fromDateInputValue('2026-11-08') ?? 0;

  it('covers exactly one day for "today"', () => {
    const range = rangeForPreset('today', now);
    expect(dhakaDateKey(range.from ?? 0)).toBe('2026-11-08');
    expect(range.to! - range.from!).toBe(86400000);
  });

  it('covers 7 and 30 days inclusive of today', () => {
    expect(dhakaDateKey(rangeForPreset('last7', now).from ?? 0)).toBe('2026-11-02');
    expect(dhakaDateKey(rangeForPreset('last30', now).from ?? 0)).toBe('2026-10-10');
  });

  it('covers the calendar month and previous month', () => {
    const thisMonth = rangeForPreset('thisMonth', now);
    expect(dhakaDateKey(thisMonth.from ?? 0)).toBe('2026-11-01');
    expect(dhakaDateKey(thisMonth.to ?? 0)).toBe('2026-12-01');

    const lastMonth = rangeForPreset('lastMonth', now);
    expect(dhakaDateKey(lastMonth.from ?? 0)).toBe('2026-10-01');
    expect(dhakaDateKey(lastMonth.to ?? 0)).toBe('2026-11-01');
  });

  it('returns unbounded range for "all"', () => {
    expect(rangeForPreset('all', now)).toEqual({ from: null, to: null });
  });

  it('treats ranges as [from, to)', () => {
    const range = rangeForPreset('today', now);
    expect(inRange(range.from!, range)).toBe(true);
    expect(inRange((range.to ?? 0) + 1, range)).toBe(false);
  });
});
