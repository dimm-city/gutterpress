<script lang="ts">
  /**
   * FindBar — the viewer's Ctrl+F surface (owner ruling 2026-08-15: find is
   * viewer-only; editing a found word goes through "Go to source").
   *
   * Search runs INSIDE the preview frame via the existing previewAPI bridge
   * (`client.call("find", …)` → the viewer's own `window.find`), so matches
   * can only ever be book content — never the app's toolbar chrome or the
   * editor. The viewer advances its native selection on each step (wrapping
   * at the ends) and scrolls the match into view.
   *
   * Enter → next, Shift+Enter → previous, Escape/✕ → close (clears the
   * selection). PWA-clean (§8 / ADR 0004): everything goes through the
   * PreviewClient postMessage bridge — no host code at all.
   */
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import type { PreviewClient } from "$lib/preview-client";

  let {
    open = $bindable(false),
    client = null,
    onClose,
  }: {
    open?: boolean;
    client?: PreviewClient | null;
    onClose?: () => void;
  } = $props();

  interface FindReply {
    found: boolean;
    total: number;
  }

  let query = $state("");
  let result = $state<FindReply | null>(null);
  let inputEl = $state<HTMLInputElement | undefined>(undefined);

  /** Focus + select on mount (the bar is created fresh each open). */
  function autofocus(el: HTMLInputElement) {
    inputEl = el;
    el.focus();
    el.select();
  }

  onMount(() => {
    return () => {
      // Leaving the workspace with the bar up must not strand a selection.
      void client?.call("clearFind").catch(() => {});
    };
  });

  async function find(backwards = false) {
    if (!client) return;
    if (!query) {
      result = null;
      void client.call("clearFind").catch(() => {});
      return;
    }
    try {
      result = await client.call<FindReply>("find", [query, backwards]);
    } catch {
      result = null;
    }
  }

  function close() {
    void client?.call("clearFind").catch(() => {});
    query = "";
    result = null;
    open = false;
    onClose?.();
  }

  function onInputKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      void find(e.shiftKey);
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
      oninput={() => void find()}
      onkeydown={onInputKeydown}
    />
    <span class="find-count" aria-live="polite">
      {#if query && result}
        {result.total > 0 ? `${result.total} match${result.total === 1 ? "" : "es"}` : "No matches"}
      {/if}
    </span>
    <button
      class="find-btn"
      onclick={() => void find(true)}
      disabled={!query}
      title="Previous match (Shift+Enter)"
      aria-label="Previous match"
    ><Icon name="chevron-up" size={14} /></button>
    <button
      class="find-btn"
      onclick={() => void find(false)}
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
    min-width: 72px;
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
