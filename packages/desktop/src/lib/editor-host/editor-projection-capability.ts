/**
 * Editor-projection capability (SFE-P5b/SFE-P3e). Replaces
 * `getPlatform().buildEditorProjection`, `+page.svelte`'s only call site.
 *
 * Kept as its own small module — the "editor-projection slice next to the
 * editor-host code" the run specification names explicitly — even though
 * the forwarding itself is a pure 1:1 delegation with no marshalling: this
 * capability's D14 diagnostic contract (`EditorProjectionOutcome`) is worth
 * a stable, independently discoverable/testable seam of its own, next to
 * `desktop-document-host.ts` in this same directory.
 */
import { bridge } from "$lib/platform/bridge";
import type { EditorProjectionArgs, EditorProjectionOutcome } from "$lib/platform/contract";

/**
 * SFE-P3e — the desktop rich editor's plugin-aware projection, built
 * host-side (degrade-and-report — a plugin that fails to load is skipped,
 * reported in `pluginErrors`, and never blanks the projection). Resolves to
 * {@link EditorProjectionOutcome} — `ok: false` for the two classified
 * hard-failure shapes, never a rejection for either.
 */
export function buildEditorProjection(args: EditorProjectionArgs): Promise<EditorProjectionOutcome> {
  return bridge().buildEditorProjection(args);
}
