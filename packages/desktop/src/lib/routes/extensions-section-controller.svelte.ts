/**
 * ExtensionsSectionController (#243, #265) — the single owner of the
 * Extensions surface's state: ONE list (`entries` — the manifest's
 * `extensions:` in cascade order) that the Look tab and the Features tab are
 * two VIEWS over (`looks` / `features`), and ONE verb set (add, remove,
 * toggle, move) both views call.
 *
 * #265 collapsed the two rails. A look is an extension that carries styles; a
 * feature is one that carries markdown; a component library carries both and
 * appears in BOTH views — the same row, the same toggle, the same remove.
 * There is no apply/revert and no "active look": any number of looks can be
 * on at once, the list order is the CSS cascade (later wins ties) and the
 * markdown registration order, and the project's own stylesheets always load
 * last. Reordering therefore rewrites the whole list: a move inside one view
 * is a move past that entry's neighbour IN THAT VIEW, expressed as the full
 * `use` order the lib insists on (`config-helpers.ts`'s `orderAfterMove`).
 *
 * Adding is one verb with four ways to NAME the extension, which differ only
 * in what the host does with the name:
 *   - `addNpm` / `addRecommended` — a bundled feature name (written as-is)
 *     or an npm specifier (downloaded, verified, vendored, pinned — behind
 *     the native trust gate, so a null result means "the author cancelled");
 *   - `addLocal` — a folder or plugin file from the native picker,
 *     referenced in place, never copied;
 *   - `useBuiltIn` — a built-in look, the one thing that IS copied (into
 *     `extensions/<id>/`, so the look becomes the author's own editable
 *     files), then referenced as `./extensions/<id>`;
 *   - `importFile` / `importUrl` — a `.zip`, `.css`, or URL package the host
 *     validates and lands in `extensions/<id>/` (#106).
 *
 * Removal never touches the author's files (a path entry's folder stays; an
 * npm entry's vendored copy — Gutterpress's own — is deleted), so it is a
 * single click, not the two-step confirm the old rm -rf'ing theme removal
 * needed (UX review M7).
 *
 * Same single-owner discipline as every other `*SectionController`: the two
 * components read the public rune fields and call the intent methods; host
 * coupling is injected so this stays testable with fakes and PWA-clean (§8 /
 * ADR 0004) — type-only DTO imports plus the pure helpers from
 * `config-helpers` / `theme-grid`, ZERO `node:*` / lib value imports.
 * Computed values are plain getters, not `$derived` (mirrors
 * `design-section-controller.svelte.ts`), so bun's unit tests need only the
 * `$state` shim.
 */

import type {
  ProjectExtensionEntry,
  ExtensionValidationResult,
  RecommendedExtension,
  BuiltInStyleSet,
  ExtensionImportResult,
} from "$lib/platform/dtos";
import {
  orderAfterMove,
  sampleSrcdoc,
  hoverPreviewSrcdoc,
} from "$lib/components/config/config-helpers";
import { addedBuiltInIds } from "$lib/components/config/theme-grid";

export interface ExtensionsSectionDeps {
  /** The open project directory (reactive prop), or null when none is open. */
  projectDir: () => string | null;
  /** Every configured extension, in manifest (= cascade) order. */
  list: (projectDir: string) => Promise<ProjectExtensionEntry[]>;
  recommended: () => Promise<RecommendedExtension[]>;
  listBuiltIn: () => Promise<BuiltInStyleSet[]>;
  validate: (projectDir: string) => Promise<ExtensionValidationResult[]>;
  /** Add by specifier. Null when the author cancelled the native npm trust gate. */
  add: (
    projectDir: string,
    specifier: string,
    exportName?: string,
  ) => Promise<ProjectExtensionEntry | null>;
  /** Native folder/file picker; referenced in place. Null when cancelled. */
  addLocal: (projectDir: string) => Promise<ProjectExtensionEntry | null>;
  /** Copy a built-in look into `extensions/<id>/` and add it. */
  addBuiltIn: (projectDir: string, id: string) => Promise<ProjectExtensionEntry>;
  remove: (projectDir: string, use: string) => Promise<unknown>;
  setEnabled: (projectDir: string, use: string, enabled: boolean) => Promise<unknown>;
  /** Rewrite the whole list order; must name every `use` exactly once. */
  reorder: (projectDir: string, order: string[]) => Promise<unknown>;
  /** An entry's stylesheets, concatenated, for the sample thumbnail (entries with a folder only). */
  readCss: (projectDir: string, use: string) => Promise<string>;
  /** `.zip`/`.css` via the native file picker (#106). Null when cancelled. */
  importFromFile: (projectDir: string) => Promise<ExtensionImportResult | null>;
  importFromUrl: (projectDir: string, url: string) => Promise<ExtensionImportResult>;
  /** Fired after a styles-carrying extension was added by any route (the panel toasts). */
  onLookAdded?: (label: string) => void;
  /**
   * Fired after any successful change to a styles-carrying entry (added,
   * removed, toggled, moved): the Styles + Design sections both depend on
   * the cascade, so the panel wires this to reload them.
   */
  afterLookChange?: () => Promise<void>;
}

/** Does this add/import result carry a look? (`null` = cancelled, nothing changed.) */
const carriesStyles = (entry: ProjectExtensionEntry | null): boolean => !!entry?.carries.styles;

export class ExtensionsSectionController {
  // ── Public rune state (read by both views; mutated only via methods) ────────
  /** The manifest's `extensions:` list in cascade order — the ONE model. */
  entries = $state<ProjectExtensionEntry[]>([]);
  recommended = $state<RecommendedExtension[]>([]);
  builtIns = $state<BuiltInStyleSet[]>([]);
  /** Last load-test result per `use`. */
  validation = $state<Record<string, ExtensionValidationResult>>({});
  validating = $state(false);
  error = $state<string | null>(null);
  /** A non-fatal notice from the last add (installer warnings). */
  notice = $state<string | null>(null);
  /** What an action is in flight for — an entry's `use`, a built-in id, the
   *  npm draft, or `__local__`/`__file__`/`__url__` — else null. */
  busy = $state<string | null>(null);
  /** Non-fatal warnings from the last `.zip`/`.css`/URL import (#106). */
  importWarnings = $state<string[]>([]);
  /** Drafts bound directly from the templates. */
  url = $state("");
  npmName = $state("");
  /** Optional named module export for packages without a default plugin export. */
  npmExport = $state("");
  /** Sample-thumbnail srcdoc per `use` (`"__fallback__"` when unavailable). */
  thumbs = $state<Record<string, string>>({});
  /** `use` of the look hovered for the enlarged preview, and its srcdoc (#106). */
  hoverUse = $state<string | null>(null);
  hoverPreview = $state<string | null>(null);

  /**
   * Raw CSS cached per `use` (populated by `loadThumb`) so the hover preview
   * can build its enlarged 2-page spread without a second host round trip.
   * Non-reactive: only read imperatively by `showHoverPreview`.
   */
  private rawCssCache: Record<string, string> = {};

  private readonly deps: ExtensionsSectionDeps;

  constructor(deps: ExtensionsSectionDeps) {
    this.deps = deps;
  }

  // ── Views (getters so bun unit tests need only the $state shim) ─────────────
  /** The Look view: every entry that carries styles, in cascade order. */
  get looks(): ProjectExtensionEntry[] {
    return this.entries.filter((e) => e.carries.styles);
  }
  /**
   * The Features view: every entry that carries markdown — plus any entry that
   * carries nothing at all (a missing folder, an unparseable specifier), so no
   * configured entry is ever invisible and un-removable.
   */
  get features(): ProjectExtensionEntry[] {
    return this.entries.filter((e) => e.carries.markdown || !e.carries.styles);
  }
  /** Bundled features not yet in the list — the "Turn on" rows. */
  get availableRecommended(): RecommendedExtension[] {
    return this.recommended.filter((r) => !this.entries.some((e) => e.use === r.use));
  }
  /** True when the built-in look `id` is already in the list as `./extensions/<id>`. */
  isBuiltInAdded = (id: string): boolean => addedBuiltInIds(this.entries).has(id);

  // ── Load ────────────────────────────────────────────────────────────────────
  loadExtensions = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    this.error = null;
    try {
      const [entries, recs, builtIns] = await Promise.all([
        this.deps.list(projectDir),
        this.deps.recommended(),
        this.deps.listBuiltIn(),
      ]);
      this.entries = entries;
      this.recommended = recs;
      this.builtIns = builtIns;
      // Thumbnails lazy-load in the background (non-fatal if they fail).
      void Promise.all(
        entries.filter((e) => e.carries.styles && e.dir).map((e) => this.loadThumb(e)),
      );
      await this.validateExtensions();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  };

  validateExtensions = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    this.validating = true;
    try {
      const results = await this.deps.validate(projectDir);
      this.validation = Object.fromEntries(results.map((r) => [r.use, r]));
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.validating = false;
    }
  };

  private async loadThumb(entry: ProjectExtensionEntry): Promise<void> {
    if (this.thumbs[entry.use]) return;
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    try {
      const css = await this.deps.readCss(projectDir, entry.use);
      this.rawCssCache[entry.use] = css;
      this.thumbs = { ...this.thumbs, [entry.use]: sampleSrcdoc(css) };
    } catch {
      this.thumbs = { ...this.thumbs, [entry.use]: "__fallback__" };
    }
  }

  // ── The one mutation shape ──────────────────────────────────────────────────
  /**
   * Every verb below: refuse while busy, clear the messages, mark busy, run,
   * reload the list on success (and the Styles + Design sections when the
   * change touched a look), surface a failure, clear busy. A `null` result is
   * the "cancelled, nothing changed" convention of the add/import verbs — no
   * reload. Returns the action's result, or undefined when refused or failed.
   */
  private async mutate<T>(
    busyKey: string,
    action: (projectDir: string) => Promise<T>,
    touchesLook: (result: T) => boolean,
  ): Promise<T | undefined> {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.busy) return undefined;
    this.busy = busyKey;
    this.error = null;
    this.notice = null;
    try {
      const result = await action(projectDir);
      if (result === null) return result;
      await this.loadExtensions();
      if (touchesLook(result)) await this.deps.afterLookChange?.();
      return result;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return undefined;
    } finally {
      this.busy = null;
    }
  }

  /** After a successful add: surface the host's non-fatal warnings, and announce a new look. */
  private announceAdded(entry: ProjectExtensionEntry): void {
    if (entry.warnings?.length) this.notice = entry.warnings.join(" ");
    if (entry.carries.styles) this.deps.onLookAdded?.(entry.label);
  }

  // ── Verbs (arrow fields: passed as callbacks from the templates) ────────────
  toggle = async (entry: ProjectExtensionEntry): Promise<void> => {
    await this.mutate(
      entry.use,
      (dir) => this.deps.setEnabled(dir, entry.use, !entry.enabled),
      () => entry.carries.styles,
    );
  };

  remove = async (entry: ProjectExtensionEntry): Promise<void> => {
    await this.mutate(entry.use, (dir) => this.deps.remove(dir, entry.use), () => entry.carries.styles);
  };

  /** Move `entry` one slot up (-1) or down (+1) within the Look or Features view. */
  move = async (
    entry: ProjectExtensionEntry,
    delta: -1 | 1,
    view: "looks" | "features",
  ): Promise<void> => {
    const order = orderAfterMove(
      this.entries,
      view === "looks" ? this.looks : this.features,
      entry,
      delta,
    );
    if (!order) return;
    await this.mutate(entry.use, (dir) => this.deps.reorder(dir, order), () => entry.carries.styles);
  };

  /** "Install from npm": the drafts → `add`. A cancelled trust gate keeps the draft. */
  addNpm = async (): Promise<void> => {
    const name = this.npmName.trim();
    const exportName = this.npmExport.trim() || undefined;
    if (!name) {
      this.error = "Enter an npm package name (e.g. markdown-it-highlightjs).";
      return;
    }
    const added = await this.mutate(name, (dir) => this.deps.add(dir, name, exportName), carriesStyles);
    if (!added) return;
    this.npmName = "";
    this.npmExport = "";
    this.announceAdded(added);
  };

  /** Turn on a bundled feature — writes its name, nothing to install. */
  addRecommended = async (rec: RecommendedExtension): Promise<void> => {
    const added = await this.mutate(rec.use, (dir) => this.deps.add(dir, rec.use), carriesStyles);
    if (added) this.announceAdded(added);
  };

  /** A folder or plugin file from the native picker, referenced in place. */
  addLocal = async (): Promise<void> => {
    const added = await this.mutate("__local__", (dir) => this.deps.addLocal(dir), carriesStyles);
    if (added) this.announceAdded(added);
  };

  /** Copy a built-in look into the project and add it. */
  useBuiltIn = async (id: string): Promise<void> => {
    const added = await this.mutate(id, (dir) => this.deps.addBuiltIn(dir, id), () => true);
    if (added) this.announceAdded(added);
  };

  /**
   * #106: import a look from a `.zip` package or a bare `.css` file via the
   * native file picker. The host validates (rejects on a parse failure, unsafe
   * paths, or over-cap) and returns non-fatal warnings, which are surfaced
   * without blocking the import.
   */
  importFile = async (): Promise<void> => {
    this.importWarnings = [];
    const result = await this.mutate("__file__", (dir) => this.deps.importFromFile(dir), () => true);
    if (result) this.announceImported(result);
  };

  importUrl = async (): Promise<void> => {
    const url = this.url.trim();
    if (!url) {
      this.error = "Enter a URL (a .css file or an extension folder).";
      return;
    }
    this.importWarnings = [];
    const result = await this.mutate("__url__", (dir) => this.deps.importFromUrl(dir, url), () => true);
    if (!result) return;
    this.url = "";
    this.announceImported(result);
  };

  private announceImported(result: ExtensionImportResult): void {
    this.importWarnings = result.warnings.map((w) => w.message);
    this.announceAdded(result.entry);
  }

  // ── Hover preview (#106) ────────────────────────────────────────────────────
  //
  // Reuses the per-row thumbnail mechanism (readCss → inline <style> →
  // sandboxed <iframe srcdoc>), swapping the sample for a FIXED built-in
  // 2-page spread. It renders a constant sample, never the author's document,
  // so it structurally cannot re-paginate the manuscript. The raw CSS is
  // already cached by `loadThumb`; on a cache miss we fetch it once. An entry
  // with no folder (bundled, uninstalled, missing) has no CSS to show.
  showHoverPreview = async (entry: ProjectExtensionEntry): Promise<void> => {
    if (!entry.dir) return;
    this.hoverUse = entry.use;
    const cached = this.rawCssCache[entry.use];
    if (cached !== undefined) {
      this.hoverPreview = hoverPreviewSrcdoc(cached);
      return;
    }
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    try {
      const css = await this.deps.readCss(projectDir, entry.use);
      this.rawCssCache[entry.use] = css;
      // The pointer may have moved on while we were fetching: only paint if
      // this row is still the hovered one.
      if (this.hoverUse === entry.use) this.hoverPreview = hoverPreviewSrcdoc(css);
    } catch {
      if (this.hoverUse === entry.use) this.hoverPreview = null;
    }
  };

  hideHoverPreview = (): void => {
    this.hoverUse = null;
    this.hoverPreview = null;
  };
}
