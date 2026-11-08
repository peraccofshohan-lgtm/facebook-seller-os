import { describe, expect, it } from 'vitest';
import { PBKDF2_ITERATIONS, checksumFnv1a, createPinRecord, decryptString, encryptString, fromBase64, toBase64, verifyPin } from '@/lib/crypto';

/**
 * These tests use a reduced PBKDF2 iteration count so the suite stays fast; the
 * production default (210 000) is asserted separately so it cannot be lowered silently.
 */
const FAST = 1000;

describe('symmetric encryption (used for password-protected backups)', () => {
  it('round-trips a payload with the correct password', async () => {
    const envelope = await encryptString('{"orders":[]}', 'correct horse', FAST);
    await expect(decryptString(envelope, 'correct horse')).resolves.toBe('{"orders":[]}');
  });

  it('fails with the wrong password', async () => {
    const envelope = await encryptString('secret', 'correct horse', FAST);
    await expect(decryptString(envelope, 'wrong password')).rejects.toThrow();
  });

  it('fails if the ciphertext was tampered with (AES-GCM authentication)', async () => {
    const envelope = await encryptString('secret', 'pw', FAST);
    const bytes = fromBase64(envelope.data);
    bytes[0] = bytes[0] ^ 0xff;
    const tampered = { ...envelope, data: toBase64(bytes) };
    await expect(decryptString(tampered, 'pw')).rejects.toThrow();
  });

  it('uses a fresh salt and IV on every call', async () => {
    const a = await encryptString('same', 'pw', FAST);
    const b = await encryptString('same', 'pw', FAST);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('keeps the production iteration count high', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(200_000);
  });
});

describe('PIN records', () => {
  it('verifies the right PIN and rejects the wrong one', async () => {
    const record = await createPinRecord('1234', FAST);
    await expect(verifyPin('1234', record)).resolves.toBe(true);
    await expect(verifyPin('9999', record)).resolves.toBe(false);
  });

  it('never stores the PIN in plaintext and salts each record', async () => {
    const a = await createPinRecord('1234', FAST);
    const b = await createPinRecord('1234', FAST);
    expect(JSON.stringify(a)).not.toContain('1234');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('checksumFnv1a', () => {
  it('is stable and changes with the input', () => {
    expect(checksumFnv1a('hello')).toBe(checksumFnv1a('hello'));
    expect(checksumFnv1a('hello')).not.toBe(checksumFnv1a('hello!'));
  });
});
