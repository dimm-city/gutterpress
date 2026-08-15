<script lang="ts">
  /**
   * FindBar — the viewer's Ctrl+F surface. Drives Electron's native
   * window-level find (`getPlatform().findInPage`), which is the ONLY way to
   * search the cross-origin preview iframe: the renderer can't reach its DOM,
   * but Chromium's find searches every frame, paints the native highlights,
   * and scrolls the active match into view — across ALL pages, since the
   * viewer keeps the whole book in the DOM.
   *
   * Enter → next, Shift+Enter → previous, Escape/✕ → close (clears the
   * highlights). The match counter comes from the onFindResult push stream.
   *
   * PWA-clean (§8 / ADR 0004): host work only through getPlatform().
   */
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { getPlatform } from "$lib/platform";
  import type { FindInPageResult } from "$lib/platform/contract";

  let {
    open = $bindable(false),
    onClose,
  }: {
    open?: boolean;
    onClose?: () => void;
  } = $props();

  let query = $state("");
  let result = $state<FindInPageResult | null>(null);
  let inputEl = $state<HTMLInputElement | undefined>(undefined);

  /** Focus + select on mount (the bar is created fresh each open). */
  function autofocus(el: HTMLInputElement) {
    inputEl = el;
    el.focus();
    el.select();
  }

  onMount(() => {
    const off = getPlatform().onFindResult((r) => {
      result = r;
    });
    return () => {
      off?.();
      // Leaving the workspace with the bar up must not strand highlights.
      void getPlatform().stopFindInPage("clearSelection");
    };
  });

  function startSearch() {
    if (!query) {
      result = null;
      void getPlatform().stopFindInPage("clearSelection");
      return;
    }
    void getPlatform().findInPage(query, { findNext: false });
  }

  function step(forward: boolean) {
    if (!query) return;
    void getPlatform().findInPage(query, { forward, findNext: true });
  }

  function close() {
    void getPlatform().stopFindInPage("clearSelection");
    query = "";
    result = null;
    open = false;
    onClose?.();
  }

  function onInputKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      step(!e.shiftKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  /** Re-focus the input (host calls this when Ctrl+F fires while already open). */
  export function focusInput() {
    inputEl?.focus();
    inputEl?.select();
  }
</script>

{#if open}
  <div class="find-bar" role="search" aria-label="Find in book">
    <Icon name="search" size={14} />
    <input
      class="find-input"
      type="text"
      placeholder="Find in book…"
      aria-label="Find text"
      bind:value={query}
      use:autofocus
      oninput={startSearch}
      onkeydown={onInputKeydown}
    />
    <span class="find-count" aria-live="polite">
      {#if query && result}
        {result.matches > 0 ? `${result.activeMatchOrdinal}/${result.matches}` : "0 results"}
      {/if}
    </span>
    <button
      class="find-btn"
      onclick={() => step(false)}
      disabled={!query}
      title="Previous match (Shift+Enter)"
      aria-label="Previous match"
    ><Icon name="chevron-up" size={14} /></button>
    <button
      class="find-btn"
      onclick={() => step(true)}
      disabled={!query}
      title="Next match (Enter)"
      aria-label="Next match"
    ><Icon name="chevron-down" size={14} /></button>
    <button
      class="find-btn"
      onclick={close}
      title="Close (Esc)"
      aria-label="Close find"
    ><Icon name="x" size={14} /></button>
  </div>
{/if}

<style>
  .find-bar {
    position: absolute;
    top: 8px;
    right: 16px;
    z-index: var(--app-z-popover);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 8px;
    background: var(--app-surface);
    border: 1px solid var(--app-border);
    box-shadow: 0 4px 16px var(--app-shadow-md);
    color: var(--app-text-secondary);
  }

  .find-input {
    width: 200px;
    padding: 4px 8px;
    font-size: 12px;
    border-radius: 6px;
    border: 1px solid var(--app-border);
    background: var(--app-surface-sunken);
    color: var(--app-text);
  }
  .find-input:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 1px;
  }

  .find-count {
    min-width: 56px;
    text-align: right;
    font-size: 11px;
    color: var(--app-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .find-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 5px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--app-text-secondary);
    cursor: pointer;
  }
  .find-btn:hover:not(:disabled) {
    background: var(--app-surface-hover);
    color: var(--app-text);
  }
  .find-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .find-btn:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 1px;
  }
</style>
