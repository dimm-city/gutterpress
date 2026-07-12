/**
 * DetailsSectionController — the single owner of the Details section's state
 * + logic that used to live inline in `ProjectConfigPanel.svelte` (title,
 * authors, output filename, source files — manifest fields with no prior
 * writer before #PCV).
 *
 * Centralises the read manifest subset (`fields`), the four editable drafts
 * (`titleDraft` / `outputDraft` / `authorsDraft` / `sourceDraft`), the
 * load/save flags, and the author-list array intents (`addAuthor` /
 * `removeAuthor` / `setAuthor`).
 *
 * Single-owner discipline mirrors `DesignSectionController`
 * (`design-section-controller.svelte.ts`): the component reads the public
 * rune fields directly (including via `bind:value={controller.titleDraft}`
 * for the plain-text drafts) and calls the intent methods.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8 / ADR 0004): the reactive `projectDir` accessor, the `readManifest` /
 * `writeManifest` host calls, and the `onSaved` / `onError` (toast) hooks.
 * `ProjectConfigFields` is a type-only import — ZERO `node:*` / lib value
 * imports.
 */

import type { ProjectConfigFields } from "$lib/api";

export interface DetailsSectionDeps {
  /** The open project directory (reactive prop), or null when none is open. */
  projectDir: () => string | null;
  /** Read the author-facing manifest subset. */
  readManifest: (projectDir: string) => Promise<ProjectConfigFields>;
  /** Apply manifest field updates (one yaml round-trip); returns the saved state. */
  writeManifest: (
    projectDir: string,
    updates: ProjectConfigFields,
  ) => Promise<ProjectConfigFields>;
  /** Fired after a successful save (the panel wires this to a toast). */
  onSaved?: () => void;
  /** Fired after a load/save failure (the panel wires this to a toast). */
  onError?: (message: string) => void;
}

export class DetailsSectionController {
  // ── Public rune state (read by the template; mutated only via methods) ──────
  /** The manifest subset as last read/saved from disk. */
  fields = $state<ProjectConfigFields>({});
  /** True while a save round-trip is in flight. */
  detailsSaving = $state(false);
  /** Last load/save error, or null. */
  detailsError = $state<string | null>(null);
  /** Editable title draft — bound directly from the template. */
  titleDraft = $state("");
  /** Editable output-filename draft — bound directly from the template. */
  outputDraft = $state("");
  /** Editable author-name drafts, one per row. */
  authorsDraft = $state<string[]>([]);
  /** Editable source-files draft — one path per line, textarea-bound. */
  sourceDraft = $state("");

  private readonly deps: DetailsSectionDeps;

  constructor(deps: DetailsSectionDeps) {
    this.deps = deps;
  }

  // ── Load ────────────────────────────────────────────────────────────────────
  async loadDetails(): Promise<void> {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    this.detailsError = null;
    try {
      const f = await this.deps.readManifest(projectDir);
      this.fields = f;
      this.titleDraft = f.title ?? "";
      this.outputDraft = f.outputFilename ?? "";
      this.authorsDraft = f.authors ?? [];
      this.sourceDraft = (f.sourceFiles ?? []).join("\n");
    } catch (e) {
      this.detailsError = e instanceof Error ? e.message : String(e);
    }
  }

  // ── Author-list intents ──────────────────────────────────────────────────────
  addAuthor = (): void => {
    this.authorsDraft = [...this.authorsDraft, ""];
  };

  removeAuthor = (i: number): void => {
    this.authorsDraft = this.authorsDraft.filter((_, idx) => idx !== i);
  };

  setAuthor = (i: number, v: string): void => {
    this.authorsDraft = this.authorsDraft.map((a, idx) => (idx === i ? v : a));
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  saveDetails = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    const trimmedAuthors = this.authorsDraft.map((a) => a.trim()).filter((a) => a.length > 0);
    const sourceLines = this.sourceDraft
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    this.detailsSaving = true;
    this.detailsError = null;
    try {
      const src = sourceLines.length === 0 ? null : sourceLines;
      const out = await this.deps.writeManifest(projectDir, {
        title: this.titleDraft.trim(),
        authors: trimmedAuthors,
        outputFilename: this.outputDraft.trim(),
        sourceFiles: src,
      });
      this.fields = out;
      this.deps.onSaved?.();
    } catch (e) {
      this.detailsError = e instanceof Error ? e.message : String(e);
      this.deps.onError?.(`Could not save details: ${this.detailsError}`);
    } finally {
      this.detailsSaving = false;
    }
  };
}
