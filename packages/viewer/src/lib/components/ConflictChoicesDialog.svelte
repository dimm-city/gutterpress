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
  import type {
    ConflictFileInfo,
    ConflictPreview,
    ConflictResolutionChoice,
    SyncOutcome,
  } from "$lib/platform/contract";

  let {
    open = $bindable(false),
    projectDir,
    bookSubPath = "",
    files = [],
    localId,
    remoteId,
    /** Called after successful resolution so the parent can refresh the preview. */
    onResolved,
    /** Re-routes to the reconnect flow on the unlikely auth error during resolution. */
    onReconnect,
    triggerEl,
  }: {
    open?: boolean;
    projectDir: string | null;
    bookSubPath?: string;
    files?: ConflictFileInfo[];
    localId?: string | null;
    remoteId?: string | null;
    onResolved?: (mergedRemoteChanges: boolean) => void;
    onReconnect?: () => void;
    triggerEl?: HTMLButtonElement | undefined;
  } = $props();

  /** Per-file choice: default "both" for both-edited (lossless), "mine" for deletions. */
  let choices = $state<Record<string, "mine" | "theirs" | "both">>({});
  let phase = $state<"choosing" | "resolving" | "done" | "error">("choosing");
  let errorMessage = $state<string | null>(null);
  let dialogEl = $state<HTMLDivElement | undefined>(undefined);

  /** Track which file disclosures are expanded (path → boolean). */
  let previewExpanded = $state<Record<string, boolean>>({});
  /** Memoised preview results (path → ConflictPreview | null | "loading" | "error"). */
  let previewCache = $state<Record<string, ConflictPreview | null | "loading" | "error">>({});

  // Reset and default choices whenever the dialog opens or the file list changes.
  $effect(() => {
    if (!open) return;
    phase = "choosing";
    errorMessage = null;
    previewExpanded = {};
    previewCache = {};
    // Default: "both" for both-edited (safest, lossless), "mine" for deletion conflicts.
    choices = Object.fromEntries(
      files.map((f) => [
        f.path,
        f.kind === "both-edited" ? ("both" as const) : ("mine" as const),
      ]),
    );
    queueMicrotask(() => dialogEl?.focus());
  });

  function isOutsideBook(filePath: string): boolean {
    return !!bookSubPath && !filePath.startsWith(bookSubPath + "/");
  }

  function displayPath(filePath: string): string {
    return bookSubPath && filePath.startsWith(bookSubPath + "/")
      ? filePath.slice(bookSubPath.length + 1)
      : filePath;
  }

  /** Human-readable label for the file, falling back to the display path. */
  function fileLabel(filePath: string): string {
    const display = displayPath(filePath);
    // Try to make a chapter-like label from the filename.
    const name = display.split("/").pop() ?? display;
    // Strip extension and de-kebab for a readable label ("03-chapter.md" → "03 chapter").
    return name
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]/g, " ")
      .replace(/^\d+\s*/, (m) => m); // keep leading numbers ("03 ")
  }

  /** Per-kind explanation shown below the file name. */
  function kindExplanation(kind: ConflictFileInfo["kind"]): string {
    switch (kind) {
      case "both-edited":
        return "You and a teammate both changed this file.";
      case "you-deleted":
        return "You removed this file, but it was changed online.";
      case "online-deleted":
        return "This file was removed online, but you changed it here.";
    }
  }

  /** Whether the file is a binary type (image/font/pdf) — no diff available. */
  function isBinary(filePath: string): boolean {
    return /\.(png|jpg|jpeg|gif|webp|svg|avif|ico|bmp|tiff?|woff2?|otf|ttf|eot|pdf)$/i.test(
      filePath,
    );
  }

  /**
   * Toggle the "Compare versions" disclosure for a text file.
   * On first expand, lazily fetches the preview via getPlatform().getConflictPreview()
   * and memoises the result so subsequent toggles don't re-fetch.
   */
  async function togglePreview(filePath: string) {
    const wasExpanded = previewExpanded[filePath] ?? false;
    previewExpanded = { ...previewExpanded, [filePath]: !wasExpanded };

    // Only fetch on first expand and only for text (non-binary) files.
    if (!wasExpanded && !(filePath in previewCache) && !isBinary(filePath) && projectDir) {
      previewCache = { ...previewCache, [filePath]: "loading" };
      try {
        const result = await getPlatform().getConflictPreview(projectDir, filePath);
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
    const resolutions: ConflictResolutionChoice[] = files.map((f) => ({
      path: f.path,
      choice: choices[f.path] ?? "both",
    }));
    try {
      const outcome: SyncOutcome = await getPlatform().resolveSyncConflicts({
        projectDir,
        resolutions,
        localId,
        remoteId,
      });
      if (outcome.status === "synced") {
        phase = "done";
        onResolved?.(outcome.mergedRemoteChanges);
        close();
      } else if (outcome.status === "up-to-date") {
        phase = "done";
        onResolved?.(false);
        close();
      } else if (outcome.status === "auth") {
        phase = "error";
        errorMessage = outcome.message;
        onReconnect?.();
      } else {
        phase = "error";
        errorMessage = outcome.message;
      }
    } catch (e) {
      phase = "error";
      const raw = e instanceof Error ? e.message : String(e);
      errorMessage = raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
    }
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
    if (phase === "resolving") return; // can't interrupt — host is mid-operation
    open = false;
    triggerEl?.focus();
  }
</script>

{#if open}
  <div class="backdrop" onclick={close} role="presentation"></div>

  <div
    bind:this={dialogEl}
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="conflict-title"
    tabindex="-1"
    onkeydown={trapFocus}
  >
    <header class="dialog-header">
      <h2 id="conflict-title">
        <Icon name="triangle-alert" />
        Changes happened in two places
      </h2>
      <button
        class="close"
        onclick={close}
        disabled={phase === "resolving"}
        title="Close (Esc)"
        aria-label="Close"
      ><Icon name="x" size={16} /></button>
    </header>

    <div class="dialog-body">
      <!-- Persistent live region for phase announcements -->
      <div class="sr-only" role="status" aria-live="polite">
        {#if phase === "resolving"}
          Applying your choices…
        {:else if phase === "error"}
          Something went wrong — {errorMessage ?? ""}
        {/if}
      </div>

      {#if phase !== "error"}
        <p class="lede">
          You and a teammate changed some of the same files. A snapshot of
          your work was saved automatically — you can always recover either
          version from View History. Choose what to do with each file below.
        </p>

        <!-- "Not sure?" affordance — recommended lossless default (§6.1) -->
        <div class="keep-both-banner" role="note">
          <span class="banner-icon" aria-hidden="true">💡</span>
          <span>
            <strong>Not sure?</strong> Choose "Keep both" — it's the safest option
            and saves a copy of both versions next to each other.
          </span>
          <button class="banner-btn" onclick={() => setAll("both")} disabled={phase === "resolving"}>
            Set all to Keep both
          </button>
        </div>

        {#if bookSubPath && files.some((f) => isOutsideBook(f.path))}
          <p class="hint">
            Some files below are outside this book but part of the same shared
            folder — everything in it saves together.
          </p>
        {/if}

        <!-- svelte-ignore a11y_no_redundant_roles -->
        <ul class="file-list" role="list" aria-label="Files with differences">
          {#each files as file (file.path)}
            {@const label = fileLabel(file.path)}
            {@const binary = isBinary(file.path)}
            <li class="file-item">
              <div class="file-info">
                <span class="file-label">{label}</span>
                <span class="file-path">{displayPath(file.path)}{isOutsideBook(file.path) ? " · shared folder" : ""}</span>
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
                    <span class="disclosure-arrow" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
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
                    <span class="rec-badge" aria-label="Recommended">★</span>
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
    <footer class="actions">
      {#if phase === "error"}
        <button class="ghost" onclick={close}>Close</button>
        <button class="primary" onclick={confirm}>Try again</button>
      {:else}
        <button class="ghost" onclick={close} disabled={phase === "resolving"}>Decide later</button>
        <button
          class="primary"
          onclick={confirm}
          disabled={phase === "resolving" || files.length === 0 || !localId || !remoteId}
        >
          {phase === "resolving" ? "Applying choices…" : "Use these choices"}
        </button>
      {/if}
    </footer>
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
    width: min(600px, 94vw);
    max-height: 84vh;
    background: var(--app-surface);
    color: var(--app-text-secondary);
    border-radius: 8px;
    box-shadow: 0 14px 40px var(--app-shadow-lg);
    z-index: 1001;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--app-border-subtle);
    flex-shrink: 0;
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
    border: 1px solid transparent;
    border-radius: 5px;
    color: var(--app-text-muted);
    line-height: 1;
    cursor: pointer;
    padding: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    min-height: 28px;
  }
  .close:hover:not(:disabled) { color: var(--app-text); background: var(--app-surface-hover); }
  .close:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
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
    margin: 0 0 14px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--app-text-secondary);
  }
  .hint {
    font-size: 12px;
    color: var(--app-text-faint);
    margin: 0 0 12px;
    line-height: 1.5;
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
  .banner-icon { font-size: 14px; flex-shrink: 0; margin-top: 1px; }
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
    color: var(--app-text-faint);
    font-family: ui-monospace, monospace;
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
    border-color: var(--app-border-strong, var(--app-border));
  }
  .choice-btn:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }
  .choice-btn.selected {
    background: var(--app-accent, var(--app-focus-ring));
    border-color: var(--app-accent-border, var(--app-focus-ring));
    color: var(--app-accent-text, #fff);
    font-weight: 600;
  }
  /* "Keep both" is the recommended option. When NOT selected it gets a faint
     accent tint + accent border so it reads as endorsed at a glance — clearly
     distinct from the neutral buttons AND from the solid-fill selected state
     (three-judge gate finding: a lone star was too quiet / conflated the two). */
  .choice-btn.recommended:not(.selected) {
    border-color: var(--app-focus-ring);
    color: var(--app-text);
    background: var(--app-accent-subtle, color-mix(in srgb, var(--app-focus-ring) 14%, transparent));
  }
  .choice-btn.recommended:not(.selected):hover:not(:disabled) {
    background: var(--app-accent-subtle-hover, color-mix(in srgb, var(--app-focus-ring) 22%, transparent));
  }
  .rec-badge {
    font-size: 10px;
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

  /* Pinned action bar — sibling of the scroll region, always visible. */
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-shrink: 0;
    padding: 14px 18px;
    border-top: 1px solid var(--app-border-subtle);
    background: var(--app-surface);
  }
  .actions button {
    padding: 6px 14px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .primary {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
  }
  .primary:hover:not(:disabled) { background: var(--app-accent-hover); }
  .primary:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .ghost { background: transparent; color: var(--app-text-muted); border-color: var(--app-border); }
  .ghost:hover:not(:disabled) { background: var(--app-surface-hover); color: var(--app-text); }

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
  .disclosure-arrow { font-size: 10px; }

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
    font-family: ui-monospace, "Cascadia Code", "Fira Code", monospace;
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
    color: var(--app-text-faint);
    padding: 4px 0;
  }
  .preview-unavailable {
    margin: 0;
    font-size: 11px;
    color: var(--app-text-faint);
    padding: 4px 0;
  }
</style>
