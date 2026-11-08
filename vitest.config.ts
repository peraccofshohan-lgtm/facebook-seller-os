import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

/**
 * Shared Vitest settings.
 *
 * Concrete test projects live in `vitest.workspace.ts` (Vitest 2 workspace API):
 * unit (pure functions), integration (services + IndexedDB) and ui (jsdom).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify('1.0.0-test'),
  },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
