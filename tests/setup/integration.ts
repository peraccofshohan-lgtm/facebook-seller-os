/**
 * Integration test environment.
 *
 * `fake-indexeddb` provides a spec-compliant IndexedDB implementation in Node, so the
 * real Dexie schema, indexes and transactions are exercised — not a mocked service layer.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, vi } from 'vitest';
import { BACKUP_TABLES, db, SCHEMA_VERSION } from '@/db/db';
import { ensureDefaultTaxonomies, ensureSettings } from '@/db/defaults';
import { APP_VERSION } from '@/services/settingsService';

interface GlobalWithUrl {
  URL: typeof URL;
}
const g = globalThis as unknown as { URL: Partial<GlobalWithUrl['URL']> };
if (typeof g.URL.createObjectURL !== 'function') {
  g.URL.createObjectURL = () => 'blob:mock';
  g.URL.revokeObjectURL = () => undefined;
}

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  // Empty every table rather than deleting/reopening the database: keeps one stable
  // connection for the whole file so transactions behave like they do in a browser.
  await db.transaction('rw', BACKUP_TABLES.map((name) => db.table(name)), async () => {
    await Promise.all(BACKUP_TABLES.map((name) => db.table(name).clear()));
  });
  // Re-seed the app settings and default taxonomies the way the app boot does.
  await ensureSettings(APP_VERSION);
  await ensureDefaultTaxonomies();
});

afterEach(() => {
  vi.restoreAllMocks();
});

export { SCHEMA_VERSION };
