<script lang="ts">
  /**
   * SyncDialog (#15 sync phase, ADR 0006 D5) — the author-facing surface
   * for "Sync Changes". Pure author language: sync / online copy /
   * version — never push / merge / commit / conflict.
   *
   * Flow: open → live "what's new" check ("N changes to sync") → Sync →
   * one of: success · already in sync · offline ("saved on this computer")
   * · reconnect (single button, D7) · the per-file choices screen ("Your copy
   * and the online copy both changed") → confirm → sync the combined
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
    SyncOutcome,
    SyncPreviewInfo,
  } from "$lib/platform/contract";

  let {
    open = $bindable(false),
    projectDir,
    bookSubPath = "",
    onSynced,
    onReconnect,
    triggerEl,
  }: {
    open?: boolean;
    projectDir: string | null;
    /**
     * When the book is a subfolder of a larger shared folder: its path
     * relative to that folder ("/"-separated). Conflict files outside the
     * book are still listed (they block the sync) and get labeled as part
     * of the same shared folder. Empty for standalone projects.
     */
    bookSubPath?: string;
    /** Sync completed; local files may have gained online changes. */
    onSynced?: (mergedRemoteChanges: boolean) => void;
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
    | "syncing"
    | "done"
    | "offline"
    | "auth"
    | "conflict"
    | "error";

  let dialogEl = $state<HTMLDivElement | undefined>(undefined);
  let phase = $state<Phase>("checking");
  let preview = $state<SyncPreviewInfo | null>(null);
  let resultMessage = $state<string | null>(null);
  let conflictFiles = $state<ConflictFileInfo[]>([]);
  let conflictLocalId = $state<string | null>(null);
  let conflictRemoteId = $state<string | null>(null);
  /** Per-file choice, keyed by path. Defaults to keeping the author's copy. */
  let choices = $state<Record<string, "mine" | "theirs" | "both">>({});
  /** True when the user tried to close the dialog mid-sync. */
  let closeBlocked = $state(false);

  // Stale-load guard (same pattern as AdvancedSetupDialog): check() is the
  // SOLE writer of loadGen — each call invalidates any in-flight load.
  let loadGen = 0;

  $effect(() => {
    if (!open) return;
    phase = "checking";
    preview = null;
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
    phase = "checking";
    try {
      // Live, fetch-only preview: what's new online (commit details) and
      // what we would send. The host degrades to local information with a
      // friendly `fetchNotice` when the remote can't be reached.
      const result = await getPlatform().previewSync(projectDir);
      if (gen !== loadGen) return;
      preview = result;
      phase = "idle";
    } catch (e) {
      if (gen !== loadGen) return;
      // A failed check never blocks syncing — sync itself reports
      // offline/auth in a friendly way.
      preview = null;
      phase = "idle";
    }
  }

  /** Outgoing snapshots not online yet (0 when unknown — sync will tell). */
  let outgoingCount = $derived(preview?.outgoing.count ?? 0);
  /** Online snapshots not on this computer; null = couldn't check. */
  let incomingCount = $derived(preview ? preview.incoming.count : null);
  /** Working-tree edits the pre-sync snapshot would save. */
  let editsPending = $derived((preview?.changedFiles.count ?? 0) > 0);
  /** Items under "Your changes to send": commits + the pending-edits row. */
  let sendCount = $derived(outgoingCount + (editsPending ? 1 : 0));

  /** "2 changes to sync · 4 new..." summary (idle lede + live region). */
  let statusLine = $derived.by(() => {
    if (!preview) return null;
    // Approximate counts are lower bounds (the host caps the history walk;
    // shallow clones hide older history) — render them as "250+".
    const plus = preview.outgoing.approximate ? "+" : "";
    const pieces: string[] = [];
    if (sendCount > 0) {
      pieces.push(`${sendCount}${plus} change${sendCount === 1 ? "" : "s"} to sync`);
    }
    if ((incomingCount ?? 0) > 0) {
      const inPlus = preview.incoming.approximate ? "+" : "";
      pieces.push(
        `${incomingCount}${inPlus} new change${incomingCount === 1 ? "" : "s"} in the online copy`,
      );
    }
    if (pieces.length === 0) return "Everything is in sync.";
    return pieces.join(" · ");
  });

  let nothingToSync = $derived(
    preview !== null && sendCount === 0 && incomingCount === 0,
  );

  /** Behind-only: nothing of ours to send, but online changes to bring down. */
  let hasOnlineChangesOnly = $derived(
    preview !== null && sendCount === 0 && (incomingCount ?? 0) > 0,
  );

  /** "9 hours ago" for the incoming/outgoing commit lists. */
  function relativeTime(ms: number): string {
    const min = Math.round((Date.now() - ms) / 60_000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
    const hours = Math.round(min / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.round(hours / 24);
    if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
    try {
      return new Date(ms).toLocaleDateString();
    } catch {
      return "";
    }
  }

  function applyOutcome(outcome: SyncOutcome) {
    resultMessage = outcome.message;
    switch (outcome.status) {
      case "synced":
        phase = "done";
        onSynced?.(outcome.mergedRemoteChanges);
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
        // UX-5: default both-edited files to "both" (Keep both copies) — the
        // only option that can't silently discard anyone's work. Other kinds
        // default to "mine" as before (you-deleted / online-deleted are
        // deletion-intent conflicts where the author's local state is the
        // starting point).
        choices = Object.fromEntries(
          outcome.files.map((f) => [
            f.path,
            f.kind === "both-edited" ? ("both" as const) : ("mine" as const),
          ]),
        );
        phase = "conflict";
        break;
      case "error":
        phase = "error";
        break;
    }
  }

  async function sync() {
    if (!projectDir || phase === "syncing") return;
    phase = "syncing";
    closeBlocked = false;
    resultMessage = null;
    try {
      applyOutcome(await getPlatform().syncChanges(projectDir));
    } catch (e) {
      resultMessage = friendly(e);
      phase = "error";
    }
  }

  async function confirmChoices() {
    if (!projectDir || !conflictLocalId || !conflictRemoteId) return;
    if (phase === "syncing") return;
    const resolutions = conflictFiles.map((f) => ({
      path: f.path,
      choice: choices[f.path] ?? ("mine" as const),
    }));
    phase = "syncing";
    closeBlocked = false;
    resultMessage = null;
    try {
      applyOutcome(
        await getPlatform().resolveSyncConflicts({
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

  /** Conflict paths are shared-folder-relative; is this one outside the book? */
  function isOutsideBook(filePath: string): boolean {
    return !!bookSubPath && !filePath.startsWith(bookSubPath + "/");
  }

  /** Book files display book-relative; outside files keep their full path. */
  function displayPath(filePath: string): string {
    return bookSubPath && filePath.startsWith(bookSubPath + "/")
      ? filePath.slice(bookSubPath.length + 1)
      : filePath;
  }

  function kindLabel(kind: ConflictFileInfo["kind"]): string {
    // UX-5: clearer per-kind labels that describe what actually happened and
    // point toward the safest default choice for each situation.
    switch (kind) {
      case "both-edited":
        return "You and a collaborator both edited this file — keeping both copies is the safest choice";
      case "you-deleted":
        return "You removed this file, but it was changed online — choose whether to restore or discard it";
      case "online-deleted":
        return "This file was removed online, but you changed it — choose whether to keep or discard your edits";
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
    // Syncing can't be safely interrupted (the host is mid-sync) —
    // tell the user instead of silently ignoring the attempt (GitHubDialog
    // precedent for mid-download closes).
    if (phase === "syncing") {
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
      case "syncing":
        return "Syncing your changes.";
      case "done":
        return resultMessage ?? "Done.";
      case "offline":
        return resultMessage ?? "Saved on this computer.";
      case "auth":
        return resultMessage ?? "Reconnect and try again.";
      case "conflict":
        return "Your copy and the online copy both changed. Choose which version to keep for each file.";
      case "error":
        return resultMessage ?? "Syncing didn't complete.";
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
    aria-labelledby="sync-title"
    tabindex="-1"
    onkeydown={trapFocus}
  >
    <header class="dialog-header">
      <h2 id="sync-title">
        <Icon name="cloud-upload" />
        Sync Changes
      </h2>
      <button
        class="close"
        onclick={close}
        disabled={phase === "syncing"}
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
      {:else if phase === "syncing"}
        <p class="hint busy" role="status">
          <span class="spinner" aria-hidden="true"></span>
          Syncing your changes…
        </p>
        {#if closeBlocked}
          <p class="hint" role="status">Syncing in progress — please wait.</p>
        {/if}
      {:else if phase === "idle"}
        {#if statusLine}
          <p class="lede" role="status">{statusLine}</p>
        {:else}
          <p class="lede" role="status">
            Sync sends your latest work to this project's online repository.
            A snapshot of your work is saved first, so nothing can be lost.
          </p>
        {/if}
        {#if preview?.fetchNotice}
          <!-- The live check failed (offline / rejected connection). Non-
               blocking: outgoing info is still shown and Sync stays enabled
               (sync itself reports offline/auth in a friendly way). -->
          <p class="hint">{preview.fetchNotice}</p>
        {/if}

        {#if preview && (incomingCount ?? 0) > 0}
          <section class="changes">
            <h3>
              Incoming changes from the online copy
              ({incomingCount}{preview.incoming.approximate ? "+" : ""})
            </h3>
            <!-- svelte-ignore a11y_no_redundant_roles -- list-style:none strips
                 list semantics in some screen readers; role="list" restores it. -->
            <ul class="commit-list" role="list" aria-label="Incoming changes">
              {#each preview.incoming.commits as c (c.id)}
                <li class="commit-item">
                  <span class="commit-message">{c.message || "(no description)"}</span>
                  <span class="commit-meta">
                    {relativeTime(c.timestamp)}{c.author ? ` · ${c.author}` : ""}
                  </span>
                </li>
              {/each}
              {#if (incomingCount ?? 0) > preview.incoming.commits.length}
                <li class="commit-item more">
                  …and {(incomingCount ?? 0) - preview.incoming.commits.length} more
                </li>
              {/if}
            </ul>
            <p class="hint">Syncing brings these changes to this computer.</p>
          </section>
        {/if}

        {#if preview && sendCount > 0}
          <section class="changes">
            <h3>
              Your changes to send
              ({sendCount}{preview.outgoing.approximate ? "+" : ""})
            </h3>
            <!-- svelte-ignore a11y_no_redundant_roles -->
            <ul class="commit-list" role="list" aria-label="Your changes to send">
              {#each preview.outgoing.commits as c (c.id)}
                <li class="commit-item">
                  <span class="commit-message">{c.message || "(no description)"}</span>
                  <span class="commit-meta">
                    {relativeTime(c.timestamp)}{c.author ? ` · ${c.author}` : ""}
                  </span>
                </li>
              {/each}
              {#if outgoingCount > preview.outgoing.commits.length}
                <li class="commit-item more">
                  …and {outgoingCount - preview.outgoing.commits.length} more
                </li>
              {/if}
              {#if editsPending}
                <li class="commit-item">
                  <span class="commit-message">
                    Edits not yet snapshotted
                    ({preview.changedFiles.count}
                    file{preview.changedFiles.count === 1 ? "" : "s"})
                  </span>
                  <span class="commit-meta">
                    {preview.changedFiles.sample.map(displayPath).join(", ")}{preview
                      .changedFiles.count > preview.changedFiles.sample.length
                      ? `, +${preview.changedFiles.count - preview.changedFiles.sample.length} more`
                      : ""}
                  </span>
                </li>
              {/if}
            </ul>
            {#if editsPending}
              <p class="hint">Your newest edits will be saved as a snapshot when you sync.</p>
            {/if}
          </section>
        {/if}

        <!-- UX-6: when nothing to sync, replace the disabled pseudo-button +
             "Not now" with a single enabled Done that closes the dialog. -->
        {#if nothingToSync}
          <footer class="actions">
            <button class="ghost" onclick={check}>Refresh</button>
            <button class="primary" onclick={close}>Done</button>
          </footer>
        {:else}
          <footer class="actions">
            <button class="ghost" onclick={check}>Refresh</button>
            <button class="ghost" onclick={close}>Not now</button>
            <button class="primary" onclick={sync}>
              {hasOnlineChangesOnly ? "Get online changes" : "Sync Changes"}
            </button>
          </footer>
        {/if}
      {:else if phase === "done"}
        <p class="notice" role="status">{resultMessage}</p>
        <footer class="actions">
          <button class="primary" onclick={close}>Done</button>
        </footer>
      {:else if phase === "offline"}
        <!-- UX-4: resultMessage (from MSG_OFFLINE in sync.ts) already contains
             the full "Your changes are saved…" sentence — render it directly
             rather than prepending a redundant "Saved on this computer — " prefix
             that creates a doubled sentence. -->
        <p class="notice" role="status">
          {resultMessage ?? "Your changes are saved on this computer. Try syncing again when you're back online."}
        </p>
        <footer class="actions">
          <button class="ghost" onclick={close}>Close</button>
          <button class="primary" onclick={sync}>Try again</button>
        </footer>
      {:else if phase === "auth"}
        <p class="error" role="alert">{resultMessage}</p>
        <footer class="actions">
          <button class="ghost" onclick={close}>Not now</button>
          <button class="primary" onclick={reconnect}>Reconnect</button>
        </footer>
      {:else if phase === "conflict"}
        <!-- UX-5: improved lede — make the safety snapshot prominent up front,
             explain that no choice here permanently loses anything. The per-file
             labels (kindLabel) guide each individual decision. -->
        <p class="lede">
          Your copy and the online copy changed the same files. A safety
          snapshot was saved before anything was touched — you can always
          recover either version from View History. Review each file below
          and choose how to combine the changes.
        </p>
        {#if bookSubPath && conflictFiles.some((f) => isOutsideBook(f.path))}
          <!-- A book in a shared folder: conflicts ANYWHERE in that folder
               block the sync, so they are all listed; files outside this
               book keep their full shared-folder path. -->
          <p class="hint">
            Some of these files are outside this book but part of the same
            shared folder — everything in it syncs together.
          </p>
        {/if}
        <!-- svelte-ignore a11y_no_redundant_roles -- list-style:none strips
             list semantics in some screen readers; role="list" restores it. -->
        <ul class="conflict-list" role="list" aria-label="Files with differences">
          {#each conflictFiles as file (file.path)}
            <li class="conflict-item">
              <div class="conflict-info">
                <span class="conflict-path">{displayPath(file.path)}</span>
                <span class="conflict-kind">
                  {kindLabel(file.kind)}{isOutsideBook(file.path)
                    ? " · in the shared folder, outside this book"
                    : ""}
                </span>
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
            Use these choices and sync
          </button>
        </footer>
      {:else if phase === "error"}
        <p class="error" role="alert">{resultMessage}</p>
        <footer class="actions">
          <button class="ghost" onclick={close}>Close</button>
          <button class="primary" onclick={sync}>Try again</button>
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
  .changes {
    margin: 0 0 14px;
  }
  .changes h3 {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--app-text);
  }
  .commit-list {
    list-style: none;
    margin: 0 0 6px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 180px;
    overflow-y: auto;
    border: 1px solid var(--app-border-subtle);
    border-radius: 6px;
    padding: 6px 10px;
  }
  .commit-item {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 3px 0;
  }
  .commit-item + .commit-item {
    border-top: 1px solid var(--app-border-subtle);
  }
  .commit-message {
    font-size: 12px;
    color: var(--app-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .commit-meta {
    font-size: 11px;
    color: var(--app-text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .commit-item.more {
    font-size: 11px;
    color: var(--app-text-faint);
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
