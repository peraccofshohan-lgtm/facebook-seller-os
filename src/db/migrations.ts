/**
 * migrations.ts — Schema/data migration registry.
 *
 * How migrations work here
 *  1. Dexie `version(n).stores()` declares the *structure* (see db.ts).
 *  2. Anything that cannot be expressed as an index change (backfilling a new field,
 *     normalising values, repairing data) is registered here as a function keyed by the
 *     target schema version.
 *  3. `runMigrations()` is called during application bootstrap, inside a transaction per
 *     migration, and records the applied version in `settings.schemaVersion`.
 *
 * Migrations must be idempotent: they may be re-run on a partially migrated database.
 */

import { db, SCHEMA_VERSION } from './db';
import { nowMs } from '@/lib/date';

export interface Migration {
  version: number;
  description: string;
  /** Runs inside a Dexie read/write transaction. Must be idempotent. */
  run: () => Promise<void>;
}

export const migrations: Migration[] = [
  // Version 1 is the initial schema; nothing to backfill. Later releases append entries:
  // { version: 2, description: '…', run: async () => { … } }
];

/** Highest schema version this build understands. */
export const targetSchemaVersion = SCHEMA_VERSION;

export interface MigrationResult {
  applied: number[];
  previousVersion: number;
  currentVersion: number;
}

/** Apply every pending migration, in order, recording progress in settings. */
export async function runMigrations(): Promise<MigrationResult> {
  const settings = await db.settings.get('app');
  const previousVersion = settings?.schemaVersion ?? 0;
  const applied: number[] = [];

  const pending = migrations
    .filter((m) => m.version > previousVersion && m.version <= targetSchemaVersion)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    await db.transaction('rw', [db.settings, db.products, db.orders, db.customers, db.payments, db.expenses], async () => {
      await migration.run();
    });
    applied.push(migration.version);
  }

  const currentVersion = Math.max(previousVersion, targetSchemaVersion);
  if (settings) {
    await db.settings.update('app', { schemaVersion: currentVersion, updatedAt: nowMs() });
  }

  return { applied, previousVersion, currentVersion };
}

/**
 * Detect a database written by a *newer* version of the app (for example after the user
 * downgrades or a stale service worker serves an old bundle). In that case we refuse to
 * migrate and surface a clear Bengali warning instead of corrupting data.
 */
export async function detectFutureSchema(): Promise<boolean> {
  const settings = await db.settings.get('app');
  if (!settings) return false;
  return settings.schemaVersion > targetSchemaVersion;
}
