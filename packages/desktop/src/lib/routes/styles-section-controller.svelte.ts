/**
 * StylesSectionController — the single owner of the Styles section's
 * active-stylesheet toggle state + logic that used to live inline in
 * `ProjectConfigPanel.svelte` (replaces the retired StylePicker chooser).
 *
 * Centralises the resolved stylesheet list (`styles`), the busy/error flags,
 * and the active-set toggle intent.
 *
 * Single-owner discipline mirrors `DesignSectionController`
 * (`design-section-controller.svelte.ts`): the component reads the public
 * rune fields and calls the intent methods.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8 / ADR 0004): the reactive `projectDir` accessor, the `listStyles` /
 * `setActive` host calls, the `onToggled` callback (the panel wires this to a
 * toast), the `onEditRawCss` escape hatch, and `afterStyleChange` — a
 * cross-section refresh hook the panel wires to reload the Design section
 * (its tokens live on the possibly-now-different active stylesheet).
 * `ProjectStyle` is a type-only import — ZERO `node:*` / lib value imports.
 */

import type { ProjectStyle } from "$lib/platform/dtos";

export interface StylesSectionDeps {
  /** The open project directory (reactive prop), or null when none is open. */
  projectDir: () => string | null;
  listStyles: (projectDir: string) => Promise<ProjectStyle[]>;
  /** Replace the manifest's active `styles:` list (reorder + toggle). */
  setActive: (projectDir: string, paths: string[]) => Promise<string[]>;
  /** Fired after a successful toggle (the panel wires this to a toast). */
  onToggled?: (nowOn: boolean) => void;
  /** Escape hatch: open a stylesheet in the raw-CSS editor. */
  onEditRawCss?: (cssPath: string) => void;
  /** Design tokens live on the active stylesheet — refresh it after a toggle. */
  afterStyleChange?: () => Promise<void>;
}

export class StylesSectionController {
  // ── Public rune state (read by the template; mutated only via methods) ──────
  styles = $state<ProjectStyle[]>([]);
  stylesError = $state<string | null>(null);
  stylesBusy = $state(false);

  private readonly deps: StylesSectionDeps;

  constructor(deps: StylesSectionDeps) {
    this.deps = deps;
  }

  // ── Load ────────────────────────────────────────────────────────────────────
  loadStyles = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    this.stylesError = null;
    try {
      this.styles = await this.deps.listStyles(projectDir);
    } catch (e) {
      this.stylesError = e instanceof Error ? e.message : String(e);
    }
  };

  // ── Intents ───────────────────────────────────────────────────────────────
  toggleStyleActive = async (s: ProjectStyle, on: boolean): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.stylesBusy) return;
    this.stylesBusy = true;
    this.stylesError = null;
    try {
      // Rebuild the active paths list after this toggle.
      const next = this.styles
        .filter((x) => (x.path === s.path ? on : x.active))
        .map((x) => x.displayName);
      await this.deps.setActive(projectDir, next);
      await this.loadStyles();
      // Design tokens live on the (possibly changed) active stylesheet — refresh.
      await this.deps.afterStyleChange?.();
      this.deps.onToggled?.(on);
    } catch (e) {
      this.stylesError = e instanceof Error ? e.message : String(e);
    } finally {
      this.stylesBusy = false;
    }
  };

  editStyle = (s: ProjectStyle): void => {
    this.deps.onEditRawCss?.(s.path);
  };
}
