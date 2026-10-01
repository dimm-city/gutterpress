<script lang="ts">
  /**
   * PreviewToolbar — the preview pane's own control strip, the mirror of
   * EditorToolbar above the editor pane: page navigation and zoom live HERE,
   * next to the pages they act on, not in the main app toolbar (which now
   * carries only app-level controls: mode, focus, setup, publish).
   *
   * The page picker is a native <select> — one option per page, the current
   * page selected. The selection is driven through the select's VALUE (a
   * property write), never per-option `selected` attributes: once a user has
   * picked an option the browser marks it dirty and ignores attribute
   * changes, which would freeze the display on stale pages. The onchange
   * handler immediately re-syncs the DOM to currentPage so a dropped/failed
   * navigation (mid-render, client gone, host error) can never leave the
   * select showing a page the preview isn't on — the successful navigation
   * updates currentPage and the value follows.
   *
   * data-current-page/data-total-pages are the machine-readable seam the perf
   * gates read (tests/perf/*-gate.mjs): a select's option text never appears
   * in document.body.innerText, so the gates cannot scrape the page indicator
   * any other way. Keep these attributes when changing this control.
   *
   * PWA-clean (§8): type-only imports, zero host/Node code.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { PageNavController } from "$lib/routes/page-nav-controller.svelte";

  let {
    pageNav,
    rendering,
    zoom,
    zoomDisabled,
    onApplyZoom,
  }: {
    pageNav: PageNavController;
    rendering: boolean;
    zoom: string;
    zoomDisabled: boolean;
    onApplyZoom: (zoom: string) => void;
  } = $props();

  const ZOOM_LEVELS: Array<[string, string]> = [
    ["fit-width", "Fit to width"],
    ["0.25", "25%"],
    ["0.5", "50%"],
    ["0.75", "75%"],
    ["1", "100%"],
    ["1.25", "125%"],
    ["1.5", "150%"],
    ["2", "200%"],
  ];
  const zoomLabel = $derived(ZOOM_LEVELS.find(([val]) => val === zoom)?.[1] ?? "Zoom");

  // Close the enclosing <details> menu after a menu item is chosen, and return
  // focus to its summary for keyboard users.
  function closeMenu(e: Event) {
    const details = (e.currentTarget as HTMLElement)?.closest("details");
    if (details) {
      details.open = false;
      details.querySelector<HTMLElement>("summary")?.focus();
    }
  }
</script>

<div class="preview-toolbar" role="toolbar" aria-label="Preview controls">
  <nav class="page-nav" aria-label="Page navigation">
    <button class="icon-btn" onclick={() => pageNav.firstPage()} disabled={rendering} title="First page (Home)" aria-label="First page">
      <Icon name="chevrons-left" size={16} />
    </button>
    <button class="icon-btn" onclick={() => pageNav.prevPage()} disabled={rendering} title="Previous page (Left/PageUp)" aria-label="Previous page">
      <Icon name="chevron-left" size={16} />
    </button>
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
      <Icon name="chevron-right" size={16} />
    </button>
    <button class="icon-btn" onclick={() => pageNav.lastPage()} disabled={rendering} title="Last page (End)" aria-label="Last page">
      <Icon name="chevrons-right" size={16} />
    </button>
  </nav>

  <details class="menu zoom-menu">
    <summary class="icon-btn menu-summary" title="Zoom level" aria-label="Zoom level">
      <Icon name="zoom-in" size={16} />
      <span class="zoom-label">{zoomLabel}</span>
      <Icon name="chevron-down" size={12} />
    </summary>
    <div class="menu-panel">
      {#each ZOOM_LEVELS as [val, label] (val)}
        <button
          aria-pressed={zoom === val}
          class="menu-item"
          class:active={zoom === val}
          onclick={(e) => { onApplyZoom(val); closeMenu(e); }}
          disabled={zoomDisabled}
        >
          {label}
        </button>
      {/each}
    </div>
  </details>
</div>

<style>
  /* Same chrome as EditorToolbar so the two panes read as one pair. */
  .preview-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 3px 6px;
    min-height: 32px;
    box-sizing: border-box;
    width: 100%;
    flex-shrink: 0;
    background: var(--app-surface-raised);
    border-bottom: 1px solid var(--app-border);
    /* Above the iframe so the zoom dropdown paints over the preview. */
    position: relative;
    z-index: 11;
  }
  .page-nav {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .preview-toolbar button,
  .menu-summary {
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: var(--app-control-text);
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .icon-btn {
    padding: 4px 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .preview-toolbar button:hover:not(:disabled),
  .menu-summary:hover {
    background: var(--app-control-hover-bg);
  }
  .preview-toolbar button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .preview-toolbar button:focus-visible,
  .preview-toolbar select:focus-visible,
  .menu-summary:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 1px;
  }

  /* Page select — the former toolbar pill, with a custom chevron (the native
     GTK/OS select chrome ignores `background` on some platforms). */
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
    background-position: right 6px center;
    border: 1px solid light-dark(#b3c0d4, #576170);
    border-radius: 5px;
    color: light-dark(#1a3055, #eef4ff);
    font-size: 12px;
    font-weight: 500;
    padding: 3px 22px 3px 8px;
    min-width: 76px;
    margin: 0 2px;
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
     pill's light text with a light popup background (or vice versa). */
  .page-select option {
    background: var(--app-surface);
    color: var(--app-text);
  }

  /* ---- Zoom menu (same family as the app toolbar's dropdowns) ---- */
  .menu { position: relative; display: inline-block; }
  .menu-summary {
    list-style: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
  }
  .menu-summary::-webkit-details-marker { display: none; }
  .menu[open] .menu-summary {
    background: var(--app-control-hover-bg);
  }
  .zoom-label { font-size: 12px; }
  .menu-panel {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 80;
    min-width: 120px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 4px;
    background: var(--app-surface);
    border: 1px solid var(--app-border);
    border-radius: 4px;
    box-shadow: 0 4px 12px var(--app-shadow-md);
  }
  .preview-toolbar .menu-panel button.menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    border: 0;
    border-radius: 3px;
    color: var(--app-text);
    padding: 5px 8px;
    font-weight: 400;
  }
  .preview-toolbar .menu-panel button.menu-item:not(.active):hover:not(:disabled) {
    background: var(--app-control-hover-bg);
  }
  .preview-toolbar .menu-panel button.menu-item.active {
    background: var(--app-accent-subtle);
    color: var(--app-link);
    font-weight: 600;
  }
  .preview-toolbar .menu-panel button.menu-item.active::after {
    content: "\2713" / "";
    margin-left: auto;
    padding-left: 12px;
  }

  /* Narrow preview pane (the editor beside it, or a phone): the zoom label
     yields first, then the first/last jump buttons. */
  @container preview-pane (max-width: 420px) {
    .zoom-label { display: none; }
  }
  @container preview-pane (max-width: 300px) {
    .page-nav > .icon-btn:first-child,
    .page-nav > .icon-btn:last-child { display: none; }
  }

  @media (pointer: coarse) {
    .preview-toolbar .icon-btn,
    .preview-toolbar .menu-summary,
    .preview-toolbar .page-select {
      min-height: 40px;
      min-width: 40px;
    }
  }
</style>
