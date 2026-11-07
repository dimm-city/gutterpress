<script lang="ts">
  /**
   * StatusPopover — the status control's small panel: a short headline, one
   * sentence about the state, its one primary action, and a way into Book
   * setup → Backup & history.
   *
   * It follows BookSwitcher's pattern (an absolutely-positioned panel that opens
   * upward out of the bar) and adds what a panel with a button needs: Escape
   * and a click outside close it, focus moves onto the first button, focus
   * returns to the status control on Escape or after an action, and the panel
   * closes itself when focus leaves it or when the state it describes changes.
   * Presentational: the bar decides what each action does.
   */
  import { onMount } from "svelte";
  import type { StatusActionId, StatusLine } from "#lib/save-status.ts";

  let {
    line,
    busy = false,
    onAction,
    onClose,
  }: {
    line: StatusLine;
    /** An action is already running: the primary button waits. */
    busy?: boolean;
    onAction: (id: StatusActionId) => void;
    /** `refocus`: put focus back on the status control. */
    onClose: (refocus?: boolean) => void;
  } = $props();

  let root = $state<HTMLDivElement | null>(null);

  // The link into the tab is redundant when a button already goes there.
  let showBackupLink = $derived(
    line.primary?.id !== "open-backup" && line.secondary?.id !== "open-backup" && line.key !== "saving" && line.key !== "save-failed",
  );

  /** Closes the panel when the state it describes changes (so it never reopens on its own, or shows the wrong state). */
  function watchState(_node: HTMLElement, key: string) {
    let current = key;
    return {
      update(next: string) {
        if (next !== current) onClose(false);
        current = next;
      },
    };
  }

  function onFocusOut(e: FocusEvent) {
    const next = e.relatedTarget as HTMLElement | null;
    // Focus moving to the status control is its own toggle; elsewhere it closes the panel.
    if (next && (root?.contains(next) || next.closest(".status-wrap"))) return;
    if (next) onClose(false);
  }

  onMount(() => {
    root?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose(true);
      }
    };
    const onDown = (e: MouseEvent) => {
      // The status control itself toggles the panel; leave that click to it.
      const el = e.target as HTMLElement | null;
      if (root && el && !root.contains(el) && !el.closest(".status-wrap")) onClose(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  });
</script>

<div class="status-popover" role="dialog" aria-label="Status of this book" bind:this={root} use:watchState={line.key} onfocusout={onFocusOut}>
  <p class="headline {line.tone}">{line.headline}</p>
  <p class="detail">{line.detail}</p>
  <div class="actions">
    {#if line.primary}
      <button
        type="button"
        class={line.primaryQuiet ? "quiet" : "app-btn-primary primary"}
        disabled={busy && line.primary.id !== "open-backup"}
        onclick={() => onAction(line.primary!.id)}
      >{line.primary.label}</button>
    {/if}
    {#if line.secondary}
      <button type="button" class="link" onclick={() => onAction(line.secondary!.id)}>{line.secondary.label}</button>
    {/if}
    {#if showBackupLink}
      <button type="button" class="link" onclick={() => onAction("open-backup")}>Backup &amp; history…</button>
    {/if}
  </div>
</div>

<style>
  .status-popover {
    position: absolute;
    bottom: 100%;
    left: 0;
    margin: 0 0 4px;
    width: 320px;
    max-width: 90vw;
    padding: 12px 14px;
    display: grid;
    gap: 6px;
    background: var(--app-surface-raised);
    border: 1px solid var(--app-border);
    border-radius: 6px;
    box-shadow: 0 -4px 16px var(--app-shadow-md);
    z-index: var(--app-z-popover);
    font-size: 12px;
    color: var(--app-text-secondary);
  }
  .headline { margin: 0; font-size: 12px; font-weight: 600; color: var(--app-text); }
  .headline.warn { color: var(--app-warning-text); }
  .headline.error { color: var(--app-error-text); }
  .detail { margin: 0; line-height: 1.45; }
  .actions { display: flex; align-items: center; gap: 12px; margin-top: 6px; flex-wrap: wrap; }
  .primary { font-size: 12px; padding: 5px 12px; }
  .quiet {
    font-size: 12px;
    padding: 4px 11px;
    background: transparent;
    color: var(--app-text);
    border: 1px solid var(--app-border);
    border-radius: 4px;
    cursor: pointer;
  }
  .quiet:hover:not(:disabled) { background: var(--app-surface-hover); }
  .quiet:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  .link {
    border: none;
    background: transparent;
    padding: 2px 0;
    font: inherit;
    color: var(--app-link);
    cursor: pointer;
    text-decoration: underline;
  }
  .link:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
</style>
