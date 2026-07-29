/**
 * PluginsSectionController — the single owner of the Plugins section's
 * configured-list + recommended + advanced-add state and logic that used to
 * live inline in `ProjectConfigPanel.svelte` (replaces the retired
 * PluginManager).
 *
 * Centralises the configured `plugins` list, the per-ref `validation` map,
 * the curated `recommended` built-ins, the validating/busy/error flags, and
 * the advanced install-by-name draft (`npmName`).
 *
 * Single-owner discipline mirrors `DesignSectionController`
 * (`design-section-controller.svelte.ts`): the component reads the public
 * rune fields and calls the intent methods.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8 / ADR 0004): the reactive `projectDir` accessor and the `api.plugin.*`
 * host calls. `ProjectPluginEntry` / `PluginValidationResult` /
 * `RecommendedPlugin` are type-only imports — ZERO `node:*` / lib value
 * imports.
 */

import type {
  ProjectPluginEntry,
  PluginValidationResult,
  RecommendedPlugin,
} from "$lib/platform/dtos";

export interface PluginsSectionDeps {
  /** The open project directory (reactive prop), or null when none is open. */
  projectDir: () => string | null;
  list: (projectDir: string) => Promise<ProjectPluginEntry[]>;
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

export class PluginsSectionController {
  // ── Public rune state (read by the template; mutated only via methods) ──────
  plugins = $state<ProjectPluginEntry[]>([]);
  validation = $state<Record<string, PluginValidationResult>>({});
  recommended = $state<RecommendedPlugin[]>([]);
  pluginValidating = $state(false);
  pluginError = $state<string | null>(null);
  pluginNotice = $state<string | null>(null);
  pluginBusyRef = $state<string | null>(null);
  /** "Install npm plugin" package spec draft — bound directly from the template. */
  npmName = $state("");
  /** Optional named module export for packages without a default plugin export. */
  npmExport = $state("");

  private readonly deps: PluginsSectionDeps;

  constructor(deps: PluginsSectionDeps) {
    this.deps = deps;
  }

  // ── Load ────────────────────────────────────────────────────────────────────
  loadPlugins = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    this.pluginError = null;
    try {
      const [list, recs] = await Promise.all([
        this.deps.list(projectDir),
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

  // ── Intents ───────────────────────────────────────────────────────────────
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
