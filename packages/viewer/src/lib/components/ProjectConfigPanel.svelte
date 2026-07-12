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
   * This is the COMPOSITION ROOT: it instantiates one `*SectionController`
   * per domain (UX review M14 — the controller-per-section extraction the
   * Design section started) and renders six presentational children (one per
   * domain) under `./config/`, passing each ITS controller as a single prop.
   * The children carry no state, no `api` value import — all `api.*` calls
   * live in the controllers under `$lib/routes/*-section-controller.svelte.ts`.
   * Each section owns its OWN CSS in its own style block; only the
   * primitives genuinely shared across sections live in
   * `$lib/styles/config-section-shared.css`, `@import`ed per section (see
   * that file's header for why).
   *
   * Six sections, each owning its own controller + `api.*` calls (no
   * `$effect`: data loads on mount + after mutations, mirroring the
   * History-tab pattern):
   *   1. Details    — title, authors, output filename, source files (manifest
   *                    fields with NO prior writer — `api.manifest.{read,setFields}`).
   *   2. Appearance — theme grid: apply / remove / import (folder + URL).
   *                    `api.theme.*`.
   *   3. Styles     — active-stylesheet toggle + open-in-editor.
   *                    `api.style.setActive` + `api.project.listStyles`.
   *   4. Design     — `:root` CSS custom properties (colors + sizes) parsed +
   *                    written client-side (regex + canvas hex-normalise),
   *                    debounced per token. Ported verbatim from the retired
   *                    DesignPanel; this was the first section to get the
   *                    controller extraction.
   *   5. Plugins    — configured list + toggle + validate, plus the
   *                    recommended built-in features and an advanced
   *                    add-by-name/local path. `api.plugin.*`.
   *   6. Publish    — provider cards, connect/settings/run. `api.publish.*`.
   *
   * Cross-section refresh: applying/removing a theme changes the active
   * stylesheet, so Appearance's controller is given an `afterThemeChange`
   * hook wired to reload Styles + Design; toggling a stylesheet similarly
   * gives Styles' controller an `afterStyleChange` hook wired to reload
   * Design. Every other refresh is a section reloading its own state after
   * its own mutation — no other cross-controller coupling exists.
   *
   * PWA-clean (§8): only `import type` from the lib; everything value-bearing
   * goes through `api.*` HTTP routes or raw fs routes, all inside the
   * controllers. No Node/host imports in this module or any controller.
   */
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import type { ToastController } from "$lib/components/Toast.svelte";
  import { DetailsSectionController } from "$lib/routes/details-section-controller.svelte";
  import { AppearanceSectionController } from "$lib/routes/appearance-section-controller.svelte";
  import { StylesSectionController } from "$lib/routes/styles-section-controller.svelte";
  import { DesignSectionController } from "$lib/routes/design-section-controller.svelte";
  import { PluginsSectionController } from "$lib/routes/plugins-section-controller.svelte";
  import { PublishSectionController } from "$lib/routes/publish-section-controller.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import DetailsSection from "$lib/components/config/DetailsSection.svelte";
  import AppearanceSection from "$lib/components/config/AppearanceSection.svelte";
  import StylesSection from "$lib/components/config/StylesSection.svelte";
  import DesignSection from "$lib/components/config/DesignSection.svelte";
  import PluginsSection from "$lib/components/config/PluginsSection.svelte";
  import PublishSection from "$lib/components/config/PublishSection.svelte";

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

  // Covers the initial parallel load of all sections.
  let loadingAll = $state(true);

  const projectDirAccessor = () => projectDir;

  // ── (4) Design — depended on by Appearance's/Styles' cross-refresh hooks,
  //     so it's constructed first. ────────────────────────────────────────
  const design = new DesignSectionController({
    projectDir: projectDirAccessor,
    listStyles: (dir) => api.project.listStyles(dir),
    readFile: (path) => api.fs.readFile(path),
    writeFile: (path, content) => api.fs.writeFile(path, content),
    onError: (msg) => toast?.error?.(msg),
    onEditRawCss: (path) => onEditRawCss?.(path),
  });

  // ── (3) Styles — refreshes Design after a toggle. ──────────────────────
  const styles = new StylesSectionController({
    projectDir: projectDirAccessor,
    listStyles: (dir) => api.project.listStyles(dir),
    setActive: (dir, paths) => api.style.setActive(dir, paths),
    onToggled: (on) => toast?.success?.(on ? "Stylesheet enabled." : "Stylesheet disabled."),
    onEditRawCss: (path) => onEditRawCss?.(path),
    afterStyleChange: () => design.loadDesign(),
  });

  // ── (1) Details ─────────────────────────────────────────────────────────
  const details = new DetailsSectionController({
    projectDir: projectDirAccessor,
    readManifest: (dir) => api.manifest.read(dir),
    writeManifest: (dir, updates) => api.manifest.setFields(dir, updates),
    onSaved: () => toast?.success?.("Project details saved."),
    onError: (msg) => toast?.error?.(msg),
  });

  // ── (2) Appearance — refreshes Styles + Design after apply/remove. ─────
  const appearance = new AppearanceSectionController({
    projectDir: projectDirAccessor,
    listBuiltIn: () => api.theme.listBuiltIn(),
    listProject: (dir) => api.theme.listProject(dir),
    getActive: (dir) => api.theme.getActive(dir),
    apply: (dir, target) => api.theme.apply(dir, target),
    remove: (dir, id) => api.theme.remove(dir, id),
    importFromFolder: (dir) => api.theme.importFromFolder(dir),
    importFromUrl: (dir, url) => api.theme.importFromUrl(dir, url),
    readCss: (dir, source) => api.theme.readCss(dir, source),
    onApplied: (themeId) => {
      onThemeApplied?.(themeId);
      toast?.success?.("Theme applied — your preview is updating. Use Design to fine-tune.");
    },
    afterThemeChange: async () => {
      await Promise.all([styles.loadStyles(), design.loadDesign()]);
    },
  });

  // ── (5) Plugins ─────────────────────────────────────────────────────────
  const plugins = new PluginsSectionController({
    projectDir: projectDirAccessor,
    list: (dir) => api.plugin.list(dir),
    recommended: () => api.plugin.recommended(),
    validate: (dir) => api.plugin.validate(dir),
    setEnabled: (dir, ref, enabled) => api.plugin.setEnabled(dir, ref, enabled),
    addNpm: (dir, name) => api.plugin.addNpm(dir, name),
    addLocal: (dir) => api.plugin.addLocal(dir),
  });

  // ── (6) Publish (#35) ───────────────────────────────────────────────────
  const publish = new PublishSectionController({
    projectDir: projectDirAccessor,
    listProviders: (dir) => api.publish.listProviders(dir),
    setConfig: (dir, providerId, values) => api.publish.setConfig(dir, providerId, values),
    connect: (dir, providerId, token) => api.publish.connect(dir, providerId, token),
    disconnect: (providerId) => api.publish.disconnect(providerId),
    run: (dir, providerId, options) => api.publish.run(dir, providerId, options),
    pickPdfFile: () => api.dialog.pickPdfFile(),
    openDirectory: () => api.dialog.openDirectory(),
    openExternal: (url) => api.shell.openExternal(url),
    onSaved: () => toast?.success?.("Publish settings saved."),
    onConnected: () => toast?.success?.("Connected — the key is stored securely on this computer."),
    onPublished: (guided) =>
      toast?.success?.(guided ? "Upload package ready — follow the checklist to finish." : "Published!"),
  });

  // ── Lifecycle: load every section's data on mount ────────────────────────

  onMount(() => {
    let cancelled = false;
    void loadAll().finally(() => {
      if (!cancelled) loadingAll = false;
    });
    return () => {
      cancelled = true;
      void design.flushPendingTokenWrites();
    };
  });

  async function loadAll(): Promise<void> {
    if (!projectDir) return;
    // Sections load in parallel — none depend on another.
    await Promise.allSettled([
      details.loadDetails(),
      appearance.loadThemes(),
      styles.loadStyles(),
      design.loadDesign(),
      plugins.loadPlugins(),
      publish.loadPublish(),
    ]);
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
      <DetailsSection controller={details} />
      <AppearanceSection controller={appearance} />
      <StylesSection controller={styles} />
      <DesignSection controller={design} />
      <PluginsSection controller={plugins} />
      <PublishSection controller={publish} />
    </div>
  {/if}
</div>

<style>
  @import "$lib/styles/config-section-shared.css";

  /* Structural chrome owned by this root (scoped). Every section's own CSS
     lives in its own component now (UX review M14). The header's Close
     button and the top-level "Loading…"/empty-state text are rendered
     directly by THIS component's own template and still use the shared
     button/text primitives (`.ghost`, `.small`, `.muted`, generic `button`),
     so this file `@import`s the same shared layer the sections do — see
     `$lib/styles/config-section-shared.css` for the full rationale. */
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

  .empty { padding: 24px; text-align: center; color: var(--app-text-faint); font-size: 13px; }
</style>
