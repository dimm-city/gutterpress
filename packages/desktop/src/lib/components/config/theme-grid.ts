/**
 * Pure built-in-look grid helper for LookSection.svelte.
 *
 * Extracted so the "already added" rule is unit-testable without a Svelte
 * component test harness (none exists in this repo — see CLAUDE.md test
 * conventions). `import type` only, so this stays PWA-clean (§8).
 */
import type { ProjectExtensionEntry } from "$lib/platform/dtos";

/**
 * The ids of the built-in looks already in the project's list: a path entry
 * at `./extensions/<id>`, the folder `addBuiltInStyleSet` copies a built-in
 * into (#265). The grid shows such a look as added instead of offering "Use"
 * again — a second Use is a no-op by lib contract (the folder is kept, only
 * re-referenced), but offering it would still suggest the author's edited
 * copy might be replaced. Removing the entry makes "Use" reappear, and since
 * the folder stays on disk, Use then re-references the author's own edited
 * copy rather than a fresh one.
 */
export function addedBuiltInIds(entries: ProjectExtensionEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const e of entries) {
    if (e.kind !== "path") continue;
    const m = e.use
      .trim()
      .replace(/\\/g, "/")
      .replace(/\/+$/, "")
      .match(/^\.\/extensions\/([^/]+)$/);
    if (m) ids.add(m[1]!);
  }
  return ids;
}
