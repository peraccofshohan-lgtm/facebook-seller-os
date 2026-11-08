import { describe, expect, it } from 'vitest';
import { formatPhone, isValidBdPhone, levenshtein, matchesQuery, namesLookSimilar, normalizePhone, normalizeText } from '@/lib/search';

describe('phone handling', () => {
  it('normalises Bangladeshi numbers written in several common ways', () => {
    expect(normalizePhone('+88 01712-345678')).toBe('01712345678');
    expect(normalizePhone('৮৮০১৭১২৩৪৫৬৭৮')).toBe('01712345678');
    expect(normalizePhone('01712 345 678')).toBe('01712345678');
  });

  it('accepts valid Bangladeshi mobile numbers only', () => {
    expect(isValidBdPhone('01712345678')).toBe(true);
    expect(isValidBdPhone('+8801712345678')).toBe(true);
    expect(isValidBdPhone('0161234567')).toBe(false);
    expect(isValidBdPhone('12345678901')).toBe(false);
    expect(isValidBdPhone('')).toBe(false);
  });

  it('formats for display', () => {
    expect(formatPhone('01712345678')).toBe('01712 345678');
  });
});

describe('Bengali-aware search', () => {
  it('matches Bengali text typed in Latin and vice versa is not required, but digits and case are', () => {
    expect(normalizeText('Rima  Khatun ')).toBe('rima khatun');
    expect(matchesQuery('rima khatun', 'RIMA')).toBe(true);
  });

  it('normalises Bengali digits when searching', () => {
    expect(matchesQuery('অর্ডার ১২৩', '123')).toBe(true);
  });

  it('ignores an empty query', () => {
    expect(matchesQuery('anything', '')).toBe(true);
  });
});

describe('duplicate detection helpers', () => {
  it('measures edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('রিমা', 'রিমা')).toBe(0);
  });

  it('flags near-identical names but not clearly different ones', () => {
    expect(namesLookSimilar('রিমা আক্তার', 'রিমা আক্তার')).toBe(true);
    // Word order does not matter.
    expect(namesLookSimilar('রিমা আক্তার', 'আক্তার রিমা')).toBe(true);
    // Deliberately conservative: one shared word out of two is NOT a match, because a
    // duplicate warning must never nudge the user into merging two different people.
    expect(namesLookSimilar('রিমা আক্তার', 'রিমা আখতার')).toBe(false);
    expect(namesLookSimilar('রিমা আক্তার', 'করিম ট্রেডার্স')).toBe(false);
  });
});
