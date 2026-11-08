/**
 * crypto.ts — Backup encryption and PIN hashing using the platform Web Crypto API.
 *
 * We NEVER invent our own cryptography:
 *  - Authenticated encryption: AES-256-GCM (provides confidentiality + integrity).
 *  - Key derivation: PBKDF2-HMAC-SHA256 with a random 128-bit salt and 210,000 iterations
 *    (OWASP-recommended floor for PBKDF2-SHA256).
 *  - Every encryption uses a fresh random 96-bit IV (never reused with the same key).
 *
 * Passwords/PINs are never stored. Only salt + derived-key bits are persisted, and for the
 * PIN we store a PBKDF2 hash with its own salt.
 */

export const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

export interface EncryptedEnvelope {
  /** Envelope format version. */
  v: 1;
  alg: 'AES-GCM-256';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  /** base64 */
  salt: string;
  /** base64 */
  iv: string;
  /** base64 (ciphertext + GCM authentication tag) */
  data: string;
}

export interface PinRecord {
  v: 1;
  alg: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  hash: string;
  /** Number of consecutive failed attempts. */
  failedAttempts?: number;
  /** Epoch ms until which the lock is held. */
  lockedUntil?: number;
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error('এই ব্রাউজারে Web Crypto API পাওয়া যায়নি। HTTPS বা আধুনিক ব্রাউজার ব্যবহার করুন।');
  }
  return c.subtle;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

async function importPbkdf2Key(password: string): Promise<CryptoKey> {
  return subtle().importKey('raw', encodeUtf8(password) as unknown as ArrayBuffer, 'PBKDF2', false, ['deriveBits', 'deriveKey']);
}

async function deriveBits(password: string, salt: Uint8Array, iterations: number, bits: number): Promise<Uint8Array> {
  const key = await importPbkdf2Key(password);
  const derived = await subtle().deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as ArrayBuffer,
      iterations,
      hash: 'SHA-256',
    },
    key,
    bits,
  );
  return new Uint8Array(derived);
}

async function deriveAesKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const key = await importPbkdf2Key(password);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as ArrayBuffer, iterations, hash: 'SHA-256' },
    key,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt a UTF-8 string with a password. Returns a serialisable envelope. */
export async function encryptString(plaintext: string, password: string, iterations = PBKDF2_ITERATIONS): Promise<EncryptedEnvelope> {
  if (!password) throw new Error('পাসওয়ার্ড দিন');
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveAesKey(password, salt, iterations);
  const cipher = await subtle().encrypt({ name: 'AES-GCM', iv: iv as unknown as ArrayBuffer }, key, encodeUtf8(plaintext) as unknown as ArrayBuffer);
  return {
    v: 1,
    alg: 'AES-GCM-256',
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(cipher)),
  };
}

/** Decrypt an envelope. Throws a user-friendly error when the password is wrong or data is corrupt. */
export async function decryptString(envelope: EncryptedEnvelope, password: string): Promise<string> {
  if (!password) throw new Error('পাসওয়ার্ড দিন');
  if (!envelope || envelope.alg !== 'AES-GCM-256' || envelope.kdf !== 'PBKDF2-SHA256') {
    throw new Error('ব্যাকআপ ফাইলটি সঠিক ফরম্যাটে নেই।');
  }
  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const data = fromBase64(envelope.data);
  const key = await deriveAesKey(password, salt, envelope.iterations ?? PBKDF2_ITERATIONS);
  try {
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: iv as unknown as ArrayBuffer }, key, data as unknown as ArrayBuffer);
    return decodeUtf8(new Uint8Array(plain));
  } catch {
    // AES-GCM authentication failure => wrong password or tampered file.
    throw new Error('পাসওয়ার্ড সঠিক নয় অথবা ফাইলটি ক্ষতিগ্রস্ত হয়েছে।');
  }
}

/** Create a PBKDF2 record for an app-lock PIN. The PIN itself is never stored. */
export async function createPinRecord(pin: string, iterations = PBKDF2_ITERATIONS): Promise<PinRecord> {
  const salt = randomBytes(SALT_BYTES);
  const bits = await deriveBits(pin, salt, iterations, 256);
  return {
    v: 1,
    alg: 'PBKDF2-SHA256',
    iterations,
    salt: toBase64(salt),
    hash: toBase64(bits),
    failedAttempts: 0,
    lockedUntil: 0,
  };
}

export async function verifyPin(pin: string, record: PinRecord): Promise<boolean> {
  const salt = fromBase64(record.salt);
  const bits = await deriveBits(pin, salt, record.iterations, 256);
  const expected = fromBase64(record.hash);
  const actual = bits;
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/** Produce a short checksum of a string (FNV-1a 32-bit, hex) for integrity display. */
export function checksumFnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
