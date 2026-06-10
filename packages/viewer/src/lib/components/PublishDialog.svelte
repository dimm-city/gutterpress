<script lang="ts">
  /**
   * PublishDialog (#15 publish phase, ADR 0006 D5) — the author-facing surface
   * for "Publish Changes". Pure author language: publish / online copy /
   * version — never push / merge / commit / conflict.
   *
   * Flow: open → live "what's new" check ("N changes to publish") → Publish →
   * one of: success · already published · offline ("saved on this computer")
   * · reconnect (single button, D7) · the per-file choices screen ("Your copy
   * and the online copy both changed") → confirm → publish the combined
   * result.
   *
   * All host work goes through getPlatform() (§8 / ADR 0004); the snapshot-
   * first git mechanics live in the lib behind the remote:* IPC. The host
   * always snapshots before doing anything, so every path here is recoverable
   * through View History.
   */
  import Icon from "$lib/components/Icon.svelte";
  import { getPlatform } from "$lib/platform";
  import type {
    ConflictFileInfo,
    PublishOutcome,
    PublishStatusInfo,
  } from "$lib/platform/contract";

  let {
    open = $bindable(false),
    projectDir,
    onPublished,
    onReconnect,
    triggerEl,
  }: {
    open?: boolean;
    projectDir: string | null;
    /** Publish completed; local files may have gained online changes. */
    onPublished?: (mergedRemoteChanges: boolean) => void;
    /**
     * The saved connection was rejected (D7) — the parent routes the single
     * Reconnect action to the matching connect flow (GitHub dialog or
     * Advanced Setup) and this dialog closes.
     */
    onReconnect?: () => void;
    triggerEl?: HTMLButtonElement | undefined;
  } = $props();

  type Phase =
    | "checking"
    | "idle"
    | "publishing"
    | "done"
    | "offline"
    | "auth"
    | "conflict"
    | "error";

  let dialogEl = $state<HTMLDivElement | undefined>(undefined);
  let phase = $state<Phase>("checking");
  let status = $state<PublishStatusInfo | null>(null);
  let resultMessage = $state<string | null>(null);
  let conflictFiles = $state<ConflictFileInfo[]>([]);
  let conflictLocalId = $state<string | null>(null);
  let conflictRemoteId = $state<string | null>(null);
  /** Per-file choice, keyed by path. Defaults to keeping the author's copy. */
  let choices = $state<Record<string, "mine" | "theirs" | "both">>({});
  /** True when the user tried to close the dialog mid-publish. */
  let closeBlocked = $state(false);

  // Stale-load guard (same pattern as AdvancedSetupDialog): check() is the
  // SOLE writer of loadGen — each call invalidates any in-flight load.
  let loadGen = 0;

  $effect(() => {
    if (!open) return;
    phase = "checking";
    status = null;
    resultMessage = null;
    conflictFiles = [];
    conflictLocalId = null;
    conflictRemoteId = null;
    choices = {};
    closeBlocked = false;
    queueMicrotask(() => dialogEl?.focus());
    void check();
  });

  async function check() {
    if (!projectDir) return;
    const gen = ++loadGen;
    try {
      // Live check so "N changes to publish" includes what's new online; the
      // host degrades to a local count when the network is unavailable.
      const result = await getPlatform().getPublishStatus(projectDir, true);
      if (gen !== loadGen) return;
      status = result;
      phase = "idle";
    } catch (e) {
      if (gen !== loadGen) return;
      // A failed check never blocks publishing — publish itself reports
      // offline/auth in a friendly way.
      status = null;
      phase = "idle";
    }
  }

  /** "2 changes to publish" line for the idle screen. */
  let statusLine = $derived.by(() => {
    if (!status) return null;
    // Approximate counts are lower bounds (the host caps the history walk;
    // shallow clones hide older history) — render them as "250+".
    const plus = status.approximate ? "+" : "";
    const pieces: string[] = [];
    const ahead = status.ahead ?? 0;
    const localCount = ahead + (status.hasUnsnapshottedChanges ? 1 : 0);
    if (localCount > 0) {
      pieces.push(
        `${localCount}${plus} change${localCount === 1 ? "" : "s"} to publish`,
      );
    }
    if ((status.behind ?? 0) > 0) {
      pieces.push(
        `${status.behind}${plus} new change${status.behind === 1 ? "" : "s"} in the online copy`,
      );
    }
    if (pieces.length === 0) return "Everything is already published.";
    return pieces.join(" · ");
  });

  let nothingToPublish = $derived(
    status !== null &&
      (status.ahead ?? 1) === 0 &&
      !status.hasUnsnapshottedChanges &&
      (status.behind ?? 0) === 0,
  );

  /** Behind-only: nothing of ours to send, but online changes to bring down. */
  let hasOnlineChangesOnly = $derived(
    status !== null &&
      (status.ahead ?? 1) === 0 &&
      !status.hasUnsnapshottedChanges &&
      (status.behind ?? 0) > 0,
  );

  function applyOutcome(outcome: PublishOutcome) {
    resultMessage = outcome.message;
    switch (outcome.status) {
      case "published":
        phase = "done";
        onPublished?.(outcome.mergedRemoteChanges);
        break;
      case "up-to-date":
        phase = "done";
        break;
      case "offline":
        phase = "offline";
        break;
      case "auth":
        phase = "auth";
        break;
      case "conflict":
        conflictFiles = outcome.files;
        conflictLocalId = outcome.localId;
        conflictRemoteId = outcome.remoteId;
        choices = Object.fromEntries(
          outcome.files.map((f) => [f.path, "mine" as const]),
        );
        phase = "conflict";
        break;
      case "error":
        phase = "error";
        break;
    }
  }

  async function publish() {
    if (!projectDir || phase === "publishing") return;
    phase = "publishing";
    closeBlocked = false;
    resultMessage = null;
    try {
      applyOutcome(await getPlatform().publishChanges(projectDir));
    } catch (e) {
      resultMessage = friendly(e);
      phase = "error";
    }
  }

  async function confirmChoices() {
    if (!projectDir || !conflictLocalId || !conflictRemoteId) return;
    if (phase === "publishing") return;
    const resolutions = conflictFiles.map((f) => ({
      path: f.path,
      choice: choices[f.path] ?? ("mine" as const),
    }));
    phase = "publishing";
    closeBlocked = false;
    resultMessage = null;
    try {
      applyOutcome(
        await getPlatform().resolvePublishConflicts({
          projectDir,
          resolutions,
          localId: conflictLocalId,
          remoteId: conflictRemoteId,
        }),
      );
    } catch (e) {
      resultMessage = friendly(e);
      phase = "error";
    }
  }

  function reconnect() {
    close();
    onReconnect?.();
  }

  function kindLabel(kind: ConflictFileInfo["kind"]): string {
    switch (kind) {
      case "both-edited":
        return "Changed in your copy and in the online copy";
      case "you-deleted":
        return "You removed this file; the online copy changed it";
      case "online-deleted":
        return "The online copy removed this file; you changed it";
    }
  }

  function friendly(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
  }

  function focusableElements() {
    return Array.from(
      dialogEl?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
  }

  function trapFocus(e: KeyboardEvent) {
    if (e.key !== "Tab") return;
    const focusable = focusableElements();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function close() {
    // Publishing can't be safely interrupted (the host is mid push/merge) —
    // tell the user instead of silently ignoring the attempt (GitHubDialog
    // precedent for mid-download closes).
    if (phase === "publishing") {
      closeBlocked = true;
      return;
    }
    open = false;
    triggerEl?.focus();
  }

  /** Announced through the persistent live region on every phase change. */
  let phaseAnnouncement = $derived.by(() => {
    switch (phase) {
      case "checking":
        return "Checking what's new.";
      case "idle":
        return statusLine ?? "";
      case "publishing":
        return "Publishing your changes.";
      case "done":
        return resultMessage ?? "Done.";
      case "offline":
        return resultMessage ?? "Saved on this computer.";
      case "auth":
        return resultMessage ?? "Reconnect and try again.";
      case "conflict":
        return "Your copy and the online copy both changed. Choose which version to keep for each file.";
      case "error":
        return resultMessage ?? "Publishing didn't complete.";
    }
  });
</script>

{#if open}
  <div class="backdrop" onclick={close} role="presentation"></div>

  <div
    bind:this={dialogEl}
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="publish-title"
    tabindex="-1"
    onkeydown={trapFocus}
  >
    <header class="dialog-header">
      <h2 id="publish-title">
        <Icon name="cloud-upload" />
        Publish Changes
      </h2>
      <button
        class="close"
        onclick={close}
        disabled={phase === "publishing"}
        title="Close (Esc)"
        aria-label="Close"
      >&times;</button>
    </header>

    <div class="dialog-body">
      <!-- Persistent live region (GitHubDialog precedent): announcing phase
           transitions from a node that already exists is reliable; a region
           mounted WITH its content is routinely skipped by screen readers. -->
      <div class="sr-only" role="status" aria-live="polite">{phaseAnnouncement}</div>

      {#if phase === "checking"}
        <p class="hint" role="status">Checking what's new…</p>
      {:else if phase === "publishing"}
        <p class="hint busy" role="status">
          <span class="spinner" aria-hidden="true"></span>
          Publishing your changes…
        </p>
        {#if closeBlocked}
          <p class="hint" role="status">Publishing in progress — please wait.</p>
        {/if}
      {:else if phase === "idle"}
        {#if statusLine}
          <p class="lede" role="status">{statusLine}</p>
        {:else}
          <p class="lede" role="status">
            Publish sends your latest work to this project's online repository.
            A snapshot of your work is saved first, so nothing can be lost.
          </p>
        {/if}
        {#if status?.hasUnsnapshottedChanges}
          <p class="hint">Your newest edits will be saved as a snapshot when you publish.</p>
        {/if}
        <footer class="actions">
          <button class="ghost" onclick={close}>Not now</button>
          <button class="primary" onclick={publish} disabled={nothingToPublish}>
            {nothingToPublish
              ? "Everything is published"
              : hasOnlineChangesOnly
                ? "Get online changes"
                : "Publish Changes"}
          </button>
        </footer>
      {:else if phase === "done"}
        <p class="notice" role="status">{resultMessage}</p>
        <footer class="actions">
          <button class="primary" onclick={close}>Done</button>
        </footer>
      {:else if phase === "offline"}
        <p class="notice" role="status">
          Saved on this computer — {resultMessage ??
            "your changes will publish when you're back online."}
        </p>
        <footer class="actions">
          <button class="ghost" onclick={close}>Close</button>
          <button class="primary" onclick={publish}>Try again</button>
        </footer>
      {:else if phase === "auth"}
        <p class="error" role="alert">{resultMessage}</p>
        <footer class="actions">
          <button class="ghost" onclick={close}>Not now</button>
          <button class="primary" onclick={reconnect}>Reconnect</button>
        </footer>
      {:else if phase === "conflict"}
        <p class="lede">
          Your copy and the online copy both changed. Choose which version to
          keep for each file. A safety snapshot of your work was already taken,
          so you can always get either version back from View History.
        </p>
        <!-- svelte-ignore a11y_no_redundant_roles -- list-style:none strips
             list semantics in some screen readers; role="list" restores it. -->
        <ul class="conflict-list" role="list" aria-label="Files with differences">
          {#each conflictFiles as file (file.path)}
            <li class="conflict-item">
              <div class="conflict-info">
                <span class="conflict-path">{file.path}</span>
                <span class="conflict-kind">{kindLabel(file.kind)}</span>
              </div>
              <select
                bind:value={choices[file.path]}
                aria-label={`Choose which version of ${file.path} to keep`}
              >
                <option value="mine">Keep my version</option>
                <option value="theirs">Use the online version</option>
                <option value="both">Keep both copies</option>
              </select>
            </li>
          {/each}
        </ul>
        <footer class="actions">
          <button class="ghost" onclick={close}>Decide later</button>
          <button class="primary" onclick={confirmChoices}>
            Use these choices and publish
          </button>
        </footer>
      {:else if phase === "error"}
        <p class="error" role="alert">{resultMessage}</p>
        <footer class="actions">
          <button class="ghost" onclick={close}>Close</button>
          <button class="primary" onclick={publish}>Try again</button>
        </footer>
      {/if}
    </div>
  </div>
{/if}

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && open) close();
  }}
/>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--app-backdrop);
    z-index: 1000;
  }
  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(560px, 92vw);
    max-height: 80vh;
    background: var(--app-surface);
    color: var(--app-text-secondary);
    border-radius: 8px;
    box-shadow: 0 14px 40px var(--app-shadow-lg);
    z-index: 1001;
    display: flex;
    flex-direction: column;
    /* Long conflict lists scroll inside .dialog-body; without this they
       bleed past the border-radius. */
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--app-border-subtle);
  }
  .dialog-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .close {
    background: transparent;
    border: 0;
    color: var(--app-text-muted);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
  }
  .close:hover:not(:disabled) { color: var(--app-text); }
  .close:disabled { opacity: 0.4; cursor: default; }
  .dialog-body {
    padding: 16px 18px;
    overflow-y: auto;
    flex: 1;
  }
  .sr-only {
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
  .lede {
    margin: 0 0 12px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--app-text-secondary);
  }
  .hint {
    font-size: 12px;
    color: var(--app-text-faint);
    margin: 0 0 14px;
    line-height: 1.5;
  }
  .hint.busy {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--app-text-secondary);
    font-size: 13px;
  }
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--app-border);
    border-top-color: var(--app-focus-ring);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .notice {
    margin: 0 0 12px;
    padding: 8px 12px;
    border-radius: 6px;
    background: var(--app-success-bg);
    border: 1px solid var(--app-success-border);
    color: var(--app-success-text);
    font-size: 12px;
    line-height: 1.5;
  }
  .error {
    margin: 0 0 12px;
    padding: 8px 12px;
    border-radius: 6px;
    background: var(--app-error-bg);
    border: 1px solid var(--app-error-border);
    color: var(--app-error-text);
    font-size: 12px;
    line-height: 1.5;
  }
  .conflict-list {
    list-style: none;
    margin: 0 0 4px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .conflict-item {
    border: 1px solid var(--app-border);
    border-radius: 8px;
    padding: 10px 12px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .conflict-info {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .conflict-path {
    font-weight: 600;
    font-size: 13px;
    color: var(--app-text);
    font-family: ui-monospace, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .conflict-kind {
    font-size: 11px;
    color: var(--app-text-faint);
  }
  .conflict-item select {
    flex: 0 0 auto;
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border);
    color: var(--app-text-secondary);
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 12px;
  }
  .conflict-item select:focus {
    outline: none;
    border-color: var(--app-focus-ring);
  }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 16px;
    margin-top: 4px;
    border-top: 1px solid var(--app-border-subtle);
  }
  .actions button {
    padding: 6px 14px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .primary { background: var(--app-focus-ring); color: var(--app-text-on-accent); }
  .primary:hover:not(:disabled) { background: var(--app-accent-hover); }
  .ghost { background: transparent; color: var(--app-text-muted); border-color: var(--app-border); }
  .ghost:hover:not(:disabled) { background: var(--app-surface-hover); color: var(--app-text); }
</style>
