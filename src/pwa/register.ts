/**
 * pwa/register.ts — Service worker registration with a safe update flow.
 *
 * Strategy: `prompt`. When a new version is cached, the running tab is NOT reloaded
 * automatically (that could interrupt someone halfway through entering an order).
 * The UI shows a Bengali banner and the user chooses when to reload.
 */

export interface RegisterOptions {
  onNeedRefresh: (applyUpdate: () => void) => void;
  onOfflineReady: () => void;
}

export function registerServiceWorker({ onNeedRefresh, onOfflineReady }: RegisterOptions): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;

  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          onNeedRefresh(() => void updateSW(true));
        },
        onOfflineReady() {
          onOfflineReady();
        },
      });
    })
    .catch(() => {
      /* Service worker registration is best-effort; the app still works without it. */
    });
}
