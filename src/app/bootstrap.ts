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
import { ensureDefaultTaxonomies, ensureNoteTemplates, ensureSettings } from '@/db/defaults';
import { detectFutureSchema, runMigrations } from '@/db/migrations';
import { APP_VERSION } from '@/services/settingsService';

export interface BootstrapResult {
  schemaVersion: number;
  /** True when the stored data belongs to a newer app version. */
  futureSchema: boolean;
  migrationsApplied: number[];
  /**
   * Set when a migration threw. The app still opens with the previous schema version —
   * we never leave the database half-migrated — and the seller is warned in Bengali so
   * they can take a backup instead of losing data silently.
   */
  migrationError: string | null;
}

let promise: Promise<BootstrapResult> | null = null;

export function bootstrapApp(): Promise<BootstrapResult> {
  if (promise) return promise;
  promise = (async () => {
    await openDatabase();
    await ensureSettings(APP_VERSION);
    await ensureDefaultTaxonomies();
    await ensureNoteTemplates();

    // A migration runs in its own transaction, so a failure rolls back that migration
    // and nothing else. Catch it here so the app still opens on the old schema.
    let migrationError: string | null = null;
    let applied: number[] = [];
    try {
      const migration = await runMigrations();
      applied = migration.applied;
    } catch (error) {
      migrationError = error instanceof Error ? error.message : String(error);
    }

    const futureSchema = await detectFutureSchema();
    const settings = await ensureSettings(APP_VERSION);
    return {
      schemaVersion: settings.schemaVersion,
      futureSchema,
      migrationsApplied: applied,
      migrationError,
    };
  })();
  return promise;
}
