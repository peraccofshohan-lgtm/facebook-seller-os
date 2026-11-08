import { defineWorkspace } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  // `virtual:pwa-register` only exists when vite-plugin-pwa runs; tests use a stub.
  'virtual:pwa-register': fileURLToPath(new URL('./tests/setup/pwa-stub.ts', import.meta.url)),
};
const define = { __APP_VERSION__: JSON.stringify('1.0.0-test') };

/**
 * Test projects (Vitest workspace).
 *
 * - unit:        pure functions only — no DOM, no database.
 * - integration: services + Dexie against a real IndexedDB implementation (fake-indexeddb).
 * - ui:          React tree rendered in jsdom.
 */
export default defineWorkspace([
  {
    resolve: { alias },
    define,
    test: {
      name: 'unit',
      environment: 'node',
      include: ['tests/unit/**/*.test.ts'],
      globals: true,
    },
  },
  {
    resolve: { alias },
    define,
    test: {
      name: 'integration',
      environment: 'node',
      include: ['tests/integration/**/*.test.ts'],
      setupFiles: ['tests/setup/integration.ts'],
      globals: true,
      testTimeout: 30000,
      hookTimeout: 30000,
    },
  },
  {
    resolve: { alias },
    define,
    test: {
      name: 'ui',
      environment: 'jsdom',
      include: ['tests/ui/**/*.test.tsx'],
      setupFiles: ['tests/setup/ui.ts'],
      globals: true,
      testTimeout: 30000,
    },
  },
]);
