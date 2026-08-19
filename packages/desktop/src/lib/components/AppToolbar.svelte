<script lang="ts">
  /**
   * AppToolbar — the main window toolbar, extracted out of `+page.svelte`
   * (toolbar refactor). Purely presentational: every piece of state arrives as
   * a prop and every action leaves through a callback, so the component is
   * testable in isolation and `+page.svelte` stays a composition root.
   *
   * Responsive design (replaces the old hand-rolled absolute-centering +
   * 8-stage collapse ladder):
   *
   *  - The shell is a 3-column CSS grid — `auto minmax(0,1fr) auto`. The
   *    page-nav sits in the middle track, i.e. in the space REMAINING between
   *    the start/end clusters, optically centered within it. Unlike the old
   *    `position:absolute; left:50%` column (or a naive `1fr auto 1fr` grid),
   *    in-flow neighbours cannot paint over each other, so cluster overlap is
   *    impossible by construction; the middle additionally clips
   *    (`overflow-x: clip`) as a belt-and-braces guarantee.
   *  - `container-type: inline-size` + four documented @container stages
   *    collapse progressively by the toolbar's OWN width (not the viewport),
   *    with thresholds derived from the measured cluster widths so the middle
   *    track always has room for the page nav:
   *      ≤1150px  view-mode segmented group → dropdown menu
   *      ≤1000px  button text labels drop (icon-only), title/path trim
   *      ≤900px   page nav compacts (first/last jump buttons drop)
   *      ≤620px   title/path, view-mode/zoom menus, separators, hints drop
   *  - `(pointer: coarse)` keeps ≥44×44px touch targets on touch devices
   *    without fattening the desktop layout.
   *
   * Primary actions are ordered Publish → Export → Save so Save is always the
   * right-most button. There is no overflow menu: Export opens the export
   * dialog, project settings is a dedicated button beside the editor toggle,
   * focus mode lives on the editor toolbar, advanced setup in app Settings.
   *
   * PWA-clean (§8): type-only imports, zero host/Node code.
   */
  import Icon from "$lib/components/Icon.svelte";
  import { adjacentTab, type MobileTab } from "$lib/editor/mobile-layout";
  import type { PageNavController } from "$lib/routes/page-nav-controller.svelte";

  let {
    // ── Start cluster: panel toggle + document identity ──────────────────────
    leftPanelOpen,
    onToggleLeftPanel,
    panelToggleEl = $bindable(undefined),
    sourceMode,
    currentUrl = null,
    docTitle = null,
    folderTitle = null,
    folderTooltip = null,
    onOpenInBrowser,
    // ── Center: page navigation ──────────────────────────────────────────────
    pageNav,
    rendering,
    showPageNav,
    // ── End cluster: pane tabs (narrow), view controls, actions ──────────────
    isNarrow,
    mobileTab,
    onSelectMobileTab,
    editorTabDisabled,
    previewTabDisabled,
    hidePreviewControls,
    viewMode,
    zoom,
    previewControlsDisabled,
    viewModeDisabled,
    onApplyViewMode,
    onApplyZoom,
    previewHidden,
    previewToggleDisabled,
    onTogglePreview,
    editorOpen,
    editorToggleDisabled,
    onToggleEditor,
    showEditorModeSwitch,
    editorMode,
    richDisabledReason,
    onSetEditorMode,
    publishVisible,
    publishDisabled,
    onPublish,
    canSavePdf,
    exporting,
    exportDisabled,
    onOpenExport,
    exportBtnEl = $bindable(undefined),
    exportHints = [],
    exportWarning = null,
    saving,
    saveDisabled,
    savePending,
    onSave,
    showProjectSettings,
    onOpenProjectSettings,
  }: {
    leftPanelOpen: boolean;
    onToggleLeftPanel: () => void;
    panelToggleEl?: HTMLButtonElement | undefined;
    sourceMode: "folder" | "url";
    /** URL-mode source identity (label + tooltip + open-in-browser). */
    currentUrl?: string | null;
    docTitle?: string | null;
    /** Folder-mode label; the full path arrives as the tooltip. */
    folderTitle?: string | null;
    folderTooltip?: string | null;
    onOpenInBrowser: () => void;
    pageNav: PageNavController;
    rendering: boolean;
    showPageNav: boolean;
    isNarrow: boolean;
    mobileTab: MobileTab;
    onSelectMobileTab: (tab: MobileTab) => void;
    editorTabDisabled: boolean;
    previewTabDisabled: boolean;
    /** Narrow + editor tab: the preview controls are noise — hide them. */
    hidePreviewControls: boolean;
    viewMode: "single" | "two-column";
    zoom: string;
    /**
     * Zoom. Enabled whenever there is a VIEW to zoom — the preview, or the
     * rich editor, which is a view in its own right (it renders the book's
     * pages full-window). Leaving it gated on the preview alone made it dead
     * chrome exactly when it was needed most: a book whose page is narrower
     * than the window shows at print size, and enlarging it is the author's
     * call, not something they can be denied.
     */
    previewControlsDisabled: boolean;
    /**
     * Single / Two-page specifically. Separate from
     * `previewControlsDisabled` because the page-navigation cluster shares
     * that flag and is genuinely preview-only, while these two drive the rich
     * EDITOR as well — and the editor runs (full-window, exactly the width a
     * spread needs) while the preview server is still starting, or never
     * starts at all.
     */
    viewModeDisabled: boolean;
    onApplyViewMode: (mode: "single" | "two-column") => void;
    onApplyZoom: (zoom: string) => void;
    previewHidden: boolean;
    previewToggleDisabled: boolean;
    onTogglePreview: () => void;
    editorOpen: boolean;
    editorToggleDisabled: boolean;
    onToggleEditor: () => void;
    /** Rich/Markdown switch — shown only while an .md file is open in the editor. */
    showEditorModeSwitch: boolean;
    editorMode: "rich" | "source";
    /** Non-null disables Rich and explains why (fail-closed file). */
    richDisabledReason: string | null;
    onSetEditorMode: (mode: "rich" | "source") => void;
    publishVisible: boolean;
    publishDisabled: boolean;
    onPublish: () => void;
    canSavePdf: boolean;
    exporting: boolean;
    exportDisabled: boolean;
    /** Opens the export dialog (format + settings live there, not here). */
    onOpenExport: () => void;
    /** The Export button element — the export dialog's focus-restore target. */
    exportBtnEl?: HTMLButtonElement | undefined;
    /** Why Export is unavailable right now (rendered as quiet notes). */
    exportHints?: string[];
    /** Save-readiness warning (rendered as role="alert"). */
    exportWarning?: string | null;
    saving: boolean;
    saveDisabled: boolean;
    savePending: boolean;
    onSave: () => void;
    showProjectSettings: boolean;
    onOpenProjectSettings: () => void;
  } = $props();

  // Close the enclosing <details> menu after a menu item is chosen, and return
  // focus to its summary for keyboard users.
  function closeMenu(e: Event) {
    const details = (e.currentTarget as HTMLElement)?.closest("details");
    if (details) {
      details.open = false;
      details.querySelector<HTMLElement>("summary")?.focus();
    }
  }

  /**
   * Keyboard navigation for the mobile tablist (WAI-ARIA tabs pattern):
   * Left/Up = previous, Right/Down = next, Home/End = first/last. Activates the
   * focused tab (automatic activation) and moves focus to its button.
   */
  function onMobileTabKeydown(e: KeyboardEvent) {
    let next: MobileTab | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = adjacentTab(mobileTab, 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = adjacentTab(mobileTab, -1);
    else if (e.key === "Home") next = "markdown";
    else if (e.key === "End") next = "preview";
    if (!next) return;
    e.preventDefault();
    onSelectMobileTab(next);
    queueMicrotask(() => {
      document.querySelector<HTMLButtonElement>(`#mobile-tab-${next}`)?.focus();
    });
  }
</script>

<header class="toolbar" class:edit-narrow={hidePreviewControls} class:url-mode={sourceMode === "url"}>
  <div class="toolbar-start">
    <!-- Panel toggle — far left, first control in navbar -->
    <button
      bind:this={panelToggleEl}
      class="icon-btn panel-toggle-btn"
      class:active={leftPanelOpen}
      onclick={onToggleLeftPanel}
      title="Toggle left panel (Ctrl+\)"
      aria-label="Toggle left panel"
      aria-pressed={leftPanelOpen}
      aria-controls="left-panel-region"
    >
      <Icon name="panel-left" />
    </button>
    {#if sourceMode === "url" && currentUrl}
      {#if docTitle}
        <span class="doc-title" title={docTitle}>{docTitle}</span>
      {/if}
      <span class="path" title={currentUrl}>{currentUrl}</span>
      <button class="icon-btn" onclick={onOpenInBrowser} title="Open in browser" aria-label="Open in browser">
        <Icon name="external-link" />
      </button>
    {:else if folderTitle}
      <!-- Folder source: show the title/name; full path is the hover tooltip. -->
      <span class="doc-title" title={folderTooltip ?? folderTitle}>{folderTitle}</span>
    {:else}
      <span class="path no-project">Gutterpress</span>
    {/if}
  </div>

  <!-- Center column: an in-flow grid track (never absolutely positioned), so
       it stays centered when space allows and can NEVER overlap the start/end
       clusters when space is tight. -->
  <div class="toolbar-center">
    {#if showPageNav}
      <nav class="page-nav" aria-label="Page navigation">
        <button class="icon-btn nav-first" onclick={() => pageNav.firstPage()} disabled={rendering} title="First page (Home)" aria-label="First page">
          <Icon name="chevrons-left" />
        </button>
        <button class="icon-btn" onclick={() => pageNav.prevPage()} disabled={rendering} title="Previous page (Left/PageUp)" aria-label="Previous page">
          <Icon name="chevron-left" />
        </button>
        <!-- Page picker: a native select — one option per page, the current
             page selected. Clicking "3 / 12" drops down the full page list.
             The selection is driven through the select's VALUE (a property
             write), never per-option `selected` attributes: once a user has
             picked an option the browser marks it dirty and ignores attribute
             changes, which would freeze the display on stale pages. The
             onchange handler immediately re-syncs the DOM to currentPage so a
             dropped/failed navigation (mid-render, client gone, host error)
             can never leave the select showing a page the preview isn't on —
             the successful navigation updates currentPage and the value
             follows.
             data-current-page/data-total-pages are the machine-readable seam
             the perf gates read (tests/perf/*-gate.mjs): a select's option
             text never appears in document.body.innerText, so the gates
             cannot scrape the page indicator the way they did the old text
             pill. Keep these attributes when changing this control. -->
        <select
          class="page-select"
          aria-label="Go to page"
          disabled={rendering || pageNav.totalPages === 0}
          data-current-page={pageNav.currentPage}
          data-total-pages={pageNav.totalPages}
          value={pageNav.currentPage}
          onchange={(e) => {
            const el = e.currentTarget as HTMLSelectElement;
            pageNav.selectPage(el.value);
            el.value = String(pageNav.currentPage);
          }}
        >
          {#if pageNav.totalPages === 0}
            <option selected>&mdash; / &mdash;</option>
          {:else}
            {#each pageNav.pageOptions as p (p)}
              <option value={p}>{p} / {pageNav.totalPages}</option>
            {/each}
          {/if}
        </select>
        <button class="icon-btn" onclick={() => pageNav.nextPage()} disabled={rendering} title="Next page (Right/PageDown)" aria-label="Next page">
          <Icon name="chevron-right" />
        </button>
        <button class="icon-btn nav-last" onclick={() => pageNav.lastPage()} disabled={rendering} title="Last page (End)" aria-label="Last page">
          <Icon name="chevrons-right" />
        </button>
      </nav>
    {/if}
  </div>

  <div class="toolbar-end">
    {#if isNarrow}
      <!-- Single-pane switcher (narrow viewports): editor or preview. Real
           WAI-ARIA tabs: role=tablist + tab, aria-selected, roving tabindex,
           arrow/Home/End navigation. The tabpanels are the editor + preview
           panes in the workspace below (linked via aria-controls). -->
      <div
        class="pane-toggle"
        role="tablist"
        aria-label="Markdown or Preview"
        aria-orientation="horizontal"
      >
        <button
          id="mobile-tab-markdown"
          role="tab"
          class="icon-text seg"
          class:active={mobileTab === "markdown"}
          onclick={() => onSelectMobileTab("markdown")}
          onkeydown={onMobileTabKeydown}
          disabled={editorTabDisabled}
          title="Edit your markdown"
          aria-label="Markdown"
          aria-selected={mobileTab === "markdown"}
          aria-controls="mobile-panel-editor"
          tabindex={mobileTab === "markdown" ? 0 : -1}
        >
          <Icon name="pen-line" /><span class="view-label">Markdown</span>
        </button>
        <button
          id="mobile-tab-preview"
          role="tab"
          class="icon-text seg"
          class:active={mobileTab === "preview"}
          onclick={() => onSelectMobileTab("preview")}
          onkeydown={onMobileTabKeydown}
          disabled={previewTabDisabled}
          title="Preview your book"
          aria-label="Preview"
          aria-selected={mobileTab === "preview"}
          aria-controls="mobile-panel-preview"
          tabindex={mobileTab === "preview" ? 0 : -1}
        >
          <Icon name="eye" /><span class="view-label">Preview</span>
        </button>
      </div>
    {/if}
    <span class="toolbar-sep" aria-hidden="true"></span>

    <!-- View-mode (single/spread): a pair of segmented buttons on wide
         toolbars; collapses into a single menu button when space is tight. -->
    <div class="view-mode-group">
      <button
        class="icon-text"
        class:active={viewMode === "single"}
        onclick={() => onApplyViewMode("single")}
        disabled={viewModeDisabled}
        title="Show one page at a time"
        aria-label="Single page view"
        aria-pressed={viewMode === "single"}
      >
        <Icon name="rectangle-vertical" /><span class="view-label">Single</span>
      </button>
      <button
        class="icon-text"
        class:active={viewMode === "two-column"}
        onclick={() => onApplyViewMode("two-column")}
        disabled={viewModeDisabled}
        title="Show two pages side by side, like an open book"
        aria-label="Two pages side by side"
        aria-pressed={viewMode === "two-column"}
      >
        <Icon name="columns-2" /><span class="view-label">Two-page</span>
      </button>
    </div>
    <details class="menu view-mode-menu">
      <summary class="icon-btn menu-summary" title="Page view mode" aria-label="Page view mode">
        <Icon name={viewMode === "single" ? "rectangle-vertical" : "columns-2"} />
        <Icon name="chevron-down" size={12} />
      </summary>
      <div class="menu-panel">
        <button
          aria-pressed={viewMode === "single"}
          class="menu-item"
          class:active={viewMode === "single"}
          onclick={(e) => { onApplyViewMode("single"); closeMenu(e); }}
          disabled={viewModeDisabled}
        >
          <Icon name="rectangle-vertical" /> Single page
        </button>
        <button
          aria-pressed={viewMode === "two-column"}
          class="menu-item"
          class:active={viewMode === "two-column"}
          onclick={(e) => { onApplyViewMode("two-column"); closeMenu(e); }}
          disabled={viewModeDisabled}
        >
          <Icon name="columns-2" /> Two pages side by side
        </button>
      </div>
    </details>

    <!-- Zoom: always the compact icon button so the toolbar stays tight. -->
    <details class="menu zoom-menu">
      <summary class="icon-btn menu-summary" title="Zoom level" aria-label="Zoom level">
        <Icon name="zoom-in" />
        <Icon name="chevron-down" size={12} />
      </summary>
      <div class="menu-panel">
        {#each [["fit-width", "Fit to width"], ["0.25", "25%"], ["0.5", "50%"], ["0.75", "75%"], ["1", "100%"], ["1.25", "125%"], ["1.5", "150%"], ["2", "200%"]] as [val, label] (val)}
          <button
            aria-pressed={zoom === val}
            class="menu-item"
            class:active={zoom === val}
            onclick={(e) => { onApplyZoom(val); closeMenu(e); }}
            disabled={previewControlsDisabled}
          >
            {label}
          </button>
        {/each}
      </div>
    </details>

    {#if !isNarrow && sourceMode !== "url"}
      <!-- Pane toggles only exist for folder projects — in URL mode there is
           no editor, so rendering them permanently disabled is pure noise
           (and toolbar width the URL-mode start cluster badly needs). -->
      <button
        class="icon-btn"
        class:active={previewHidden}
        onclick={onTogglePreview}
        disabled={previewToggleDisabled}
        title={previewHidden ? "Show preview" : "Hide preview"}
        aria-label={previewHidden ? "Show preview" : "Hide preview"}
        aria-pressed={previewHidden}
      >
        <Icon name="eye" />
      </button>
      <button
        class="icon-btn"
        class:active={editorOpen}
        onclick={onToggleEditor}
        disabled={editorToggleDisabled}
        title="Toggle markdown editor (Ctrl+E)"
        aria-label="Toggle markdown editor"
        aria-pressed={editorOpen}
      >
        <Icon name="pen-line" />
      </button>
      {#if showEditorModeSwitch}
        <!-- Editing mode (Rich/Markdown) lives HERE, with the other mode
             controls — not floating inside the content area over the page. -->
        <div class="view-mode-group" role="group" aria-label="Editing mode">
          <button
            class="icon-text"
            class:active={editorMode === "rich"}
            aria-pressed={editorMode === "rich"}
            disabled={!!richDisabledReason}
            title={richDisabledReason ?? "Edit with the book's own layout and type"}
            onclick={() => onSetEditorMode("rich")}
          >
            <span class="view-label">Rich</span>
          </button>
          <button
            class="icon-text"
            class:active={editorMode === "source"}
            aria-pressed={editorMode === "source"}
            title="Edit the markdown source"
            onclick={() => onSetEditorMode("source")}
          >
            <span class="view-label">Markdown</span>
          </button>
        </div>
      {/if}
    {/if}
    {#if showProjectSettings}
      <!-- Project settings (manifest) — beside the editor toggle. Rendered on
           narrow layouts too (the tab bar replaces the pane toggles there,
           but project settings must stay reachable). -->
      <button
        class="icon-btn project-settings-btn"
        onclick={onOpenProjectSettings}
        title="Project settings"
        aria-label="Project settings"
      >
        <Icon name="settings" />
      </button>
    {/if}

    <span class="toolbar-sep" aria-hidden="true"></span>

    <!-- Why-is-Export-disabled notes (UX-023). -->
    {#each exportHints as hint (hint)}
      <span class="save-hint" role="note">{hint}</span>
    {/each}
    {#if exportWarning}
      <span class="save-hint save-warning" role="alert">{exportWarning}</span>
    {/if}

    <!-- Primary actions — Publish, Export, Save (Save right-most). No
         overflow menu: focus mode lives on the editor toolbar, advanced setup
         in the app Settings view, save-as-template in the export dialog, and
         project settings beside the editor toggle above. -->
    {#if publishVisible}
      <button
        class="publish-btn primary app-btn-primary icon-text"
        onclick={onPublish}
        disabled={publishDisabled}
        title="Publish your book to itch.io, KDP, Shopify and more"
      >
        <Icon name="cloud-upload" />
        <span class="btn-label">Publish</span>
      </button>
    {/if}
    <!-- Export opens the export dialog (choose PDF / HTML / template and
         adjust settings there). Ctrl+Shift+E stays the quick PDF export. -->
    <button
      bind:this={exportBtnEl}
      class="export-btn primary app-btn-primary icon-text"
      onclick={onOpenExport}
      disabled={exportDisabled}
      title="Export (choose format and settings)"
    >
      <Icon name="file-down" />
      <span class="btn-label">{exporting ? "Exporting…" : "Export"}</span>
    </button>
    <!-- Save: flush all pending editor changes to disk NOW (the same
         force-save the status bar's "Save now" runs). Disabled (with an
         "everything saved" tooltip) when there is nothing pending. -->
    <button
      class="save-btn icon-text"
      onclick={onSave}
      disabled={saveDisabled}
      title={savePending ? "Save pending changes (Ctrl+S)" : "All changes saved"}
      aria-label="Save pending changes"
    >
      <Icon name="save" />
      <span class="btn-label">{saving ? "Saving…" : "Save"}</span>
    </button>
  </div>
</header>

<style>
  /* ---- Shell: 3-column grid, container queries enabled ---- */
  .toolbar {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    height: 56px;
    flex-shrink: 0;
    container-type: inline-size;
    background: linear-gradient(
      to bottom,
      light-dark(#fafafa, #252525),
      light-dark(#f0f0f1, #1e1e1e)
    );
    border-bottom: 1px solid var(--app-border);
    /* Stacking context ABOVE the workspace panes so dropdown menus that hang
       below the toolbar paint over the preview, not behind it. overflow must
       stay visible for the same reason — `overflow: hidden` clips dropdowns. */
    position: relative;
    z-index: var(--app-z-toolbar);
    overflow: visible;
  }

  .toolbar-start {
    display: flex;
    align-items: center;
    gap: 6px;
    /* The title/path ellipsize (their own max-widths) so this cluster's
       min-content stays bounded. min-width: 0 keeps the auto track honest. */
    min-width: 0;
    overflow: hidden;
  }
  .toolbar-center {
    /* Fills the REMAINING space between the clusters; the page nav is
       optically centered within it and clips rather than overlaps if a stage
       boundary is ever miscalibrated. */
    display: flex;
    justify-content: center;
    min-width: 0;
    overflow-x: clip;
  }
  .toolbar-end {
    display: flex;
    align-items: center;
    gap: 6px;
    justify-self: end;
  }
  .page-nav {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* ---- Buttons & inputs ---- */
  /* Geometry shared by ALL toolbar buttons, including the primary/active
     variants (they inherit padding/radius/border box from here; only their
     COLOUR differs). border is split into width/style so a variant's own
     border-COLOUR isn't clobbered. */
  .toolbar button {
    border-width: 1px;
    border-style: solid;
    padding: 5px 10px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }
  /* Neutral fill — NON-primary, NON-active buttons only (the shared
     .app-btn-primary recipe in theme.css owns the primary colours). */
  .toolbar button:not(.app-btn-primary):not(.active) {
    background: var(--app-control-bg);
    border-color: var(--app-control-border);
    color: var(--app-control-text);
  }
  .toolbar button:not(.app-btn-primary):not(.active):hover:not(:disabled) {
    background: var(--app-control-hover-bg);
    border-color: var(--app-control-hover-border);
  }
  .toolbar button.active {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
  }
  .toolbar button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  /* Explicit focus ring for all toolbar interactive elements — replaces UA
     default with the app's consistent ring. */
  .toolbar button:focus-visible,
  .toolbar select:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }

  .icon-btn {
    padding: 5px 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  /* Button vocabulary: secondary controls (nav arrows, menu summaries) read as
     ONE ghost family — transparent until hover — so the filled treatment is
     reserved for the primary actions and active toggles. */
  .toolbar .icon-btn:not(.active),
  .toolbar .menu-summary {
    background: transparent;
    border-color: transparent;
  }
  .toolbar .icon-btn:not(.active):hover:not(:disabled),
  .toolbar .menu-summary:hover {
    background: var(--app-control-hover-bg);
    border-color: transparent;
  }
  /* Combo button: icon + label text side by side */
  .icon-text {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .icon-text :global(svg) { flex: 0 0 auto; }

  .view-label { font-size: 11px; }
  .btn-label { font-size: 13px; }

  /* Editor/Preview segmented toggle (narrow single-pane mode) */
  .pane-toggle {
    display: inline-flex;
    gap: 0;
    background: var(--app-control-bg);
    border: 1px solid var(--app-control-border);
    border-radius: 7px;
    padding: 2px;
  }
  .pane-toggle .seg {
    border-radius: 5px;
    border: 1px solid transparent;
    background: transparent;
  }
  .pane-toggle .seg.active {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
  }

  /* ---- Collapsible dropdown menus (view-mode + zoom + more) ---- */
  .menu { position: relative; display: inline-block; }
  /* The view-mode menu only appears when the segmented group collapses. */
  details.view-mode-menu { display: none; }
  .menu-summary {
    list-style: none;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    cursor: pointer;
  }
  .menu-summary::-webkit-details-marker { display: none; }
  .menu[open] .menu-summary {
    background: var(--app-control-hover-bg);
    border-color: var(--app-control-hover-border);
  }
  .menu-panel {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    /* Intra-toolbar stacking only: the toolbar (z: var(--app-z-toolbar)) is a
       stacking context, so this small literal never competes app-wide. */
    z-index: 80;
    min-width: 168px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px;
    background: var(--app-surface-raised);
    border: 1px solid var(--app-border);
    border-radius: 8px;
    box-shadow: 0 6px 20px var(--app-shadow-md);
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 5px;
    padding: 6px 10px;
    font-size: 13px;
    white-space: nowrap;
  }
  .menu-item:hover:not(:disabled) {
    background: var(--app-control-hover-bg);
    border-color: var(--app-control-hover-border);
  }
  .menu-item.active {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
  }

  /* Page/Spread as a true segmented control: one bordered track, the selected
     segment filled, the other transparent. */
  .view-mode-group {
    display: inline-flex;
    gap: 0;
    background: var(--app-control-bg);
    border: 1px solid var(--app-control-border);
    border-radius: 7px;
    padding: 2px;
  }
  .view-mode-group button {
    border: 1px solid transparent;
    background: transparent;
    border-radius: 5px;
    padding: 4px 9px;
  }
  .view-mode-group button:hover:not(:disabled) {
    background: var(--app-control-hover-bg);
    border-color: transparent;
  }
  .view-mode-group button.active {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
  }

  /* Page select — styled like the old page pill, with a custom chevron (the
     native GTK/OS select chrome ignores `background` on some platforms). */
  .page-select {
    /* Component-private palette (single consumer — stays out of theme.css per
       its admission rule); flips with the app theme via color-scheme. */
    --pill-from: light-dark(#e8edf5, #313740);
    --pill-to: light-dark(#dde4ef, #262c34);
    appearance: none;
    -webkit-appearance: none;
    background: linear-gradient(to bottom, var(--pill-from), var(--pill-to));
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238a8a8a' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>");
    background-repeat: no-repeat;
    background-position: right 8px center;
    border: 1px solid light-dark(#b3c0d4, #576170);
    border-radius: 6px;
    color: light-dark(#1a3055, #eef4ff);
    font-size: 13px;
    font-weight: 500;
    padding: 5px 26px 5px 10px;
    min-width: 84px;
    text-align: center;
    cursor: pointer;
  }
  .page-select:hover:not(:disabled) {
    border-color: var(--app-control-hover-border);
  }
  .page-select:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  /* The dropdown list is OS/browser-rendered and does NOT inherit the pill
     styling above — without explicit option colors the popup can pair the
     pill's light text with a light popup background (or vice versa) and the
     page list becomes unreadable. */
  .page-select option {
    background: var(--app-surface);
    color: var(--app-text);
  }

  /* Panel toggle button — accent fill matching other active toggles. */
  .panel-toggle-btn.active {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
  }
  .panel-toggle-btn.active:hover:not(:disabled) {
    background: linear-gradient(to bottom, var(--app-accent-bright), var(--app-accent-hover));
  }

  .doc-title {
    color: var(--app-text-secondary);
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 160px;
    flex-shrink: 1;
  }
  .no-project {
    font-weight: 700;
    color: var(--app-text-secondary);
  }
  .path {
    color: var(--app-text-muted);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 260px;
    flex-shrink: 2;
  }

  /* Visual separator between toolbar groups (UX-039) */
  .toolbar-sep {
    width: 1px;
    height: 20px;
    background: var(--app-border-strong);
    margin: 0 4px;
    flex-shrink: 0;
  }

  /* Hint beside Export when disabled (UX-023). Capped so it can never starve
     the page-nav's middle track. */
  .save-hint {
    font-size: 11px;
    color: var(--app-text-muted);
    white-space: nowrap;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .save-warning {
    color: var(--app-warning-text);
    max-width: 240px;
    white-space: normal;
    line-height: 1.35;
  }

  /* Narrow + editor tab: the preview is hidden, so its controls (page
     navigation, single/spread, zoom) are noise — hide them so the edit
     toolbar is just Panel · Tabs · Actions. The separators go too: with the
     view controls gone they would render as an adjacent double rule. */
  .toolbar.edit-narrow .toolbar-center,
  .toolbar.edit-narrow .view-mode-group,
  .toolbar.edit-narrow .view-mode-menu,
  .toolbar.edit-narrow .zoom-menu,
  .toolbar.edit-narrow .toolbar-sep {
    display: none;
  }

  /* URL-mode budget: the start cluster carries title + full URL + the
     open-in-browser button (~2× the folder cluster), so URL mode pre-pays for
     the page nav's middle track at EVERY width — tighter title/path caps, the
     view-mode group always in its compact menu form, and no export hints
     (Export's own tooltip carries the explanation). Without these the middle
     track starves and the page nav clips on ordinary desktop windows. */
  .toolbar.url-mode .doc-title { max-width: 140px; }
  .toolbar.url-mode .path { max-width: 120px; }
  .toolbar.url-mode .view-mode-group { display: none; }
  .toolbar.url-mode details.view-mode-menu { display: inline-block; }
  .toolbar.url-mode .save-hint { display: none; }

  /* ---- Collapse stages (see the header comment for the full table) ---- */
  @container (max-width: 1150px) {
    /* Swap the inline view-mode buttons for the compact menu button; the
       export hints yield to the page nav from here down. */
    .view-mode-group { display: none; }
    details.view-mode-menu { display: inline-block; }
    .save-hint { display: none; }
    .path { max-width: 140px; }
  }
  @container (max-width: 1000px) {
    /* Icon-only buttons: labels drop, aria-label/title keep them accessible. */
    .view-label { display: none; }
    .btn-label { display: none; }
    .doc-title { max-width: 140px; }
    .path { max-width: 100px; }
  }
  @container (max-width: 900px) {
    /* Compact page navigation: drop the first/last jump buttons; the path
       (URL mode) yields entirely, and the URL title with it. */
    .nav-first,
    .nav-last { display: none; }
    .page-select { min-width: 64px; }
    .path { display: none; }
    .toolbar.url-mode .doc-title { display: none; }
  }
  @container (max-width: 620px) {
    .doc-title,
    .path,
    .toolbar-sep,
    .save-hint,
    .view-mode-group,
    .view-mode-menu,
    .zoom-menu {
      display: none;
    }
  }

  /* #34 Touch-optimised toolbar — coarse pointer (phones/tablets) gets ≥44×44px
     tap targets per WCAG 2.5.5 / Apple HIG, WITHOUT affecting the desktop
     (mouse) layout. Scoped to (pointer: coarse) so a desktop user with a mouse
     sees the unchanged compact toolbar. */
  @media (pointer: coarse) {
    .toolbar .icon-btn,
    .toolbar .icon-text,
    .toolbar .menu-summary,
    .toolbar .page-select,
    .pane-toggle .seg,
    .toolbar .primary {
      min-width: 44px;
      min-height: 44px;
    }
    .toolbar .icon-btn,
    .toolbar .menu-summary {
      padding: 10px 12px;
    }
    .pane-toggle {
      padding: 3px;
    }
    .pane-toggle .seg {
      padding: 8px 12px;
    }
    /* Small touch screens: 44px targets don't fit beside the action trio on a
       320-390px phone — step down to 40px (still well above WCAG 2.5.8's 24px
       floor) and tighten the cluster gaps so nothing clips off-screen. */
    @container (max-width: 480px) {
      .toolbar .icon-btn,
      .toolbar .icon-text,
      .toolbar .menu-summary,
      .toolbar .page-select,
      .pane-toggle .seg,
      .toolbar .primary {
        min-width: 40px;
        min-height: 40px;
      }
      .toolbar .icon-btn,
      .toolbar .menu-summary {
        padding: 8px 9px;
      }
      .pane-toggle .seg {
        padding: 6px 9px;
      }
      .toolbar-end {
        gap: 4px;
      }
    }
  }
</style>
