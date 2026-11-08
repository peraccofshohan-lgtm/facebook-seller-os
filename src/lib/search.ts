/**
 * search.ts — Unicode-safe search helpers for Bengali + English mixed business data.
 */

/** Normalise Bengali/Arabic-Indic digits to Latin digits so "০১৭" matches "017". */
export function normalizeDigits(input: string): string {
  return input.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Lowercase, trim, collapse whitespace and normalise digits. */
export function normalizeText(input: string): string {
  return normalizeDigits(input).toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Build a searchable haystack from many fields. */
export function searchKey(...parts: (string | number | null | undefined)[]): string {
  return normalizeText(parts.filter((p) => p !== null && p !== undefined).join(' '));
}

/** All tokens must be present (AND search) — good for "shirt red". */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = normalizeText(query);
  if (!q) return true;
  // Normalise the haystack too, so stored Bengali digits can be searched with Latin digits.
  const h = normalizeText(haystack);
  const tokens = q.split(' ').filter(Boolean);
  return tokens.every((t) => h.includes(t));
}

/** Normalise a Bangladesh phone number to the local 11-digit form (01XXXXXXXXX). */
export function normalizePhone(phone: string): string {
  let p = normalizeDigits(phone).replace(/[^\d]/g, '');
  if (p.startsWith('880')) p = `0${p.slice(3)}`;
  if (p.startsWith('+880')) p = `0${p.slice(4)}`;
  if (p.length > 11) p = p.slice(-11);
  return p;
}

export function formatPhone(phone: string): string {
  const p = normalizePhone(phone);
  if (p.length !== 11) return phone;
  return `${p.slice(0, 5)} ${p.slice(5)}`;
}

export function isValidBdPhone(phone: string): boolean {
  return /^01[3-9]\d{8}$/.test(normalizePhone(phone));
}

/** Fuzzy "looks like the same person" check used for cautious duplicate warnings. */
export function namesLookSimilar(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Word-set comparison (order-insensitive), tolerant of extra words.
  const sa = new Set(na.split(' ').filter((w) => w.length > 1));
  const sb = new Set(nb.split(' ').filter((w) => w.length > 1));
  if (sa.size === 0 || sb.size === 0) return false;
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared += 1;
  const ratio = shared / Math.min(sa.size, sb.size);
  return ratio >= 0.67;
}

/** Levenshtein distance, used for near-duplicate phone detection. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}
