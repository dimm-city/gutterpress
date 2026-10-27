/**
 * DetailsSectionController — the single owner of the Details section's state
 * + logic (title, authors, chapters, page size, publish targets).
 *
 * Details saves as you go — there is no Save button. A choice (preset,
 * target, chapter order, remove author) commits at once; a text field (title,
 * author) commits when the view reports `change` (blur or Enter) through
 * `flushPendingSave`, which the panel also calls on tab switch, close and
 * unmount so nothing typed is lost (it resolves to false when the write
 * failed, so close can keep the panel open on the error). Each commit writes
 * only what differs from the manifest as last read (`fields`): a title edit
 * never rewrites `targets` or the page geometry. The page size and margins
 * (#357) live in the manifest alone and are written only when their own
 * controls were touched (`pageTouched` / `marginsTouched`, set as soon as a
 * value is typed), so a change to them is never a side effect of an unrelated
 * edit; margins a book does not set yet are shown as its stylesheets give them
 * and recorded in the manifest the first time the author changes one.
 *
 * Publish targets: a manifest with no `targets:` key shows the preset's
 * default (dtrpg → DriveThruRPG) and keeps following the preset until the
 * author touches a checkbox; only then (or when the key already exists) is
 * `targets` written, empty included (`targets: []` is the explicit opt-out).
 *
 * Single-owner discipline mirrors `DesignSectionController`
 * (`design-section-controller.svelte.ts`): the component reads the public
 * rune fields directly (including via `bind:value={controller.titleDraft}`
 * for the plain-text drafts) and calls the intent methods. Overlapping
 * commits are serialized on `saveChain` (Design's `commitChain` pattern) so a
 * flush during an in-flight save runs after it and sees its result.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8): the reactive `projectDir` accessor, the `readManifest` /
 * `writeManifest` / page-setup host calls, and the `onError` (toast) hook.
 * `ProjectConfigFields` is a type-only import — ZERO `node:*` / lib value
 * imports.
 */

import type { PageMargins, PageSetup, PageSizeChoice, ProjectConfigFields } from "#lib/api.ts";
import {
  PT_PER_INCH,
  pointsToInches,
  sizeChoiceFor,
  trimPoints,
  type PresetChoice,
} from "#lib/page-size-choices.ts";
import { defaultTargetsFor } from "#lib/publish-targets.ts";
import {
  buildSourceList,
  moveEntry,
  naturalOrder,
  setIncluded,
  toManifestFiles,
  type SourceFileEntry,
} from "#lib/components/config/source-files.ts";

export interface DetailsSectionDeps {
  /** The open project directory (reactive prop), or null when none is open. */
  projectDir: () => string | null;
  /** Read the author-facing manifest subset. */
  readManifest: (projectDir: string) => Promise<ProjectConfigFields>;
  /** Apply manifest field updates (one yaml round-trip; only the keys present
   *  are written); returns the saved state. */
  writeManifest: (
    projectDir: string,
    updates: ProjectConfigFields,
  ) => Promise<ProjectConfigFields>;
  /** List the project's markdown files (project-relative paths) — the
   *  universe the chapters include/exclude list is built from. */
  listMarkdownFiles: (projectDir: string) => Promise<string[]>;
  /** Which of the print tools (`qpdf`/`gs`) are missing on this computer.
   *  Best-effort: a rejection just means no tool note is shown. */
  listMissingPrintTools?: () => Promise<string[]>;
  /** Read the book's page geometry from its manifest (#357). Optional: without
   *  it the section simply has no page-size or margin controls. */
  readPageSetup?: (projectDir: string) => Promise<PageSetup>;
  /** Write the page size, and the margins when the choice carries them, to the manifest (#357). */
  writePageSetup?: (projectDir: string, choice: PageSizeChoice) => Promise<PageSetup>;
  /** Fired after a load/save failure (the panel wires this to a toast). */
  onError?: (message: string) => void;
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export const MARGIN_EDGES = ["top", "bottom", "inside", "outside"] as const;
export type MarginEdge = (typeof MARGIN_EDGES)[number];

/** Round to 3dp so 0.85in lands as 61.2pt, not 61.199999999999996. */
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Typed inches -> points, or null while the text is not a margin (empty, not a number, negative). */
function marginPoints(inches: string): number | null {
  if (inches.trim() === "") return null;
  const n = Number(inches);
  return Number.isFinite(n) && n >= 0 ? round3(n * PT_PER_INCH) : null;
}

const sameMargins = (a: PageMargins, b: PageMargins): boolean =>
  MARGIN_EDGES.every((edge) => Math.abs(a[edge] - b[edge]) < 0.01);

export class DetailsSectionController {
  // ── Public rune state (read by the template; mutated only via methods) ──────
  /** The manifest subset as last read/saved from disk. */
  fields = $state<ProjectConfigFields>({});
  /** The save badge: idle until something is written, then saving → saved. */
  detailsSaveStatus = $state<"idle" | "saving" | "saved">("idle");
  /** Last load/save error, or null. */
  detailsError = $state<string | null>(null);
  /** Editable title draft — bound directly from the template. */
  titleDraft = $state("");
  /** Editable author-name drafts, one per row. */
  authorsDraft = $state<string[]>([]);
  /** The chapters list: every project markdown file, ordered, each row
   *  included or excluded (the DnD editor's model — see source-files.ts). */
  sourceFiles = $state<SourceFileEntry[]>([]);
  /** Editable publish-target selection (ADR 0008) — the destinations this
   *  book is validated against. */
  targetsDraft = $state<string[]>([]);
  /** Tool ids (`qpdf`/`gs`) missing on this computer, for the note beside a
   *  checked destination that needs them. Empty when the probe failed. */
  missingTools = $state<string[]>([]);

  /** The page geometry as last read/saved, or null before the first read / when unavailable. */
  pageSetup = $state<PageSetup | null>(null);
  /** Editable "designed for" choice (the manifest preset). */
  presetDraft = $state<PresetChoice | null>(null);
  /** Editable size row + typed inches — meaningful for the `custom` preset. */
  sizeChoice = $state<string>("letter");
  widthIn = $state("");
  heightIn = $state("");
  /** Editable margins, typed in inches, one per edge (`inside` is the binding edge). */
  marginDrafts = $state<Record<MarginEdge, string>>({ top: "", bottom: "", inside: "", outside: "" });

  /** The markdown files found on disk at load time (toManifestFiles's
   *  "is this the all-files default?" reference). */
  private allMarkdownFiles: string[] = [];
  /** False when the file scan failed — then the list edits only ever produce
   *  an explicit manifest (never the "all files" null sentinel), so a blind
   *  save can't silently widen the book to files we couldn't see. */
  private scanOk = false;
  /** True once the manifest has a `targets:` key or the author touched a
   *  checkbox; until then the draft follows the preset's default and is
   *  never written. */
  private targetsExplicit = false;
  /** True when a page-size control was touched since the last page write. */
  private pageTouched = false;
  /** True when a margin field was touched since the last page write: the
   *  margins are the author's to record from then on. */
  private marginsTouched = false;
  /** The book `fields` and the drafts belong to, set only once a load has
   *  filled every one of them. A commit is bound to it: a flush during a
   *  load (the drafts still empty) writes nothing, and the unmount flush can
   *  run after the host has moved to another book, where drafts diffed
   *  against THIS book's fields must never land. */
  private loadedDir: string | null = null;
  private saveChain: Promise<boolean> = Promise.resolve(true);
  private readonly deps: DetailsSectionDeps;

  constructor(deps: DetailsSectionDeps) {
    this.deps = deps;
  }

  // ── Load ────────────────────────────────────────────────────────────────────
  async loadDetails(): Promise<void> {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    this.detailsError = null;
    this.loadedDir = null;
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
      await this.loadPageSetup(projectDir);
      this.targetsExplicit = f.targets !== undefined;
      this.targetsDraft = f.targets ?? defaultTargetsFor(this.pageSetup?.preset ?? null);
      this.pageTouched = false;
      this.marginsTouched = false;
      this.detailsSaveStatus = "idle";
      this.scanOk = scan.ok;
      // Failed scan: fall back to the manifest's own entries as the universe
      // so they stay editable without every row being flagged "missing".
      this.allMarkdownFiles = scan.ok ? scan.files : (f.sourceFiles ?? []);
      this.sourceFiles = buildSourceList(this.allMarkdownFiles, f.sourceFiles ?? null);
      // Last: every field a commit diffs is now this book's.
      this.loadedDir = projectDir;
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

  // ── Page size and margins (#357) ────────────────────────────────────────────
  /** Best-effort: a failed read just leaves the page-size and margin controls out. */
  private async loadPageSetup(projectDir: string): Promise<void> {
    if (!this.deps.readPageSetup) return;
    try {
      this.applyPageSetup(await this.deps.readPageSetup(projectDir));
    } catch {
      this.pageSetup = null;
    }
  }

  /** Point the drafts at what is recorded; the size starts from the current bounds, the margins from what the book prints with. */
  private applyPageSetup(setup: PageSetup): void {
    this.pageSetup = setup;
    this.presetDraft = setup.preset;
    const b = setup.bounds;
    this.sizeChoice = b ? sizeChoiceFor(b.width, b.height) : "letter";
    this.widthIn = b ? pointsToInches(b.width) : "";
    this.heightIn = b ? pointsToInches(b.height) : "";
    for (const edge of MARGIN_EDGES) this.marginDrafts[edge] = pointsToInches(setup.margins[edge]);
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

  /** The typed margins in points, or null while any edge is empty or not a margin. */
  get marginsChoice(): PageMargins | null {
    const out: Partial<PageMargins> = {};
    for (const edge of MARGIN_EDGES) {
      const pt = marginPoints(this.marginDrafts[edge]);
      if (pt === null) return null;
      out[edge] = pt;
    }
    return out as PageMargins;
  }

  /** True when a margin was edited but the four edges are not all filled in. */
  get marginsIncomplete(): boolean {
    return this.marginsTouched && this.marginsChoice === null;
  }

  /**
   * Whether a page write has something to do: the choice differs from what is
   * recorded, or the margins the author typed differ from those the book
   * prints with.
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
    const margins = this.marginsTouched ? this.marginsChoice : null;
    return !!margins && !sameMargins(margins, setup.margins);
  }

  /** Choose a preset: the targets follow it while the manifest has none of its own. */
  setPreset = (preset: PresetChoice): void => {
    this.presetDraft = preset;
    if (!this.targetsExplicit) this.targetsDraft = defaultTargetsFor(preset);
    void this.flushPendingSave({ page: true });
  };

  /** A size field was typed in: the size is the author's to write from now on,
   *  so a close before the field's `change` still saves it (once complete). */
  touchPage = (): void => {
    this.pageTouched = true;
  };

  /** A margin field was typed in: the margins are the author's to record from
   *  now on (in the manifest, over whatever a stylesheet gave), once complete. */
  touchMargins = (): void => {
    this.marginsTouched = true;
  };

  // ── Publish-target intents (ADR 0008) ───────────────────────────────────────
  toggleTarget = (id: string): void => {
    this.targetsDraft = this.targetsDraft.includes(id)
      ? this.targetsDraft.filter((t) => t !== id)
      : [...this.targetsDraft, id];
    this.targetsExplicit = true;
    void this.flushPendingSave();
  };

  // ── Author-list intents ──────────────────────────────────────────────────────
  /** A new, empty row — nothing to write until a name is typed (an empty row trims away). */
  addAuthor = (): void => {
    this.authorsDraft = [...this.authorsDraft, ""];
  };

  removeAuthor = (i: number): void => {
    this.authorsDraft = this.authorsDraft.filter((_, idx) => idx !== i);
    void this.flushPendingSave();
  };

  /** Draft only: the row's `change` (blur or Enter) commits it. */
  setAuthor = (i: number, v: string): void => {
    this.authorsDraft = this.authorsDraft.map((a, idx) => (idx === i ? v : a));
  };

  // ── Chapter intents (DnD reorder + include/exclude) ──────────────────────────
  moveSourceFile = (from: number, to: number): void => {
    this.sourceFiles = moveEntry(this.sourceFiles, from, to);
    void this.flushPendingSave();
  };

  setSourceIncluded = (i: number, included: boolean): void => {
    this.sourceFiles = setIncluded(this.sourceFiles, i, included);
    void this.flushPendingSave();
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  /**
   * Write whatever differs from the manifest as last read. `page: true` marks
   * the page-size controls as touched and `margins: true` the margin fields,
   * so the page geometry is written too when it changed. Chained after any
   * in-flight commit, so two flushes never interleave and the later one sees
   * the earlier one's result. Resolves to false when the write failed (the
   * drafts are kept), true otherwise.
   */
  flushPendingSave = (opts?: { page?: boolean; margins?: boolean }): Promise<boolean> => {
    if (opts?.page) this.pageTouched = true;
    if (opts?.margins) this.marginsTouched = true;
    this.saveChain = this.saveChain.then(() => this.commitChanges());
    return this.saveChain;
  };

  private async commitChanges(): Promise<boolean> {
    const projectDir = this.deps.projectDir();
    if (!projectDir || projectDir !== this.loadedDir) return true;
    const updates: ProjectConfigFields = {};
    const title = this.titleDraft.trim();
    if (title !== (this.fields.title ?? "")) updates.title = title;
    const authors = this.authorsDraft.map((a) => a.trim()).filter((a) => a.length > 0);
    if (!sameList(authors, this.fields.authors ?? [])) updates.authors = authors;
    // Compare what the two sides MEAN, not how they are spelled: an explicit
    // list that equals natural order (every scaffolded book lists its one
    // chapter) and the absent-list default name the same chapters, so an
    // untouched flush must not rewrite one as the other.
    const included = this.sourceFiles.filter((e) => e.included).map((e) => e.path);
    const recorded = this.fields.sourceFiles ?? naturalOrder(this.allMarkdownFiles);
    if (!sameList(included, recorded)) {
      // Only a successful scan may collapse to the "all files" null sentinel —
      // without the true universe that collapse could silently widen the book.
      updates.sourceFiles = this.scanOk
        ? toManifestFiles(this.sourceFiles, this.allMarkdownFiles)
        : included.length > 0
          ? included
          : null;
    }
    // Written only once explicit, empty included: `targets: []` is the
    // explicit "no destination policies" opt-out, not an omission. A manifest
    // with no key yet gets one on the first touch, whatever the selection.
    if (this.targetsExplicit) {
      const recorded = this.fields.targets;
      if (recorded === undefined || !sameList(this.targetsDraft, recorded)) {
        updates.targets = [...this.targetsDraft];
      }
    }
    const choice = this.pageChoice;
    // Margins ride along only once the author touched them; until then the
    // manifest's stay as they are (or stay absent, leaving the stylesheets').
    const margins = this.marginsTouched ? this.marginsChoice : null;
    const touched = { page: this.pageTouched, margins: this.marginsTouched };
    const writePage =
      (touched.page || touched.margins) &&
      !!choice &&
      this.pageDirty &&
      !this.pageIncomplete &&
      !this.marginsIncomplete &&
      !!this.deps.writePageSetup;
    const hasUpdates = Object.keys(updates).length > 0;
    if (!hasUpdates && !writePage) return true;
    // Consumed by this write (an incomplete size or margin stays pending); a
    // value typed while the write is in flight marks it again.
    if (writePage) this.pageTouched = this.marginsTouched = false;
    this.detailsSaveStatus = "saving";
    this.detailsError = null;
    try {
      if (hasUpdates) this.fields = await this.deps.writeManifest(projectDir, updates);
      if (writePage) {
        const setup = await this.deps.writePageSetup!(projectDir, margins ? { ...choice!, margins } : choice!);
        // Re-base the drafts on what was written, unless the author changed
        // them meanwhile: those stay as typed, for the next flush to write.
        if (this.pageTouched || this.marginsTouched) this.pageSetup = setup;
        else this.applyPageSetup(setup);
      }
      this.detailsSaveStatus = "saved";
      return true;
    } catch (e) {
      if (writePage) {
        this.pageTouched ||= touched.page;
        this.marginsTouched ||= touched.margins;
      }
      // The drafts stay as typed, so the author can retry; the error says why.
      this.detailsError = e instanceof Error ? e.message : String(e);
      this.deps.onError?.(`Could not save details: ${this.detailsError}`);
      this.detailsSaveStatus = "idle";
      return false;
    }
  }
}
