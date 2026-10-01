<script lang="ts">
  /**
   * AppToolbar — the main window toolbar, extracted out of `+page.svelte`
   * (toolbar refactor). Purely presentational: every piece of state arrives as
   * a prop and every action leaves through a callback, so the component is
   * testable in isolation and `+page.svelte` stays a composition root.
   *
   * Page navigation and zoom are NOT here: they live on the preview pane's
   * own strip (PreviewToolbar.svelte), beside the pages they act on, the way
   * the editor pane carries EditorToolbar. This bar holds only app-level
   * controls — identity, the workspace mode, Focus, book setup, publishing.
   *
   * Responsive design:
   *
   *  - The shell is a flex row: the start cluster (panel toggle + identity)
   *    shrinks and ellipsizes; the end cluster keeps its controls.
   *  - `container-type: inline-size` + three documented @container stages
   *    collapse progressively by the toolbar's OWN width (not the viewport).
   *    Least important goes first, and every control that turns icon-only
   *    keeps its aria-label and tooltip. The container is the toolbar's
   *    content box (window width − 24px), so a 900px window measures 876px:
   *      ≤1150px  Edit/Read segmented group → dropdown menu, publish
   *               hints and the Setup label drop
   *      ≤875px   the action buttons drop their text labels, path trims
   *      ≤620px   title/path, mode menu, Focus, separators, hints drop
   *    The narrow layout (≤820px window) adds the pane tabs to the end
   *    cluster.
   *  - `(pointer: coarse)` keeps ≥44×44px touch targets on touch devices
   *    without fattening the desktop layout.
   *
   * The workspace mode is ONE control with one segment per `WorkspaceMode`
   * value — no icon button beside it duplicating a mode the segments already
   * offer, and nothing reachable only from the keyboard. Focus is NOT a mode:
   * it is a separate toggle beside that control (see `focus`).
   *
   * Actions are ordered Publish → Export, Export right-most. Export is the one
   * primary (solid) action; Publish is a secondary button, since its wizard
   * exports too. There is no Save here: saving lives in the editor toolbar
   * (and Ctrl/Cmd+S). There is no overflow menu: Export opens the export
   * dialog, book setup is a dedicated labelled button beside the mode
   * control, advanced setup in app Settings.
   *
   * PWA-clean (§8): type-only imports, zero host/Node code.
   */
  import Icon from "$lib/components/Icon.svelte";
  import { adjacentTab, type MobileTab } from "$lib/editor/mobile-layout";
  import type { WorkspaceMode } from "$lib/platform";

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
    // ── End cluster: pane tabs (narrow), view controls, actions ──────────────
    isNarrow,
    mobileTab,
    onSelectMobileTab,
    editorTabDisabled,
    previewTabDisabled,
    hidePreviewControls,
    mode,
    onSetMode,
    focus,
    onToggleFocus,
    editorToggleDisabled,
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
    isNarrow: boolean;
    mobileTab: MobileTab;
    onSelectMobileTab: (tab: MobileTab) => void;
    editorTabDisabled: boolean;
    previewTabDisabled: boolean;
    /** Narrow + editor tab: the preview is hidden, so the mode switch is noise. */
    hidePreviewControls: boolean;
    /** The workspace mode — the ONE layout switch (see `WorkspaceMode`). */
    mode: WorkspaceMode;
    onSetMode: (mode: WorkspaceMode) => void;
    /** Focus is on: chrome hidden. A session toggle on top of Edit or Read. */
    focus: boolean;
    onToggleFocus: () => void;
    /** No project open — the whole mode control has nothing to switch. */
    editorToggleDisabled: boolean;
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
    showProjectSettings: boolean;
    onOpenProjectSettings: () => void;
  } = $props();

  // The collapsed menu's summary reports the mode it stands in for.
  const modeIcon = $derived(mode === "viewer" ? "book-open" : "pen-line");

  // Each tooltip says what its layout shows.
  const MODE_TITLE = {
    editor: "Edit — editor and preview side by side (Ctrl+E)",
    viewer: "Read — the preview on its own, two pages at a time",
  } as const;
  const FOCUS_TITLE =
    "Focus — hide the panels and toolbars. Press Esc to bring them back";

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

<header class="toolbar" class:narrow={isNarrow} class:edit-narrow={hidePreviewControls} class:url-mode={sourceMode === "url"}>
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

    <!-- Workspace mode (Edit/Read): one segment per `WorkspaceMode` value on
         wide toolbars; collapses into a single menu button when space is
         tight. Reading is two pages side by side; editing is one page beside
         the editor — the page layout follows from the mode, it is not a
         separate choice (see `WorkspaceMode`). -->
    <div class="mode-group">
      <button
        class="icon-text"
        class:active={mode === "editor"}
        onclick={() => onSetMode("editor")}
        disabled={editorToggleDisabled}
        title={MODE_TITLE.editor}
        aria-label="Edit"
        aria-pressed={mode === "editor"}
      >
        <Icon name="pen-line" /><span class="view-label">Edit</span>
      </button>
      <button
        class="icon-text"
        class:active={mode === "viewer"}
        onclick={() => onSetMode("viewer")}
        disabled={editorToggleDisabled}
        title={MODE_TITLE.viewer}
        aria-label="Read"
        aria-pressed={mode === "viewer"}
      >
        <Icon name="book-open" /><span class="view-label">Read</span>
      </button>
    </div>
    <details class="menu mode-menu">
      <summary class="icon-btn menu-summary" title="Edit or read" aria-label="Edit or read">
        <Icon name={modeIcon} />
        <Icon name="chevron-down" size={12} />
      </summary>
      <div class="menu-panel">
        <button
          aria-pressed={mode === "editor"}
          class="menu-item"
          class:active={mode === "editor"}
          onclick={(e) => { onSetMode("editor"); closeMenu(e); }}
          disabled={editorToggleDisabled}
          title={MODE_TITLE.editor}
        >
          <Icon name="pen-line" /> Edit
        </button>
        <button
          aria-pressed={mode === "viewer"}
          class="menu-item"
          class:active={mode === "viewer"}
          onclick={(e) => { onSetMode("viewer"); closeMenu(e); }}
          disabled={editorToggleDisabled}
          title={MODE_TITLE.viewer}
        >
          <Icon name="book-open" /> Read
        </button>
      </div>
    </details>

    <!-- Focus: a toggle on top of Edit OR Read (not a third mode), on wide and
         narrow layouts alike. Pressing it swaps this toolbar for the minimal
         FocusBar; nothing persisted changes. -->
    <button
      id="focus-toggle-btn"
      class="focus-btn icon-text"
      class:active={focus}
      onclick={onToggleFocus}
      disabled={editorToggleDisabled}
      title={FOCUS_TITLE}
      aria-label="Focus"
      aria-pressed={focus}
    >
      <Icon name="maximize" /><span class="view-label">Focus</span>
    </button>

    <span class="toolbar-sep" aria-hidden="true"></span>

    {#if showProjectSettings}
      <!-- Book setup (manifest) — beside the mode control. Rendered on
           narrow layouts too (the tab bar replaces the mode control there,
           but book setup must stay reachable). Its text label yields at the
           ≤1150px stage, before the action buttons'; aria-label and tooltip stay. -->
      <button
        class="icon-btn icon-text project-settings-btn"
        onclick={onOpenProjectSettings}
        title="Book setup"
        aria-label="Book setup"
      >
        <Icon name="wrench" />
        <span class="btn-label">Setup</span>
      </button>
    {/if}

    <!-- Why-is-Export-disabled notes (UX-023). -->
    {#each exportHints as hint (hint)}
      <span class="save-hint" role="note">{hint}</span>
    {/each}
    {#if exportWarning}
      <span class="save-hint save-warning" role="alert">{exportWarning}</span>
    {/if}

    <!-- Actions — Publish, Export (Export right-most). Export is the ONE
         primary (solid) action; Publish is a secondary button beside it — its
         wizard exports too, so two equal-weight solid buttons left the choice
         unclear. No overflow menu: Focus is a toggle beside the mode
         control, advanced setup lives in the app Settings view,
         save-as-template in the export dialog, and book setup beside the
         mode control above. Both keep their aria-label when the text label
         drops at narrow widths. -->
    {#if publishVisible}
      <button
        class="publish-btn icon-text"
        onclick={onPublish}
        disabled={publishDisabled}
        title="Publish your book to itch.io, KDP, Shopify and more"
        aria-label="Publish"
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
      aria-label={exporting ? "Exporting…" : "Export"}
    >
      <Icon name="file-down" />
      <span class="btn-label">{exporting ? "Exporting…" : "Export"}</span>
    </button>
  </div>
</header>

<style>
  /* ---- Shell: flex row, container queries enabled ---- */
  .toolbar {
    display: flex;
    justify-content: space-between;
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
  .toolbar-end {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
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
  .toolbar button:focus-visible {
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

  /* ---- Collapsible dropdown menu (view-mode) ---- */
  .menu { position: relative; display: inline-block; }
  /* The view-mode menu only appears when the segmented group collapses. */
  details.mode-menu { display: none; }
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
    min-width: 120px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 4px;
    /* Same values as EditorToolbar's `.toolbar-popup` (the Insert menu), so
       every toolbar dropdown reads as one family. */
    background: var(--app-surface);
    border: 1px solid var(--app-border);
    border-radius: 4px;
    box-shadow: 0 4px 12px var(--app-shadow-md);
  }
  /* Rows, not buttons. The generic `.toolbar button` rules above (border,
     neutral fill, `button.active` accent slab) outrank a bare `.menu-item`, so
     every selector here is anchored on `.toolbar .menu-panel button` to win at
     equal-or-higher specificity: one panel owns the border and shadow; rows are
     borderless and transparent until hovered. */
  .toolbar .menu-panel button.menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 3px;
    color: var(--app-text);
    padding: 5px 8px;
    font-size: 12px;
    font-weight: 400;
    white-space: nowrap;
  }
  /* :not(.active) — the selected row keeps its selected look under the
     pointer. Unexcluded, the hover fill would repaint it as a plain hover row
     (the #305 defect, originally white-on-pale text). */
  .toolbar .menu-panel button.menu-item:not(.active):hover:not(:disabled) {
    background: var(--app-control-hover-bg);
  }
  /* Quiet selected state: accent-tinted row, accent text, trailing check. */
  .toolbar .menu-panel button.menu-item.active {
    background: var(--app-accent-subtle);
    color: var(--app-link);
    font-weight: 600;
  }
  .toolbar .menu-panel button.menu-item.active::after {
    content: "\2713" / "";
    margin-left: auto;
    padding-left: 12px;
  }

  /* Page/Spread as a true segmented control: one bordered track, the selected
     segment filled, the other transparent. */
  .mode-group {
    display: inline-flex;
    gap: 0;
    background: var(--app-control-bg);
    border: 1px solid var(--app-control-border);
    border-radius: 7px;
    padding: 2px;
  }
  .mode-group button {
    border: 1px solid transparent;
    background: transparent;
    border-radius: 5px;
    padding: 4px 9px;
  }
  /* :not(.active) — the just-clicked segment sits under the pointer, and this
     rule (0,3,1) outranked `.mode-group button.active` (0,2,1): the selected
     segment lost its accent fill but kept its white text, so it read as
     disabled exactly when the author had just chosen it. */
  .mode-group button:not(.active):hover:not(:disabled) {
    background: var(--app-control-hover-bg);
    border-color: transparent;
  }
  .mode-group button.active {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
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

  /* Hint beside the action when disabled (UX-023). Capped so it can never
     starve the identity cluster. */
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

  /* Narrow + editor tab: the preview is hidden, so the mode switch is noise
     — hide it so the edit toolbar is just Panel · Tabs · Actions. The
     separators go too: with the view controls gone they would render as an
     adjacent double rule. */
  .toolbar.edit-narrow .mode-group,
  .toolbar.edit-narrow .mode-menu,
  .toolbar.edit-narrow .toolbar-sep {
    display: none;
  }

  /* URL-mode budget: the start cluster carries title + full URL + the
     open-in-browser button (~2× the folder cluster), so URL mode keeps
     tighter title/path caps and no hints (the action's own tooltip carries
     the explanation). */
  .toolbar.url-mode .doc-title { max-width: 140px; }
  .toolbar.url-mode .path { max-width: 120px; }
  /* A URL source has no editor, so two of the three modes are meaningless —
     drop the whole switch rather than show it permanently disabled. */
  .toolbar.url-mode .mode-group,
  .toolbar.url-mode .focus-btn,
  .toolbar.url-mode details.mode-menu { display: none; }
  .toolbar.url-mode .save-hint { display: none; }
  /* Publish is disabled for a URL source, so its label is the first to yield. */
  .toolbar.url-mode .publish-btn .btn-label { display: none; }

  /* ---- Collapse stages (see the header comment for the full table) ---- */
  @container (max-width: 1150px) {
    /* Swap the inline view-mode buttons for the compact menu button; Setup
       drops its text label (icon, tooltip and aria-label stay) and the
       hints yield from here down. */
    .mode-group { display: none; }
    details.mode-menu { display: inline-block; }
    .save-hint { display: none; }
    .project-settings-btn .btn-label { display: none; }
    /* The title ellipsizes (full text in its tooltip). */
    .doc-title { max-width: 120px; }
    .path { max-width: 100px; }
  }
  @container (max-width: 875px) {
    /* Icon-only action buttons (aria-label/title keep them accessible; 875
       is what keeps their labels on a 900px window); the path (URL mode)
       yields entirely, the URL title with it. */
    .view-label { display: none; }
    .btn-label { display: none; }
    .path { display: none; }
    .toolbar.url-mode .doc-title { display: none; }
    .toolbar.narrow .doc-title { max-width: 64px; }
  }
  @container (max-width: 620px) {
    /* Phone floor: display:none (not clipping) keeps the hidden controls out
       of the tab order. */
    .doc-title,
    .path,
    .toolbar-sep,
    .save-hint,
    .mode-group,
    .mode-menu,
    .focus-btn {
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
