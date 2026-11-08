/** Record identifier generation. Uses Web Crypto where available, with a safe fallback. */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford-like, no ambiguous I/L/O/U

export function randomId(): string {
  const g = globalThis.crypto;
  if (g && typeof g.randomUUID === 'function') return g.randomUUID();
  if (g && typeof g.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    g.getRandomValues(bytes);
    return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  }
  // Fallback (non-cryptographic) for exotic environments.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function shortId(length = 8): string {
  const g = globalThis.crypto;
  if (g && typeof g.getRandomValues === 'function') {
    const bytes = new Uint8Array(length);
    g.getRandomValues(bytes);
    return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  }
  return Math.random().toString(36).slice(2, 2 + length).toUpperCase();
}
