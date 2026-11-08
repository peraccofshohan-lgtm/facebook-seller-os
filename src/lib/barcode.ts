/**
 * barcode.ts — Code 128 (subset B) generator, drawn as SVG.
 *
 * No dependency: the symbol table is the published Code 128 specification, and it was
 * cross-checked against the table shipped in JsBarcode (MIT) before being committed here.
 *
 * SUBSET B ONLY, deliberately. Subset B encodes ASCII 32–126, which covers every
 * character that can appear in a consignment or tracking id. Consignment ids are pure
 * ASCII in practice; a Bangla tracking id is not a thing, and silently producing a
 * barcode that no scanner could read would be worse than not drawing one. Characters
 * outside the range are rejected rather than mangled.
 *
 * WHAT HAS AND HAS NOT BEEN VERIFIED: the encoding is verified by round-tripping
 * (encode → decode → same string) and by checksum tests computed by hand. It has NOT
 * been read back with a physical barcode scanner — see the V2 report.
 */

/** Run-length patterns for symbol values 0–106. Index 106 is STOP (13 modules). */
export const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
] as const;

export const START_B = 104;
export const STOP = 106;
export const MODULO = 103;

export class BarcodeError extends Error {}

/** Every character subset B can represent. */
export function isCode128BEncodable(text: string): boolean {
  if (!text) return false;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

/** Symbol values for a string, including the start character and the check symbol. */
export function code128BValues(text: string): number[] {
  if (!isCode128BEncodable(text)) {
    throw new BarcodeError('বারকোডে শুধু ইংরেজি অক্ষর, সংখ্যা ও চিহ্ন ব্যবহার করা যায়');
  }
  const values = [START_B];
  for (const char of text) values.push(char.charCodeAt(0) - 32);

  // Checksum: start value + each data value weighted by its 1-based position.
  let checksum = START_B;
  values.slice(1).forEach((value, index) => {
    checksum += value * (index + 1);
  });
  values.push(checksum % MODULO);
  values.push(STOP);
  return values;
}

/** Expand symbol values into the module string ("1" = bar, "0" = space). */
export function code128Modules(text: string): string {
  const values = code128BValues(text);
  let modules = '';
  for (const value of values) {
    const pattern = CODE128_PATTERNS[value];
    if (!pattern) throw new BarcodeError('বারকোড তৈরি করা যায়নি');
    let bar = true;
    for (const width of pattern) {
      modules += (bar ? '1' : '0').repeat(Number(width));
      bar = !bar;
    }
  }
  return modules;
}

export interface BarcodeSvgOptions {
  height?: number;
  /** Module width in px. */
  moduleWidth?: number;
  /** Quiet-zone width, in modules. The spec requires 10; labels rarely have the room. */
  quietZone?: number;
  showText?: boolean;
  fontSize?: number;
}

/**
 * Render a Code 128 barcode as an SVG string.
 *
 * Returned as a string (not a component) so it can be embedded in a printable document,
 * a data URL, or a test assertion without pulling React into the barcode module.
 */
export function code128Svg(text: string, options: BarcodeSvgOptions = {}): string {
  const height = options.height ?? 48;
  const moduleWidth = options.moduleWidth ?? 2;
  const quietZone = options.quietZone ?? 10;
  const showText = options.showText ?? true;
  const fontSize = options.fontSize ?? 11;

  const modules = code128Modules(text);
  const quiet = quietZone * moduleWidth;
  const width = quiet * 2 + modules.length * moduleWidth;
  const textHeight = showText ? fontSize + 4 : 0;

  let bars = '';
  let x = quiet;
  for (const module of modules) {
    if (module === '1') {
      bars += `<rect x="${x}" y="0" width="${moduleWidth}" height="${height}" fill="#000"/>`;
    }
    x += moduleWidth;
  }

  const label = showText
    ? `<text x="${width / 2}" y="${height + fontSize}" font-family="monospace" font-size="${fontSize}" text-anchor="middle" fill="#000">${escapeXml(
        text,
      )}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + textHeight}" viewBox="0 0 ${width} ${
    height + textHeight
  }" role="img" aria-label="বারকোড ${escapeXml(text)}"><rect width="100%" height="100%" fill="#fff"/>${bars}${label}</svg>`;
}

export function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => {
    switch (char) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/**
 * Decode a module string back to text.
 *
 * Exists so the tests can round-trip an encoding instead of only checking it looks
 * plausible: a wrong check symbol or a mis-ordered pattern is caught immediately.
 */
export function decodeCode128Modules(modules: string): string {
  // Strip the 13-module stop pattern and the trailing check symbol, then walk the rest.
  if (!modules.endsWith('1'.repeat(2))) throw new BarcodeError('বারকোডের শেষ চিহ্ন পাওয়া যায়নি');

  const symbols: number[] = [];
  let i = 0;
  // Walk left to right, consuming 11 modules per symbol. The final 13-module group is
  // the stop pattern, which we recognise because it is the only 13-module symbol.
  while (i < modules.length) {
    const remaining = modules.length - i;
    const length = remaining === 13 ? 13 : 11;
    if (remaining < 11) throw new BarcodeError('বারকোড অসম্পূর্ণ');
    const chunk = modules.slice(i, i + length);
    const value = patternToValue(chunk);
    symbols.push(value);
    i += length;
  }

  if (symbols[0] !== START_B) throw new BarcodeError('বারকোডের শুরুর চিহ্ন সঠিক নয়');
  if (symbols[symbols.length - 1] !== STOP) throw new BarcodeError('বারকোডের শেষ চিহ্ন সঠিক নয়');

  const body = symbols.slice(1, -2);
  const check = symbols[symbols.length - 2];

  let expected = START_B;
  body.forEach((value, index) => {
    expected += value * (index + 1);
  });
  if (expected % MODULO !== check) throw new BarcodeError('বারকোডের যাচাই সংখ্যা মিলছে না');

  return body.map((value) => String.fromCharCode(value + 32)).join('');
}

function patternToValue(chunk: string): number {
  // Re-run-length the module string back into the width pattern.
  let pattern = '';
  let current = chunk[0];
  let count = 0;
  for (const char of chunk) {
    if (char === current) count += 1;
    else {
      pattern += String(count);
      current = char;
      count = 1;
    }
  }
  pattern += String(count);

  const index = (CODE128_PATTERNS as readonly string[]).indexOf(pattern);
  if (index < 0) throw new BarcodeError('বারকোডের চিহ্ন চেনা যায়নি');
  return index;
}
