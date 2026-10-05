<script lang="ts">
  /**
   * FocusBar — the slim bar that replaces the app toolbar while Focus is on.
   *
   * Holds ONLY: the Edit/Read switch, Exit focus, and (in Read) page
   * navigation or (in Edit) the book's file switcher. It floats over the workspace instead of taking layout space.
   * After a few idle seconds it slides up until only a sliver shows at the
   * top edge; pointing at that sliver (or Tab into it) slides it back down.
   * Reduced motion gets the same show/hide without the slide. The show/hide
   * state machine is `createIdleReveal` (focus-mode.ts).
   *
   * Purely presentational and PWA-clean (§8): props in, callbacks out.
   */
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { createIdleReveal, type IdleReveal } from "$lib/routes/focus-mode";
  import type { PageNavController } from "$lib/routes/page-nav-controller.svelte";

  let {
    view,
    onSelectView,
    onExit,
    pageNav,
    showPageNav,
    rendering,
    files,
    currentFile,
    onSelectFile,
    readerMode = false,
  }: {
    view: "edit" | "read";
    onSelectView: (view: "edit" | "read") => void;
    onExit: () => void;
    pageNav: PageNavController;
    /** Page navigation shows in Read only (and only once a preview exists). */
    showPageNav: boolean;
    rendering: boolean;
    /** Markdown files in book order; the switcher shows in Edit when non-empty. */
    files: string[];
    /** Basename of the file open in the editor. */
    currentFile: string | null;
    onSelectFile: (name: string) => void | Promise<void>;
    /** Reader (Settings → App): no Edit/Read switch. */
    readerMode?: boolean;
  } = $props();

  let visible = $state(true);
  let barEl: HTMLElement | undefined = $state();
  let idle: IdleReveal | undefined;

  onMount(() => {
    idle = createIdleReveal((v) => (visible = v));
    return () => idle?.dispose();
  });

  // Pointer over the bar shows it and restarts the idle countdown; it tucks
  // away once the pointer has stopped moving over it. Deliberately NOT a
  // hover hold released on pointerleave: below the bar is the cross-origin
  // preview iframe, and a pointer that moves into it never tells this
  // document it left, so a hold would keep the bar down for good.
  const reveal = () => idle?.reveal();
  // KEYBOARD focus (Tab) inside the bar, or an open page <select>, holds it
  // open. A mouse click also focuses a button, so plain focus must not hold —
  // the bar would never tuck away after the first click. focusout only
  // releases when focus really left the bar.
  function onFocusIn(e: FocusEvent) {
    const t = e.target as HTMLElement;
    if (t.matches(":focus-visible") || t.tagName === "SELECT") idle?.hold(true);
  }
  function onFocusOut(e: FocusEvent) {
    if (!barEl?.contains(e.relatedTarget as Node | null)) idle?.hold(false);
  }
</script>

<!-- Pointer/focus handlers only show or hold the bar; every control inside is a real button. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={barEl}
  class="focus-bar"
  class:tucked={!visible}
  role="group"
  aria-label="Focus controls"
  onpointerenter={reveal}
  onpointermove={reveal}
  onfocusin={onFocusIn}
  onfocusout={onFocusOut}
>
  {#if !readerMode}
  <div class="view-switch" role="group" aria-label="View">
    <button
      class:active={view === "edit"}
      aria-pressed={view === "edit"}
      title="Edit — write with the preview beside you"
      onclick={() => onSelectView("edit")}
    >
      <Icon name="pen-line" /><span class="label">Edit</span>
    </button>
    <button
      class:active={view === "read"}
      aria-pressed={view === "read"}
      title="Read — just the pages"
      onclick={() => onSelectView("read")}
    >
      <Icon name="book-open" /><span class="label">Read</span>
    </button>
  </div>
  {/if}

  {#if showPageNav}
    <nav class="page-nav" aria-label="Page navigation">
      <button class="icon" onclick={() => pageNav.prevPage()} disabled={rendering} title="Previous page (Left/PageUp)" aria-label="Previous page">
        <Icon name="chevron-left" />
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
      <button class="icon" onclick={() => pageNav.nextPage()} disabled={rendering} title="Next page (Right/PageDown)" aria-label="Next page">
        <Icon name="chevron-right" />
      </button>
    </nav>
  {/if}

  {#if files.length > 0}
    <select
      class="page-select file-select"
      aria-label="Chapter"
      title="Switch chapter"
      value={currentFile}
      onchange={async (e) => {
        const el = e.currentTarget as HTMLSelectElement;
        await onSelectFile(el.value);
        // A cancelled/failed switch leaves the editor on the old file.
        el.value = currentFile ?? "";
      }}
    >
      {#each files as f (f)}
        <option value={f}>{f}</option>
      {/each}
    </select>
  {/if}

  <button class="exit" onclick={onExit} title="Exit focus (Esc)" aria-label="Exit focus">
    <Icon name="x" /><span class="label">Exit focus</span>
  </button>
</div>

<style>
  /* Hangs from the top edge like a drawer, so a pointer resting on the very
     top of the window stays over it while it slides down (a gap above it
     made the bar slide away from the pointer and flicker). */
  .focus-bar {
    position: fixed;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    z-index: var(--app-z-toolbar);
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: calc(100vw - 16px);
    padding: 4px 6px;
    background: var(--app-surface);
    border: 1px solid var(--app-border);
    border-top: none;
    border-radius: 0 0 10px 10px;
    box-shadow: 0 4px 14px var(--app-shadow-md);
    transition: transform 0.2s ease-out;
    /* How much of the tucked bar stays visible at the top edge. */
    --focus-bar-peek: 6px;
  }
  /* Tucked: slid up so only its bottom edge shows at the top of the window.
     It stays pointable (pointing at the sliver slides it back down) and in
     the tab order (focusin holds it open). */
  .focus-bar.tucked {
    transform: translate(-50%, calc(-100% + var(--focus-bar-peek)));
  }
  @media (prefers-reduced-motion: reduce) {
    .focus-bar {
      transition: none;
    }
  }

  .view-switch {
    display: inline-flex;
    background: var(--app-control-bg);
    border: 1px solid var(--app-control-border);
    border-radius: 7px;
    padding: 2px;
  }
  .page-nav {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--app-control-text);
    border-radius: 5px;
    padding: 4px 9px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }
  button:hover:not(:disabled):not(.active) {
    background: var(--app-control-hover-bg);
  }
  button.active {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  button.exit {
    background: var(--app-control-bg);
    border-color: var(--app-control-border);
  }
  button:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }
  .page-select {
    background: var(--app-control-bg);
    border: 1px solid var(--app-control-border);
    border-radius: 6px;
    color: var(--app-control-text);
    font-size: 12px;
    padding: 4px 8px;
    min-width: 72px;
    cursor: pointer;
  }
  .file-select {
    max-width: 220px;
    text-overflow: ellipsis;
  }
  .page-select:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .page-select option {
    background: var(--app-surface);
    color: var(--app-text);
  }
  /* Narrow: icons only (every control keeps its aria-label and tooltip). */
  @media screen and (max-width: 820px) {
    .label {
      display: none;
    }
  }
</style>
