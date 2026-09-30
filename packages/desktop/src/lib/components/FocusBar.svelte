<script lang="ts">
  /**
   * FocusBar — the slim bar that replaces the app toolbar while Focus is on.
   *
   * Holds ONLY: the Edit/Read switch, Exit focus, and (in Read) page
   * navigation. It floats over the workspace instead of taking layout space,
   * fades out after a few idle seconds, and comes back on pointer movement
   * near the top edge or when it receives keyboard focus (Tab). Reduced motion
   * gets the same show/hide without the fade. The show/fade state machine is
   * `createIdleReveal` (focus-mode.ts).
   *
   * Purely presentational and PWA-clean (§8): props in, callbacks out.
   */
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { createIdleReveal, pointerWakesBar, type IdleReveal } from "$lib/routes/focus-mode";
  import type { PageNavController } from "$lib/routes/page-nav-controller.svelte";

  let {
    view,
    onSelectView,
    onExit,
    pageNav,
    showPageNav,
    rendering,
  }: {
    view: "edit" | "read";
    onSelectView: (view: "edit" | "read") => void;
    onExit: () => void;
    pageNav: PageNavController;
    /** Page navigation shows in Read only (and only once a preview exists). */
    showPageNav: boolean;
    rendering: boolean;
  } = $props();

  let visible = $state(true);
  let barEl: HTMLElement | undefined = $state();
  let idle: IdleReveal | undefined;

  onMount(() => {
    idle = createIdleReveal((v) => (visible = v));
    const onMove = (e: PointerEvent) => {
      if (pointerWakesBar(e.clientY)) idle?.reveal();
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      idle?.dispose();
    };
  });

  // Hovering, or KEYBOARD focus (Tab), inside the bar holds it open; leaving
  // restarts the countdown. A mouse click also focuses a button, so plain focus
  // must not hold — the bar would never fade after the first click.
  // focusout only releases when focus really left the bar.
  const hold = () => idle?.hold(true);
  const release = () => idle?.hold(false);
  function onFocusIn(e: FocusEvent) {
    if ((e.target as HTMLElement).matches(":focus-visible")) hold();
  }
  function onFocusOut(e: FocusEvent) {
    if (!barEl?.contains(e.relatedTarget as Node | null)) release();
  }
</script>

<!-- Pointer/focus handlers only hold the bar open; every control inside is a real button. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={barEl}
  class="focus-bar"
  class:faded={!visible}
  role="group"
  aria-label="Focus controls"
  onpointerenter={hold}
  onpointerleave={release}
  onfocusin={onFocusIn}
  onfocusout={onFocusOut}
>
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

  <button class="exit" onclick={onExit} title="Exit focus (Esc or Ctrl+Shift+F)" aria-label="Exit focus">
    <Icon name="x" /><span class="label">Exit focus</span>
  </button>
</div>

<style>
  .focus-bar {
    position: fixed;
    top: 8px;
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
    border-radius: 10px;
    box-shadow: 0 4px 14px var(--app-shadow-md);
    opacity: 1;
    transition: opacity 0.25s ease-out;
  }
  /* Faded: invisible and click-through, but still in the tab order so Tab
     reaches it (focusin holds it open). */
  .focus-bar.faded {
    opacity: 0;
    pointer-events: none;
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
