/**
 * DetailsSectionController — the single owner of the Details section's state
 * + logic that used to live inline in `ProjectConfigPanel.svelte` (title,
 * authors, output filename, source files — manifest fields with no prior
 * writer before #PCV).
 *
 * Centralises the read manifest subset (`fields`), the four editable drafts
 * (`titleDraft` / `authorsDraft` / `sourceDraft`), the
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
import {
  buildSourceList,
  moveEntry,
  setIncluded,
  toManifestFiles,
  type SourceFileEntry,
} from "$lib/components/config/source-files";

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
  /** List the project's markdown files (project-relative paths) — the
   *  universe the source-files include/exclude list is built from. */
  listMarkdownFiles: (projectDir: string) => Promise<string[]>;
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
  /** Editable author-name drafts, one per row. */
  authorsDraft = $state<string[]>([]);
  /** The source-files list: every project markdown file, ordered, each row
   *  included or excluded (the DnD editor's model — see source-files.ts). */
  sourceFiles = $state<SourceFileEntry[]>([]);

  /** The markdown files found on disk at load time (toManifestFiles's
   *  "is this the all-files default?" reference). */
  private allMarkdownFiles: string[] = [];
  /** False when the file scan failed — then the list edits only ever produce
   *  an explicit manifest (never the "all files" null sentinel), so a blind
   *  save can't silently widen the book to files we couldn't see. */
  private scanOk = false;
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
      const [f, scan] = await Promise.all([
        this.deps.readManifest(projectDir),
        this.deps
          .listMarkdownFiles(projectDir)
          .then((files) => ({ ok: true, files }))
          .catch(() => ({ ok: false, files: [] as string[] })),
      ]);
      this.fields = f;
      this.titleDraft = f.title ?? "";
      this.authorsDraft = f.authors ?? [];
      this.scanOk = scan.ok;
      // Failed scan: fall back to the manifest's own entries as the universe
      // so they stay editable without every row being flagged "missing".
      this.allMarkdownFiles = scan.ok ? scan.files : (f.sourceFiles ?? []);
      this.sourceFiles = buildSourceList(this.allMarkdownFiles, f.sourceFiles ?? null);
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

  // ── Source-files intents (DnD reorder + include/exclude) ─────────────────────
  moveSourceFile = (from: number, to: number): void => {
    this.sourceFiles = moveEntry(this.sourceFiles, from, to);
  };

  setSourceIncluded = (i: number, included: boolean): void => {
    this.sourceFiles = setIncluded(this.sourceFiles, i, included);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  saveDetails = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    const trimmedAuthors = this.authorsDraft.map((a) => a.trim()).filter((a) => a.length > 0);
    this.detailsSaving = true;
    this.detailsError = null;
    try {
      const included = this.sourceFiles.filter((e) => e.included).map((e) => e.path);
      // Only a successful scan may collapse to the "all files" null sentinel —
      // without the true universe that collapse could silently widen the book.
      const src = this.scanOk
        ? toManifestFiles(this.sourceFiles, this.allMarkdownFiles)
        : included.length > 0
          ? included
          : null;
      const out = await this.deps.writeManifest(projectDir, {
        title: this.titleDraft.trim(),
        authors: trimmedAuthors,
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
