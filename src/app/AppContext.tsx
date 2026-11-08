import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getSettings } from '@/services/settingsService';
import type { Settings } from '@/domain/types';
import { setFormatPreference } from '@/lib/format-prefs';

interface AppContextValue {
  /** Bumped after every mutation so list queries refetch. */
  version: number;
  refresh: () => void;
  settings: Settings | null;
  refreshSettings: () => Promise<void>;
  updateSettingsLocal: (settings: Settings) => void;
  /** PIN lock state. A PIN never encrypts the database — it only gates the UI. */
  locked: boolean;
  unlock: () => void;
  lock: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [locked, setLocked] = useState(false);
  const [pinInitialised, setPinInitialised] = useState(false);

  const refreshSettings = useCallback(async () => {
    setSettings(await getSettings());
  }, []);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings, version]);

  // Push the number-format choice into the pure formatters so every screen
  // (not just the dashboard) shows digits the way the seller asked for.
  //
  // This runs during render, NOT inside an effect: child effects fire before
  // parent effects, so an effect here would let every screen paint once with
  // the module default and never correct itself on a cold page load.
  if (settings) {
    setFormatPreference({ bengaliDigits: settings.locale?.bengaliDigits ?? true });
  }

  // Apply the PIN gate once settings are known (on every app start / reload).
  useEffect(() => {
    if (!settings || pinInitialised) return;
    setLocked(Boolean(settings.security?.pinEnabled));
    setPinInitialised(true);
  }, [settings, pinInitialised]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const value = useMemo<AppContextValue>(
    () => ({
      version,
      refresh,
      settings,
      refreshSettings,
      updateSettingsLocal: (next: Settings) => setSettings(next),
      locked,
      unlock: () => setLocked(false),
      lock: () => setLocked(true),
    }),
    [version, refresh, settings, refreshSettings, locked],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used inside <AppProvider>');
  return ctx;
}

/** Refresh-dependent query hook key. Add `version` to any query deps. */
export function useDataVersion(): number {
  return useAppContext().version;
}
