/**
 * backupService.ts — Full backup, restore, and integrity validation.
 *
 * Guarantees and limits (documented in BACKUP_AND_RESTORE.md):
 *  - A backup is a JSON file containing every table plus a manifest (app version, schema
 *    version, counts, checksum). It is created entirely in the browser.
 *  - Optional password protection uses AES-256-GCM with a PBKDF2-SHA256 derived key
 *    (210,000 iterations). The password is never stored anywhere. If it is lost, an
 *    encrypted backup CANNOT be recovered — the UI states this clearly.
 *  - Restore NEVER happens implicitly. The caller must show a preview and obtain an
 *    explicit confirmation with a chosen strategy (merge or replace).
 *  - "Replace" first re-reads the current data so the operation can be reported accurately;
 *    it is executed in a single IndexedDB transaction.
 */

import { db, BACKUP_TABLES, type BackupTableName } from '@/db/db';
import { nowIso, nowMs } from '@/lib/date';
import { checksumFnv1a, decryptString, encryptString, type EncryptedEnvelope } from '@/lib/crypto';
import type { BackupFile, BackupMeta, BackupPayload, BackupTableCounts } from '@/domain/types';
import { APP_VERSION } from './settingsService';

export const BACKUP_FORMAT = 'facebook-seller-os-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const SCHEMA_VERSION_EXPORT = 1;

function emptyPayload(): BackupPayload {
  return {
    products: [],
    productVariants: [],
    productCategories: [],
    expenseCategories: [],
    paymentMethods: [],
    courierProviders: [],
    stockLevels: [],
    stockMovements: [],
    customers: [],
    orders: [],
    orderEvents: [],
    payments: [],
    courierRecords: [],
    returns: [],
    expenses: [],
    settings: [],
  };
}

export async function collectPayload(): Promise<BackupPayload> {
  const entries = await Promise.all(
    BACKUP_TABLES.map(async (name) => [name, await (db as unknown as Record<string, { toArray(): Promise<unknown[]> }>)[name].toArray()] as const),
  );
  const payload = emptyPayload();
  for (const [name, rows] of entries) {
    (payload as unknown as Record<string, unknown[]>)[name] = rows;
  }
  return payload;
}

export function countPayload(payload: BackupPayload): BackupTableCounts {
  const counts: BackupTableCounts = {};
  for (const table of BACKUP_TABLES) {
    const rows = (payload as unknown as Record<string, unknown[]>)[table] ?? [];
    counts[table] = rows.length;
  }
  return counts;
}

export async function buildBackupFile(deviceLabel = ''): Promise<BackupFile> {
  const data = await collectPayload();
  const counts = countPayload(data);
  const meta: BackupMeta = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION_EXPORT,
    createdAtIso: nowIso(),
    createdAtMs: nowMs(),
    deviceLabel,
    counts,
    checksum: checksumFnv1a(JSON.stringify(data)),
    encrypted: false,
  };
  return { meta, data };
}

export async function buildEncryptedBackup(password: string, deviceLabel = ''): Promise<{ meta: BackupMeta; envelope: EncryptedEnvelope }> {
  const file = await buildBackupFile(deviceLabel);
  const envelope = await encryptString(JSON.stringify(file.data), password);
  return {
    meta: { ...file.meta, checksum: '', encrypted: true },
    envelope,
  };
}

export function backupFilename(encrypted: boolean, date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
  return `facebook-seller-os-backup-${stamp}.${encrypted ? 'fsos' : 'json'}`;
}

/* ------------------------------------------------------------------ */
/* Inspection                                                          */
/* ------------------------------------------------------------------ */

export interface BackupIssue {
  level: 'error' | 'warning';
  message: string;
}

export interface BackupInspection {
  valid: boolean;
  encrypted: boolean;
  meta: BackupMeta | null;
  payload: BackupPayload | null;
  issues: BackupIssue[];
  /** Present only for encrypted files: the raw envelope awaiting a password. */
  envelope: EncryptedEnvelope | null;
}

function isEnvelope(value: unknown): value is EncryptedEnvelope {
  const v = value as EncryptedEnvelope | null;
  return Boolean(v && v.alg === 'AES-GCM-256' && v.kdf === 'PBKDF2-SHA256' && typeof v.data === 'string');
}

/** Parse a backup file without writing anything to the database. */
export function inspectBackup(text: string): BackupInspection {
  const issues: BackupIssue[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { valid: false, encrypted: false, meta: null, payload: null, envelope: null, issues: [{ level: 'error', message: 'ফাইলটি বৈধ JSON নয়।' }] };
  }
  const file = parsed as Partial<BackupFile> & { envelope?: unknown };
  const meta = file.meta as BackupMeta | undefined;

  if (!meta || meta.format !== BACKUP_FORMAT) {
    return {
      valid: false,
      encrypted: false,
      meta: null,
      payload: null,
      envelope: null,
      issues: [{ level: 'error', message: 'এটি Facebook Seller OS ব্যাকআপ ফাইল নয়।' }],
    };
  }

  if (isEnvelope(file.envelope)) {
    return {
      valid: false,
      encrypted: true,
      meta,
      payload: null,
      envelope: file.envelope,
      issues: [{ level: 'warning', message: 'ফাইলটি পাসওয়ার্ড দিয়ে এনক্রিপ্ট করা। প্রিভিউ দেখতে পাসওয়ার্ড দিন।' }],
    };
  }

  const payload = file.data;
  if (!payload) {
    return {
      valid: false,
      encrypted: false,
      meta,
      payload: null,
      envelope: null,
      issues: [{ level: 'error', message: 'ব্যাকআপ ফাইলে কোনো ডেটা পাওয়া যায়নি।' }],
    };
  }

  for (const table of BACKUP_TABLES) {
    const rows = (payload as unknown as Record<string, unknown>)[table];
    if (!Array.isArray(rows)) {
      issues.push({ level: 'error', message: `ব্যাকআপে "${table}" টেবিলের তথ্য নেই বা সঠিক নয়।` });
    }
  }

  const expected = checksumFnv1a(JSON.stringify(payload));
  if (meta.checksum && meta.checksum !== expected) {
    issues.push({ level: 'warning', message: 'চেকসাম মেলেনি — ফাইলটি পরিবর্তিত বা ক্ষতিগ্রস্ত হতে পারে।' });
  }
  if (meta.schemaVersion > SCHEMA_VERSION_EXPORT) {
    issues.push({
      level: 'warning',
      message: `ব্যাকআপটি অ্যাপের নতুন সংস্করণ (স্কিমা ${meta.schemaVersion}) থেকে নেওয়া। এই সংস্করণে সব তথ্য ঠিকভাবে পড়া নাও যেতে পারে।`,
    });
  }

  return {
    valid: !issues.some((i) => i.level === 'error'),
    encrypted: false,
    meta,
    payload,
    envelope: null,
    issues,
  };
}

/** Decrypt an encrypted backup into a normal inspection result. */
export async function inspectEncryptedBackup(envelope: EncryptedEnvelope, meta: BackupMeta, password: string): Promise<BackupInspection> {
  const json = await decryptString(envelope, password);
  const data = JSON.parse(json) as BackupPayload;
  const checksum = checksumFnv1a(JSON.stringify(data));
  const issues: BackupIssue[] = [];
  if (meta.checksum && meta.checksum !== checksum) issues.push({ level: 'warning', message: 'চেকসাম মেলেনি।' });
  return {
    valid: !issues.some((i) => i.level === 'error'),
    encrypted: true,
    meta: { ...meta, checksum },
    payload: data,
    envelope,
    issues,
  };
}

/* ------------------------------------------------------------------ */
/* Restore                                                             */
/* ------------------------------------------------------------------ */

export type RestoreMode = 'merge' | 'replace';

export interface RestoreResult {
  mode: RestoreMode;
  counts: Record<string, { added: number; updated: number; skipped: number }>;
  durationMs: number;
}

/**
 * Merge strategy: a record is inserted when its id is unknown; when the id exists the
 * record with the newer `updatedAt` wins. Nothing is ever deleted in merge mode.
 */
export async function restoreBackup(payload: BackupPayload, mode: RestoreMode): Promise<RestoreResult> {
  const startedAt = Date.now();
  const counts: Record<string, { added: number; updated: number; skipped: number }> = {};

  await db.transaction('rw', BACKUP_TABLES.map((name) => (db as unknown as Record<string, never>)[name]) as never[], async () => {
    for (const name of BACKUP_TABLES) {
      const incoming = (payload as unknown as Record<string, Record<string, unknown>[]>)[name] ?? [];
      const store = (db as unknown as Record<string, { get(id: string): Promise<unknown>; put(row: never): Promise<unknown>; bulkPut(rows: never[]): Promise<unknown>; clear(): Promise<unknown> }>)[name];
      counts[name] = { added: 0, updated: 0, skipped: 0 };

      if (mode === 'replace') {
        await store.clear();
        if (incoming.length) await store.bulkPut(incoming as never[]);
        counts[name] = { added: incoming.length, updated: 0, skipped: 0 };
        continue;
      }

      for (const row of incoming) {
        const id = String(row.id ?? '');
        if (!id) {
          counts[name].skipped += 1;
          continue;
        }
        const existing = (await store.get(id)) as { updatedAt?: number } | undefined;
        if (!existing) {
          await store.put(row as never);
          counts[name].added += 1;
        } else {
          const incomingUpdated = Number(row.updatedAt ?? 0);
          const existingUpdated = Number(existing.updatedAt ?? 0);
          if (incomingUpdated >= existingUpdated) {
            await store.put(row as never);
            counts[name].updated += 1;
          } else {
            counts[name].skipped += 1;
          }
        }
      }
    }
  });

  return { mode, counts, durationMs: Date.now() - startedAt };
}

/** Human summary of what a restore would change, used by the restore preview dialog. */
export async function previewRestore(payload: BackupPayload, mode: RestoreMode): Promise<{ table: BackupTableName; incoming: number; add: number; update: number; skip: number; current: number }[]> {
  const out: { table: BackupTableName; incoming: number; add: number; update: number; skip: number; current: number }[] = [];
  for (const name of BACKUP_TABLES) {
    const incomingRows = (payload as unknown as Record<string, Record<string, unknown>[]>)[name] ?? [];
    const store = (db as unknown as Record<string, { count(): Promise<number>; get(id: string): Promise<unknown> }>)[name];
    const current = await store.count();
    let add = 0;
    let update = 0;
    let skip = 0;
    if (mode === 'replace') {
      add = incomingRows.length;
    } else {
      for (const row of incomingRows) {
        const id = String(row.id ?? '');
        if (!id) {
          skip += 1;
          continue;
        }
        const existing = (await store.get(id)) as { updatedAt?: number } | undefined;
        if (!existing) add += 1;
        else if (Number(row.updatedAt ?? 0) >= Number(existing.updatedAt ?? 0)) update += 1;
        else skip += 1;
      }
    }
    out.push({ table: name, incoming: incomingRows.length, add, update, skip, current });
  }
  return out;
}

/** Update the "last backup" timestamp shown in Settings. */
export async function markBackupTaken(): Promise<void> {
  const settings = await db.settings.get('app');
  if (!settings) return;
  await db.settings.update('app', {
    backup: { ...settings.backup, lastBackupAt: nowMs() },
    updatedAt: nowMs(),
  });
}

export function isBackupDue(lastBackupAt: number | null, reminderDays: number, now: number = nowMs()): boolean {
  if (!lastBackupAt) return true;
  return now - lastBackupAt > reminderDays * 86400000;
}
