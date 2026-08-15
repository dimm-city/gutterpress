<script lang="ts">
  /**
   * ConflictChoicesDialog — the "changes happened in two places" resolution screen
   * (transparent-sync plan §6.1).
   *
   * Presents per-file plain-language options with "Keep both" highlighted as the
   * recommended lossless default. Works for binary files (images/fonts) — no diff
   * shown, same three buttons, "Keep both" still the safe default.
   *
   * Wired to the existing resolveConflicts path via getPlatform().resolveSyncConflicts.
   * Only the presentation, wording, and defaulting change — the underlying engine
   * is reused verbatim (§6.1).
   *
   * No Git jargon. PWA-clean (CLAUDE.md §8 / ADR 0004).
   */
  import Icon from "$lib/components/Icon.svelte";
  import { getPlatform } from "$lib/platform";
  import { api } from "$lib/api";
  import { basenameOf } from "$lib/platform/paths";
  import { friendlyHostError } from "$lib/errors";
  import { routeResolveOutcome } from "$lib/components/resolve-outcome";
  import type {
    ConflictFileEntry,
    ConflictResolutionChoice,
    SyncOutcome,
  } from "$lib/platform/contract";
  import type { ConflictPreview } from "$lib/platform/dtos";
  import { dialogBehavior } from "$lib/dialog";

  let {
    open = $bindable(false),
    projectDir,
    files = [],
    localId,
    remoteId,
    /**
     * True while the host is still fetching localId/remoteId (M13 — only when
     * the conflict emit site that opened this dialog couldn't carry them
     * directly). Disables the primary button with an honest "Getting things
     * ready…" label instead of a silently-dead one.
     */
    pending = false,
    /**
     * True when that fallback ids fetch failed (M13). Shows an in-dialog
     * retry instead of leaving the primary button dead forever with no
     * explanation.
     */
    idsFetchFailed = false,
    /** Retry the fallback ids fetch (wired to SyncController.retryConflictIds). */
    onRetryIds,
    /** Called after successful resolution so the parent can refresh the preview. */
    onResolved,
    /**
     * The online copy changed AGAIN while the author was deciding, and the
     * resolution came back as a fresh conflict with new files/ids (the lib's
     * push-race recovery). The parent must replace its conflict state so the
     * `files`/`localId`/`remoteId` props re-render against reality — wired to
     * SyncController.applyReconflict. Without this the dialog was a dead end:
     * every retry re-submitted the stale ids (2026-08 field incident).
     */
    onReconflict,
    /** Re-routes to the reconnect flow on the unlikely auth error during resolution. */
    onReconnect,
    triggerEl,
  }: {
    open?: boolean;
    projectDir: string | null;
    files?: ConflictFileEntry[];
    localId?: string | null;
    remoteId?: string | null;
    pending?: boolean;
    idsFetchFailed?: boolean;
    onRetryIds?: () => void;
    onResolved?: (mergedRemoteChanges: boolean) => void;
    onReconflict?: (files: ConflictFileEntry[], localId: string, remoteId: string) => void;
    onReconnect?: () => void;
    triggerEl?: HTMLButtonElement | undefined;
  } = $props();

  /** Per-file choice: default "both" for both-edited (lossless), "mine" for deletions. */
  let choices = $state<Record<string, "mine" | "theirs" | "both">>({});
  let phase = $state<"choosing" | "resolving" | "done" | "error">("choosing");
  let errorMessage = $state<string | null>(null);
  /**
   * What the current error is actually about — set alongside errorMessage at
   * the same point in confirm(), so the header can be a function of state the
   * same way the body already is (visual-gate round 1 finding: a static
   * "file conflict" title was shown over the unrelated connection-setup
   * error). "sync-again" = the resolution can't succeed with the ids in hand
   * (race exhausted / expired choices) — its footer offers "Sync again"
   * (fresh ids via onRetryIds), never a blind retry of the stale resolution.
   */
  let errorKind = $state<"conflict" | "connection-setup" | "sync-again">("conflict");
  /**
   * True right after a reconflict: the online copy changed again mid-decision
   * and the file list below was refreshed against the NEW online version.
   * Cleared on the next confirm/mount.
   */
  let reconflicted = $state(false);

  /** Header icon + title as a function of the dialog's current state. */
  const header = $derived(
    phase === "error" && errorKind === "connection-setup"
      ? { icon: "link" as const, title: "Your online connection needs to be set up again" }
      : { icon: "triangle-alert" as const, title: "This project changed in two places" },
  );

  /** Track which file disclosures are expanded (path → boolean). */
  let previewExpanded = $state<Record<string, boolean>>({});
  /** Memoised preview results (path → ConflictPreview | null | "loading" | "error"). */
  let previewCache = $state<Record<string, ConflictPreview | null | "loading" | "error">>({});

  /** Default per-file choice: lossless "both" for edits, "mine" for deletions. */
  function defaultChoice(kind: ConflictFileEntry["kind"]): "mine" | "theirs" | "both" {
    return kind === "both-edited" ? "both" : "mine";
  }

  function onDialogMount(_el: HTMLElement) {
    phase = "choosing";
    errorMessage = null;
    errorKind = "conflict";
    reconflicted = false;
    previewExpanded = {};
    previewCache = {};
    choices = Object.fromEntries(files.map((f) => [f.path, defaultChoice(f.kind)]));
  }

  /** Human-readable label for the file, falling back to the repo-relative path. */
  function fileLabel(filePath: string): string {
    // Try to make a chapter-like label from the filename.
    const name = basenameOf(filePath);
    // Strip extension and de-kebab for a readable label ("03-chapter.md" → "03 chapter").
    // Leading numbers ("03 chapter" → "03 chapter") are kept as-is — only the
    // extension and separators are normalised.
    return name
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]/g, " ");
  }

  /** Per-kind explanation shown below the file name. */
  function kindExplanation(kind: ConflictFileEntry["kind"]): string {
    switch (kind) {
      case "both-edited":
        return "You and a teammate both changed this file.";
      case "you-deleted":
        return "You removed this file, but it was changed online.";
      case "online-deleted":
        return "This file was removed online, but you changed it here.";
    }
  }

  /**
   * Toggle the "Compare versions" disclosure for a text file.
   * On first expand, lazily fetches the preview via the server route and
   * memoises the result so subsequent toggles don't re-fetch.
   *
   * L12: binary detection is the HOST's job, not this component's. When the
   * conflict payload already carries a definite `isBinary` (from
   * `electron/recovery-bridge.ts`'s canonical extension list), this component
   * trusts it outright and never fetches a preview for a binary file. Only
   * when `isBinary` is unknown (older/other emit sites — see
   * sync-controller.svelte.ts's ids-fetch fallback) does it still ask the host
   * via getConflictPreview, whose own response also carries the
   * authoritative isBinary (used below to render "No preview").
   */
  async function togglePreview(filePath: string) {
    const wasExpanded = previewExpanded[filePath] ?? false;
    previewExpanded = { ...previewExpanded, [filePath]: !wasExpanded };
    const knownBinary = files.find((f) => f.path === filePath)?.isBinary === true;

    // Only fetch on first expand and only when not already known to be binary.
    if (!wasExpanded && !(filePath in previewCache) && !knownBinary && projectDir) {
      previewCache = { ...previewCache, [filePath]: "loading" };
      try {
        const fileEntry = files.find((f) => f.path === filePath);
        const result = await api.sync.getConflictPreview(projectDir, filePath, fileEntry?.kind);
        previewCache = { ...previewCache, [filePath]: result };
      } catch {
        // Preview failed — fall back to the no-preview message; don't break choices.
        previewCache = { ...previewCache, [filePath]: "error" };
      }
    }
  }

  async function confirm() {
    if (!projectDir || !localId || !remoteId || phase === "resolving") return;
    phase = "resolving";
    errorMessage = null;
    errorKind = "conflict";
    reconflicted = false;
    const resolutions: ConflictResolutionChoice[] = files.map((f) => ({
      path: f.path,
      choice: choices[f.path] ?? defaultChoice(f.kind),
    }));
    try {
      const outcome: SyncOutcome = await getPlatform().resolveSyncConflicts({
        projectDir,
        resolutions,
        localId,
        remoteId,
      });
      // ALL outcome routing lives in routeResolveOutcome — an exhaustively
      // switched shared module, so an unrouted status is a compile error, not
      // a silent fall-through into the generic arm (the 2026-08 field
      // incident: a "conflict" outcome — the lib's designed answer when the
      // online copy moves mid-decision — was swallowed by the old inline
      // else, dead-ending the author forever).
      const action = routeResolveOutcome(outcome);
      switch (action.kind) {
        case "done":
          phase = "done";
          onResolved?.(action.mergedRemoteChanges);
          close();
          break;
        case "reconflict":
          // The online copy changed again while deciding. Hand the FRESH
          // files/ids to the parent (they flow back down as props), rebuild
          // the per-file choices for the new list, and return to choosing —
          // with a visible notice so the refresh isn't mistaken for a no-op.
          onReconflict?.(action.files, action.localId, action.remoteId);
          choices = Object.fromEntries(
            action.files.map((f) => [f.path, defaultChoice(f.kind)]),
          );
          previewExpanded = {};
          previewCache = {};
          reconflicted = true;
          phase = "choosing";
          break;
        case "auth":
          phase = "error";
          errorMessage = action.message;
          onReconnect?.();
          break;
        case "offline":
          phase = "error";
          errorMessage = action.message;
          break;
        case "connection-setup":
          // The project's online connection itself is the problem — route to
          // the same connect/setup surface the "auth" branch uses; the
          // author's per-file choices are left untouched.
          phase = "error";
          errorKind = "connection-setup";
          errorMessage = action.message;
          onReconnect?.();
          break;
        case "sync-again":
          // The resolution can't succeed with the ids in hand (race
          // exhausted / choices expired). The footer offers "Sync again",
          // which fetches FRESH ids — retrying the stale resolution can
          // never succeed, so no plain retry is offered here.
          phase = "error";
          errorKind = "sync-again";
          errorMessage = action.message;
          break;
        case "failed":
          phase = "error";
          errorMessage = action.message;
          break;
      }
    } catch (e) {
      phase = "error";
      errorMessage = friendlyHostError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * "Sync again" from the sync-again error state: back to the choosing shell
   * and ask the parent for a fresh sync (SyncController.retryConflictIds →
   * a full sync that either resolves outright or returns a NEW conflict whose
   * files/ids replace this dialog's props).
   */
  function syncAgain() {
    phase = "choosing";
    errorMessage = null;
    errorKind = "conflict";
    onRetryIds?.();
  }

  function setAll(choice: "mine" | "theirs" | "both") {
    choices = Object.fromEntries(files.map((f) => [f.path, choice]));
  }

  /**
   * Radiogroup keyboard model: Arrow keys move AND select within a file's
   * three choices (roving tabindex — only the checked radio is tab-focusable),
   * matching the WAI-ARIA radio pattern (three-judge a11y finding).
   */
  const CHOICE_ORDER = ["mine", "theirs", "both"] as const;
  function onRadioKey(e: KeyboardEvent, filePath: string) {
    if (phase === "resolving") return;
    const fwd = e.key === "ArrowRight" || e.key === "ArrowDown";
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!fwd && !back) return;
    e.preventDefault();
    const cur = CHOICE_ORDER.indexOf(choices[filePath] ?? "both");
    const next = CHOICE_ORDER[(cur + (fwd ? 1 : -1) + CHOICE_ORDER.length) % CHOICE_ORDER.length]!;
    choices[filePath] = next;
    const group = e.currentTarget as HTMLElement;
    queueMicrotask(() =>
      group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(),
    );
  }

  function close() {
    if (phase === "resolving") return; // can't interrupt — host is mid-operation
    open = false;
    triggerEl?.focus();
  }
</script>

{#if open}
  <div class="dlg-backdrop" onclick={close} role="presentation"></div>

  <div
    class="dlg-shell"
    use:dialogBehavior={{ onClose: close, triggerEl, labelledBy: "conflict-title", focusContainer: true }}
    use:onDialogMount
  >
    <header class="dlg-header">
      <h2 id="conflict-title">
        <Icon name={header.icon} />
        {header.title}
      </h2>
      <button
        class="dlg-close"
        onclick={close}
        disabled={phase === "resolving"}
        title="Close (Esc)"
        aria-label="Close"
      ><Icon name="x" size={16} /></button>
    </header>

    <div class="dialog-body">
      <!-- Persistent live region for phase announcements -->
      <div class="dlg-sr-only" role="status" aria-live="polite">
        {#if phase === "resolving"}
          Applying your choices…
        {:else if phase === "error"}
          Something went wrong — {errorMessage ?? ""}
        {:else if pending}
          Getting things ready…
        {:else if idsFetchFailed}
          We couldn't get things ready to combine your changes. You can try again.
        {/if}
      </div>

      {#if phase !== "error"}
        <!-- M13: the ids-fetch fallback state — only entered when the emit
             site that opened this dialog couldn't carry localId/remoteId
             directly. Replaces a silently-disabled primary button with an
             honest status and, on failure, a retry. -->
        {#if pending}
          <div class="ids-status" role="status">
            <span class="ids-spinner" aria-hidden="true"></span>
            Getting things ready…
          </div>
        {:else if idsFetchFailed}
          <div class="ids-status ids-status-error" role="alert">
            <span>We couldn't get things ready to combine your changes.</span>
            <button class="ids-retry-btn" onclick={() => onRetryIds?.()}>Try again</button>
          </div>
        {:else if reconflicted}
          <!-- The online copy moved again mid-decision: the list below was
               refreshed against the NEW online version (never a dead end —
               2026-08 field incident). -->
          <div class="ids-status" role="alert">
            <span>
              The online copy changed again while you were deciding. The files
              below show the newest differences — choose again.
            </span>
          </div>
        {/if}

        <p class="lede">
          You and a teammate changed some of the same files. A copy of
          your work was saved automatically before combining. Choose what to
          do with each file below.
        </p>

        <!-- "Not sure?" affordance — recommended lossless default (§6.1) -->
        <div class="keep-both-banner" role="note">
          <span class="banner-icon" aria-hidden="true"><Icon name="lightbulb" size={16} /></span>
          <span>
            <strong>Not sure?</strong> Choose "Keep both" — it's the safest option
            and saves a copy of both versions next to each other.
          </span>
          <button class="banner-btn" onclick={() => setAll("both")} disabled={phase === "resolving"}>
            Set all to Keep both
          </button>
        </div>

        <!-- svelte-ignore a11y_no_redundant_roles -->
        <ul class="file-list" role="list" aria-label="Files with differences">
          {#each files as file (file.path)}
            {@const label = fileLabel(file.path)}
            {@const binary = file.isBinary === true}
            <li class="file-item">
              <div class="file-info">
                <span class="file-label">{label}</span>
                <span class="file-path">{file.path}</span>
                <span class="file-explain">{kindExplanation(file.kind)}{binary ? " Binary file — no preview available." : ""}</span>
              </div>

              <!-- "Compare versions" disclosure — text files only (§ feature spec) -->
              {#if file.kind === "both-edited" && !binary}
                {@const expanded = previewExpanded[file.path] ?? false}
                {@const cachedPreview = previewCache[file.path]}
                <div class="preview-disclosure">
                  <button
                    class="disclosure-btn"
                    aria-expanded={expanded}
                    onclick={() => togglePreview(file.path)}
                    disabled={phase === "resolving"}
                  >
                    <span class="disclosure-arrow" aria-hidden="true"><Icon name={expanded ? "chevron-down" : "chevron-right"} size={12} /></span>
                    Compare versions
                  </button>
                  {#if expanded}
                    <div class="preview-panes">
                      {#if cachedPreview === "loading"}
                        <p class="preview-loading" aria-live="polite">Loading preview…</p>
                      {:else if cachedPreview === "error" || cachedPreview === null || (typeof cachedPreview === "object" && cachedPreview.isBinary)}
                        <p class="preview-unavailable">No preview for this kind of file.</p>
                      {:else if typeof cachedPreview === "object"}
                        <div class="pane-row">
                          <div class="preview-pane" aria-label="Your version">
                            <div class="pane-label">Your version</div>
                            <pre class="pane-content">{cachedPreview.mine}</pre>
                          </div>
                          <div class="preview-pane" aria-label="The online version">
                            <div class="pane-label">The online version</div>
                            <pre class="pane-content">{cachedPreview.theirs}</pre>
                          </div>
                        </div>
                      {:else}
                        <p class="preview-unavailable">No preview for this kind of file.</p>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}

              <!-- Three-button choice (§6.1) — segmented for clarity -->
              <div
                class="choice-group"
                role="radiogroup"
                tabindex="-1"
                aria-label={`Choose version for ${label}`}
                onkeydown={(e) => onRadioKey(e, file.path)}
              >
                <button
                  role="radio"
                  class="choice-btn"
                  class:selected={choices[file.path] === "mine"}
                  onclick={() => (choices[file.path] = "mine")}
                  disabled={phase === "resolving"}
                  aria-checked={choices[file.path] === "mine"}
                  tabindex={choices[file.path] === "mine" ? 0 : -1}
                  title="Use what's on this computer"
                >
                  Keep my version
                </button>
                <button
                  role="radio"
                  class="choice-btn"
                  class:selected={choices[file.path] === "theirs"}
                  onclick={() => (choices[file.path] = "theirs")}
                  disabled={phase === "resolving"}
                  aria-checked={choices[file.path] === "theirs"}
                  tabindex={choices[file.path] === "theirs" ? 0 : -1}
                  title="Use what a teammate changed online"
                >
                  Use the online version
                </button>
                <button
                  role="radio"
                  class="choice-btn recommended"
                  class:selected={choices[file.path] === "both"}
                  onclick={() => (choices[file.path] = "both")}
                  disabled={phase === "resolving"}
                  aria-checked={choices[file.path] === "both"}
                  tabindex={choices[file.path] === "both" || !choices[file.path] ? 0 : -1}
                  title="Save yours and add the online version as a copy next to it"
                >
                  Keep both
                  {#if choices[file.path] !== "both"}
                    <span class="rec-badge" aria-label="Recommended"><Icon name="star" size={12} /></span>
                  {/if}
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="error-msg" role="alert">{errorMessage}</p>
      {/if}
    </div>

    <!-- Footer is a PINNED sibling of the scroll region (not inside it), so the
         commit and the safe-escape are always visible no matter how many files
         are listed (three-judge gate finding). -->
    <footer class="dlg-actions">
      {#if phase === "error" && errorKind === "sync-again"}
        <!-- The stale resolution can never succeed — the ONLY useful action
             is a fresh sync (new ids). No blind "Try again" here. -->
        <button class="dlg-ghost" onclick={close}>Close</button>
        <button class="dlg-primary app-btn-primary" onclick={syncAgain}>Sync again</button>
      {:else if phase === "error"}
        <button class="dlg-ghost" onclick={close}>Close</button>
        <button class="dlg-primary app-btn-primary" onclick={confirm}>Try again</button>
      {:else}
        <button class="dlg-ghost" onclick={close} disabled={phase === "resolving"}>Decide later</button>
        <button
          class="dlg-primary app-btn-primary"
          onclick={confirm}
          disabled={phase === "resolving" || files.length === 0 || !localId || !remoteId}
        >
          {#if phase === "resolving"}
            Applying choices…
          {:else if pending}
            Getting things ready…
          {:else}
            Use these choices
          {/if}
        </button>
      {/if}
    </footer>
  </div>
{/if}


<style>
  @import "$lib/styles/dialog-shell.css";

  .dlg-shell {
    width: min(600px, 94vw);
    max-height: 84vh;
  }

  .dialog-body {
    padding: 16px 18px;
    overflow-y: auto;
    flex: 1;
  }

  .lede {
    margin: 0 0 14px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--app-text-secondary);
  }

  /* "Not sure? Keep both" banner — the recommended-lossless affordance (§6.1). */
  .keep-both-banner {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    margin: 0 0 16px;
    border-radius: 8px;
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border-subtle);
    font-size: 12px;
    line-height: 1.5;
    color: var(--app-text-secondary);
  }
  .banner-icon { display: inline-flex; flex-shrink: 0; margin-top: 1px; }
  .banner-btn {
    flex-shrink: 0;
    margin-left: auto;
    padding: 4px 10px;
    font-size: 11px;
    border-radius: 5px;
    background: var(--app-surface);
    border: 1px solid var(--app-border);
    color: var(--app-text-secondary);
    cursor: pointer;
    white-space: nowrap;
    align-self: center;
  }
  .banner-btn:hover:not(:disabled) { background: var(--app-surface-hover); color: var(--app-text); }
  .banner-btn:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }

  .file-list {
    list-style: none;
    margin: 0 0 4px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .file-item {
    border: 1px solid var(--app-border);
    border-radius: 8px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .file-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .file-label {
    font-weight: 600;
    font-size: 13px;
    color: var(--app-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-transform: capitalize;
  }
  .file-path {
    font-size: 11px;
    color: var(--app-text-muted);
    font-family: var(--app-font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-explain {
    font-size: 11px;
    /* Meaning-bearing text — keep ≥4.5:1 (use secondary, not faint).
       Three-judge a11y finding. */
    color: var(--app-text-secondary);
    line-height: 1.4;
  }

  /* Three-button choice group (§6.1) */
  .choice-group {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .choice-btn {
    flex: 1 1 auto;
    min-width: 0;
    padding: 6px 10px;
    font-size: 12px;
    border-radius: 6px;
    border: 1px solid var(--app-border);
    background: var(--app-surface-sunken);
    color: var(--app-text-secondary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    transition: background 0.1s, border-color 0.1s, color 0.1s;
    text-align: center;
  }
  .choice-btn:hover:not(:disabled):not(.selected) {
    background: var(--app-surface-hover);
    color: var(--app-text);
    border-color: var(--app-border-strong);
  }
  .choice-btn:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }
  .choice-btn.selected {
    background: var(--app-accent);
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
    font-weight: 600;
  }
  /* "Keep both" is the recommended option. When NOT selected it gets a faint
     accent tint + accent border so it reads as endorsed at a glance — clearly
     distinct from the neutral buttons AND from the solid-fill selected state
     (three-judge gate finding: a lone star was too quiet / conflated the two). */
  .choice-btn.recommended:not(.selected) {
    border-color: var(--app-focus-ring);
    color: var(--app-text);
    background: var(--app-accent-subtle);
  }
  .choice-btn.recommended:not(.selected):hover:not(:disabled) {
    background: color-mix(in srgb, var(--app-focus-ring) 22%, transparent);
  }
  .rec-badge {
    display: inline-flex;
    align-items: center;
    opacity: 0.7;
    flex-shrink: 0;
  }
  .choice-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .error-msg {
    margin: 0 0 12px;
    padding: 8px 12px;
    border-radius: 6px;
    background: var(--app-error-bg);
    border: 1px solid var(--app-error-border);
    color: var(--app-error-text);
    font-size: 12px;
    line-height: 1.5;
  }

  /* M13: "Getting things ready…" / ids-fetch-failed status strip — the
     honest replacement for a silently-disabled primary button. */
  .ids-status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 14px;
    padding: 8px 12px;
    border-radius: 6px;
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border-subtle);
    font-size: 12px;
    line-height: 1.4;
    color: var(--app-text-secondary);
  }
  .ids-status-error {
    background: var(--app-error-bg);
    border-color: var(--app-error-border);
    color: var(--app-error-text);
    flex-wrap: wrap;
  }
  .ids-retry-btn {
    margin-left: auto;
    padding: 4px 10px;
    font-size: 11px;
    border-radius: 5px;
    background: var(--app-surface);
    border: 1px solid var(--app-border);
    color: var(--app-text);
    cursor: pointer;
    white-space: nowrap;
  }
  .ids-retry-btn:hover { background: var(--app-surface-hover); }
  .ids-retry-btn:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }

  .ids-spinner {
    width: 10px;
    height: 10px;
    border: 1.5px solid var(--app-spinner-track);
    border-top-color: var(--app-spinner-head);
    border-radius: 50%;
    animation: ids-spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  @keyframes ids-spin { to { transform: rotate(360deg); } }

  /* Fallback disabled treatment for body buttons with no dedicated
     :disabled rule of their own (currently just .banner-btn). */
  button:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Primary-button colors come from the shared .app-btn-primary recipe
     (theme.css) — the L5 convergence removed this dialog's local copy. */

  /* "Compare versions" disclosure — text-file preview panes */
  .preview-disclosure {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .disclosure-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: transparent;
    border: 1px solid var(--app-border);
    border-radius: 5px;
    color: var(--app-text-muted);
    font-size: 11px;
    cursor: pointer;
    padding: 3px 8px;
    align-self: flex-start;
    line-height: 1.5;
  }
  .disclosure-btn:hover:not(:disabled) { color: var(--app-text); background: var(--app-surface-hover); }
  .disclosure-btn:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .disclosure-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .disclosure-arrow { display: inline-flex; align-items: center; }

  .preview-panes { display: flex; flex-direction: column; gap: 6px; }
  .pane-row {
    display: flex;
    gap: 8px;
  }
  .preview-pane {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--app-border-subtle);
    border-radius: 5px;
    overflow: hidden;
  }
  .pane-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--app-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 4px 8px;
    background: var(--app-surface-sunken);
    border-bottom: 1px solid var(--app-border-subtle);
    flex-shrink: 0;
  }
  .pane-content {
    margin: 0;
    padding: 8px;
    font-family: var(--app-font-mono);
    font-size: 11px;
    line-height: 1.5;
    overflow-y: auto;
    max-height: 200px;
    background: var(--app-surface-sunken);
    color: var(--app-text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .preview-loading {
    margin: 0;
    font-size: 11px;
    color: var(--app-text-muted);
    padding: 4px 0;
  }
  .preview-unavailable {
    margin: 0;
    font-size: 11px;
    color: var(--app-text-muted);
    padding: 4px 0;
  }
</style>
