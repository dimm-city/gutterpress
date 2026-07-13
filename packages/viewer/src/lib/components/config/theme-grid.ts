/**
 * Pure Appearance-grid helpers for AppearanceSection.svelte (UX review M6).
 *
 * Extracted so the dedupe rule is unit-testable without a Svelte component
 * test harness (none exists in this repo — see CLAUDE.md test conventions).
 * `import type` only from `$lib/api`, so this stays PWA-clean (§8).
 */
import type { ThemeInfo } from "$lib/api";

/**
 * The Appearance grid used to render BOTH the built-in card and the
 * project's own copy of the same theme (created by a prior Apply/import).
 * Applying the built-in twin then re-copied its pristine files over the
 * project copy — silently discarding any Design-panel customizations
 * (UX review M6). Fix: once a project theme with a given id exists, hide the
 * built-in card for that id — the project copy (and its "Remove" control) is
 * the one true entry for that theme from then on. Removing the project copy
 * makes the pristine built-in card reappear.
 *
 * This alone closes the destructive path from the grid: the only route to
 * `applyTheme({ kind: "builtin" })` is a built-in card's Apply button, and
 * that card is never shown once a same-id project copy exists. (The
 * theme-manager API also refuses to clobber an existing project copy on its
 * own, as a defense-in-depth backstop for callers outside this grid.)
 */
export function visibleBuiltInThemes(
  builtIns: ThemeInfo[],
  projectThemes: ThemeInfo[],
): ThemeInfo[] {
  const projectIds = new Set(projectThemes.map((t) => t.id));
  return builtIns.filter((t) => !projectIds.has(t.id));
}
