/**
 * Pure "already added" helper for the Extensions tab's bundled Add rows
 * (`ExtensionsSectionController.availableBundled`).
 *
 * Kept separate so the rule is unit-testable on its own. `import type` only,
 * so this stays PWA-clean (§8).
 */
import type { ProjectExtensionEntry } from "#lib/platform/dtos.ts";

/**
 * The ids of the built-in looks a book still carries as COPIES: a path entry
 * at `./extensions/<id>`, the folder older Gutterpress versions copied a
 * built-in look into. A bundled look is listed by its bare name today, but a
 * book with such a copy must not be offered the same look a second time.
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
