/**
 * format-prefs.ts — the app-wide number-formatting preference.
 *
 * `formatMoney` / `formatDate` are pure functions called from ~180 places, so
 * they cannot each reach into app settings. Instead AppContext pushes the
 * user's choice into this tiny module whenever settings change, and the
 * formatters use it as their default.
 *
 * The initial value matches the shipped default in `db/defaults.ts`
 * (`locale.bengaliDigits: true`) so the very first paint — before settings have
 * loaded from IndexedDB — already looks the same as it will afterwards.
 */

let bengaliDigits = true;

/** Called by AppContext whenever settings are loaded or saved. */
export function setFormatPreference(next: { bengaliDigits: boolean }): void {
  bengaliDigits = next.bengaliDigits;
}

/** Default used by `formatMoney` and `formatDate` when a caller passes nothing. */
export function prefersBengaliDigits(): boolean {
  return bengaliDigits;
}

/** Test helper: put the preference back to the shipped default. */
export function resetFormatPreference(): void {
  bengaliDigits = true;
}
