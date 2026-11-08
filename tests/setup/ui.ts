/**
 * UI test environment: jsdom + fake IndexedDB, matching how the app really runs.
 */
import 'fake-indexeddb/auto';
import '@testing-library/dom';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { BACKUP_TABLES, db } from '@/db/db';
import { ensureDefaultTaxonomies, ensureSettings } from '@/db/defaults';
import { APP_VERSION } from '@/services/settingsService';

// jsdom does not implement matchMedia.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await db.transaction('rw', BACKUP_TABLES.map((name) => db.table(name)), async () => {
    await Promise.all(BACKUP_TABLES.map((name) => db.table(name).clear()));
  });
  await ensureSettings(APP_VERSION);
  await ensureDefaultTaxonomies();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
