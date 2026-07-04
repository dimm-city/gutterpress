<script lang="ts">
  /**
   * ProjectConfigPanel (#PCV) — the unified "one button → manage everything"
   * surface that replaces the four retired modal managers (PluginManager,
   * ThemeManager, StylePicker, DesignPanel).
   *
   * Rendered INLINE in the editor pane (swapped in via `editorView === "config"`
   * in +page.svelte) — the preview iframe stays mounted next to it, so the
   * author sees each change (theme apply, token tweak, plugin toggle) take
   * effect live. That is the whole reason the Config view replaces the editor
   * (not the preview): it preserves the "never unmount the preview iframe"
   * invariant (#38) while still giving the config form full pane height.
   *
   * This is the COMPOSITION ROOT: it owns every section's shared state, load
   * functions, and `api.*` calls, and renders five presentational children (one
   * per domain) under `./config/`, passing each its slice via props + callbacks.
   * The children carry no state, no `api` value import, and no styles — the
   * shared/section CSS lives here under `.config-panel :global(...)`, so it
   * still reaches the child-rendered elements without leaking beyond the panel.
   *
   * Five sections, each owning its own load state + `api.*` calls (no `$effect`:
   * data loads on mount + after mutations, mirroring the History-tab pattern):
   *   1. Details   — title, authors, output filename, source files (manifest fields
   *                   with NO prior writer — `api.manifest.{read,setFields}`).
   *   2. Appearance — theme grid: apply / remove / import (folder + URL). Reuses
   *                   the existing `api.theme.*` namespace.
   *   3. Styles    — active-stylesheet toggle + open-in-editor. `api.style.setActive`
   *                   + `api.project.listStyles` (replaces the old StylePicker chooser).
   *   4. Design    — `:root` CSS custom properties (colors + sizes) parsed + written
   *                   client-side (regex + canvas hex-normalise), debounced per
   *                   token. Ported verbatim from the retired DesignPanel.
   *   5. Plugins   — configured list + toggle + validate, plus the recommended
   *                   built-in features and an advanced add-by-name/local path.
   *                   Reuses `api.plugin.*`.
   *
   * PWA-clean (§8): only `import type` from the lib; everything value-bearing goes
   * through `api.*` HTTP routes or raw fs routes. The token regex + canvas hex
   * normaliser are browser-only — no Node/host imports in this module.
   */
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import type {
    ProjectConfigFields,
    ProjectStyle,
    ThemeInfo,
    ApplyThemeTarget,
    ProjectPluginEntry,
    PluginValidationResult,
    RecommendedPlugin,
  } from "$lib/api";
  import type { StyleToken } from "$lib/platform/contract";
  import type { ToastController } from "$lib/components/Toast.svelte";
  import {
    parseStyleTokens,
    applyTokenUpdates,
    type TokenUpdate,
  } from "$lib/style-tokens";
  import Icon from "$lib/components/Icon.svelte";
  import { keyOf, sampleSrcdoc } from "$lib/components/config/config-helpers";
  import DetailsSection from "$lib/components/config/DetailsSection.svelte";
  import AppearanceSection from "$lib/components/config/AppearanceSection.svelte";
  import StylesSection from "$lib/components/config/StylesSection.svelte";
  import DesignSection from "$lib/components/config/DesignSection.svelte";
  import PluginsSection from "$lib/components/config/PluginsSection.svelte";

  let {
    projectDir,
    toast = null,
    onThemeApplied,
    onEditRawCss,
    onClose,
    sidebarEmbedded = false,
  }: {
    projectDir: string | null;
    toast?: ToastController | null;
    /** Fire after a theme apply so the parent can surface the right toast. */
    onThemeApplied?: (themeId: string) => void;
    /** Escape hatch: open a stylesheet in the raw-CSS editor (returns to editor view). */
    onEditRawCss?: (cssPath: string) => void;
    /** Close the config view — return focus to the editor/preview. */
    onClose?: () => void;
    sidebarEmbedded?: boolean;
  } = $props();

  // ── Section state (each section owns its load/error flags; no cross-sections) ─
  let loadingAll = $state(true); // covers the initial parallel load of all sections

  // (1) Details
  let fields = $state<ProjectConfigFields>({});
  let detailsSaving = $state(false);
  let detailsError = $state<string | null>(null);
  let titleDraft = $state("");
  let outputDraft = $state("");
  let authorsDraft = $state<string[]>([]);
  let sourceDraft = $state("");

  // (2) Appearance
  let builtIns = $state<ThemeInfo[]>([]);
  let projectThemes = $state<ThemeInfo[]>([]);
  let activeThemeId = $state<string | null>(null);
  let themeError = $state<string | null>(null);
  let themeBusyId = $state<string | null>(null);
  let themeUrl = $state("");
  let thumbs = $state<Record<string, string>>({});

  // (3) Styles
  let styles = $state<ProjectStyle[]>([]);
  let stylesError = $state<string | null>(null);
  let stylesBusy = $state(false);

  // (4) Design
  let cssPath = $state<string | null>(null);
  let cssName = $state("");
  let tokens = $state<StyleToken[]>([]);
  let designLoading = $state(false);
  let designError = $state<string | null>(null);
  let designSaveStatus = $state<"idle" | "saving" | "saved">("idle");
  const originals = new Map<string, string>();

  // (5) Plugins
  let plugins = $state<ProjectPluginEntry[]>([]);
  let validation = $state<Record<string, PluginValidationResult>>({});
  let recommended = $state<RecommendedPlugin[]>([]);
  let pluginValidating = $state(false);
  let pluginError = $state<string | null>(null);
  let pluginBusyRef = $state<string | null>(null);
  let npmName = $state("");

  // ── Design-token derivations (client-side; parse helpers in $lib/style-tokens) ─
  const colorTokens = $derived(tokens.filter((t) => t.kind === "color"));
  const sizeTokens = $derived(tokens.filter((t) => t.kind === "length"));
  const otherTokens = $derived(tokens.filter((t) => t.kind === "text"));
  const isDirty = (t: StyleToken) => originals.has(t.name) && originals.get(t.name) !== t.value;
  const anyDirty = $derived(tokens.some(isDirty));

  // ── Theme thumbnails ────────────────────────────────────────────────────────

  async function loadThumb(t: ThemeInfo): Promise<void> {
    const key = keyOf(t);
    if (thumbs[key]) return;
    try {
      const css = await api.theme.readCss(
        t.kind === "builtin" ? null : projectDir,
        { kind: t.kind, id: t.id },
      );
      thumbs = { ...thumbs, [key]: sampleSrcdoc(css) };
    } catch {
      thumbs = { ...thumbs, [key]: "__fallback__" };
    }
  }

  // ── Lifecycle: load every section's data on mount ────────────────────────────

  onMount(() => {
    let cancelled = false;
    void loadAll().finally(() => {
      if (!cancelled) loadingAll = false;
    });
    return () => {
      cancelled = true;
      flushPendingTokenWrites();
    };
  });

  async function loadAll(): Promise<void> {
    if (!projectDir) return;
    // Sections load in parallel — none depend on another.
    await Promise.allSettled([
      loadDetails(),
      loadThemes(),
      loadStyles(),
      loadDesign(),
      loadPlugins(),
    ]);
  }

  /** Refresh a single section after a mutation in that section. */
  async function refresh(section: "themes" | "styles" | "design" | "plugins"): Promise<void> {
    if (section === "themes") await loadThemes();
    else if (section === "styles") await loadStyles();
    else if (section === "design") await loadDesign();
    else await loadPlugins();
  }

  // ── (1) Details ──────────────────────────────────────────────────────────────

  async function loadDetails(): Promise<void> {
    if (!projectDir) return;
    detailsError = null;
    try {
      const f = await api.manifest.read(projectDir);
      fields = f;
      titleDraft = f.title ?? "";
      outputDraft = f.outputFilename ?? "";
      authorsDraft = f.authors ?? [];
      sourceDraft = (f.sourceFiles ?? []).join("\n");
    } catch (e) {
      detailsError = e instanceof Error ? e.message : String(e);
    }
  }

  function addAuthor(): void {
    authorsDraft = [...authorsDraft, ""];
  }
  function removeAuthor(i: number): void {
    authorsDraft = authorsDraft.filter((_, idx) => idx !== i);
  }
  function setAuthor(i: number, v: string): void {
    authorsDraft = authorsDraft.map((a, idx) => (idx === i ? v : a));
  }

  async function saveDetails(): Promise<void> {
    if (!projectDir) return;
    const trimmedAuthors = authorsDraft.map((a) => a.trim()).filter((a) => a.length > 0);
    const sourceLines = sourceDraft
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    detailsSaving = true;
    detailsError = null;
    try {
      const src = sourceLines.length === 0 ? null : sourceLines;
      const out = await api.manifest.setFields(projectDir, {
        title: titleDraft.trim(),
        authors: trimmedAuthors,
        outputFilename: outputDraft.trim(),
        sourceFiles: src,
      });
      fields = out;
      toast?.success?.("Project details saved.");
    } catch (e) {
      detailsError = e instanceof Error ? e.message : String(e);
      toast?.error?.(`Could not save details: ${detailsError}`);
    } finally {
      detailsSaving = false;
    }
  }

  // ── (2) Appearance ────────────────────────────────────────────────────────

  async function loadThemes(): Promise<void> {
    if (!projectDir) return;
    themeError = null;
    try {
      const [bi, pt, active] = await Promise.all([
        api.theme.listBuiltIn(),
        api.theme.listProject(projectDir),
        api.theme.getActive(projectDir),
      ]);
      builtIns = bi;
      projectThemes = pt;
      activeThemeId = active?.id ?? null;
      // Thumbnails lazy-load (non-fatal if they fail).
      void Promise.all([...bi, ...pt].map((t) => loadThumb(t)));
    } catch (e) {
      themeError = e instanceof Error ? e.message : String(e);
    }
  }

  async function applyTheme(t: ThemeInfo): Promise<void> {
    if (!projectDir || themeBusyId) return;
    themeBusyId = t.id;
    themeError = null;
    try {
      const target: ApplyThemeTarget = { kind: t.kind, id: t.id };
      const applied = await api.theme.apply(projectDir, target);
      activeThemeId = applied.id;
      onThemeApplied?.(applied.id);
      toast?.success?.("Theme applied — your preview is updating. Use Design to fine-tune.");
      // The styles list + design tokens both depend on the now-active stylesheet;
      // refresh them so the Config view agrees with the rendered preview.
      await Promise.all([refresh("styles"), refresh("design")]);
    } catch (e) {
      themeError = e instanceof Error ? e.message : String(e);
    } finally {
      themeBusyId = null;
    }
  }

  async function removeTheme(t: ThemeInfo): Promise<void> {
    if (!projectDir || t.kind !== "project" || themeBusyId) return;
    themeBusyId = t.id;
    themeError = null;
    try {
      await api.theme.remove(projectDir, t.id);
      if (activeThemeId === t.id) activeThemeId = null;
      await refresh("themes");
      await Promise.all([refresh("styles"), refresh("design")]);
    } catch (e) {
      themeError = e instanceof Error ? e.message : String(e);
    } finally {
      themeBusyId = null;
    }
  }

  async function importThemeFolder(): Promise<void> {
    if (!projectDir || themeBusyId) return;
    themeError = null;
    themeBusyId = "__import__";
    try {
      const added = await api.theme.importFromFolder(projectDir);
      if (added) await refresh("themes");
    } catch (e) {
      themeError = e instanceof Error ? e.message : String(e);
    } finally {
      themeBusyId = null;
    }
  }

  async function importThemeUrl(): Promise<void> {
    if (!projectDir || themeBusyId) return;
    const u = themeUrl.trim();
    if (!u) {
      themeError = "Enter a theme URL (a .css file or a theme folder).";
      return;
    }
    themeError = null;
    themeBusyId = "__url__";
    try {
      await api.theme.importFromUrl(projectDir, u);
      themeUrl = "";
      await refresh("themes");
    } catch (e) {
      themeError = e instanceof Error ? e.message : String(e);
    } finally {
      themeBusyId = null;
    }
  }

  // ── (3) Styles ─────────────────────────────────────────────────────────────

  async function loadStyles(): Promise<void> {
    if (!projectDir) return;
    stylesError = null;
    try {
      styles = await api.project.listStyles(projectDir);
    } catch (e) {
      stylesError = e instanceof Error ? e.message : String(e);
    }
  }

  async function toggleStyleActive(s: ProjectStyle, on: boolean): Promise<void> {
    if (!projectDir || stylesBusy) return;
    stylesBusy = true;
    stylesError = null;
    try {
      // Rebuild the active paths list after this toggle.
      const next = styles.filter((x) => (x.path === s.path ? on : x.active)).map((x) => x.path);
      await api.style.setActive(projectDir, next);
      await loadStyles();
      // Design tokens live on the (possibly changed) active stylesheet — refresh.
      await refresh("design");
      toast?.success?.(on ? "Stylesheet enabled." : "Stylesheet disabled.");
    } catch (e) {
      stylesError = e instanceof Error ? e.message : String(e);
    } finally {
      stylesBusy = false;
    }
  }

  function editStyle(s: ProjectStyle): void {
    onEditRawCss?.(s.path);
  }

  // ── (4) Design tokens ─────────────────────────────────────────────────────

  async function loadDesign(): Promise<void> {
    if (!projectDir) return;
    designLoading = true;
    designError = null;
    tokens = [];
    try {
      const list = await api.project.listStyles(projectDir);
      const active = list.find((x) => x.active) ?? list[0];
      if (!active) {
        cssPath = null;
        cssName = "";
        return;
      }
      cssPath = active.path;
      cssName = active.displayName;
      const css = await api.fs.readFile(active.path);
      tokens = parseStyleTokens(css);
      originals.clear();
      for (const t of tokens) originals.set(t.name, t.value);
      designSaveStatus = "idle";
    } catch (e) {
      designError = e instanceof Error ? e.message : String(e);
    } finally {
      designLoading = false;
    }
  }

  // Debounced, serialized token writes. Edits coalesce into `tokenPending`
  // (keyed by name — last value wins) behind a SINGLE debounce timer. A flush
  // reads the CSS once, folds ALL pending mutations via `applyTokenUpdates`, and
  // writes once, so two edits committed in the same tick can't clobber each
  // other (a per-token read-modify-write did — the second write lost the first).
  // `commitChain` serializes overlapping flushes, so an unmount flush can't race
  // the debounce timer's flush onto a stale base string.
  const tokenPending = new Map<string, string>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let commitChain: Promise<void> = Promise.resolve();

  function scheduleTokenWrite(name: string, value: string): void {
    tokenPending.set(name, value);
    designSaveStatus = "saving";
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushPendingTokenWrites();
    }, 250);
  }

  function flushPendingTokenWrites(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    // Chain after any in-flight commit so each read-once/write-once pass sees
    // the previous write's result instead of a stale snapshot.
    commitChain = commitChain.then(commitPendingTokens);
    return commitChain;
  }

  async function commitPendingTokens(): Promise<void> {
    if (!cssPath || tokenPending.size === 0) return;
    // Drain the coalesced edits into one batch, then read → fold → write once.
    const updates: TokenUpdate[] = [...tokenPending.entries()].map(([name, value]) => ({ name, value }));
    tokenPending.clear();
    try {
      const css = await api.fs.readFile(cssPath);
      await api.fs.writeFile(cssPath, applyTokenUpdates(css, updates));
      if (tokenPending.size === 0) designSaveStatus = "saved";
    } catch (e) {
      // Re-queue the failed batch (unless a newer edit already superseded it) so
      // a later flush can retry, and surface the error.
      for (const u of updates) if (!tokenPending.has(u.name)) tokenPending.set(u.name, u.value);
      designSaveStatus = "idle";
      toast?.error?.(`Couldn't save changes: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function setToken(t: StyleToken, value: string): void {
    t.value = value;
    tokens = tokens; // nudge reactivity (mutated element)
    scheduleTokenWrite(t.name, value);
  }

  function resetToken(t: StyleToken): void {
    const o = originals.get(t.name);
    if (o !== undefined && o !== t.value) setToken(t, o);
  }

  function revertAllTokens(): void {
    for (const t of tokens) resetToken(t);
  }

  function setLength(t: StyleToken, num: string): void {
    const n = num.trim();
    if (n === "") return;
    setToken(t, `${n}${t.unit ?? ""}`);
  }

  function editRawCss(): void {
    if (cssPath) onEditRawCss?.(cssPath);
  }

  // ── (5) Plugins ───────────────────────────────────────────────────────────

  async function loadPlugins(): Promise<void> {
    if (!projectDir) return;
    pluginError = null;
    try {
      const [list, recs] = await Promise.all([
        api.plugin.list(projectDir),
        api.plugin.recommended(),
      ]);
      plugins = list;
      recommended = recs;
      await validatePlugins();
    } catch (e) {
      pluginError = e instanceof Error ? e.message : String(e);
    }
  }

  async function validatePlugins(): Promise<void> {
    if (!projectDir) return;
    pluginValidating = true;
    try {
      const results = await api.plugin.validate(projectDir);
      validation = Object.fromEntries(results.map((r) => [r.ref, r]));
    } catch (e) {
      pluginError = e instanceof Error ? e.message : String(e);
    } finally {
      pluginValidating = false;
    }
  }

  async function togglePlugin(entry: ProjectPluginEntry): Promise<void> {
    if (!projectDir || pluginBusyRef) return;
    pluginBusyRef = entry.ref;
    pluginError = null;
    try {
      await api.plugin.setEnabled(projectDir, entry.ref, !entry.enabled);
      await loadPlugins();
    } catch (e) {
      pluginError = e instanceof Error ? e.message : String(e);
    } finally {
      pluginBusyRef = null;
    }
  }

  async function addNpmPlugin(): Promise<void> {
    if (!projectDir || pluginBusyRef) return;
    const name = npmName.trim();
    if (!name) {
      pluginError = "Enter an npm package name (e.g. markdown-it-footnote).";
      return;
    }
    pluginError = null;
    pluginBusyRef = name;
    try {
      await api.plugin.addNpm(projectDir, name);
      npmName = "";
      await loadPlugins();
    } catch (e) {
      pluginError = e instanceof Error ? e.message : String(e);
    } finally {
      pluginBusyRef = null;
    }
  }

  async function addLocalPlugin(): Promise<void> {
    if (!projectDir || pluginBusyRef) return;
    pluginError = null;
    pluginBusyRef = "__local__";
    try {
      const added = await api.plugin.addLocal(projectDir);
      if (added) await loadPlugins();
    } catch (e) {
      pluginError = e instanceof Error ? e.message : String(e);
    } finally {
      pluginBusyRef = null;
    }
  }

  async function addRecommended(rec: RecommendedPlugin): Promise<void> {
    if (!projectDir || pluginBusyRef) return;
    pluginError = null;
    pluginBusyRef = rec.name;
    try {
      await api.plugin.addNpm(projectDir, rec.name);
      await loadPlugins();
    } catch (e) {
      pluginError = e instanceof Error ? e.message : String(e);
    } finally {
      pluginBusyRef = null;
    }
  }

  const hasProject = $derived(!!projectDir);
</script>

<div class="config-panel" aria-busy={loadingAll}>
  <header class="panel-header">
    <h2>Project settings</h2>
    {#if onClose}
      <button class="ghost small close" onclick={onClose} title="Back to editor" aria-label="Back to editor">
        <Icon name="x" size={16} /> Close
      </button>
    {/if}
  </header>

  {#if !hasProject}
    <div class="empty">
      <p>Open a project folder to configure it.</p>
    </div>
  {:else if loadingAll}
    <p class="muted">Loading…</p>
  {:else}
    <div class="sections" class:embedded={sidebarEmbedded}>

      <DetailsSection
        {detailsError}
        bind:titleDraft
        {authorsDraft}
        bind:outputDraft
        bind:sourceDraft
        {detailsSaving}
        {addAuthor}
        {removeAuthor}
        {setAuthor}
        {saveDetails}
      />

      <AppearanceSection
        {themeError}
        {builtIns}
        {projectThemes}
        {activeThemeId}
        {thumbs}
        {themeBusyId}
        bind:themeUrl
        {applyTheme}
        {removeTheme}
        {importThemeFolder}
        {importThemeUrl}
      />

      <StylesSection
        {stylesError}
        {styles}
        {stylesBusy}
        {toggleStyleActive}
        {editStyle}
      />

      <DesignSection
        {designSaveStatus}
        {anyDirty}
        {designLoading}
        {designError}
        {cssPath}
        {cssName}
        {tokens}
        {colorTokens}
        {sizeTokens}
        {otherTokens}
        {isDirty}
        {setToken}
        {resetToken}
        {setLength}
        {revertAllTokens}
        {editRawCss}
      />

      <PluginsSection
        {pluginError}
        {plugins}
        {recommended}
        {validation}
        {pluginValidating}
        {pluginBusyRef}
        bind:npmName
        {validatePlugins}
        {togglePlugin}
        {addRecommended}
        {addNpmPlugin}
        {addLocalPlugin}
      />

    </div>
  {/if}
</div>

<style>
  /* Structural chrome owned by this root (scoped). Every other rule below is
     authored as `.config-panel :global(...)` so it still styles the elements the
     section children render (all descendants of `.config-panel`) without leaking
     beyond the panel — the same containment Svelte scoping gave the single-file
     component before the split. */
  .config-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    background: var(--app-bg);
    color: var(--app-text-secondary);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .panel-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; border-bottom: 1px solid var(--app-border-subtle);
    position: sticky; top: 0; background: var(--app-bg); z-index: 1;
  }
  .panel-header h2 { margin: 0; font-size: 12px; font-weight: 700; color: var(--app-text); text-transform: uppercase; letter-spacing: 0.04em; }
  .sections { display: flex; flex-direction: column; gap: 16px; padding: 14px 16px 24px; }
  .sections.embedded { padding-top: 12px; }

  .config-panel :global(.block) { display: flex; flex-direction: column; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--app-border-subtle); }
  .config-panel :global(.block:last-child) { border-bottom: none; }
  .config-panel :global(.block h3) {
    margin: 0; font-size: 12px; font-weight: 600; color: var(--app-text);
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .config-panel :global(.block-head) { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .config-panel :global(.subhead) { margin: 6px 0 2px; font-size: 11px; font-weight: 600; color: var(--app-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }

  .config-panel :global(.muted) { margin: 0; font-size: 13px; color: var(--app-text-muted); }
  .config-panel :global(.error) { margin: 0; color: var(--app-error-text); font-size: 12px; }
  .config-panel :global(.hint) { margin: 0; font-size: 11.5px; color: var(--app-text-faint); line-height: 1.4; }
  .config-panel :global(.row) { display: flex; align-items: center; gap: 8px; }

  .config-panel :global(.field) { display: flex; flex-direction: column; gap: 3px; }
  .config-panel :global(.field .lbl) { font-size: 11px; color: var(--app-text-muted); font-weight: 500; }
  .config-panel :global(.input) {
    background: var(--app-surface-sunken); border: 1px solid var(--app-border);
    color: var(--app-text-secondary); padding: 7px 9px; border-radius: 5px;
    font-size: 13px; font-family: inherit; width: 100%; box-sizing: border-box;
  }
  .config-panel :global(.input:focus) { outline: none; border-color: var(--app-focus-ring); }
  .config-panel :global(textarea.input) { resize: vertical; font-family: ui-monospace, monospace; font-size: 12px; }
  .config-panel :global(.input.sharp) { width: auto; min-width: 0; flex: 1; }

  .config-panel :global(.authors) { display: flex; flex-direction: column; gap: 4px; }
  .config-panel :global(.author-row) { display: flex; gap: 4px; align-items: center; }
  .config-panel :global(.author-row .input) { flex: 1; }
  .config-panel :global(.add) { align-self: flex-start; }

  .config-panel :global(button) {
    display: inline-flex; align-items: center; gap: 5px; padding: 7px 12px;
    font-size: 13px; border-radius: 5px; cursor: pointer; border: 1px solid transparent;
    font-family: inherit;
  }
  .config-panel :global(button.small) { padding: 5px 10px; font-size: 12px; }
  .config-panel :global(button.icononly) { padding: 5px; }
  .config-panel :global(.primary) { background: var(--app-focus-ring); color: var(--app-text-on-accent); }
  .config-panel :global(.primary:hover:not(:disabled)) { background: var(--app-accent-hover); }
  .config-panel :global(.ghost) { background: transparent; color: var(--app-text-muted); border-color: var(--app-border); }
  .config-panel :global(.ghost:hover:not(:disabled)) { background: var(--app-surface-hover); color: var(--app-text); }
  .config-panel :global(button:disabled) { opacity: 0.5; cursor: not-allowed; }
  .config-panel :global(button.full) { width: 100%; justify-content: center; }

  .config-panel :global(.add-row) { display: flex; gap: 6px; }
  .config-panel :global(.add-row .input) { flex: 1; }

  /* Themes */
  .config-panel :global(.theme-grid) { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
  .config-panel :global(.theme-card) {
    display: flex; flex-direction: column; gap: 4px; padding: 6px;
    border: 1px solid var(--app-border); border-radius: 7px; background: var(--app-surface-sunken);
  }
  .config-panel :global(.theme-card.active) { border-color: var(--app-focus-ring); }
  .config-panel :global(.thumb) { width: 100%; aspect-ratio: 4 / 3; border-radius: 4px; overflow: hidden; background: var(--app-control-bg); border: 1px solid var(--app-border-subtle); }
  .config-panel :global(.thumb iframe) { width: 100%; height: 100%; border: 0; transform: scale(0.6); transform-origin: top left; width: 167%; height: 167%; }
  .config-panel :global(.thumb-placeholder) {
    width: 100%; height: 100%; display: grid; place-content: center;
    gap: 5px; padding: 12px; background:
      linear-gradient(135deg, var(--app-surface), var(--app-control-bg));
  }
  .config-panel :global(.theme-fallback-title) { font-size: 22px; font-weight: 700; color: var(--app-text); line-height: 1; }
  .config-panel :global(.theme-fallback-line) { display: block; width: 68px; height: 4px; border-radius: 999px; background: var(--app-border-strong); }
  .config-panel :global(.theme-fallback-line.short) { width: 46px; }
  .config-panel :global(.theme-info) { display: flex; flex-direction: column; gap: 1px; }
  .config-panel :global(.theme-name) { font-size: 12px; font-weight: 600; color: var(--app-text); }
  .config-panel :global(.theme-author) { font-size: 10px; color: var(--app-text-faint); }
  .config-panel :global(.theme-actions) { display: flex; align-items: center; gap: 6px; }
  .config-panel :global(.badge) { font-size: 10px; color: var(--app-text-faint); background: var(--app-surface-hover); padding: 1px 6px; border-radius: 9px; }
  .config-panel :global(.muted.dim) { font-size: 11px; }

  /* Styles */
  .config-panel :global(.style-list) { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .config-panel :global(.style-list li) {
    display: flex; align-items: center; gap: 8px; padding: 7px 9px;
    border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken);
  }
  .config-panel :global(.style-list li.active) { border-color: var(--app-focus-ring); }
  .config-panel :global(.style-row) { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; cursor: pointer; }
  .config-panel :global(.style-name) { font-size: 12px; color: var(--app-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, monospace; }

  /* Design tokens */
  .config-panel :global(.token-row) { justify-content: space-between; }
  .config-panel :global(.token-row.dirty .token-label) { color: var(--app-accent, #4ea1ff); }
  .config-panel :global(.token-label) { flex: 1; font-size: 12px; color: var(--app-text-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .config-panel :global(.control) { display: flex; align-items: center; gap: 6px; }
  .config-panel :global(.control.color input[type="color"]) { width: 28px; height: 28px; padding: 0; border: 1px solid var(--app-border); border-radius: 4px; background: var(--app-control-bg); cursor: pointer; }
  .config-panel :global(.control.color .swatch) { width: 28px; height: 28px; border-radius: 4px; border: 1px solid var(--app-border); }
  .config-panel :global(.control.size) { gap: 4px; }
  .config-panel :global(.control.size input[type="number"]) { width: 64px; padding: 5px 6px; background: var(--app-surface-sunken); border: 1px solid var(--app-border); color: var(--app-text-secondary); border-radius: 4px; font-size: 12px; }
  .config-panel :global(.unit) { font-size: 11px; color: var(--app-text-faint); }
  .config-panel :global(.save-status) { font-size: 11px; }
  .config-panel :global(.save-status.saving) { color: var(--app-text-muted); }
  .config-panel :global(.save-status.saved) { color: var(--app-success-text, #3fb950); }

  /* Plugins */
  .config-panel :global(.plugin-list), .config-panel :global(.rec-list) { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .config-panel :global(.plugin-list li), .config-panel :global(.rec-list li) { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken); }
  .config-panel :global(.plugin-list li.disabled) { opacity: 0.6; }
  .config-panel :global(.plugin-main), .config-panel :global(.rec-main) { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .config-panel :global(.plugin-name) { font-size: 12px; color: var(--app-text); font-family: ui-monospace, monospace; word-break: break-all; }
  .config-panel :global(.plugin-meta) { display: flex; align-items: center; gap: 8px; font-size: 11px; }
  .config-panel :global(.kind) { color: var(--app-text-faint); }
  .config-panel :global(.status) { display: inline-flex; align-items: center; gap: 3px; font-weight: 500; }
  .config-panel :global(.status.ok) { color: var(--app-success-text, #3fb950); }
  .config-panel :global(.status.error) { color: var(--app-error-text); }
  .config-panel :global(.status.checking), .config-panel :global(.status.disabled) { color: var(--app-text-faint); }
  .config-panel :global(.status-detail) { margin: 0; font-size: 11px; color: var(--app-error-text); line-height: 1.35; }
  .config-panel :global(.status-raw) { margin: 2px 0 0; }
  .config-panel :global(.status-raw > summary) { font-size: 11px; color: var(--app-text-muted); cursor: pointer; user-select: none; }
  .config-panel :global(.status-raw > pre) { margin: 4px 0 0; padding: 6px; font-size: 11px; color: var(--app-text-muted); background: var(--app-control-bg); border: 1px solid var(--app-border); border-radius: 4px; white-space: pre-wrap; word-break: break-word; }
  .config-panel :global(.rec-label) { font-size: 12px; font-weight: 600; color: var(--app-text); }
  .config-panel :global(.rec-desc) { margin: 0; font-size: 11px; color: var(--app-text-muted); line-height: 1.4; }
  .config-panel :global(.rec-pkg) { font-size: 10px; color: var(--app-text-faint); font-family: ui-monospace, monospace; }
  .config-panel :global(.added) { font-size: 11px; color: var(--app-text-faint); font-style: italic; }

  .config-panel :global(.toggle) { flex-shrink: 0; width: 36px; height: 20px; border-radius: 10px; background: var(--app-border); border: 1px solid var(--app-border); position: relative; cursor: pointer; padding: 0; }
  .config-panel :global(.toggle.on) { background: var(--app-focus-ring); border-color: var(--app-focus-ring); }
  .config-panel :global(.toggle .knob) { position: absolute; top: 1px; left: 1px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 0.15s; }
  .config-panel :global(.toggle.on .knob) { transform: translateX(15px); }
  .config-panel :global(.toggle:focus-visible) { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .config-panel :global(.toggle:disabled) { opacity: 0.5; cursor: progress; }

  .config-panel :global(.advanced > summary) { cursor: pointer; user-select: none; font-size: 12px; font-weight: 600; color: var(--app-text-muted); padding: 4px 0; list-style-position: inside; }

  .empty { padding: 24px; text-align: center; color: var(--app-text-faint); font-size: 13px; }

  @media (max-width: 480px) {
    .config-panel :global(.theme-grid) { grid-template-columns: 1fr 1fr; }
  }
</style>
