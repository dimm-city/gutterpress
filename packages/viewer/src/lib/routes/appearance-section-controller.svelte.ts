/**
 * AppearanceSectionController — the single owner of the Appearance section's
 * theme-grid state + logic that used to live inline in
 * `ProjectConfigPanel.svelte` (apply / remove / import from folder + URL,
 * plus per-card thumbnail loading).
 *
 * Centralises the built-in + project theme lists, the active theme id, the
 * lazy-loaded thumbnail srcdocs, the busy/error flags, and the two-step
 * inline Remove confirm (UX review M7 — `removeArmedKey` names the card
 * whose Remove is armed; a second click on the same card performs the
 * removal, matching the CrashRecoveryDialog Discard pattern).
 *
 * Single-owner discipline mirrors `DesignSectionController`
 * (`design-section-controller.svelte.ts`): the component reads the public
 * rune fields and calls the intent methods.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8 / ADR 0004): the reactive `projectDir` accessor, the `api.theme.*`
 * host calls, the `onApplied` callback (the panel forwards this to its own
 * `onThemeApplied` prop so the app can toast), and `afterThemeChange` — a
 * cross-section refresh hook the panel wires to reload the Styles + Design
 * sections (their state depends on the now-active stylesheet). `ThemeInfo` /
 * `ApplyThemeTarget` are type-only imports plus the pure `keyOf` /
 * `sampleSrcdoc` helpers from `config-helpers` (browser-only string/derivation
 * helpers, same as `DesignSectionController` importing `$lib/style-tokens`
 * directly) — ZERO `node:*` / lib value imports.
 */

import type {
  ThemeInfo,
  ApplyThemeTarget,
  ThemeImportResult,
} from "$lib/platform/dtos";
import {
  keyOf,
  sampleSrcdoc,
  hoverPreviewSrcdoc,
} from "$lib/components/config/config-helpers";

export interface AppearanceSectionDeps {
  /** The open project directory (reactive prop), or null when none is open. */
  projectDir: () => string | null;
  listBuiltIn: () => Promise<ThemeInfo[]>;
  listProject: (projectDir: string) => Promise<ThemeInfo[]>;
  getActive: (projectDir: string) => Promise<ThemeInfo | null>;
  /** The "Revert to previous theme" target, or null when there is none (#106). */
  getPrevious: (projectDir: string) => Promise<ThemeInfo | null>;
  apply: (projectDir: string, target: ApplyThemeTarget) => Promise<ThemeInfo>;
  /** Re-apply the previously active theme (#106). */
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
   * Fired after apply/remove succeeds — the Styles + Design sections both
   * depend on the (possibly now different) active stylesheet, so the panel
   * wires this to reload them.
   */
  afterThemeChange?: () => Promise<void>;
}

export class AppearanceSectionController {
  // ── Public rune state (read by the template; mutated only via methods) ──────
  builtIns = $state<ThemeInfo[]>([]);
  projectThemes = $state<ThemeInfo[]>([]);
  activeThemeId = $state<string | null>(null);
  themeError = $state<string | null>(null);
  themeBusyId = $state<string | null>(null);
  themeUrl = $state("");
  thumbs = $state<Record<string, string>>({});
  /** `keyOf` of the theme card whose Remove is armed for a two-step confirm, or null (M7). */
  removeArmedKey = $state<string | null>(null);
  /** The revert target — the theme active before the current one, or null (#106). */
  previousTheme = $state<ThemeInfo | null>(null);
  /** Non-fatal warnings from the last `.zip`/`.css` import (surfaced, not fatal) (#106). */
  themeWarnings = $state<string[]>([]);
  /** `keyOf` of the card being hovered for the enlarged preview, or null (#106). */
  hoverThemeKey = $state<string | null>(null);
  /** The enlarged 2-page-spread srcdoc for the hovered theme, or null (#106). */
  hoverPreview = $state<string | null>(null);

  /**
   * Raw theme CSS cached per card (populated by `loadThumb`) so the hover
   * preview can build its enlarged 2-page spread without a second host round
   * trip. Non-reactive — only read imperatively by `showHoverPreview`.
   */
  private rawCssCache: Record<string, string> = {};

  private readonly deps: AppearanceSectionDeps;

  constructor(deps: AppearanceSectionDeps) {
    this.deps = deps;
  }

  // ── Thumbnails ────────────────────────────────────────────────────────────
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

  // ── Load ────────────────────────────────────────────────────────────────────
  loadThemes = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    this.themeError = null;
    // A refresh can change which cards exist (apply/remove/import all call
    // this) — never leave a stale "Delete "X"?" confirm armed on a card that
    // may no longer represent the same theme.
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

  // ── Intents ───────────────────────────────────────────────────────────────
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
      // stylesheet — refresh them so the Config view agrees with the
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
   * click arms the card (AppearanceSection swaps its actions for a
   * "Delete \"X\"?" warning naming the theme); a second click while armed
   * performs the actual removal.
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
      this.themeError = "Enter a theme URL (a .css file or a theme folder).";
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
   * #106: import a theme from a `.zip` package or a bare `.css` file via the
   * native file picker. The host validates (rejects on a parse failure / unsafe
   * paths / over-cap) and returns non-fatal warnings, which are surfaced without
   * blocking the import.
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

  /** #106: re-apply the previously active theme (available indefinitely). */
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

  // ── Hover preview (#106) ────────────────────────────────────────────────────
  //
  // Reuses the per-card thumbnail mechanism (readCss → inline <style> → sandboxed
  // <iframe srcdoc>), swapping the sample for a FIXED built-in 2-page spread. It
  // renders a constant sample, never the author's document, so it structurally
  // cannot re-paginate the manuscript. The raw CSS is already cached by
  // `loadThumb`; on a cache miss we fetch it once.
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
      // The pointer may have moved on while we were fetching — only paint if
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
}
