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
  import { onMount } from "svelte";
  import { getPlatform, isDesktop } from "$lib/platform";
  import { api } from "$lib/api";
  import type { SyncStatus, SyncState, ConflictFileEntry } from "$lib/platform/contract";

  let {
    /** Currently-open project directory — pill is hidden when null. */
    projectDir = null as string | null,
    /** Called when the auth pill is clicked — should open the reconnect flow. */
    onReconnect,
    /**
     * Called when the conflict pill is clicked — receives the conflict file
     * list plus the localId/remoteId from the SAME SyncStatus payload (M13 —
     * absent when the emitting host path couldn't compute them), so the parent
     * can open ConflictChoicesDialog without a second network sync.
     */
    onConflict,
    /**
     * Called when the quiet pill (synced/offline/syncing) is clicked (§5.2).
     * Receives the project's operation-log path (or null if none yet) so the
     * parent can open ProjectActivityView — the writer-facing version-history
     * + operation-log surface (M37: this comment previously named
     * OperationLogDialog, a separate modal used only by the recovery flows).
     */
    onDetails,
    onSyncState,
  }: {
    projectDir?: string | null;
    onReconnect?: () => void;
    onConflict?: (files: ConflictFileEntry[], localId?: string, remoteId?: string) => void;
    onDetails?: (logFilePath: string | null) => void;
    /** Fired on every sync-state transition so an ancestor (the status-bar
     *  protection summary) can show the live online-copy status instead of a
     *  static capability flag. */
    onSyncState?: (state: SyncState) => void;
  } = $props();

  let syncState = $state<SyncState>("idle");
  let conflictFiles = $state<ConflictFileEntry[]>([]);
  // M13: the conflict ids from the same SyncStatus payload, when the emitting
  // host path could compute them — see onConflict's doc comment above.
  let conflictLocalId = $state<string | undefined>(undefined);
  let conflictRemoteId = $state<string | undefined>(undefined);
  // Last-known operation-log path for this project, carried on the status stream
  // (SyncStatus.logFile). Retained across status transitions so clicking the
  // pill can always open the log once any sync/recovery has emitted a path.
  let logFilePath = $state<string | null>(null);
  /**
   * M40: text for the ALWAYS-rendered visually-hidden live region below,
   * updated on every real state transition (see the onSyncStatus handler).
   * Previously the aria-live announcement lived on the non-interactive pill
   * branch (`role="status"`) — dead code, since `interactive` is true
   * whenever `onDetails` is passed and the only real mount always passes it,
   * so screen-reader users never heard a single sync transition. This region
   * is unconditional (not gated on `pillText`/`projectDir` like the visible
   * pill) so it persists across every visibility toggle.
   */
  let liveMessage = $state<string | null>(null);

  // Subscribe to the host orchestrator's status stream on mount.
  // The parent wraps this component in {#key projectDir} so onMount fires fresh
  // whenever projectDir changes, providing the same re-subscription behaviour.
  onMount(() => {
    // Reset per-project state so a previous project's log path never leaks.
    logFilePath = null;
    liveMessage = null;
    // Only subscribe when running in the desktop host (the WebAdapter stub is a
    // safe no-op but we skip the wiring on the web path for clarity).
    if (!isDesktop() || !projectDir) {
      syncState = "idle";
      conflictFiles = [];
      onSyncState?.("idle");
      return;
    }
    const applyStatus = (status: SyncStatus) => {
      // Scope to this project only (the host may manage multiple open windows).
      if (status.projectDir !== projectDir) return;
      syncState = status.state;
      onSyncState?.(status.state);
      conflictFiles = status.files ?? [];
      conflictLocalId = status.localId;
      conflictRemoteId = status.remoteId;
      // M40: announce the transition via the persistent live region. `pillText`
      // is a $derived that already reflects the `syncState` assignment above by
      // the time it's read here. Only overwrite on a real (non-hidden) state so
      // an "idle" transition doesn't blank the last meaningful announcement.
      if (pillText) liveMessage = pillText;
      // Retain the latest non-empty log path (later "idle" events omit it).
      if (status.logFile) logFilePath = status.logFile;
      // Auto-clear "recovered" confirmation back to "synced" after ~4s.
      if (recoveredTimer) { clearTimeout(recoveredTimer); recoveredTimer = null; }
      if (status.state === "recovered") {
        recoveredTimer = setTimeout(() => {
          recoveredTimer = null;
          if (syncState === "recovered") { syncState = "synced"; onSyncState?.("synced"); }
        }, 4000);
      }
    };
    let receivedLive = false;
    const unsubscribe = getPlatform().onSyncStatus((status: SyncStatus) => {
      receivedLive = true;
      applyStatus(status);
    });
    // Seed from the host's retained status: "sync:status" is fire-and-forget
    // with no replay, so any emit that happened BEFORE this subscription (the
    // project-open one-shot "connect"/"local" states especially) would
    // otherwise be lost and the pill would sit blank/stale until the next
    // periodic tick. A push that lands first wins — the seed is older by
    // definition, so it never overwrites a live event.
    void api.sync
      .getStatus(projectDir)
      .then((status) => {
        if (!receivedLive && status) applyStatus(status);
      })
      .catch(() => {});
    return () => {
      unsubscribe();
      if (recoveredTimer) { clearTimeout(recoveredTimer); recoveredTimer = null; }
    };
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
      case "local":
        // Local project, no online copy: previous versions are being kept.
        // Clickable → opens the Previous versions view (§5.2 reachability).
        return "Previous versions available";
      case "connect":
        // An HTTPS remote exists but print-md isn't connected to it — one
        // step from syncing. Actionable copy + click routes to the connect
        // flow (same plumbing as "auth"), instead of the old misleading
        // "local" framing that read as a remote-detection bug.
        return "Connect to keep an online copy";
      case "auth":
        return "Reconnect your project";
      case "conflict":
        // Kept short so the actionable "tap to review" survives the pill's
        // max-width and never truncates (three-judge gate finding).
        return "Changes in two places — tap to review";
      case "error":
        // M40: honest copy — a transient/unexpected sync failure is NOT the
        // same thing as no network, and telling a writer on a working
        // connection they're "Offline" is misleading. Still calm/no-jargon.
        return "Sync paused — changes are saved on this computer";
      case "recovering":
        // Calm, task-named, no alarm word in the always-visible chrome
        // (three-judge gate: keep "problem" out of the ambient pill).
        return "Tidying up sync…";
      case "recovered":
        // Brief confirmation; auto-clears to "Everything is in sync" (see effect).
        return "Sync all set";
      case "idle":
      default:
        return null;
    }
  });

  /**
   * Full-sentence aria-label so screen-reader users get the reassuring context
   * the terse visible chip omits — and a guaranteed closure signal for recovery
   * even if the overlay was dismissed/auto-cleared (three-judge a11y finding).
   */
  let ariaLabel = $derived.by((): string | null => {
    switch (syncState) {
      case "recovering":
        return "A sync problem is being fixed automatically. Your work is backed up.";
      case "recovered":
        return "A sync problem was fixed. Your work is safe.";
      default:
        return pillText;
    }
  });

  /** True for states that are visually "quiet" (no action needed). */
  let isQuiet = $derived(
    syncState === "synced" ||
      syncState === "up-to-date" ||
      syncState === "idle" ||
      syncState === "recovered" ||
      syncState === "local",
  );

  /** True when the pill should pulse/animate (a sync is actively running). */
  let isActive = $derived(syncState === "syncing" || syncState === "recovering");

  // Auto-clear the brief "Sync all set" confirmation back to the quiet
  // in-sync state after ~4s (three-judge gate: a confirmation, not a badge).
  // The timer is started directly in the onSyncStatus handler when "recovered"
  // arrives — no reactive tracking needed.
  let recoveredTimer: ReturnType<typeof setTimeout> | null = null;

  /** True for states that require user attention. */
  let isWarning = $derived(syncState === "auth" || syncState === "conflict");

  /** "connect" invites (not warns): accent dot, clickable, neutral text. */
  let isInvite = $derived(syncState === "connect");

  function handleClick() {
    if (syncState === "auth" || syncState === "connect") {
      // Both route to the connect/reconnect flow — "connect" is the
      // never-connected variant of the same action.
      onReconnect?.();
    } else if (syncState === "conflict") {
      onConflict?.(conflictFiles, conflictLocalId, conflictRemoteId);
    } else if (onDetails) {
      // Quiet states (synced/offline/syncing) open the operation log when an
      // onDetails handler is wired — satisfies §5.2 advanced-path reachability.
      onDetails(logFilePath);
    }
  }

  /**
   * Whether the pill is interactive.
   * - auth/conflict always invite action.
   * - quiet states are interactive when an onDetails handler is provided (§5.2).
   */
  let interactive = $derived(
    syncState === "auth" || syncState === "conflict" || syncState === "connect" || !!onDetails,
  );
</script>

<!-- M40: persistent visually-hidden live region — announces every real sync
     state transition regardless of whether the visible pill is a button or
     plain text (see liveMessage's doc comment). Replaces the dead
     role="status" branch that used to live on the non-interactive markup
     below, which never rendered in production. -->
<div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
  {liveMessage ?? ""}
</div>

{#if pillText !== null && projectDir}
  {#if interactive}
    <!-- Auth and conflict pills are buttons — they invite an action. -->
    <button
      class="sync-pill"
      class:quiet={isQuiet}
      class:active={isActive}
      class:warning={isWarning}
      class:invite={isInvite}
      onclick={handleClick}
      aria-label={ariaLabel}
      title={pillText}
    >
      {#if isActive}
        <span class="pill-spinner" aria-hidden="true"></span>
      {:else if syncState === "conflict"}
        <span class="pill-dot warning-dot" aria-hidden="true"></span>
      {:else if syncState === "auth"}
        <span class="pill-dot auth-dot" aria-hidden="true"></span>
      {:else if syncState === "connect"}
        <span class="pill-dot connect-dot" aria-hidden="true"></span>
      {/if}
      <span class="pill-text">{pillText}</span>
    </button>
  {:else}
    <!-- Syncing/synced/offline — informational only, not a button. Announcing
         its transitions is owned entirely by the persistent live region
         above (M40) — this element no longer duplicates role="status"/
         aria-live, which never rendered in production anyway (`interactive`
         is always true whenever `onDetails` is passed, and the only real
         mount always passes it). -->
    <div
      class="sync-pill"
      class:quiet={isQuiet}
      class:active={isActive}
      class:warning={isWarning}
      aria-label={ariaLabel}
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
  /* M40: standard sr-only pattern for the persistent live region — visually
     invisible but still reachable by assistive tech (same shape as
     dialog-shell.css's .dlg-sr-only; kept local since this component isn't a
     dialog and doesn't otherwise import that stylesheet). */
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* Plain status TEXT — no border, no chip background. Matches the status bar's
     "All changes saved" indicator (same size/colour) so the two read as one
     row of ambient status text rather than a button-y pill. */
  .sync-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    font-size: 11px;
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 260px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: var(--app-text-secondary);
    cursor: default;
    user-select: none;
    transition: color 0.15s;
  }

  /* "Saving changes…" — same text colour while in flight (spinner carries the cue). */
  .sync-pill.active {
    color: var(--app-text-secondary);
  }

  /* auth / conflict — needs attention: a warning text colour (still no chrome),
     and clickable so the author can act on it. */
  .sync-pill.warning {
    color: var(--app-warning-text);
    cursor: pointer;
  }
  button.sync-pill.warning:hover {
    color: var(--app-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  /* Quiet states are clickable too (view the git/sync activity log). Keep the
     affordance ambient per §5.1 — a pointer + the same subtle underline-brighten
     as the warning hover, but in the neutral text colour (no button chrome). */
  button.sync-pill:not(.warning) {
    cursor: pointer;
  }
  button.sync-pill:not(.warning):hover {
    color: var(--app-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  button.sync-pill:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
    border-radius: 2px;
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
  .warning-dot { background: var(--app-warning-text); }
  .auth-dot    { background: var(--app-warning-text); }
  /* "connect" invites rather than warns — accent-colored dot, neutral text. */
  .connect-dot { background: var(--app-accent); }
  .sync-pill.invite { cursor: pointer; }
</style>
