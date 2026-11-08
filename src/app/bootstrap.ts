/**
 * bootstrap.ts — Application start-up sequence.
 *
 * Order matters:
 *   1. Open IndexedDB (creates the schema if this is the first run).
 *   2. Ensure the settings row and default taxonomies exist (idempotent).
 *   3. Run pending data migrations.
 *   4. Detect a database written by a newer app version (refuse to downgrade silently).
 *
 * Everything happens locally: no network request is made during bootstrap.
 */

import { openDatabase } from '@/db/db';
import { ensureDefaultTaxonomies, ensureSettings } from '@/db/defaults';
import { detectFutureSchema, runMigrations } from '@/db/migrations';
import { APP_VERSION } from '@/services/settingsService';

export interface BootstrapResult {
  schemaVersion: number;
  /** True when the stored data belongs to a newer app version. */
  futureSchema: boolean;
  migrationsApplied: number[];
}

let promise: Promise<BootstrapResult> | null = null;

export function bootstrapApp(): Promise<BootstrapResult> {
  if (promise) return promise;
  promise = (async () => {
    await openDatabase();
    await ensureSettings(APP_VERSION);
    await ensureDefaultTaxonomies();
    const migration = await runMigrations();
    const futureSchema = await detectFutureSchema();
    const settings = await ensureSettings(APP_VERSION);
    return {
      schemaVersion: settings.schemaVersion,
      futureSchema,
      migrationsApplied: migration.applied,
    };
  })();
  return promise;
}
