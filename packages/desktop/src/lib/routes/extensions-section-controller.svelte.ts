/**
 * ExtensionsSectionController (#243) - the single owner of the merged
 * Extensions surface's state + logic: the theme grid ("Look" tab, ex-
 * `AppearanceSectionController`) and the plugin list ("Features" tab, ex-
 * `PluginsSectionController`) are now ONE controller over ONE project's worth
 * of extension data, per the issue's "one controller and one model" shape.
 *
 * NOTE ON PUNCTUATION: this file intentionally avoids em dashes, curly
 * quotes, section-sign shorthand, and box-drawing divider characters (all
 * used elsewhere in this codebase's comments) in favor of plain ASCII, to
 * sidestep a Unicode-generation reliability issue hit while authoring this
 * file. Prefer the surrounding codebase's normal typographic conventions in
 * any future edits to this file once that is no longer a concern.
 *
 * ## Why one class instead of two collaborating ones
 *
 * The two halves keep their OWN state/methods below (grouped in two clearly
 * marked sections) rather than being rewritten into a single generic list,
 * because the two things they model are genuinely different mechanisms, not
 * just different presentations of the same one:
 *
 *   - A LOOK (`api.theme.*`) is exclusive: applying one REPLACES the active
 *     look, copies the whole folder into the project, and is reversible via
 *     "Revert to previous". This is `styles:` block replacement
 *     (`theme-manager.ts`'s `setActiveThemeStyle`).
 *   - A FEATURE (`api.plugin.*`) is additive: any number can be enabled at
 *     once, each is a `plugins:` manifest entry with its own `enabled` flag,
 *     and it is validated by load-testing, not by "is this the active one".
 *
 * Both halves are extensions in the #241 package-format sense, but the ACTUAL
 * verbs (apply/import/revert/remove vs enable/disable/add) do not collapse
 * into one shared verb without misrepresenting one side or the other - see
 * the issue's own tab descriptions ("Applying one replaces the active look"
 * vs "enable toggle"). This controller keeps them as two named groups of
 * methods for exactly that reason: an honest UI needs the code backing it to
 * stay honest about which mechanism it is invoking.
 *
 * ## Classification: which tab does an extension appear in
 *
 * Per the issue: "An extension that carries both appears where its primary
 * intent says it belongs - a `kind` hint in `gutterpress.json`, defaulting to
 * 'look' when it has styles - with the other half visible in its detail
 * view." This controller implements the DEFAULT half of that rule and
 * explicitly does NOT implement the explicit-override half:
 *
 *   - Every `ThemeInfo` (from `api.theme.*`) always has at least one declared
 *     style (`themeStyleList` defaults to `["theme.css"]` - see
 *     `theme-manager.ts`), so every Look-tab entry is "look" by construction.
 *     No heuristic is needed here; the API it came from IS the classification.
 *   - Every `ProjectPluginEntry`/`RecommendedPlugin` (from `api.plugin.*`) is
 *     "features" by construction, for a DIFFERENT reason: per #241's landed
 *     lib behavior, a full extension (styles + markdown) is only installable
 *     through the PLUGIN flow (`addLocalPlugin` - a `plugins:` entry whose
 *     `path` names a folder; `loadExtensionFromDir` resolves both halves).
 *     Its styles activate ADDITIVELY, alongside the plugin's markdown, via
 *     the plugin loader - never through the exclusive `styles:`-block
 *     mechanism a Look card's "Apply" performs. So even though such an
 *     extension "has styles", showing it as a Look card would misrepresent
 *     its actual activation mechanism (toggle, not apply/replace) - the
 *     precise mismatch #243's own issue text does not anticipate, because it
 *     assumes a single unified install path that the landed #241 lib work
 *     does not (yet) provide. Reclassifying it would need either a lib
 *     change (teaching `listProjectPlugins` to read a local entry's declared
 *     styles) or new Look-card semantics for a toggle-based "look" - both
 *     out of scope for a UI/route-layer issue. Flagged in the PR description
 *     as a follow-up rather than guessed at here.
 *
 * An explicit `kind:` override field in `gutterpress.json` is NOT read here
 * (or anywhere - the lib's `ExtensionMetadata` does not declare one): adding
 * it would be a lib change, and #241 did not add one. Until then, "which API
 * returned it" is the only classification signal, and it happens to already
 * match the issue's stated default for every extension actually reachable
 * today.
 *
 * The one cross-tab signal this controller DOES surface: a Look card whose
 * `ThemeInfo.markdown` is set (the folder's `gutterpress.json` also declares
 * a markdown entry) shows an inert "also includes markdown features" note
 * (`config-helpers.ts`'s `extensionOtherHalfNote`) - real data #241 already
 * threads through, informational only, matching that field's own "parsed,
 * never wired by the theme verbs" contract. There is no equivalent note the
 * other direction (a Features row cannot currently tell you it also carries
 * styles): `listProjectPlugins` never reads a local entry's metadata file,
 * and teaching it to would be the same lib change named above.
 *
 * ## Everything else
 *
 * Same single-owner discipline as every other `*SectionController`
 * (`DesignSectionController`, etc.): the component reads the public rune
 * fields and calls the intent methods; host coupling is injected so this
 * stays testable with fakes and PWA-clean (section 8 / ADR 0004) -
 * `ThemeInfo` / `ApplyThemeTarget` / `ThemeImportResult` / `ProjectPluginEntry`
 * / `PluginValidationResult` / `RecommendedPlugin` are type-only imports plus
 * the pure helpers from `config-helpers` - ZERO `node:*` / lib value imports.
 * Computed values are plain getters, not `$derived` (mirrors
 * `design-section-controller.svelte.ts`), so bun's unit tests need only the
 * `$state` shim, not the full Svelte compiler.
 */

import type {
  ThemeInfo,
  ApplyThemeTarget,
  ThemeImportResult,
  ProjectPluginEntry,
  PluginValidationResult,
  RecommendedPlugin,
} from "$lib/platform/dtos";
import {
  keyOf,
  sampleSrcdoc,
  hoverPreviewSrcdoc,
} from "$lib/components/config/config-helpers";

export interface ExtensionsSectionDeps {
  /** The open project directory (reactive prop), or null when none is open. */
  projectDir: () => string | null;

  // -- Look (ex-AppearanceSectionDeps) ----------------------------------
  listBuiltIn: () => Promise<ThemeInfo[]>;
  listProject: (projectDir: string) => Promise<ThemeInfo[]>;
  getActive: (projectDir: string) => Promise<ThemeInfo | null>;
  /** The "Revert to previous look" target, or null when there is none (#106). */
  getPrevious: (projectDir: string) => Promise<ThemeInfo | null>;
  apply: (projectDir: string, target: ApplyThemeTarget) => Promise<ThemeInfo>;
  /** Re-apply the previously active look (#106). */
  revert: (projectDir: string) => Promise<ThemeInfo>;
  remove: (projectDir: string, id: string) => Promise<{ ok: true }>;
  importFromFolder: (projectDir: string) => Promise<ThemeInfo | null>;
  /** Import a `.zip` package or bare `.css` via the native file picker (#106). Null when cancelled. */
  importFromFile: (projectDir: string) => Promise<ThemeImportResult | null>;
  importFromUrl: (projectDir: string, url: string) => Promise<ThemeInfo>;
  readCss: (
    projectDir: string | null,
    source: { kind: "builtin" | "project"; id: string },
  ) => Promise<string>;
  /** Fired after a successful apply (the panel forwards to its `onThemeApplied` prop). */
  onApplied?: (themeId: string) => void;
  /**
   * Fired after apply/remove succeeds: the Styles + Design sections both
   * depend on the (possibly now different) active stylesheet, so the panel
   * wires this to reload them.
   */
  afterThemeChange?: () => Promise<void>;

  // -- Features (ex-PluginsSectionDeps) ---------------------------------
  listPlugins: (projectDir: string) => Promise<ProjectPluginEntry[]>;
  recommended: () => Promise<RecommendedPlugin[]>;
  validate: (projectDir: string) => Promise<PluginValidationResult[]>;
  setEnabled: (projectDir: string, ref: string, enabled: boolean) => Promise<unknown>;
  addNpm: (
    projectDir: string,
    packageName: string,
    exportName?: string,
  ) => Promise<ProjectPluginEntry | null>;
  addLocal: (projectDir: string) => Promise<ProjectPluginEntry | null>;
}

export class ExtensionsSectionController {
  // -- Look public rune state (read by LookSection; mutated only via methods) --
  builtIns = $state<ThemeInfo[]>([]);
  projectThemes = $state<ThemeInfo[]>([]);
  activeThemeId = $state<string | null>(null);
  themeError = $state<string | null>(null);
  themeBusyId = $state<string | null>(null);
  themeUrl = $state("");
  thumbs = $state<Record<string, string>>({});
  /** `keyOf` of the look card whose Remove is armed for a two-step confirm, or null (M7). */
  removeArmedKey = $state<string | null>(null);
  /** The revert target: the look active before the current one, or null (#106). */
  previousTheme = $state<ThemeInfo | null>(null);
  /** Non-fatal warnings from the last `.zip`/`.css` import (surfaced, not fatal) (#106). */
  themeWarnings = $state<string[]>([]);
  /** `keyOf` of the card being hovered for the enlarged preview, or null (#106). */
  hoverThemeKey = $state<string | null>(null);
  /** The enlarged 2-page-spread srcdoc for the hovered look, or null (#106). */
  hoverPreview = $state<string | null>(null);

  /**
   * Raw CSS cached per card (populated by `loadThumb`) so the hover preview
   * can build its enlarged 2-page spread without a second host round trip.
   * Non-reactive: only read imperatively by `showHoverPreview`.
   */
  private rawCssCache: Record<string, string> = {};

  // -- Features public rune state (read by FeaturesSection; mutated only via methods) --
  plugins = $state<ProjectPluginEntry[]>([]);
  validation = $state<Record<string, PluginValidationResult>>({});
  recommended = $state<RecommendedPlugin[]>([]);
  pluginValidating = $state(false);
  pluginError = $state<string | null>(null);
  pluginNotice = $state<string | null>(null);
  pluginBusyRef = $state<string | null>(null);
  /** "Install npm plugin" package spec draft: bound directly from the template. */
  npmName = $state("");
  /** Optional named module export for packages without a default plugin export. */
  npmExport = $state("");

  private readonly deps: ExtensionsSectionDeps;

  constructor(deps: ExtensionsSectionDeps) {
    this.deps = deps;
  }

  // -- Load (both tabs at once: the initial mount reload) -----------------
  loadExtensions = async (): Promise<void> => {
    await Promise.all([this.loadThemes(), this.loadPlugins()]);
  };

  // === Look (ex-AppearanceSectionController) ==============================

  private async loadThumb(t: ThemeInfo): Promise<void> {
    const key = keyOf(t);
    if (this.thumbs[key]) return;
    const projectDir = this.deps.projectDir();
    try {
      const css = await this.deps.readCss(t.kind === "builtin" ? null : projectDir, {
        kind: t.kind,
        id: t.id,
      });
      this.rawCssCache[key] = css;
      this.thumbs = { ...this.thumbs, [key]: sampleSrcdoc(css) };
    } catch {
      this.thumbs = { ...this.thumbs, [key]: "__fallback__" };
    }
  }

  loadThemes = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    this.themeError = null;
    // A refresh can change which cards exist (apply/remove/import all call
    // this): never leave a stale "Delete "X"?" confirm armed on a card that
    // may no longer represent the same look.
    this.removeArmedKey = null;
    try {
      const [bi, pt, active, previous] = await Promise.all([
        this.deps.listBuiltIn(),
        this.deps.listProject(projectDir),
        this.deps.getActive(projectDir),
        this.deps.getPrevious(projectDir),
      ]);
      this.builtIns = bi;
      this.projectThemes = pt;
      this.activeThemeId = active?.id ?? null;
      this.previousTheme = previous;
      // Thumbnails lazy-load (non-fatal if they fail).
      void Promise.all([...bi, ...pt].map((t) => this.loadThumb(t)));
    } catch (e) {
      this.themeError = e instanceof Error ? e.message : String(e);
    }
  };

  applyTheme = async (t: ThemeInfo): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.themeBusyId) return;
    this.themeBusyId = t.id;
    this.themeError = null;
    this.themeWarnings = [];
    this.removeArmedKey = null;
    try {
      const target: ApplyThemeTarget = { kind: t.kind, id: t.id };
      const applied = await this.deps.apply(projectDir, target);
      this.activeThemeId = applied.id;
      this.previousTheme = await this.deps.getPrevious(projectDir);
      this.deps.onApplied?.(applied.id);
      // The styles list + design tokens both depend on the now-active
      // stylesheet: refresh them so the Config view agrees with the
      // rendered preview.
      await this.deps.afterThemeChange?.();
    } catch (e) {
      this.themeError = e instanceof Error ? e.message : String(e);
    } finally {
      this.themeBusyId = null;
    }
  };

  private removeTheme = async (t: ThemeInfo): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || t.kind !== "project" || this.themeBusyId) return;
    this.themeBusyId = t.id;
    this.themeError = null;
    try {
      await this.deps.remove(projectDir, t.id);
      if (this.activeThemeId === t.id) this.activeThemeId = null;
      await this.loadThemes();
      await this.deps.afterThemeChange?.();
    } catch (e) {
      this.themeError = e instanceof Error ? e.message : String(e);
    } finally {
      this.themeBusyId = null;
    }
  };

  /**
   * UX review M7: Remove used to run an immediate recursive delete with no
   * confirmation at any layer. This is a two-step inline confirm: the first
   * click arms the card (LookSection swaps its actions for a "Delete \"X\"?"
   * warning naming the look); a second click while armed performs the actual
   * removal.
   */
  requestRemoveTheme = (t: ThemeInfo): void => {
    const key = keyOf(t);
    if (this.removeArmedKey === key) {
      this.removeArmedKey = null;
      void this.removeTheme(t);
    } else {
      this.removeArmedKey = key;
    }
  };

  /** Cancel an armed Remove confirm without deleting anything. */
  cancelRemoveTheme = (): void => {
    this.removeArmedKey = null;
  };

  importThemeFolder = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.themeBusyId) return;
    this.themeError = null;
    this.themeBusyId = "__import__";
    try {
      const added = await this.deps.importFromFolder(projectDir);
      if (added) await this.loadThemes();
    } catch (e) {
      this.themeError = e instanceof Error ? e.message : String(e);
    } finally {
      this.themeBusyId = null;
    }
  };

  importThemeUrl = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.themeBusyId) return;
    const u = this.themeUrl.trim();
    if (!u) {
      this.themeError = "Enter a URL (a .css file or an extension folder).";
      return;
    }
    this.themeError = null;
    this.themeBusyId = "__url__";
    try {
      await this.deps.importFromUrl(projectDir, u);
      this.themeUrl = "";
      await this.loadThemes();
    } catch (e) {
      this.themeError = e instanceof Error ? e.message : String(e);
    } finally {
      this.themeBusyId = null;
    }
  };

  /**
   * #106: import a look from a `.zip` package or a bare `.css` file via the
   * native file picker. The host validates (rejects on a parse failure,
   * unsafe paths, or over-cap) and returns non-fatal warnings, which are
   * surfaced without blocking the import.
   */
  importThemeFile = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.themeBusyId) return;
    this.themeError = null;
    this.themeWarnings = [];
    this.themeBusyId = "__file__";
    try {
      const result = await this.deps.importFromFile(projectDir);
      if (result) {
        this.themeWarnings = result.warnings.map((w) => w.message);
        await this.loadThemes();
      }
    } catch (e) {
      this.themeError = e instanceof Error ? e.message : String(e);
    } finally {
      this.themeBusyId = null;
    }
  };

  /** #106: re-apply the previously active look (available indefinitely). */
  revertTheme = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.themeBusyId || !this.previousTheme) return;
    this.themeError = null;
    this.themeWarnings = [];
    this.themeBusyId = "__revert__";
    try {
      const applied = await this.deps.revert(projectDir);
      this.activeThemeId = applied.id;
      this.deps.onApplied?.(applied.id);
      await this.loadThemes();
      await this.deps.afterThemeChange?.();
    } catch (e) {
      this.themeError = e instanceof Error ? e.message : String(e);
    } finally {
      this.themeBusyId = null;
    }
  };

  // -- Hover preview (#106) -------------------------------------------------
  //
  // Reuses the per-card thumbnail mechanism (readCss -> inline <style> ->
  // sandboxed <iframe srcdoc>), swapping the sample for a FIXED built-in
  // 2-page spread. It renders a constant sample, never the author's document,
  // so it structurally cannot re-paginate the manuscript. The raw CSS is
  // already cached by `loadThumb`; on a cache miss we fetch it once.
  showHoverPreview = async (t: ThemeInfo): Promise<void> => {
    const key = keyOf(t);
    this.hoverThemeKey = key;
    const cached = this.rawCssCache[key];
    if (cached !== undefined) {
      this.hoverPreview = hoverPreviewSrcdoc(cached);
      return;
    }
    const projectDir = this.deps.projectDir();
    try {
      const css = await this.deps.readCss(t.kind === "builtin" ? null : projectDir, {
        kind: t.kind,
        id: t.id,
      });
      this.rawCssCache[key] = css;
      // The pointer may have moved on while we were fetching: only paint if
      // this card is still the hovered one.
      if (this.hoverThemeKey === key) this.hoverPreview = hoverPreviewSrcdoc(css);
    } catch {
      if (this.hoverThemeKey === key) this.hoverPreview = null;
    }
  };

  hideHoverPreview = (): void => {
    this.hoverThemeKey = null;
    this.hoverPreview = null;
  };

  // === Features (ex-PluginsSectionController) ==============================

  loadPlugins = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    this.pluginError = null;
    try {
      const [list, recs] = await Promise.all([
        this.deps.listPlugins(projectDir),
        this.deps.recommended(),
      ]);
      this.plugins = list;
      this.recommended = recs;
      await this.validatePlugins();
    } catch (e) {
      this.pluginError = e instanceof Error ? e.message : String(e);
    }
  };

  validatePlugins = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    this.pluginValidating = true;
    try {
      const results = await this.deps.validate(projectDir);
      this.validation = Object.fromEntries(results.map((r) => [r.ref, r]));
    } catch (e) {
      this.pluginError = e instanceof Error ? e.message : String(e);
    } finally {
      this.pluginValidating = false;
    }
  };

  togglePlugin = async (entry: ProjectPluginEntry): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.pluginBusyRef) return;
    this.pluginBusyRef = entry.ref;
    this.pluginError = null;
    try {
      await this.deps.setEnabled(projectDir, entry.ref, !entry.enabled);
      await this.loadPlugins();
    } catch (e) {
      this.pluginError = e instanceof Error ? e.message : String(e);
    } finally {
      this.pluginBusyRef = null;
    }
  };

  addNpmPlugin = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.pluginBusyRef) return;
    const name = this.npmName.trim();
    const exportName = this.npmExport.trim() || undefined;
    if (!name) {
      this.pluginError = "Enter an npm package name (e.g. markdown-it-highlightjs).";
      return;
    }
    this.pluginError = null;
    this.pluginNotice = null;
    this.pluginBusyRef = name;
    try {
      const added = await this.deps.addNpm(projectDir, name, exportName);
      if (!added) return;
      this.npmName = "";
      this.npmExport = "";
      await this.loadPlugins();
      if (added.warnings?.length) this.pluginNotice = added.warnings.join(" ");
    } catch (e) {
      this.pluginError = e instanceof Error ? e.message : String(e);
    } finally {
      this.pluginBusyRef = null;
    }
  };

  addLocalPlugin = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.pluginBusyRef) return;
    this.pluginError = null;
    this.pluginNotice = null;
    this.pluginBusyRef = "__local__";
    try {
      const added = await this.deps.addLocal(projectDir);
      if (added) await this.loadPlugins();
    } catch (e) {
      this.pluginError = e instanceof Error ? e.message : String(e);
    } finally {
      this.pluginBusyRef = null;
    }
  };

  addRecommended = async (rec: RecommendedPlugin): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.pluginBusyRef) return;
    this.pluginError = null;
    this.pluginNotice = null;
    this.pluginBusyRef = rec.name;
    try {
      const added = await this.deps.addNpm(projectDir, rec.name);
      if (added) await this.loadPlugins();
    } catch (e) {
      this.pluginError = e instanceof Error ? e.message : String(e);
    } finally {
      this.pluginBusyRef = null;
    }
  };
}
