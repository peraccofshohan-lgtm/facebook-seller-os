/**
 * barcode.test.ts — Code 128 encoding has to be right, or it is worse than absent.
 *
 * A barcode that looks like a barcode but does not scan wastes a parcel label. These
 * tests check the symbol table against the published Code 128 specification, verify the
 * checksum with figures worked out by hand, and round-trip encode → decode.
 */

import { describe, expect, it } from 'vitest';
import {
  BarcodeError,
  CODE128_PATTERNS,
  MODULO,
  START_B,
  STOP,
  code128BValues,
  code128Modules,
  code128Svg,
  decodeCode128Modules,
  isCode128BEncodable,
} from '@/lib/barcode';
import { courierQrPayload, qrSvg } from '@/lib/qr';

describe('the symbol table', () => {
  it('has the 107 entries the specification defines', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
  });

  it('is all 11-module symbols except the 13-module stop', () => {
    CODE128_PATTERNS.forEach((pattern, index) => {
      const modules = pattern.split('').reduce((sum, digit) => sum + Number(digit), 0);
      if (index === STOP) expect(modules).toBe(13);
      else expect(modules).toBe(11);
    });
  });

  it('uses the published patterns for the characters that matter here', () => {
    // Start B, the digits and STOP are the ones a consignment id exercises.
    expect(CODE128_PATTERNS[START_B]).toBe('211214');
    expect(CODE128_PATTERNS[STOP]).toBe('2331112');
    // Symbol 0 (space, value 0 in subset B) and 16 ('0').
    expect(CODE128_PATTERNS[0]).toBe('212222');
    expect(CODE128_PATTERNS[16]).toBe('123122');
  });
});

describe('checksum', () => {
  it('matches a value worked out by hand', () => {
    // "TEST": start B = 104, then T,E,S,T at weights 1..4.
    // T = 84 - 32 = 52, E = 69 - 32 = 37, S = 83 - 32 = 51, T = 52
    // (104 + 52*1 + 37*2 + 51*3 + 52*4) mod 103
    //   = (104 + 52 + 74 + 153 + 208) mod 103
    //   = 591 mod 103 = 591 - 515 = 76
    const values = code128BValues('TEST');
    expect(values[0]).toBe(START_B);
    expect(values).toEqual([START_B, 52, 37, 51, 52, 76, STOP]);
  });

  it('always lands inside the symbol range', () => {
    for (const text of ['A', 'PT-998877', 'ORD-00042', '1234567890', '~']) {
      const values = code128BValues(text);
      const check = values[values.length - 2];
      expect(check).toBeGreaterThanOrEqual(0);
      expect(check).toBeLessThan(MODULO);
      expect(values[values.length - 1]).toBe(STOP);
    }
  });
});

describe('round trip', () => {
  it('decodes back to exactly what it encoded', () => {
    for (const text of ['PT-998877', 'ORD-00042', 'A', 'ABCDEFGHIJKLM', '1234567890', 'a-z_0-9', '~!@#$%']) {
      expect(decodeCode128Modules(code128Modules(text))).toBe(text);
    }
  });

  it('catches a corrupted module', () => {
    const modules = code128Modules('PT-998877');
    const flipped = `${modules.slice(0, 5)}${modules[5] === '1' ? '0' : '1'}${modules.slice(6)}`;
    expect(() => decodeCode128Modules(flipped)).toThrow(BarcodeError);
  });

  it('produces a module string of the expected length', () => {
    // start (11) + one symbol per character (11) + check (11) + stop (13)
    const text = 'PT-998877';
    expect(code128Modules(text)).toHaveLength(11 + text.length * 11 + 11 + 13);
  });
});

describe('what subset B cannot encode', () => {
  it('rejects Bangla text rather than drawing an unreadable barcode', () => {
    expect(isCode128BEncodable('পার্সেল')).toBe(false);
    expect(() => code128BValues('পার্সেল')).toThrow(/ইংরেজি/);
  });

  it('rejects an empty string', () => {
    expect(isCode128BEncodable('')).toBe(false);
  });

  it('rejects control characters', () => {
    expect(isCode128BEncodable('AB\nCD')).toBe(false);
  });
});

describe('SVG output', () => {
  it('emits a well-formed SVG with the bars and the caption', () => {
    const svg = code128Svg('PT-998877');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('<rect');
    expect(svg).toContain('PT-998877');
    // No raw ampersands or angle brackets leaking from the caption.
    expect(svg).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#39;)/);
  });

  it('escapes characters that would break the markup', () => {
    const svg = code128Svg('A&B<C>');
    expect(svg).toContain('A&amp;B&lt;C&gt;');
  });

  it('can omit the caption and reserve the quiet zone', () => {
    const withText = code128Svg('ABC', { showText: true });
    const without = code128Svg('ABC', { showText: false });
    expect(without).not.toContain('<text');
    expect(without.length).toBeLessThan(withText.length);

    const wide = code128Svg('ABC', { quietZone: 20 });
    const narrow = code128Svg('ABC', { quietZone: 2 });
    const widthOf = (svg: string) => Number(/width="(\d+)"/.exec(svg)?.[1] ?? 0);
    expect(widthOf(wide)).toBeGreaterThan(widthOf(narrow));
  });
});

describe('QR codes', () => {
  it('renders a QR SVG for a consignment id', () => {
    const svg = qrSvg('PT-998877');
    expect(svg).toBeTruthy();
    expect(svg!.startsWith('<svg')).toBe(true);
    expect(svg!.endsWith('</svg>')).toBe(true);
    // A QR code is made of dark modules; an empty grid would mean it silently failed.
    expect(svg!.match(/<rect/g)?.length).toBeGreaterThan(20);
  });

  it('returns null for empty input rather than an empty grid', () => {
    expect(qrSvg('')).toBeNull();
    expect(qrSvg('   ')).toBeNull();
  });

  it('produces different grids for different data', () => {
    expect(qrSvg('AAA')).not.toBe(qrSvg('BBB'));
  });

  it('builds a short ASCII payload for a parcel label', () => {
    expect(courierQrPayload('PT-998877', 'ORD-00042')).toBe('PT-998877|ORD-00042');
    expect(courierQrPayload('PT-998877', '')).toBe('PT-998877');
  });

  it('keeps a 200-character reference inside what QR can carry', () => {
    const long = 'X'.repeat(200);
    expect(qrSvg(long)).toBeTruthy();
  });
});
