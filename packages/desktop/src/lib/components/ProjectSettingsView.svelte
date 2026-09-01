<script lang="ts">
  /**
   * ProjectSettingsView — the full-window "Project settings" surface, patterned
   * after the app SettingsView (header + close, tab bar, one cohesive slice per
   * tab). It replaced the left-sidebar Config tab (and with it the retired
   * ProjectConfigPanel): the sidebar's 260px column was a cramped frame for
   * manifest editing, theme browsing, and plugin management.
   *
   * This is the COMPOSITION ROOT for the per-domain section controllers
   * (UX review M14): it instantiates one `*SectionController` per domain and
   * renders the presentational sections under `./config/`, passing each ITS
   * controller as a single prop. The children carry no state and no `api`
   * value import — all `api.*` calls live in the controllers under
   * `$lib/routes/*-section-controller.svelte.ts`.
   *
   * Four tabs, backed by FIVE controllers (no `$effect`: data loads on mount +
   * after mutations, mirroring SettingsView/History):
   *   1. Details       — title, authors, output filename, source files
   *                      (`api.manifest.{read,setFields}`).
   *   2. Look & style  — theme grid (`AppearanceSection`) → design tokens
   *                      (`DesignSection`) → the raw stylesheet list
   *                      (`StylesSection`) behind an "Advanced" disclosure
   *                      (UX review M35's writer-shaped merge, unchanged).
   *   3. Plugins       — configured list + toggle + validate + recommended
   *                      built-ins (`api.plugin.*`).
   *   4. Connections   — this project's sync surface (remote diagnosis +
   *                      Test Remote Access; `ProjectConnectionsSection`,
   *                      self-loading — no controller).
   *
   * Cross-section refresh: applying/removing a theme changes the active
   * stylesheet, so Appearance's controller reloads Styles + Design
   * (`afterThemeChange`); toggling a stylesheet reloads Design
   * (`afterStyleChange`). Every other refresh is a section reloading its own
   * state after its own mutation.
   *
   * The body carries the `.config-panel` class: the sections' shared chrome
   * (`$lib/styles/config-section-shared.css`, @imported per section) scopes
   * every rule under that ancestor class.
   *
   * PWA-clean (§8): only `import type` from the lib; everything value-bearing
   * goes through `api.*` HTTP routes or `$lib/files/files-capability`'s typed
   * IPC inside the controllers.
   */
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import { readFile, writeFile, listDir } from "$lib/files/files-capability";
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
  import ProjectConnectionsSection from "$lib/components/ProjectConnectionsSection.svelte";
  import { PRINT_TOOL_IDS } from "$lib/publish-targets";

  let {
    projectDir,
    repoRoot = null,
    toast = null,
    onThemeApplied,
    onEditRawCss,
    onClose,
    onOpenAccounts,
  }: {
    projectDir: string | null;
    /** The repo the open book belongs to — lets the pickers offer SHARED styles. */
    repoRoot?: string | null;
    toast?: ToastController | null;
    /** Fire after a theme apply so the parent can surface the right toast. */
    onThemeApplied?: (themeId: string) => void;
    /** Escape hatch: open a stylesheet in the raw-CSS editor (the parent
     *  closes this view first). */
    onEditRawCss?: (cssPath: string) => void;
    /** Close the view — return to the workspace. */
    onClose?: () => void;
    /** Open the app Settings view on the Accounts tab (the parent closes
     *  this view first). Used by the Connections tab's guidance. */
    onOpenAccounts?: () => void;
  } = $props();

  // Covers the initial parallel load of all sections.
  let loadingAll = $state(true);
  // Focus target on open: opening the view makes the whole workspace (and the
  // toolbar button that opened it) inert, which would drop keyboard focus to
  // <body> — so the close button takes it, mirroring dialog behavior.
  let closeBtnEl = $state<HTMLButtonElement | undefined>(undefined);

  const projectDirAccessor = () => projectDir;

  // ── Design — depended on by Appearance's/Styles' cross-refresh hooks,
  //    so it's constructed first. ─────────────────────────────────────────
  const design = new DesignSectionController({
    projectDir: projectDirAccessor,
    listStyles: (dir) => api.project.listStyles(dir, repoRoot),
    readFile: (path) => readFile(path),
    writeFile: (path, content) => writeFile(path, content),
    onError: (msg) => toast?.error?.(msg),
    onEditRawCss: (path) => onEditRawCss?.(path),
  });

  // ── Styles — refreshes Design after a toggle. ──────────────────────────
  const styles = new StylesSectionController({
    projectDir: projectDirAccessor,
    listStyles: (dir) => api.project.listStyles(dir, repoRoot),
    setActive: (dir, paths) => api.style.setActive(dir, paths),
    onToggled: (on) => toast?.success?.(on ? "Stylesheet enabled." : "Stylesheet disabled."),
    onEditRawCss: (path) => onEditRawCss?.(path),
    afterStyleChange: () => design.loadDesign(),
  });

  // ── Details ─────────────────────────────────────────────────────────────
  const details = new DetailsSectionController({
    projectDir: projectDirAccessor,
    readManifest: (dir) => api.manifest.read(dir),
    writeManifest: (dir, updates) => api.manifest.setFields(dir, updates),
    // The source-files list universe: top-level markdown files (the same set
    // the render pipeline includes when the manifest lists none).
    listMarkdownFiles: (dir) =>
      listDir(dir).then((entries) =>
        entries.filter((e) => !e.isDir && /\.md$/i.test(e.name)).map((e) => e.name),
      ),
    // Which print tools are absent, for the publish-targets note — the same
    // /api/doctor data the Help tab shows.
    listMissingPrintTools: () =>
      api
        .doctor()
        .then((d) =>
          (d.tools ?? [])
            .filter((t) => !t.found && PRINT_TOOL_IDS.includes(t.id))
            .map((t) => t.id),
        ),
    onSaved: () => toast?.success?.("Project details saved."),
    onError: (msg) => toast?.error?.(msg),
  });

  // ── Appearance — refreshes Styles + Design after apply/remove. ─────────
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
      toast?.success?.("Theme applied — close Project settings to see it in the preview. Use Design to fine-tune.");
    },
    afterThemeChange: async () => {
      await Promise.all([styles.loadStyles(), design.loadDesign()]);
    },
  });

  // ── Plugins ─────────────────────────────────────────────────────────────
  const plugins = new PluginsSectionController({
    projectDir: projectDirAccessor,
    list: (dir) => api.plugin.list(dir),
    recommended: () => api.plugin.recommended(),
    validate: (dir) => api.plugin.validate(dir),
    setEnabled: (dir, ref, enabled) => api.plugin.setEnabled(dir, ref, enabled),
    addNpm: (dir, name, exportName) => api.plugin.addNpm(dir, name, exportName),
    addLocal: (dir) => api.plugin.addLocal(dir),
  });

  // ── Lifecycle: load every section's data on mount ────────────────────────
  onMount(() => {
    closeBtnEl?.focus();
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

  // ── Tabs (SettingsView pattern: WAI-ARIA tabs, arrow-key navigation) ──────
  type ProjectSettingsTab = "details" | "look" | "plugins" | "connections";
  const TABS: Array<{ id: ProjectSettingsTab; label: string }> = [
    { id: "details", label: "Details" },
    { id: "look", label: "Look & style" },
    { id: "plugins", label: "Plugins" },
    { id: "connections", label: "Connections" },
  ];
  let activeTab = $state<ProjectSettingsTab>("details");
  let tabEls = $state<Record<ProjectSettingsTab, HTMLButtonElement | undefined>>({
    details: undefined,
    look: undefined,
    plugins: undefined,
    connections: undefined,
  });

  function onTablistKeydown(e: KeyboardEvent) {
    const ids = TABS.map((tab) => tab.id);
    const current = ids.indexOf(activeTab);
    let next: number | undefined;
    if (e.key === "ArrowRight") next = (current + 1) % ids.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + ids.length) % ids.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = ids.length - 1;
    if (next === undefined) return;
    e.preventDefault();
    activeTab = ids[next]!;
    tabEls[activeTab]?.focus();
  }

  function close() {
    onClose?.();
  }
</script>

<div class="settings-view" aria-busy={loadingAll}>
  <header class="settings-header">
    <h2 id="project-settings-title">Project settings</h2>
    <button bind:this={closeBtnEl} class="settings-close" onclick={close} title="Close project settings (Esc)" aria-label="Close project settings"><Icon name="x" size={16} /></button>
  </header>

  <div class="tab-bar" role="tablist" aria-label="Project settings sections" onkeydown={onTablistKeydown} tabindex="-1">
    {#each TABS as tab (tab.id)}
      <button
        id="project-settings-tab-{tab.id}"
        role="tab"
        class="tab"
        class:active={activeTab === tab.id}
        aria-selected={activeTab === tab.id}
        aria-controls="project-settings-panel"
        tabindex={activeTab === tab.id ? 0 : -1}
        bind:this={tabEls[tab.id]}
        onclick={() => (activeTab = tab.id)}
      >{tab.label}</button>
    {/each}
  </div>

  <div
    id="project-settings-panel"
    class="settings-body config-panel"
    role="tabpanel"
    aria-labelledby="project-settings-tab-{activeTab}"
  >
    {#if !hasProject}
      <div class="empty">
        <p>Open a project folder to configure it.</p>
      </div>
    {:else if loadingAll}
      <p class="loading">Loading…</p>
    {:else}
      {#if activeTab === "details"}
        <DetailsSection controller={details} />
      {/if}

      {#if activeTab === "look"}
        <!-- UX review M35: theme grid → design tokens → stylesheet list,
             merged under one writer-shaped "Look & style" heading. The
             stylesheet list is a plain always-visible section — project
             settings has no collapsible sections. -->
        <section class="block look-style">
          <h3>Look &amp; style</h3>
          <AppearanceSection controller={appearance} />
          <DesignSection controller={design} />
          <div class="advanced">
            <h4 class="advanced-heading">Stylesheets</h4>
            <div class="advanced-body">
              <StylesSection controller={styles} />
            </div>
          </div>
        </section>
      {/if}

      {#if activeTab === "plugins"}
        <PluginsSection controller={plugins} />
      {/if}

      {#if activeTab === "connections"}
        <!-- This project's connection details (moved from the app Settings'
             Connections tab, 2026-07-30). Accounts/credentials stay global in
             Settings → Accounts; onOpenAccounts routes there. -->
        <ProjectConnectionsSection {projectDir} {onOpenAccounts} />
      {/if}
    {/if}
  </div>
</div>

<style>
  /* Frame CSS mirrors SettingsView so the two settings surfaces read as one
     family; section chrome comes from config-section-shared.css via the
     `.config-panel` class on the body (see the header comment). */
  .settings-view {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    background: var(--app-bg);
    color: var(--app-text-secondary);
  }
  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    padding: 12px 16px;
    border-bottom: 1px solid var(--app-border);
    background: var(--app-surface-raised);
  }
  .settings-header h2 {
    margin: 0;
    color: var(--app-text);
    font-size: 15px;
  }
  .settings-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border: 1px solid var(--app-border);
    border-radius: 5px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
  }
  .settings-close:hover { background: var(--app-control-hover-bg); color: var(--app-text); }
  .settings-close:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .settings-body {
    flex: 1;
    min-height: 0;
    padding: 16px 18px;
    overflow-y: auto;
    /* A comfortable reading measure — the sidebar's 260px column was the whole
       reason this became a full view; unbounded width is just as unfriendly.
       border-box: there is no global reset, and content-box width:100% plus
       the 18px side padding would overflow the fixed sheet horizontally on
       windows narrower than ~896px (Codex review, PR #118). */
    box-sizing: border-box;
    max-width: 860px;
    width: 100%;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  /* ── Tab bar (SettingsView pattern) ── */
  .tab-bar {
    display: flex;
    gap: 2px;
    padding: 0 16px;
    border-bottom: 1px solid var(--app-border-subtle);
    flex-shrink: 0;
    overflow-x: auto;
  }
  .tab {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--app-text-muted);
    font-size: 12.5px;
    padding: 8px 10px;
    cursor: pointer;
    white-space: nowrap;
  }
  .tab:hover { color: var(--app-text); }
  .tab.active {
    color: var(--app-text);
    border-bottom-color: var(--app-accent);
    font-weight: 600;
  }
  .tab:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: -2px; }

  .empty { padding: 24px; text-align: center; color: var(--app-text-muted); font-size: 13px; }
  .loading { margin: 0; font-size: 13px; color: var(--app-text-muted); }

  /* The merged "Look & style" section: the gap between its three panes and
     the stylesheet sub-section chrome are owned here. `.block`/`h3` chrome
     comes from the shared layer. */
  .settings-body .look-style { gap: 14px; }
  .look-style :global(.look-subsection) { display: flex; flex-direction: column; gap: 8px; }
  .advanced {
    border-top: 1px solid var(--app-border-subtle);
    padding-top: 8px;
  }
  .advanced-heading {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    color: var(--app-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .advanced-body { padding-top: 10px; }
</style>
