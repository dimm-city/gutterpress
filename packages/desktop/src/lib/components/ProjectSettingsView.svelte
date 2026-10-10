<script lang="ts">
  /**
   * ProjectSettingsView — the "Book settings" surface (tab bar, one cohesive
   * slice per tab), opened in the shared AppView layer because a sidebar
   * column is a cramped frame for manifest editing, theme browsing, and
   * plugin management. AppView owns the frame, the close control, Escape and
   * focus (a dialog on top, e.g. "Save as template…", takes Escape first).
   *
   * This is the COMPOSITION ROOT for the per-domain section controllers: it
   * instantiates one `*SectionController` per domain and renders the
   * presentational sections under `./config/`, passing each ITS controller as a
   * single prop. The children carry no state and no `api` value import — all
   * `api.*` calls live in the controllers under
   * `$lib/routes/*-section-controller.svelte.ts`.
   *
   * Four tabs, backed by FOUR controllers (no `$effect`: data loads on mount +
   * after mutations, mirroring SettingsView/History):
   *   1. Details     — title, authors, output filename, source files
   *                    (`api.manifest.{read,setFields}`).
   *   2. Look        — the extensions that carry styles (`LookSection`)
   *                    → design tokens (`DesignSection`) → the raw stylesheet
   *                    list (`StylesSection`) under a "Stylesheets" heading.
   *                    The section heading is "Look & style" — it covers all
   *                    three subsections — while the tab button itself is
   *                    shortened to "Look" to pair with "Features" (#243).
   *   3. Features    — the extensions that carry markdown: toggle, remove,
   *                    validate, the recommended bundled features, npm /
   *                    local add (`FeaturesSection`).
   *   4. Connections — this project's sync surface (remote diagnosis +
   *                    Test Remote Access; `ProjectConnectionsSection`,
   *                    self-loading — no controller).
   *
   * #243/#265 — Look and Features are two VIEWS over ONE `extensions:` list
   * and one verb set, owned by the single `ExtensionsSectionController`
   * instance (`extensions` below; `api.extension.*`). `afterLookChange`
   * (a styles-carrying extension was added/removed/toggled/moved → reload
   * Styles + Design) and `afterStyleChange` (a stylesheet was toggled →
   * reload Design) are the cross-section refresh hooks; every other refresh
   * is a section reloading its own state after its own mutation.
   *
   * The body carries the `.config-panel` class: the sections' shared chrome
   * (`$lib/styles/config-section-shared.css`, @imported per section) scopes
   * every rule under that ancestor class.
   *
   * PWA-clean (§8): only `import type` from the lib; everything value-bearing
   * goes through `api.*` HTTP routes inside the controllers.
   */
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import { useSettings } from "$lib/settings.svelte";
  import type { ToastController } from "$lib/components/Toast.svelte";
  import { DetailsSectionController } from "$lib/routes/details-section-controller.svelte";
  import { ExtensionsSectionController } from "$lib/routes/extensions-section-controller.svelte";
  import { StylesSectionController } from "$lib/routes/styles-section-controller.svelte";
  import { DesignSectionController } from "$lib/routes/design-section-controller.svelte";
  import AppView from "$lib/components/AppView.svelte";
  import DetailsSection from "$lib/components/config/DetailsSection.svelte";
  import LookSection from "$lib/components/config/LookSection.svelte";
  import StylesSection from "$lib/components/config/StylesSection.svelte";
  import DesignSection from "$lib/components/config/DesignSection.svelte";
  import FeaturesSection from "$lib/components/config/FeaturesSection.svelte";
  import ProjectConnectionsSection from "$lib/components/ProjectConnectionsSection.svelte";
  import SaveTemplateDialog from "$lib/components/SaveTemplateDialog.svelte";
  import { PRINT_TOOL_IDS } from "$lib/publish-targets";

  let {
    projectDir,
    repoRoot = null,
    initialTab = "details",
    toast = null,
    onEditRawCss,
    onClose,
    onOpenAccounts,
    onVersionHistoryEnabled,
    triggerEl,
  }: {
    projectDir: string | null;
    /** The repo the open book belongs to — lets the pickers offer SHARED styles. */
    repoRoot?: string | null;
    /** Tab to open on. Read once at mount (the view is keyed per open). */
    initialTab?: "details" | "features" | "connections";
    toast?: ToastController | null;
    /** Escape hatch: open a stylesheet in the raw-CSS editor (the parent
     *  closes this view first). */
    onEditRawCss?: (cssPath: string) => void;
    /** Close the view — return to the workspace. */
    onClose?: () => void;
    /** Open the app Settings view on the Accounts tab (the parent closes
     *  this view first). Used by the Connections tab's guidance. */
    onOpenAccounts?: () => void;
    /** The Connections tab just turned on version history: re-read the project's classification. */
    onVersionHistoryEnabled?: (projectDir: string) => void;
    /** The control that opened the view, for focus restore on close. */
    triggerEl?: HTMLElement | null;
  } = $props();

  // Covers the initial parallel load of all sections.
  let loadingAll = $state(true);

  const projectDirAccessor = () => projectDir;

  // ── Design — depended on by Extensions'/Styles' cross-refresh hooks,
  //    so it's constructed first. ─────────────────────────────────────────
  const design = new DesignSectionController({
    projectDir: projectDirAccessor,
    listStyles: (dir) => api.project.listStyles(dir, repoRoot),
    listExtensions: (dir) => api.extension.list(dir),
    readFile: (path) => api.fs.readFile(path),
    writeFile: (path, content) => api.fs.writeFile(path, content),
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
      api.fs
        .listDir(dir)
        .then((entries) => entries.filter((e) => !e.isDir && /\.md$/i.test(e.name)).map((e) => e.name)),
    // Which print tools are absent, for the publish-targets note — the same
    // /api/doctor data Troubleshooting → Diagnostics shows.
    listMissingPrintTools: () =>
      api
        .doctor()
        .then((d) =>
          (d.tools ?? [])
            .filter((t) => !t.found && PRINT_TOOL_IDS.includes(t.id))
            .map((t) => t.id),
        ),
    onSaved: () => toast?.success?.("Book details saved."),
    onError: (msg) => toast?.error?.(msg),
  });

  const settings = useSettings();

  // ── Extensions — ONE list, two views (#243/#265). A change to a look
  //    refreshes Styles + Design. ─────────────────────────────────────────
  const extensions = new ExtensionsSectionController({
    projectDir: projectDirAccessor,
    list: (dir) => api.extension.list(dir),
    recommended: () => api.extension.recommended(),
    listBuiltIn: () => api.extension.listBuiltIn(),
    search: (query) => api.extension.search(query),
    outdated: (dir, includePrerelease) => api.extension.outdated(dir, includePrerelease),
    versions: (name) => api.extension.versions(name),
    includePrerelease: () => settings.current.updates.includeExtensionPrereleases,
    setIncludePrerelease: (on) => settings.set({ updates: { includeExtensionPrereleases: on } }),
    validate: (dir) => api.extension.validate(dir),
    add: (dir, specifier, exportName) => api.extension.add(dir, specifier, exportName),
    addLocal: (dir) => api.extension.addLocal(dir),
    addBuiltIn: (dir, id) => api.extension.addBuiltIn(dir, id),
    remove: (dir, use) => api.extension.remove(dir, use),
    setEnabled: (dir, use, enabled) => api.extension.setEnabled(dir, use, enabled),
    reorder: (dir, order) => api.extension.reorder(dir, order),
    readCss: (dir, use) => api.extension.readCss(dir, use),
    importFromFile: (dir) => api.extension.importFromFile(dir),
    importFromUrl: (dir, url) => api.extension.importFromUrl(dir, url),
    onLookAdded: (label) => {
      toast?.success?.(`${label} added — it now shows in the preview. Use Design to fine-tune.`);
    },
    afterLookChange: async () => {
      await Promise.all([styles.loadStyles(), design.loadDesign()]);
    },
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
      extensions.loadExtensions(),
      styles.loadStyles(),
      design.loadDesign(),
    ]);
  }

  const hasProject = $derived(!!projectDir);

  // ── Tabs (SettingsView pattern: WAI-ARIA tabs, arrow-key navigation) ──────
  //
  // #243/#265: "Look" and "Features" are the two author-facing views over
  // the ONE `extensions` controller above. They stay separate TAB BUTTONS
  // rather than nesting a second tab bar inside a single "Extensions" entry —
  // this tab bar already gives them exactly that with no new navigation
  // component. See `docs/ux-design-contract.md` sections 9 and 11.
  type ProjectSettingsTab = "details" | "look" | "features" | "connections";
  const TABS: Array<{ id: ProjectSettingsTab; label: string }> = [
    { id: "details", label: "Details" },
    { id: "look", label: "Look" },
    { id: "features", label: "Features" },
    { id: "connections", label: "Connections" },
  ];
  // svelte-ignore state_referenced_locally
  let activeTab = $state<ProjectSettingsTab>(initialTab);
  let tabEls = $state<Record<ProjectSettingsTab, HTMLButtonElement | undefined>>({
    details: undefined,
    look: undefined,
    features: undefined,
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

  // "Save as template…" (Details tab) — mounted fresh per open so its form
  // resets; the opening button is remembered for focus restore.
  let templateDialogTrigger = $state<HTMLButtonElement | null>(null);
</script>

<AppView title="Book settings" icon="wrench" measure={860} onClose={close} {triggerEl}>
  <div class="tab-bar" role="tablist" aria-label="Book settings sections" onkeydown={onTablistKeydown} tabindex="-1">
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
    aria-busy={loadingAll}
    role="tabpanel"
    aria-labelledby="project-settings-tab-{activeTab}"
  >
    {#if !hasProject}
      <div class="empty">
        <p>Open a book to configure it.</p>
      </div>
    {:else if loadingAll}
      <p class="loading">Loading…</p>
    {:else}
      {#if activeTab === "details"}
        <DetailsSection controller={details} onSaveAsTemplate={(el) => (templateDialogTrigger = el)} />
      {/if}

      {#if activeTab === "look"}
        <!-- The Look grid → design tokens → stylesheet list,
             merged under one writer-shaped "Look & style" heading (the tab
             button itself is shortened to "Look", #243 — see the header
             comment). The stylesheet list is a plain always-visible section
             - book settings has no collapsible sections. -->
        <section class="block look-style">
          <h3>Look &amp; style</h3>
          <LookSection controller={extensions} />
          <DesignSection controller={design} />
          <div class="advanced">
            <h4 class="advanced-heading">Stylesheets</h4>
            <div class="advanced-body">
              <StylesSection controller={styles} />
            </div>
          </div>
        </section>
      {/if}

      {#if activeTab === "features"}
        <FeaturesSection controller={extensions} />
      {/if}

      {#if activeTab === "connections"}
        <!-- This project's connection details. Accounts/credentials stay
             global in Settings → Accounts; onOpenAccounts routes there. -->
        <ProjectConnectionsSection {projectDir} {onOpenAccounts} {onVersionHistoryEnabled} />
      {/if}
    {/if}
  </div>
{#if templateDialogTrigger && projectDir}
    <SaveTemplateDialog
      {projectDir}
      {toast}
      triggerEl={templateDialogTrigger}
      onClose={() => (templateDialogTrigger = null)}
    />
  {/if}
</AppView>

<style>
  /* Section chrome comes from config-section-shared.css via the
     `.config-panel` class on the body (see the header comment); the frame,
     title and close control are AppView's. */
  .settings-body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    color: var(--app-text-secondary);
  }
  /* ── Tab bar (SettingsView pattern) ── */
  .tab-bar {
    display: flex;
    gap: 2px;
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
