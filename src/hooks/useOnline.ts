import { useEffect, useState } from 'react';

/**
 * Online/offline status.
 *
 * This reflects `navigator.onLine` only. It is deliberately NOT called "sync status":
 * the app keeps no server in the loop, so there is nothing to synchronise.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}
