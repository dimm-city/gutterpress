/**
 * The app Settings view's tab contract, shared by `SettingsView.svelte` and
 * `+page.svelte`'s `openSettings()`.
 *
 * `sanitizeSettingsTab` exists because "open settings" entry points are plain
 * DOM click handlers: a call site written `onclick={onOpenSettings}` hands the
 * MouseEvent to `openSettings(tab)`, and an unchecked value would become the
 * active tab id — matching no tab, rendering an EMPTY settings body (the
 * 2026-07-22 owner report). Every value that is not a known tab id collapses
 * to the default "app" tab, at both ends of the hand-off (see
 * tests/platform/settings-tabs.test.ts).
 */

export const SETTINGS_TAB_IDS = ["app", "editor", "saving", "connections", "advanced"] as const;

export type SettingsTab = (typeof SETTINGS_TAB_IDS)[number];

/** Collapse any unknown value to a real tab id (default "app"). */
export function sanitizeSettingsTab(value: unknown): SettingsTab {
  return SETTINGS_TAB_IDS.includes(value as SettingsTab) ? (value as SettingsTab) : "app";
}
