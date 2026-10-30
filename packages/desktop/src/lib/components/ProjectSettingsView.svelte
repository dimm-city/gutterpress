<script lang="ts">
  /**
   * ProjectSettingsView — the "Book setup" surface (the toolbar's Setup
   * button), opened in the shared AppView layer because a sidebar column is a
   * cramped frame for manifest editing and choosing a look. AppView owns the
   * frame, the close control, Escape and focus (a dialog on top, e.g. "Save as
   * template…", takes Escape first).
   *
   * This is the COMPOSITION ROOT for the per-domain section controllers: it
   * instantiates one `*SectionController` per domain and renders the
   * presentational sections under `./config/`, passing each its controller.
   * The children carry no state — the `api.*` calls live in the controllers
   * under `#lib/routes/*-section-controller.svelte.ts`.
   *
   * Tabs Book · Look · Extensions · Online copy, and Advanced set apart at the
   * right; four controllers (no `$effect`: data loads on mount + after
   * mutations):
   *   1. Book     — title, authors, page size and margins, print checks,
   *                 chapters (`DetailsSection`, `api.manifest.*`,
   *                 `api.pageSize.*`); flushed on tab switch and close.
   *   2. Look     — choose a look, adjust six brand settings beside a live
   *                 sample (`LookSection`: the extensions AND design
   *                 controllers).
   *   3. Extensions — the manifest's ordered extension list and the one Add
   *                 area: built-in extras, npm, folders and web addresses
   *                 (`ExtensionsSection`).
   *   4. Online copy (id `online-copy`) — saved versions, Version history
   *                 (opens inside the tab), revisions and this book's online
   *                 copy (`ProjectConnectionsSection`, self-loading — no
   *                 controller).
   *   5. Advanced — the one place for developer controls: the manifest file,
   *                 the stylesheet list (`StylesSection`), and every design
   *                 setting (`DesignSection`).
   *
   * Every write shows in the header's one Saving… / Saved. `afterLookChange`
   * and `afterChange` (a styles-carrying extension or a stylesheet changed →
   * reload the design settings) are the cross-section refresh hooks; every
   * other refresh is a section reloading its own state after its own
   * mutation.
   *
   * The body carries the `.config-panel` class: the sections' shared chrome
   * (`#lib/styles/config-section-shared.css`, @imported per section) scopes
   * every rule under that ancestor class.
   *
   * PWA-clean (§8): only `import type` from the lib; everything value-bearing
   * goes through `api.*` HTTP routes inside the controllers.
   */
  import { onMount, tick } from "svelte";
  import { api } from "#lib/api.ts";
  import type { ToastController } from "#lib/components/Toast.svelte";
  import { joinPath } from "#lib/platform/paths.ts";
  import { DetailsSectionController } from "#lib/routes/details-section-controller.svelte.ts";
  import { ExtensionsSectionController } from "#lib/routes/extensions-section-controller.svelte.ts";
  import { StylesSectionController } from "#lib/routes/styles-section-controller.svelte.ts";
  import { DesignSectionController } from "#lib/routes/design-section-controller.svelte.ts";
  import AppView from "#lib/components/AppView.svelte";
  import Tabs from "#lib/components/Tabs.svelte";
  import DetailsSection from "#lib/components/config/DetailsSection.svelte";
  import LookSection from "#lib/components/config/LookSection.svelte";
  import ExtensionsSection from "#lib/components/config/ExtensionsSection.svelte";
  import StylesSection from "#lib/components/config/StylesSection.svelte";
  import DesignSection from "#lib/components/config/DesignSection.svelte";
  import { firstHeading } from "#lib/components/config/source-files.ts";
  import ProjectConnectionsSection from "#lib/components/ProjectConnectionsSection.svelte";
  import type { LastBackup } from "#lib/backup-state.ts";
  import SaveTemplateDialog from "#lib/components/SaveTemplateDialog.svelte";
  import { PRINT_TOOL_IDS } from "#lib/publish-targets.ts";

  let {
    projectDir,
    repoRoot = null,
    initialTab = "book",
    toast = null,
    onOpenFile,
    onClose,
    backup = null,
    versionsProblem = null,
    onVersionHistoryEnabled,
    onBackupSetUp,
    onProjectFilesChanged,
    onBackUpNow,
    onRepair,
    onSaveVersion,
    onBrowseVersions,
    onCloseBook,
    onOpenAccounts,
    triggerEl,
  }: {
    projectDir: string | null;
    /** The repo the open book belongs to — lets the pickers offer SHARED styles. */
    repoRoot?: string | null;
    /** Tab to open on. Read once at mount (the view is keyed per open). */
    initialTab?: "book" | "extensions" | "online-copy";
    toast?: ToastController | null;
    /** Open one of the book's files (absolute path) in the editor; the parent
     *  closes this view first. Advanced › Open manifest.yaml, and a stylesheet's Open. */
    onOpenFile?: (path: string) => void;
    /** Close the view — return to the workspace. */
    onClose?: () => void;
    /** The online copy's last word for this book (the host's stream or the last Sync). */
    backup?: LastBackup | null;
    /** Automatic versions keep failing, and why. */
    versionsProblem?: { message: string | null } | null;
    /** The Online copy tab just turned on version history: re-read the project's classification. */
    onVersionHistoryEnabled?: (projectDir: string) => void;
    /** The Online copy tab just set up or signed in to the online copy: re-read the project's state. */
    onBackupSetUp?: (projectDir: string) => void;
    /** The Online copy tab just switched to, made or renamed a revision: the book's files changed on disk. */
    onProjectFilesChanged?: () => void;
    /** The Online copy tab's Sync now: the page's sync. */
    onBackUpNow?: () => Promise<void>;
    /** The Online copy tab's Repair the online copy: the page's repair. */
    onRepair?: () => Promise<void>;
    /** The Online copy tab's Save a version: the page's save; resolves "unchanged" when there was nothing new. */
    onSaveVersion?: () => Promise<"saved" | "unchanged">;
    /** Online copy › Version history: the parent opens the Version history screen over this one. */
    onBrowseVersions?: (id?: string) => void;
    /** Close the book: the Online copy tab's Start over from the online copy ends with it. */
    onCloseBook?: () => Promise<boolean>;
    /** Open the Accounts page, over this one. */
    onOpenAccounts?: () => void;
    /** The control that opened the view, for focus restore on close. */
    triggerEl?: HTMLElement | null;
  } = $props();

  // Covers the initial parallel load of all sections.
  let loadingAll = $state(true);

  const projectDirAccessor = () => projectDir;

  // ── Design — depended on by Extensions' cross-refresh hook, so it's
  //    constructed first. ───────────────────────────────────────────────────
  const design = new DesignSectionController({
    projectDir: projectDirAccessor,
    listStyles: (dir) => api.project.listStyles(dir, repoRoot),
    listExtensions: (dir) => api.extension.list(dir),
    readCss: (dir, use) => api.extension.readCss(dir, use),
    readFile: (path) => api.fs.readFile(path),
    writeFile: (path, content) => api.fs.writeFile(path, content),
    setActiveStyles: (dir, paths) => api.style.setActive(dir, paths),
    onError: (msg) => toast?.error?.(msg),
  });

  // ── Book ────────────────────────────────────────────────────────────────
  const details = new DetailsSectionController({
    projectDir: projectDirAccessor,
    readManifest: (dir) => api.manifest.read(dir),
    writeManifest: (dir, updates) => api.manifest.setFields(dir, updates),
    // Page geometry (#357): the manifest's size and margins, read and written there.
    readPageSetup: (dir) => api.pageSize.read(dir),
    writePageSetup: (dir, choice) => api.pageSize.set(dir, choice),
    // The source-files list universe: top-level markdown files (the same set
    // the render pipeline includes when the manifest lists none).
    listMarkdownFiles: (dir) =>
      api.fs
        .listDir(dir)
        .then((entries) => entries.filter((e) => !e.isDir && /\.md$/i.test(e.name)).map((e) => e.name)),
    // A chapter is named by its first heading.
    readFirstHeading: (dir, path) => api.fs.readFile(joinPath(dir, path)).then(firstHeading),
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
    onError: (msg) => toast?.error?.(msg),
  });

  // ── Extensions — ONE list (#265), read by Look and Extensions. A change to
  //    a look refreshes the design settings. ────────────────────────────────
  const extensions = new ExtensionsSectionController({
    projectDir: projectDirAccessor,
    list: (dir) => api.extension.list(dir),
    bundled: () => api.extension.bundled(),
    search: (query) => api.extension.search(query),
    outdated: (dir) => api.extension.outdated(dir),
    validate: (dir) => api.extension.validate(dir),
    add: (dir, specifier, exportName) => api.extension.add(dir, specifier, exportName),
    addLocal: (dir) => api.extension.addLocal(dir),
    remove: (dir, use) => api.extension.remove(dir, use),
    setEnabled: (dir, use, enabled) => api.extension.setEnabled(dir, use, enabled),
    reorder: (dir, order) => api.extension.reorder(dir, order),
    readCss: (dir, use) => api.extension.readCss(dir, use),
    importFromFile: (dir) => api.extension.importFromFile(dir),
    importFromUrl: (dir, url) => api.extension.importFromUrl(dir, url),
    afterLookChange: () => design.loadDesign(),
  });

  // ── Stylesheets — the manifest's `styles:` list. The design settings follow
  //    the book's first stylesheet, so any change reloads them. ──────────────
  const styles = new StylesSectionController({
    projectDir: projectDirAccessor,
    listStyles: (dir) => api.project.listStyles(dir, repoRoot),
    setActiveStyles: (dir, paths) => api.style.setActive(dir, paths),
    createStylesheet: () => design.ensureStylesheet(),
    afterChange: () => design.loadDesign(),
  });

  // ── Lifecycle: load every section's data on mount ────────────────────────
  onMount(() => {
    let cancelled = false;
    void loadAll().finally(() => {
      if (!cancelled) loadingAll = false;
    });
    return () => {
      cancelled = true;
      void details.flushPendingSave();
      void design.flushPendingTokenWrites();
    };
  });

  async function loadAll(): Promise<void> {
    if (!projectDir) return;
    // Sections load in parallel — none depend on another.
    await Promise.allSettled([details.loadDetails(), extensions.loadExtensions(), design.loadDesign(), styles.loadStyles()]);
  }

  const hasProject = $derived(!!projectDir);

  // ── The header's one Saving… / Saved, for every tab's writes ─────────────
  const saveStatus = $derived.by(() => {
    const all = [details.detailsSaveStatus, design.designSaveStatus, extensions.saveStatus, styles.saveStatus];
    return all.includes("saving") ? "Saving…" : all.includes("saved") ? "Saved" : "";
  });

  // ── Tabs (the start screen's strip; Advanced sits apart at the right) ────
  type BookSetupTab = "book" | "look" | "extensions" | "online-copy" | "advanced";
  const TABS: Array<{ id: BookSetupTab; label: string }> = [
    { id: "book", label: "Book" },
    { id: "look", label: "Look" },
    { id: "extensions", label: "Extensions" },
    { id: "online-copy", label: "Online copy" },
    { id: "advanced", label: "Advanced" },
  ];
  // svelte-ignore state_referenced_locally
  let activeTab = $state<BookSetupTab>(initialTab);

  /** Leaving Book commits anything still typed there (a text field whose
   *  `change` has not fired yet). */
  function selectTab(id: BookSetupTab) {
    if (activeTab === "book" && id !== "book") void details.flushPendingSave();
    activeTab = id;
  }

  /** Look's links to Extensions and Advanced: the tab's top, or Advanced's "All design settings". */
  async function openTab(id: "extensions" | "advanced", at?: "design") {
    selectTab(id);
    await tick();
    if (at === "design") {
      const heading = document.getElementById("all-design-settings");
      heading?.scrollIntoView({ block: "start" });
      heading?.focus({ preventScroll: true });
    } else {
      document.getElementById(`project-settings-tab-${id}`)?.focus();
    }
  }

  /**
   * Write everything still pending. A failed write keeps the view open, on
   * the tab that shows the error (the unmount flush stays the backstop for
   * every other exit).
   */
  async function flushAll(): Promise<boolean> {
    // A field still being typed in saves on `change`, which leaving it fires.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const [bookSaved, designSaved] = await Promise.all([details.flushPendingSave(), design.flushPendingTokenWrites()]);
    if (!bookSaved) selectTab("book");
    else if (!designSaved && activeTab !== "advanced") selectTab("look");
    return bookSaved && designSaved;
  }

  async function close() {
    if (await flushAll()) onClose?.();
  }

  /** Advanced › Open manifest.yaml, and a stylesheet's Open. */
  async function openFile(path: string) {
    if (await flushAll()) onOpenFile?.(path);
  }

  let onlineCopy = $state<{ refreshHistory: () => void }>();
  /** A backup finished: reload the Version history list, if it is showing. */
  export function refreshHistory() {
    onlineCopy?.refreshHistory();
  }

  // "Save as template…" (Book tab) — mounted fresh per open so its form
  // resets; the opening button is remembered for focus restore.
  let templateDialogTrigger = $state<HTMLButtonElement | null>(null);
</script>

<AppView title="Book setup" icon="wrench" measure={860} onClose={close} {triggerEl}>
  {#snippet actions()}
    <!-- Always in the DOM with its text swapped: a live region announces a
         change to its content, not its own arrival (WCAG 2.2 SC 4.1.3). -->
    <span class="save-status" class:saved={saveStatus === "Saved"} aria-live="polite">{saveStatus}</span>
  {/snippet}
  <div class="book-tabs">
    <Tabs tabs={TABS} active={activeTab} label="Book setup sections" idPrefix="project-settings" onselect={selectTab} />
  </div>

  <div
    id="project-settings-panel"
    class="settings-body config-panel"
    aria-busy={loadingAll}
    role="tabpanel"
    aria-labelledby="project-settings-tab-{activeTab}"
  >
    {#if !hasProject}
      <p class="empty">Open a book to set it up.</p>
    {:else if loadingAll}
      <p class="loading">Loading your book's setup…</p>
    {:else}
      {#if activeTab === "book"}
        <DetailsSection controller={details} onSaveAsTemplate={(el) => (templateDialogTrigger = el)} />
      {/if}

      {#if activeTab === "look"}
        <LookSection {extensions} {design} onOpenTab={openTab} />
      {/if}

      {#if activeTab === "extensions"}
        <ExtensionsSection controller={extensions} />
      {/if}

      {#if activeTab === "online-copy"}
        <!-- This book's versions, revisions and online copy: signing in to its GitHub account or server happens here, in place; Version history replaces the tab's content. -->
        <ProjectConnectionsSection bind:this={onlineCopy} {projectDir} {backup} {versionsProblem} {onVersionHistoryEnabled} {onBackupSetUp} {onProjectFilesChanged} {onBackUpNow} {onRepair} {onSaveVersion} {onBrowseVersions} {onCloseBook} {onOpenAccounts} {toast} />
      {/if}

      {#if activeTab === "advanced"}
        <section class="block">
          <h3>Advanced</h3>
          <p class="hint">For your stylesheets, every design setting, and the manifest behind your book. Most books never need this tab.</p>
          <div class="row">
            <button class="ghost small" onclick={() => projectDir && openFile(joinPath(projectDir, "manifest.yaml"))}>Open manifest.yaml</button>
            <span class="hint">Opens the file in the editor.</span>
          </div>
        </section>
        <StylesSection controller={styles} onOpen={openFile} />
        <DesignSection controller={design} />
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
  /* Advanced stands apart at the right; it stays last in the arrow-key order. */
  .book-tabs :global([role="tab"]:last-child) { margin-left: auto; }
  .save-status { font-size: 12.5px; color: var(--app-text-muted); }
  .save-status.saved { color: var(--app-success-text); }

  .empty, .loading { margin: 0; font-size: 13px; color: var(--app-text-muted); }
</style>
