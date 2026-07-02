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
  import Icon from "$lib/components/Icon.svelte";

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
  let _hexCtx: CanvasRenderingContext2D | null | undefined;

  // (5) Plugins
  let plugins = $state<ProjectPluginEntry[]>([]);
  let validation = $state<Record<string, PluginValidationResult>>({});
  let recommended = $state<RecommendedPlugin[]>([]);
  let pluginValidating = $state(false);
  let pluginError = $state<string | null>(null);
  let pluginBusyRef = $state<string | null>(null);
  let npmName = $state("");

  // ── Style-token helpers (client-side; ported from the retired DesignPanel) ─

  function makeStyleToken(name: string, raw: string): StyleToken {
    const label = name.replace(/^--/, "").replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    if (/^#[0-9a-fA-F]{3,8}$|^rgba?\s*\(|^hsla?\s*\(|^oklch\s*\(|^color\s*\(/.test(raw)) {
      return { name, value: raw, kind: "color", label };
    }
    const len = raw.match(/^(-?[\d.]+)\s*(px|rem|em|vh|vw|vmin|vmax|%|pt|cm|mm|in|ex|ch)\b/i);
    if (len) {
      return { name, value: raw, kind: "length", label, number: parseFloat(len[1]), unit: len[2] };
    }
    return { name, value: raw, kind: "text", label };
  }

  function parseStyleTokens(cssText: string): StyleToken[] {
    const out: StyleToken[] = [];
    const rootRe = /:root\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = rootRe.exec(cssText)) !== null) {
      for (const line of m[1].split("\n")) {
        const pair = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*;/);
        if (pair) out.push(makeStyleToken(pair[1], pair[2]));
      }
    }
    return out;
  }

  function updateRootToken(cssText: string, name: string, value: string): string {
    const escaped = name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
    const existing = new RegExp(`(${escaped}\\s*:)[^;]*(;)`, "g");
    if (existing.test(cssText)) {
      return cssText.replace(new RegExp(`(${escaped}\\s*:)[^;]*(;)`, "g"), `$1 ${value}$2`);
    }
    return cssText.replace(/(:root\s*\{)/, `$1\n  ${name}: ${value};`);
  }

  function toHex(value: string): string | null {
    try {
      if (_hexCtx === undefined) _hexCtx = document.createElement("canvas").getContext("2d");
      if (!_hexCtx) return null;
      _hexCtx.fillStyle = "#000000";
      _hexCtx.fillStyle = value;
      const out = _hexCtx.fillStyle;
      return typeof out === "string" && /^#[0-9a-f]{6}$/i.test(out) ? out : null;
    } catch {
      return null;
    }
  }
  const colorHex = (v: string) => toHex(v) ?? v;

  const colorTokens = $derived(tokens.filter((t) => t.kind === "color"));
  const sizeTokens = $derived(tokens.filter((t) => t.kind === "length"));
  const otherTokens = $derived(tokens.filter((t) => t.kind === "text"));
  const isDirty = (t: StyleToken) => originals.has(t.name) && originals.get(t.name) !== t.value;
  const anyDirty = $derived(tokens.some(isDirty));

  // ── Theme thumbnail srcdoc (ported verbatim from the retired ThemeManager) ─

  function sampleSrcdoc(css: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
html,body{margin:0;padding:0;} body{padding:14px 16px;} *{box-sizing:border-box;}
${css}
</style></head><body>
<h1>Chapter Title</h1>
<h2>A Section Heading</h2>
<p>The quick brown fox jumps over the lazy dog. Typography, color, and
spacing preview rendered with this theme&rsquo;s stylesheet.</p>
<blockquote>A short pull quote shows callout and accent styling.</blockquote>
<h3>Subheading</h3>
<ul><li>First list item</li><li>Second list item</li></ul>
<p><a href="#">A themed link</a> with <code>inline code</code>.</p>
</body></html>`;
  }

  const keyOf = (t: ThemeInfo) => `${t.kind}:${t.id}`;

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

  /** True when this theme card is the project's active applied theme. */
  function isActiveTheme(t: ThemeInfo): boolean {
    // The active theme always lives in the project (apply copies built-ins into
    // themes/<id>). Match the project-kind card only, so a built-in card doesn't
    // also light up when its copy is the active project theme.
    return t.kind === "project" && activeThemeId === t.id;
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

  // Per-token debounced write (ported from the retired DesignPanel).
  const tokenTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const tokenPending = new Map<string, string>();

  function scheduleTokenWrite(name: string, value: string): void {
    tokenPending.set(name, value);
    designSaveStatus = "saving";
    const existing = tokenTimers.get(name);
    if (existing) clearTimeout(existing);
    tokenTimers.set(
      name,
      setTimeout(() => {
        tokenTimers.delete(name);
        void commitToken(name, value);
      }, 250),
    );
  }

  function flushPendingTokenWrites(): void {
    for (const t of tokenTimers.values()) clearTimeout(t);
    tokenTimers.clear();
    for (const [name, value] of [...tokenPending.entries()]) void commitToken(name, value);
  }

  async function commitToken(name: string, value: string): Promise<void> {
    if (!cssPath) return;
    try {
      const css = await api.fs.readFile(cssPath);
      await api.fs.writeFile(cssPath, updateRootToken(css, name, value));
      tokenPending.delete(name);
      if (tokenPending.size === 0 && tokenTimers.size === 0) designSaveStatus = "saved";
    } catch (e) {
      designSaveStatus = "idle";
      toast?.error?.(`Couldn't save ${name}: ${e instanceof Error ? e.message : String(e)}`);
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

  function isPluginConfigured(name: string): boolean {
    return plugins.some((p) => p.ref === name);
  }

  /** Status text/icon for one plugin (ported from the retired PluginManager). */
  function pluginStatus(entry: ProjectPluginEntry): {
    label: string;
    kind: "ok" | "error" | "disabled" | "checking";
    detail?: string;
    raw?: string;
  } {
    if (!entry.enabled) return { label: "Disabled", kind: "disabled" };
    const v = validation[entry.ref];
    if (pluginValidating && !v) return { label: "Checking…", kind: "checking" };
    if (!v) return { label: "Checking…", kind: "checking" };
    if (v.ok) return { label: "Loads OK", kind: "ok" };
    const needsInstall = entry.kind === "npm";
    return {
      label: needsInstall ? "Not installed" : "Error",
      kind: "error",
      detail: needsInstall
        ? "This plugin isn't installed yet, so it's skipped in the preview. Install it in your project, then click Re-check."
        : "This plugin couldn't load. See details below, then click Re-check.",
      raw: v.error,
    };
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

      <!-- (1) Details ─────────────────────────────────────────────────────── -->
      <section class="block">
        <h3>Details</h3>
        {#if detailsError}
          <p class="error" role="alert">{detailsError}</p>
        {/if}
        <label class="field">
          <span class="lbl">Title</span>
          <input
            class="input"
            type="text"
            value={titleDraft}
            oninput={(e) => (titleDraft = e.currentTarget.value)}
            placeholder="Untitled project"
          />
        </label>
        <div class="field">
          <span class="lbl">Authors</span>
          <div class="authors">
            {#each authorsDraft as _, i (i)}
              <div class="author-row">
                <input
                  class="input"
                  type="text"
                  value={authorsDraft[i]}
                  oninput={(e) => setAuthor(i, e.currentTarget.value)}
                  placeholder="Author name"
                  aria-label={`Author ${i + 1}`}
                />
                <button class="ghost icononly" onclick={() => removeAuthor(i)} title="Remove author" aria-label={`Remove author ${i + 1}`}>
                  <Icon name="x" size={13} />
                </button>
              </div>
            {/each}
            <button class="ghost small add" onclick={addAuthor}><Icon name="plus" size={12} /> Add author</button>
          </div>
        </div>
        <label class="field">
          <span class="lbl">Output filename</span>
          <input
            class="input"
            type="text"
            value={outputDraft}
            oninput={(e) => (outputDraft = e.currentTarget.value)}
            placeholder="book.pdf"
          />
        </label>
        <label class="field">
          <span class="lbl">Source files</span>
          <textarea
            class="input"
            rows="3"
            placeholder="chapter-01.md&#10;chapter-02.md&#10;(Leave blank to include all chapter files.)"
            oninput={(e) => (sourceDraft = e.currentTarget.value)}
          >{sourceDraft}</textarea>
          <span class="hint">One file per line. Leave blank to include all markdown files in the project.</span>
        </label>
        <button class="primary small" onclick={saveDetails} disabled={detailsSaving}>
          {detailsSaving ? "Saving…" : "Save details"}
        </button>
      </section>

      <!-- (2) Appearance ──────────────────────────────────────────────────── -->
      <section class="block">
        <h3>Appearance</h3>
        {#if themeError}
          <p class="error" role="alert">{themeError}</p>
        {/if}
        <p class="hint">Pick a look — applying copies the theme into your project and wires the manifest.</p>
        <ul class="theme-grid">
          {#each builtIns as t (keyOf(t))}
            {@render themeCard(t)}
          {/each}
          {#each projectThemes as t (keyOf(t))}
            {@render themeCard(t)}
          {/each}
        </ul>
        <div class="actions row">
          <button class="ghost small" onclick={importThemeFolder} disabled={themeBusyId !== null} title="Import a theme from a folder on disk">
            <Icon name="folder" size={13} /> Import from folder…
          </button>
        </div>
        <div class="add-row">
          <input
            class="input"
            type="text"
            placeholder="Theme URL (.css or theme folder)"
            value={themeUrl}
            oninput={(e) => (themeUrl = e.currentTarget.value)}
            onkeydown={(e) => { if (e.key === "Enter") importThemeUrl(); }}
          />
          <button class="ghost small" onclick={importThemeUrl} disabled={themeBusyId !== null}>Import</button>
        </div>
      </section>

      <!-- (3) Styles ─────────────────────────────────────────────────────── -->
      <section class="block">
        <h3>Styles</h3>
        {#if stylesError}
          <p class="error" role="alert">{stylesError}</p>
        {/if}
        {#if styles.length === 0}
          <p class="muted">No stylesheets found. Apply a theme to create one.</p>
        {:else}
          <ul class="style-list">
            {#each styles as s (s.path)}
              <li class:active={s.active}>
                <label class="style-row" title={s.path}>
                  <input
                    type="checkbox"
                    checked={s.active}
                    onchange={(e) => toggleStyleActive(s, e.currentTarget.checked)}
                    disabled={stylesBusy}
                    aria-label={`Enable ${s.displayName}`}
                  />
                  <span class="style-name">{s.displayName}</span>
                  {#if s.active}<span class="badge">active</span>{/if}
                </label>
                <button class="ghost small" onclick={() => editStyle(s)} title="Open in editor">
                  <Icon name="file-text" size={13} /> Edit
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <!-- (4) Design ─────────────────────────────────────────────────────── -->
      <section class="block">
        <div class="block-head">
          <h3>Design</h3>
          <div class="row">
            {#if designSaveStatus === "saving"}<span class="save-status saving" aria-live="polite">Saving…</span>
            {:else if designSaveStatus === "saved"}<span class="save-status saved" aria-live="polite">Changes saved</span>{/if}
            {#if anyDirty}
              <button class="ghost small" onclick={revertAllTokens} title="Revert all changes">Revert</button>
            {/if}
          </div>
        </div>
        {#if designLoading}
          <p class="muted">Loading…</p>
        {:else if designError}
          <p class="error" role="alert">{designError}</p>
        {:else if !cssPath}
          <p class="muted">No active stylesheet. Apply a theme first, then fine-tune its colors and sizes here.</p>
        {:else if tokens.length === 0}
          <p class="muted">{cssName} doesn't expose any settings yet. Use “Edit raw CSS” to add <code>:root</code> custom properties.</p>
        {:else}
          <p class="hint">Editing {cssName} — changes apply live to the preview.</p>
          {#if colorTokens.length > 0}
            <h4 class="subhead">Colors</h4>
            {#each colorTokens as t (t.name)}
              <div class="row token-row" class:dirty={isDirty(t)}>
                <label for={`cfg-${t.name}`} class="token-label">{t.label}</label>
                <div class="control color">
                  {#if toHex(t.value)}
                    <input id={`cfg-${t.name}`} type="color" value={colorHex(t.value)} oninput={(e) => setToken(t, e.currentTarget.value)} title={t.value} />
                  {:else}
                    <span class="swatch" style="background: {t.value}" title={t.value}></span>
                  {/if}
                  <input class="input sharp" type="text" value={colorHex(t.value)} oninput={(e) => setToken(t, e.currentTarget.value)} title={t.value} aria-label={`${t.label} value`} />
                </div>
                {#if isDirty(t)}
                  <button class="ghost icononly" onclick={() => resetToken(t)} title="Reset to original" aria-label={`Reset ${t.label}`}>
                    <Icon name="refresh-cw" size={12} />
                  </button>
                {/if}
              </div>
            {/each}
          {/if}
          {#if sizeTokens.length > 0}
            <h4 class="subhead">Sizes</h4>
            {#each sizeTokens as t (t.name)}
              <div class="row token-row" class:dirty={isDirty(t)}>
                <label for={`cfg-${t.name}`} class="token-label">{t.label}</label>
                <div class="control size">
                  <input id={`cfg-${t.name}`} type="number" value={t.number} oninput={(e) => setLength(t, e.currentTarget.value)} step="0.1" aria-label={`${t.label} number`} />
                  <span class="unit">{t.unit}</span>
                </div>
                {#if isDirty(t)}
                  <button class="ghost icononly" onclick={() => resetToken(t)} title="Reset" aria-label={`Reset ${t.label}`}>
                    <Icon name="refresh-cw" size={12} />
                  </button>
                {/if}
              </div>
            {/each}
          {/if}
          {#if otherTokens.length > 0}
            <h4 class="subhead">Other</h4>
            {#each otherTokens as t (t.name)}
              <div class="row token-row" class:dirty={isDirty(t)}>
                <label for={`cfg-${t.name}`} class="token-label">{t.label}</label>
                <div class="control">
                  <input id={`cfg-${t.name}`} class="input sharp" type="text" value={t.value} oninput={(e) => setToken(t, e.currentTarget.value)} aria-label={`${t.label} value`} />
                </div>
                {#if isDirty(t)}
                  <button class="ghost icononly" onclick={() => resetToken(t)} title="Reset" aria-label={`Reset ${t.label}`}>
                    <Icon name="refresh-cw" size={12} />
                  </button>
                {/if}
              </div>
            {/each}
          {/if}
          <button class="ghost small" onclick={editRawCss} title="Open the active stylesheet in the raw editor">
            <Icon name="file-text" size={13} /> Edit raw CSS
          </button>
        {/if}
      </section>

      <!-- (5) Plugins ─────────────────────────────────────────────────────── -->
      <section class="block">
        <div class="block-head">
          <h3>Plugins</h3>
          <button class="ghost small" onclick={validatePlugins} disabled={pluginValidating} title="Re-check that each plugin loads">
            <Icon name="refresh-cw" size={13} /> Re-check
          </button>
        </div>
        {#if pluginError}
          <p class="error" role="alert">{pluginError}</p>
        {/if}
        {#if plugins.length === 0}
          <p class="muted">No plugins configured yet. Add one below, or pick a feature above.</p>
        {:else}
          <ul class="plugin-list">
            {#each plugins as entry (entry.ref)}
              {@const st = pluginStatus(entry)}
              <li class:disabled={!entry.enabled}>
                <div class="plugin-main">
                  <span class="plugin-name">{entry.ref}</span>
                  <span class="plugin-meta">
                    <span class="kind">{entry.kind === "local" ? "local file" : "npm"}</span>
                    <span class={`status ${st.kind}`}>
                      {#if st.kind === "ok"}<Icon name="circle-check" size={12} />
                      {:else if st.kind === "error"}<Icon name="triangle-alert" size={12} />
                      {:else if st.kind === "checking"}<Icon name="refresh-cw" size={12} />{/if}
                      {st.label}
                    </span>
                  </span>
                  {#if st.detail}<p class="status-detail">{st.detail}</p>{/if}
                  {#if st.raw}
                    <details class="status-raw"><summary>Show details</summary><pre>{st.raw}</pre></details>
                  {/if}
                </div>
                <button class="toggle" class:on={entry.enabled} role="switch" aria-checked={entry.enabled} aria-label={`${entry.enabled ? "Disable" : "Enable"} ${entry.ref}`} disabled={pluginBusyRef === entry.ref} onclick={() => togglePlugin(entry)}>
                  <span class="knob"></span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        <h4 class="subhead">Markdown features</h4>
        <p class="hint">Turn a feature on and it works instantly — these are built in, nothing to install.</p>
        <ul class="rec-list">
          {#each recommended as rec (rec.name)}
            <li>
              <div class="rec-main">
                <span class="rec-label">{rec.label ?? rec.name}</span>
                <p class="rec-desc">{rec.description}</p>
                <span class="rec-pkg">{rec.name}</span>
              </div>
              {#if isPluginConfigured(rec.name)}
                <span class="added"><Icon name="circle-check" size={12} /> On</span>
              {:else}
                <button class="primary small" onclick={() => addRecommended(rec)} disabled={pluginBusyRef !== null}>Turn on</button>
              {/if}
            </li>
          {/each}
        </ul>

        <details class="advanced">
          <summary>Advanced: add another plugin</summary>
          <div class="add-row">
            <input class="input" type="text" placeholder="npm package name (e.g. markdown-it-footnote)" value={npmName} oninput={(e) => (npmName = e.currentTarget.value)} onkeydown={(e) => { if (e.key === "Enter") addNpmPlugin(); }} />
            <button class="primary small" onclick={addNpmPlugin} disabled={pluginBusyRef !== null}>Add</button>
          </div>
          <button class="ghost small full" onclick={addLocalPlugin} disabled={pluginBusyRef !== null}>
            <Icon name="folder" size={14} /> Import from local file or folder…
          </button>
          <p class="hint">A plugin added by name must already be installed in your project. Local files are referenced directly.</p>
        </details>
      </section>

    </div>
  {/if}
</div>

{#snippet themeCard(t: ThemeInfo)}
  <li class="theme-card" class:active={isActiveTheme(t)}>
    <div class="thumb">
      {#if thumbs[keyOf(t)] && thumbs[keyOf(t)] !== "__fallback__"}
        <iframe title={`Preview of ${t.name}`} srcdoc={thumbs[keyOf(t)]} sandbox="allow-same-origin" loading="lazy"></iframe>
      {:else}
        <div class="thumb-placeholder" role="img" aria-label={`Theme preview loading for ${t.name}`}>
          <span class="theme-fallback-title">Aa</span>
          <span class="theme-fallback-line"></span>
          <span class="theme-fallback-line short"></span>
        </div>
      {/if}
    </div>
    <div class="theme-info">
      <span class="theme-name">{t.name}</span>
      {#if t.author}<span class="theme-author">{t.author}</span>{/if}
      {#if isActiveTheme(t)}<span class="badge">active</span>{/if}
    </div>
    <div class="theme-actions">
      {#if isActiveTheme(t)}
        <span class="muted dim">Current theme</span>
        {#if t.kind === "project"}
          <button class="ghost small" onclick={() => removeTheme(t)} disabled={themeBusyId !== null} title="Remove this project theme">Remove</button>
        {/if}
      {:else}
        <button class="primary small" onclick={() => applyTheme(t)} disabled={themeBusyId !== null}>Apply</button>
        {#if t.kind === "project"}
          <button class="ghost icononly" onclick={() => removeTheme(t)} disabled={themeBusyId !== null} title="Remove" aria-label={`Remove ${t.name}`}>
            <Icon name="trash" size={13} />
          </button>
        {/if}
      {/if}
    </div>
  </li>
{/snippet}

<style>
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

  .block { display: flex; flex-direction: column; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--app-border-subtle); }
  .block:last-child { border-bottom: none; }
  .block h3 {
    margin: 0; font-size: 12px; font-weight: 600; color: var(--app-text);
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .block-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .subhead { margin: 6px 0 2px; font-size: 11px; font-weight: 600; color: var(--app-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }

  .muted { margin: 0; font-size: 13px; color: var(--app-text-muted); }
  .error { margin: 0; color: var(--app-error-text); font-size: 12px; }
  .hint { margin: 0; font-size: 11.5px; color: var(--app-text-faint); line-height: 1.4; }
  .row { display: flex; align-items: center; gap: 8px; }

  .field { display: flex; flex-direction: column; gap: 3px; }
  .field .lbl { font-size: 11px; color: var(--app-text-muted); font-weight: 500; }
  .input {
    background: var(--app-surface-sunken); border: 1px solid var(--app-border);
    color: var(--app-text-secondary); padding: 7px 9px; border-radius: 5px;
    font-size: 13px; font-family: inherit; width: 100%; box-sizing: border-box;
  }
  .input:focus { outline: none; border-color: var(--app-focus-ring); }
  textarea.input { resize: vertical; font-family: ui-monospace, monospace; font-size: 12px; }
  .input.sharp { width: auto; min-width: 0; flex: 1; }

  .authors { display: flex; flex-direction: column; gap: 4px; }
  .author-row { display: flex; gap: 4px; align-items: center; }
  .author-row .input { flex: 1; }
  .add { align-self: flex-start; }

  button {
    display: inline-flex; align-items: center; gap: 5px; padding: 7px 12px;
    font-size: 13px; border-radius: 5px; cursor: pointer; border: 1px solid transparent;
    font-family: inherit;
  }
  button.small { padding: 5px 10px; font-size: 12px; }
  button.icononly { padding: 5px; }
  .primary { background: var(--app-focus-ring); color: var(--app-text-on-accent); }
  .primary:hover:not(:disabled) { background: var(--app-accent-hover); }
  .ghost { background: transparent; color: var(--app-text-muted); border-color: var(--app-border); }
  .ghost:hover:not(:disabled) { background: var(--app-surface-hover); color: var(--app-text); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.full { width: 100%; justify-content: center; }

  .add-row { display: flex; gap: 6px; }
  .add-row .input { flex: 1; }

  /* Themes */
  .theme-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
  .theme-card {
    display: flex; flex-direction: column; gap: 4px; padding: 6px;
    border: 1px solid var(--app-border); border-radius: 7px; background: var(--app-surface-sunken);
  }
  .theme-card.active { border-color: var(--app-focus-ring); }
  .thumb { width: 100%; aspect-ratio: 4 / 3; border-radius: 4px; overflow: hidden; background: var(--app-control-bg); border: 1px solid var(--app-border-subtle); }
  .thumb iframe { width: 100%; height: 100%; border: 0; transform: scale(0.6); transform-origin: top left; width: 167%; height: 167%; }
  .thumb-placeholder {
    width: 100%; height: 100%; display: grid; place-content: center;
    gap: 5px; padding: 12px; background:
      linear-gradient(135deg, var(--app-surface), var(--app-control-bg));
  }
  .theme-fallback-title { font-size: 22px; font-weight: 700; color: var(--app-text); line-height: 1; }
  .theme-fallback-line { display: block; width: 68px; height: 4px; border-radius: 999px; background: var(--app-border-strong); }
  .theme-fallback-line.short { width: 46px; }
  .theme-info { display: flex; flex-direction: column; gap: 1px; }
  .theme-name { font-size: 12px; font-weight: 600; color: var(--app-text); }
  .theme-author { font-size: 10px; color: var(--app-text-faint); }
  .theme-actions { display: flex; align-items: center; gap: 6px; }
  .badge { font-size: 10px; color: var(--app-text-faint); background: var(--app-surface-hover); padding: 1px 6px; border-radius: 9px; }
  .muted.dim { font-size: 11px; }

  /* Styles */
  .style-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .style-list li {
    display: flex; align-items: center; gap: 8px; padding: 7px 9px;
    border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken);
  }
  .style-list li.active { border-color: var(--app-focus-ring); }
  .style-row { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; cursor: pointer; }
  .style-name { font-size: 12px; color: var(--app-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, monospace; }

  /* Design tokens */
  .token-row { justify-content: space-between; }
  .token-row.dirty .token-label { color: var(--app-accent, #4ea1ff); }
  .token-label { flex: 1; font-size: 12px; color: var(--app-text-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .control { display: flex; align-items: center; gap: 6px; }
  .control.color input[type="color"] { width: 28px; height: 28px; padding: 0; border: 1px solid var(--app-border); border-radius: 4px; background: var(--app-control-bg); cursor: pointer; }
  .control.color .swatch { width: 28px; height: 28px; border-radius: 4px; border: 1px solid var(--app-border); }
  .control.size { gap: 4px; }
  .control.size input[type="number"] { width: 64px; padding: 5px 6px; background: var(--app-surface-sunken); border: 1px solid var(--app-border); color: var(--app-text-secondary); border-radius: 4px; font-size: 12px; }
  .unit { font-size: 11px; color: var(--app-text-faint); }
  .save-status { font-size: 11px; }
  .save-status.saving { color: var(--app-text-muted); }
  .save-status.saved { color: var(--app-success-text, #3fb950); }

  /* Plugins */
  .plugin-list, .rec-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .plugin-list li, .rec-list li { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken); }
  .plugin-list li.disabled { opacity: 0.6; }
  .plugin-main, .rec-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .plugin-name { font-size: 12px; color: var(--app-text); font-family: ui-monospace, monospace; word-break: break-all; }
  .plugin-meta { display: flex; align-items: center; gap: 8px; font-size: 11px; }
  .kind { color: var(--app-text-faint); }
  .status { display: inline-flex; align-items: center; gap: 3px; font-weight: 500; }
  .status.ok { color: var(--app-success-text, #3fb950); }
  .status.error { color: var(--app-error-text); }
  .status.checking, .status.disabled { color: var(--app-text-faint); }
  .status-detail { margin: 0; font-size: 11px; color: var(--app-error-text); line-height: 1.35; }
  .status-raw { margin: 2px 0 0; }
  .status-raw > summary { font-size: 11px; color: var(--app-text-muted); cursor: pointer; user-select: none; }
  .status-raw > pre { margin: 4px 0 0; padding: 6px; font-size: 11px; color: var(--app-text-muted); background: var(--app-control-bg); border: 1px solid var(--app-border); border-radius: 4px; white-space: pre-wrap; word-break: break-word; }
  .rec-label { font-size: 12px; font-weight: 600; color: var(--app-text); }
  .rec-desc { margin: 0; font-size: 11px; color: var(--app-text-muted); line-height: 1.4; }
  .rec-pkg { font-size: 10px; color: var(--app-text-faint); font-family: ui-monospace, monospace; }
  .added { font-size: 11px; color: var(--app-text-faint); font-style: italic; }

  .toggle { flex-shrink: 0; width: 36px; height: 20px; border-radius: 10px; background: var(--app-border); border: 1px solid var(--app-border); position: relative; cursor: pointer; padding: 0; }
  .toggle.on { background: var(--app-focus-ring); border-color: var(--app-focus-ring); }
  .toggle .knob { position: absolute; top: 1px; left: 1px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 0.15s; }
  .toggle.on .knob { transform: translateX(15px); }
  .toggle:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .toggle:disabled { opacity: 0.5; cursor: progress; }

  .advanced > summary { cursor: pointer; user-select: none; font-size: 12px; font-weight: 600; color: var(--app-text-muted); padding: 4px 0; list-style-position: inside; }

  .empty { padding: 24px; text-align: center; color: var(--app-text-faint); font-size: 13px; }

  @media (max-width: 480px) {
    .theme-grid { grid-template-columns: 1fr 1fr; }
  }
</style>
