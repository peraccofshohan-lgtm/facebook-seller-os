/**
 * csv.ts — Small, dependency-free CSV reader/writer with:
 *  - RFC 4180 quoting (embedded commas, quotes, newlines)
 *  - UTF-8 BOM handling (Excel-compatible Bengali text)
 *  - Spreadsheet formula-injection protection on export
 */

export type CsvRow = string[];
export type CsvTable = CsvRow[];

/** Parse CSV text into rows. Handles quoted fields, "" escapes, CRLF/LF/CR. */
export function parseCsv(input: string): CsvTable {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: CsvTable = [];
  let row: CsvRow = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Flush the final field/row (a trailing newline should not create an empty row).
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

const RISKY_PREFIX = /^[=+\-@\t\r]/;

/** Neutralise spreadsheet formula injection by prefixing a single quote. */
/** A plain number is safe: only formulas are a spreadsheet-injection risk. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Guard spreadsheet formula injection, but do not mangle a real negative
  // amount: "-500" is data, "=1+1" is a formula.
  if (RISKY_PREFIX.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return s;
}

function needsQuoting(s: string): boolean {
  return s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r');
}

export function escapeCsvCell(value: unknown): string {
  let s = sanitizeCsvCell(value);
  if (needsQuoting(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export interface ToCsvOptions {
  /** Prepend a UTF-8 BOM so Excel opens Bengali text correctly. Default: true. */
  bom?: boolean;
}

export function toCsv(rows: CsvTable, options: ToCsvOptions = {}): string {
  const { bom = true } = options;
  const body = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
  return bom ? `\uFEFF${body}` : body;
}

export function csvFromObjects<T extends Record<string, unknown>>(
  objects: T[],
  columns: { key: string; header: string }[],
  options: ToCsvOptions = {},
): string {
  const headerRow = columns.map((c) => c.header);
  const bodyRows: CsvTable = objects.map((obj) => columns.map((c) => String(obj[c.key] ?? '')));
  return toCsv([headerRow, ...bodyRows], options);
}

/** Return rows that have at least one non-empty cell, and trim trailing empty columns. */
export function normalizeCsvTable(table: CsvTable): CsvTable {
  if (table.length === 0) return [];
  let maxCols = 0;
  for (const row of table) maxCols = Math.max(maxCols, row.length);
  return table.map((row) => {
    const cells = row.slice(0, maxCols).map((c) => c.trim());
    return cells;
  });
}
