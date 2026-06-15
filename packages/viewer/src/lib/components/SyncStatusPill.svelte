<script lang="ts">
  /**
   * SyncStatusPill — ambient sync status indicator (transparent-sync plan §5.1).
   *
   * Subscribes to the host auto-sync orchestrator via getPlatform().onSyncStatus()
   * and renders a small always-visible pill in the toolbar. The normal author
   * should never need to act on it; it silently says "Everything is in sync"
   * at rest or "Saving changes…" while a sync runs.
   *
   * The only two states that invite interaction are:
   *   auth     → clicking opens the reconnect flow
   *   conflict → clicking opens the ConflictChoicesDialog
   *
   * No Git jargon in any string (transparent-sync plan §5.1, copy discipline).
   * No counts (§3.5 — counts require history walks).
   * PWA-clean: all host work via getPlatform() (CLAUDE.md §8 / ADR 0004).
   */
  import { onDestroy } from "svelte";
  import { getPlatform, isDesktop } from "$lib/platform";
  import type { SyncStatus, SyncState, ConflictFileInfo } from "$lib/platform/contract";

  let {
    /** Currently-open project directory — pill is hidden when null. */
    projectDir = null as string | null,
    /** Called when the auth pill is clicked — should open the reconnect flow. */
    onReconnect,
    /**
     * Called when the conflict pill is clicked — receives the conflict file list
     * so the parent can open the ConflictChoicesDialog.
     */
    onConflict,
    /**
     * Called when the quiet pill (synced/offline/syncing) is clicked (§5.2).
     * Should open the SyncDialog details/advanced view.
     */
    onDetails,
  }: {
    projectDir?: string | null;
    onReconnect?: () => void;
    onConflict?: (files: ConflictFileInfo[]) => void;
    onDetails?: () => void;
  } = $props();

  let syncState = $state<SyncState>("idle");
  let conflictFiles = $state<ConflictFileInfo[]>([]);

  // Subscribe to the host orchestrator's status stream. Re-subscribe whenever
  // the project dir changes (or the component mounts/unmounts).
  let unsubscribe: (() => void) | null = null;

  $effect(() => {
    unsubscribe?.();
    unsubscribe = null;
    // Only subscribe when running in the desktop host (the WebAdapter stub is a
    // safe no-op but we skip the wiring on the web path for clarity).
    if (!isDesktop() || !projectDir) {
      syncState = "idle";
      conflictFiles = [];
      return;
    }
    unsubscribe = getPlatform().onSyncStatus((status: SyncStatus) => {
      // Scope to this project only (the host may manage multiple open windows).
      if (status.projectDir !== projectDir) return;
      syncState = status.state;
      conflictFiles = status.files ?? [];
    });
    // Return the cleanup function for Svelte's $effect cleanup.
    return () => {
      unsubscribe?.();
      unsubscribe = null;
    };
  });

  onDestroy(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  /**
   * The plain-language pill text (§5.1 mapping).
   * "idle" returns null — pill is hidden when there's nothing to show.
   */
  let pillText = $derived.by((): string | null => {
    switch (syncState) {
      case "syncing":
        return "Saving changes…";
      case "synced":
      case "up-to-date":
        return "Everything is in sync";
      case "offline":
        return "Offline — changes are saved on this computer";
      case "auth":
        return "Reconnect your repository";
      case "conflict":
        return "Changes happened in two places — tap to review";
      case "error":
        // Treat errors like offline from the pill's perspective (§5.1).
        return "Offline — changes are saved on this computer";
      case "idle":
      default:
        return null;
    }
  });

  /** True for states that are visually "quiet" (no action needed). */
  let isQuiet = $derived(
    syncState === "synced" || syncState === "up-to-date" || syncState === "idle",
  );

  /** True when the pill should pulse/animate (a sync is actively running). */
  let isActive = $derived(syncState === "syncing");

  /** True for states that require user attention. */
  let isWarning = $derived(syncState === "auth" || syncState === "conflict");

  function handleClick() {
    if (syncState === "auth") {
      onReconnect?.();
    } else if (syncState === "conflict") {
      onConflict?.(conflictFiles);
    } else if (onDetails) {
      // Quiet states (synced/offline/syncing) open the Sync details view when
      // an onDetails handler is wired — satisfies §5.2 advanced-path reachability.
      onDetails();
    }
  }

  /**
   * Whether the pill is interactive.
   * - auth/conflict always invite action.
   * - quiet states are interactive when an onDetails handler is provided (§5.2).
   */
  let interactive = $derived(
    syncState === "auth" || syncState === "conflict" || !!onDetails,
  );
</script>

{#if pillText !== null && projectDir}
  {#if interactive}
    <!-- Auth and conflict pills are buttons — they invite an action. -->
    <button
      class="sync-pill"
      class:quiet={isQuiet}
      class:active={isActive}
      class:warning={isWarning}
      onclick={handleClick}
      aria-label={pillText}
      title={pillText}
    >
      {#if isActive}
        <span class="pill-spinner" aria-hidden="true"></span>
      {:else if syncState === "conflict"}
        <span class="pill-dot warning-dot" aria-hidden="true"></span>
      {:else if syncState === "auth"}
        <span class="pill-dot auth-dot" aria-hidden="true"></span>
      {/if}
      <span class="pill-text">{pillText}</span>
    </button>
  {:else}
    <!-- Syncing/synced/offline — informational only, not a button. -->
    <div
      class="sync-pill"
      class:quiet={isQuiet}
      class:active={isActive}
      class:warning={isWarning}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={pillText}
      title={pillText}
    >
      {#if isActive}
        <span class="pill-spinner" aria-hidden="true"></span>
      {/if}
      <span class="pill-text">{pillText}</span>
    </div>
  {/if}
{/if}

<style>
  .sync-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 11px;
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 260px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    /* Default: informational / synced state */
    background: transparent;
    border: 1px solid var(--app-border-subtle);
    color: var(--app-text-faint);
    cursor: default;
    user-select: none;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  /* "Saving changes…" — slightly more prominent while in flight. */
  .sync-pill.active {
    color: var(--app-text-secondary);
    border-color: var(--app-border);
  }

  /* auth / conflict — needs attention, rendered like a subtle warning. */
  .sync-pill.warning {
    color: var(--app-warning-text, #b45309);
    border-color: var(--app-warning-border, #fbbf24);
    background: var(--app-warning-bg, rgba(251, 191, 36, 0.08));
    cursor: pointer;
  }
  button.sync-pill.warning:hover {
    background: var(--app-warning-bg-hover, rgba(251, 191, 36, 0.16));
  }
  button.sync-pill:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }

  .pill-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Thin spinner that matches the SyncDialog's spinner — same animation, slightly
     smaller to fit the pill. */
  .pill-spinner {
    width: 10px;
    height: 10px;
    border: 1.5px solid var(--app-border);
    border-top-color: var(--app-focus-ring);
    border-radius: 50%;
    animation: pill-spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  @keyframes pill-spin { to { transform: rotate(360deg); } }

  /* Small dot indicator for auth/conflict (no spinner — these are stable states). */
  .pill-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .warning-dot { background: var(--app-warning-text, #b45309); }
  .auth-dot    { background: var(--app-warning-text, #b45309); }
</style>
