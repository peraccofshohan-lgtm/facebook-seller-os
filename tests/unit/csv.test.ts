import { describe, expect, it } from 'vitest';
import { escapeCsvCell, parseCsv, sanitizeCsvCell, toCsv } from '@/lib/csv';

describe('parseCsv', () => {
  it('parses quoted fields containing commas and newlines', () => {
    const table = parseCsv('name,note\r\n"আহমেদ, মোঃ","লাইন ১\nলাইন ২"\r\n');
    expect(table[0]).toEqual(['name', 'note']);
    expect(table[1]).toEqual(['আহমেদ, মোঃ', 'লাইন ১\nলাইন ২']);
  });

  it('handles escaped double quotes inside quoted fields', () => {
    expect(parseCsv('a\n"say ""hi"""')[1]).toEqual(['say "hi"']);
  });

  it('keeps empty trailing fields', () => {
    expect(parseCsv('a,b,c\n1,,3')[1]).toEqual(['1', '', '3']);
  });

  it('strips a UTF-8 BOM from the first header', () => {
    expect(parseCsv('\uFEFFname\nRima')[0]).toEqual(['name']);
  });
});

describe('csv injection guard', () => {
  it('neutralises formula-leading characters that spreadsheets may execute', () => {
    expect(sanitizeCsvCell('=1+1')).toBe("'=1+1");
    expect(sanitizeCsvCell('+SUM(A1:A9)')).toBe("'+SUM(A1:A9)");
    expect(sanitizeCsvCell('-2+3')).toBe("'-2+3");
    expect(sanitizeCsvCell('@import')).toBe("'@import");
    // A leading BOM is not a formula risk, so it is left alone.
    expect(sanitizeCsvCell('﻿hello')).toBe('﻿hello');
  });

  it('leaves ordinary text untouched', () => {
    expect(sanitizeCsvCell('পণ্য')).toBe('পণ্য');
    expect(sanitizeCsvCell('')).toBe('');
    expect(sanitizeCsvCell(null)).toBe('');
  });
});

describe('toCsv', () => {
  it('quotes only the cells that need it', () => {
    expect(escapeCsvCell('plain')).toBe('plain');
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
  });

  it('round-trips through parseCsv', () => {
    const rows = [
      ['নাম', 'দাম'],
      ['টি-শার্ট, সাদা', '৫০০.০০'],
      ['হিজাব', '৩২০.০০'],
    ];
    const csv = toCsv(rows);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const parsed = parseCsv(csv);
    expect(parsed[1]).toEqual(['টি-শার্ট, সাদা', '৫০০.০০']);
    expect(parsed[2]).toEqual(['হিজাব', '৩২০.০০']);
  });
});
