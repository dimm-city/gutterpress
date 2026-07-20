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
   * Design section started) and renders four presentational sections (one per
   * domain) under `./config/`, passing each ITS controller as a single prop.
   * The children carry no state, no `api` value import — all `api.*` calls
   * live in the controllers under `$lib/routes/*-section-controller.svelte.ts`.
   * Each section owns its OWN CSS in its own style block; only the
   * primitives genuinely shared across sections live in
   * `$lib/styles/config-section-shared.css`, `@import`ed per section (see
   * that file's header for why).
   *
   * Four sections, still backed by SIX controllers (no `$effect`: data loads
   * on mount + after mutations, mirroring the History-tab pattern):
   *   1. Details       — title, authors, output filename, source files
   *                       (manifest fields with NO prior writer —
   *                       `api.manifest.{read,setFields}`).
   *   2. Look & style  — UX review M35: Appearance/Styles/Design used to be
   *                       three separate developer-shaped sections named after
   *                       API namespaces rather than "how my book looks."
   *                       They're merged into ONE writer-shaped section here —
   *                       theme grid (`AppearanceSection`, `api.theme.*`) →
   *                       design tokens (`DesignSection`, client-side `:root`
   *                       custom-property parse/write) → the raw stylesheet
   *                       checkbox list (`StylesSection`, `api.style.setActive`
   *                       + `api.project.listStyles`) demoted behind an
   *                       "Advanced" disclosure, since a writer almost never
   *                       needs to hand-toggle individual stylesheets. Three
   *                       controllers still back it 1:1 (kept from W5 — this
   *                       merge is composition/IA, not new state machinery);
   *                       only the presentation collapsed to one heading.
   *   3. Plugins       — configured list + toggle + validate, plus the
   *                       recommended built-in features and an advanced
   *                       add-by-name/local path. `api.plugin.*`.
   *   4. Publish       — provider cards, connect/settings/run. `api.publish.*`.
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
  import Icon from "$lib/components/Icon.svelte";
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
    getPrevious: (dir) => api.theme.getPrevious(dir),
    apply: (dir, target) => api.theme.apply(dir, target),
    revert: (dir) => api.theme.revert(dir),
    remove: (dir, id) => api.theme.remove(dir, id),
    importFromFolder: (dir) => api.theme.importFromFolder(dir),
    importFromFile: (dir) => api.theme.importFromFile(dir),
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

  // Publishing (#35) moved OUT of this panel to the front-and-centre toolbar
  // PublishWizard (it used to be the crammed last section here). The
  // PublishSectionController now lives in +page.svelte and drives the wizard.

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
      <!-- UX review M35: theme grid → design tokens → stylesheet list (behind
           Advanced), merged under one writer-shaped "Look & style" heading —
           see the header comment above for the full rationale. -->
      <section class="block look-style">
        <h3>Look &amp; style</h3>
        <AppearanceSection controller={appearance} />
        <DesignSection controller={design} />
        <details class="advanced">
          <summary class="advanced-summary">Advanced: stylesheets</summary>
          <div class="advanced-body">
            <StylesSection controller={styles} />
          </div>
        </details>
      </section>
      <PluginsSection controller={plugins} />
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

  .empty { padding: 24px; text-align: center; color: var(--app-text-muted); font-size: 13px; }

  /* UX review M35 — the merged "Look & style" section. `.block`/`h3` come
     from the shared import above; only the layout gap between its three
     panes (theme grid / design tokens / Advanced disclosure) and the
     disclosure chrome are owned here, since `<details>`/`<summary>` are
     literal elements in THIS component's own template (not a child's), so
     plain scoped CSS applies without needing `:global(...)`. The gap override
     is qualified with the `.config-panel` ancestor (also this component's own
     root element) so its specificity safely beats the shared `:global(.config-panel
     .block)` gap rule regardless of CSS source-file ordering. */
  .config-panel .look-style { gap: 14px; }
  .look-style :global(.look-subsection) { display: flex; flex-direction: column; gap: 8px; }
  .advanced {
    border-top: 1px solid var(--app-border-subtle);
    padding-top: 8px;
  }
  .advanced-summary {
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--app-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .advanced-summary::-webkit-details-marker { display: none; }
  .advanced-summary::before { content: "▸"; font-size: 10px; }
  .advanced[open] > .advanced-summary::before { content: "▾"; }
  .advanced-body { padding-top: 10px; }
</style>
