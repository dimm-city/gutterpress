/**
 * DetailsSectionController — the single owner of the Details section's state
 * + logic (title, authors, output filename, source files).
 *
 * The page size (#357) rides along as drafts: it is read back from the manifest
 * + stylesheet on load and written (both together) by the same Save button,
 * only when it actually changed.
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
 * (§8): the reactive `projectDir` accessor, the `readManifest` /
 * `writeManifest` host calls, and the `onSaved` / `onError` (toast) hooks.
 * `ProjectConfigFields` is a type-only import — ZERO `node:*` / lib value
 * imports.
 */

import type { PageSetup, PageSizeChoice, ProjectConfigFields } from "$lib/api";
import {
  pointsToInches,
  sizeChoiceFor,
  trimPoints,
  type PresetChoice,
} from "$lib/page-size-choices";
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
  /** Which of the print tools (`qpdf`/`gs`) are missing on this computer.
   *  Best-effort: a rejection just means no tool note is shown. */
  listMissingPrintTools?: () => Promise<string[]>;
  /** Read the book's page size from its manifest + stylesheet (#357). Optional:
   *  without it the section simply has no page-size control. */
  readPageSetup?: (projectDir: string) => Promise<PageSetup>;
  /** Write the page size to the manifest AND the stylesheet together (#357). */
  writePageSetup?: (projectDir: string, choice: PageSizeChoice) => Promise<PageSetup>;
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
  /** Editable publish-target selection (ADR 0008) — the destinations this
   *  book is validated against. Saved with the rest of the details. */
  targetsDraft = $state<string[]>([]);
  /** Tool ids (`qpdf`/`gs`) missing on this computer, for the note beside a
   *  checked destination that needs them. Empty when the probe failed. */
  missingTools = $state<string[]>([]);

  /** The page size as last read/saved, or null before the first read / when unavailable. */
  pageSetup = $state<PageSetup | null>(null);
  /** Editable "designed for" choice (the manifest preset). */
  presetDraft = $state<PresetChoice | null>(null);
  /** Editable size row + typed inches — meaningful for the `custom` preset. */
  sizeChoice = $state<string>("letter");
  widthIn = $state("");
  heightIn = $state("");

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
      this.targetsDraft = f.targets ?? [];
      await this.loadPageSetup(projectDir);
      this.scanOk = scan.ok;
      // Failed scan: fall back to the manifest's own entries as the universe
      // so they stay editable without every row being flagged "missing".
      this.allMarkdownFiles = scan.ok ? scan.files : (f.sourceFiles ?? []);
      this.sourceFiles = buildSourceList(this.allMarkdownFiles, f.sourceFiles ?? null);
      // Independent + best-effort: the tool probe must never fail the load.
      void this.deps
        .listMissingPrintTools?.()
        .then((tools) => {
          this.missingTools = tools;
        })
        .catch(() => {
          this.missingTools = [];
        });
    } catch (e) {
      this.detailsError = e instanceof Error ? e.message : String(e);
    }
  }

  // ── Page size (#357) ────────────────────────────────────────────────────────
  /** Best-effort: a failed read just leaves the page-size control out. */
  private async loadPageSetup(projectDir: string): Promise<void> {
    if (!this.deps.readPageSetup) return;
    try {
      this.applyPageSetup(await this.deps.readPageSetup(projectDir));
    } catch {
      this.pageSetup = null;
    }
  }

  /** Point the drafts at what is recorded; the size starts from the current bounds. */
  private applyPageSetup(setup: PageSetup): void {
    this.pageSetup = setup;
    this.presetDraft = setup.preset;
    const b = setup.bounds;
    this.sizeChoice = b ? sizeChoiceFor(b.width, b.height) : "letter";
    this.widthIn = b ? pointsToInches(b.width) : "";
    this.heightIn = b ? pointsToInches(b.height) : "";
  }

  /** What the drafts mean, or null while nothing is chosen / a custom trim is incomplete. */
  get pageChoice(): PageSizeChoice | null {
    if (!this.presetDraft) return null;
    if (this.presetDraft !== "custom") return { preset: this.presetDraft };
    const page = trimPoints(this.sizeChoice, this.widthIn, this.heightIn);
    return page ? { preset: "custom", page } : null;
  }

  /** True when a custom size was chosen but its width/height aren't both filled in. */
  get pageIncomplete(): boolean {
    return this.presetDraft === "custom" && this.pageChoice === null;
  }

  /**
   * Whether saving must write the page size: the choice differs from what is
   * recorded, or the stylesheet prints at a size other than the manifest's
   * (the two halves drifted — saving puts them back in step).
   */
  get pageDirty(): boolean {
    const setup = this.pageSetup;
    const choice = this.pageChoice;
    if (!setup || !choice) return false;
    if (choice.preset !== setup.preset) return true;
    const b = setup.bounds;
    if (choice.preset === "custom" && choice.page) {
      if (!b || Math.abs(b.width - choice.page.width) >= 0.5 || Math.abs(b.height - choice.page.height) >= 0.5) {
        return true;
      }
    }
    const css = setup.css;
    return !!css && !!b && (Math.abs(css.width - b.width) >= 0.5 || Math.abs(css.height - b.height) >= 0.5);
  }

  setPreset = (preset: PresetChoice): void => {
    this.presetDraft = preset;
  };

  // ── Publish-target intents (ADR 0008) ───────────────────────────────────────
  toggleTarget = (id: string): void => {
    this.targetsDraft = this.targetsDraft.includes(id)
      ? this.targetsDraft.filter((t) => t !== id)
      : [...this.targetsDraft, id];
  };

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
    if (this.pageIncomplete) {
      this.detailsError = "Enter a width and height for your custom page size.";
      return;
    }
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
        // Always sent, empty included: `targets: []` is the explicit "no
        // destination policies" opt-out, not an omission.
        targets: [...this.targetsDraft],
      });
      this.fields = out;
      const choice = this.pageChoice;
      if (choice && this.pageDirty && this.deps.writePageSetup) {
        this.applyPageSetup(await this.deps.writePageSetup(projectDir, choice));
      }
      this.deps.onSaved?.();
    } catch (e) {
      this.detailsError = e instanceof Error ? e.message : String(e);
      this.deps.onError?.(`Could not save details: ${this.detailsError}`);
    } finally {
      this.detailsSaving = false;
    }
  };
}
