/**
 * Stub for `virtual:pwa-register`.
 *
 * The real module only exists when vite-plugin-pwa is running (production build / dev
 * server). Tests import the app without that plugin, so the virtual module is aliased to
 * this harmless stand-in: no service worker is registered in tests.
 */
export function registerSW(_options?: {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
}): (reloadPage?: boolean) => Promise<void> {
  return () => Promise.resolve();
}
