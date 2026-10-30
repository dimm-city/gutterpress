<script lang="ts">
  /**
   * StatusBar — slim bottom bar hosting the start-screen (Books) button, the
   * book switcher, the one status control with Sync beside it, and the settings
   * and help buttons.
   *
   * Layout (left → right):
   *   [folder → start screen Books] | [book switcher] | [status] [Sync] ··· [settings] [help]
   *
   * The status control is one line for saving AND the online copy ("Saved ·
   * Backed up"); clicking it opens Book setup → Online copy, the one place the
   * rest lives. Sync (get the latest changes, then back up yours) sits beside
   * it only while automatic backing up is off. A reader sees none of this: they
   * get the latest on their own. The words come from the pure `statusLine`
   * (#lib/save-status); the live state comes from the sync controller. The
   * Problems badge stays on the editor toolbar.
   *
   * PWA-clean: all host work via api.* routes (CLAUDE.md §8).
   * No node: builtins or gutterpress value imports.
   */
  import BookSwitcher from "#lib/components/BookSwitcher.svelte";
  import Icon from "#lib/components/Icon.svelte";
  import { statusLine } from "#lib/save-status.ts";
  import type { LastBackup } from "#lib/backup-state.ts";
  import type { ProjectBookEntry } from "#lib/routes/project-session-controller.svelte.ts";

  let {
    /** Currently-open project directory. Bar is shown when non-null. */
    projectDir = null as string | null,
    /** Source mode — the status control only shows for folder sources. */
    sourceMode = "folder" as "folder" | "url",
    /** Whether the book can back up (an https online copy with a saved sign-in). */
    canSync = false,
    /** Whether the book has an online copy at all (any address), even one Gutterpress
     *  can't back up to: an unknown state is then "Saved", not "Saved on this computer". */
    hasRemote = false,
    /** Current save phase from the editor buffer. */
    savePhase = "clean" as "clean" | "dirty" | "saving" | "error",
    /** Settings → Saving "Save changes automatically". Off, a dirty buffer is
     *  waiting for the author's Save, not about to save itself — so it reads
     *  "Unsaved changes", never "Saving…". */
    autoSave = true,
    /** Settings → Saving "Back up online automatically". */
    autoBackup = true,
    /** Whether a manual force-save is in progress. */
    forceSaving = false,
    /** Whether a manual Sync is in progress. */
    forceSyncing = false,
    /** A reader sees no status control and no Sync. */
    readerMode = false,
    /** Books in the open project's repo; switcher shows only when > 1. */
    books = [] as ProjectBookEntry[],
    /** The book the session currently targets. */
    activeBookDir = null as string | null,
    /** The online copy's last word for the open book (the host's stream or the last manual Sync). */
    backup = null as LastBackup | null,
    /** Why automatic versions keep failing, once the host has said so (only while they are on: a failing safety net you turned off isn't news). */
    versionsProblem = null as { message: string | null } | null,
    /** Called with a book's folder path when the author switches books. */
    onSwitchBook = undefined as ((path: string) => void) | undefined,
    /** Called when the author clicks "Sync". */
    onForceSync = undefined as (() => void | Promise<void>) | undefined,
    /** The last check found changes online this computer has not got. */
    updatesAvailable = false,
    /** Called when the status control is clicked: opens Book setup → Online copy. */
    onOpenOnlineCopy = undefined as (() => void) | undefined,
    onOpenSettings = undefined as (() => void) | undefined,
    onOpenHelp = undefined as (() => void) | undefined,
    /** Called by the folder button: opens the start screen's Books tab. */
    onOpenBooks = undefined as (() => void) | undefined,
  }: {
    projectDir?: string | null;
    sourceMode?: "folder" | "url";
    canSync?: boolean;
    hasRemote?: boolean;
    autoBackup?: boolean;
    savePhase?: "clean" | "dirty" | "saving" | "error";
    autoSave?: boolean;
    forceSaving?: boolean;
    forceSyncing?: boolean;
    readerMode?: boolean;
    books?: ProjectBookEntry[];
    activeBookDir?: string | null;
    backup?: LastBackup | null;
    versionsProblem?: { message: string | null } | null;
    onSwitchBook?: (path: string) => void;
    onForceSync?: () => void | Promise<void>;
    updatesAvailable?: boolean;
    onOpenOnlineCopy?: () => void;
    onOpenSettings?: () => void;
    onOpenHelp?: () => void;
    onOpenBooks?: () => void;
  } = $props();

  // The status control: only for an open folder book, and never for a reader.
  let showStatus = $derived(!!projectDir && sourceMode === "folder" && !readerMode);
  // Manual mode: automatic backing up is off but the book can back up, so the
  // bar offers Sync beside the control.
  let showManualSync = $derived(showStatus && canSync && !autoBackup);
  let line = $derived(
    statusLine({
      savePhase,
      autoSave,
      forceSaving,
      versionsProblem,
      backup,
      hasRemote,
      backingUp: forceSyncing,
    }),
  );

  // Book switcher: only when the open repo actually has more than one book.
  let showBookSwitcher = $derived(!!projectDir && sourceMode === "folder" && books.length > 1);

</script>

<div class="status-bar" role="status" aria-label="Application status">
  <!-- Left cluster: [folder → start screen Books] | [book switcher] | [status] [Sync].
       A divider precedes each group after the first, so a hidden switcher or
       status control leaves no stray line. Settings and help sit at the far right. -->
  <div class="status-left">
    <button
      class="status-icon-btn"
      onclick={() => onOpenBooks?.()}
      title="Books — open the start screen"
      aria-label="Books — open the start screen"
    >
      <Icon name="folder" size={14} />
    </button>
    {#if showBookSwitcher}
      <span class="divider" aria-hidden="true"></span>
      <BookSwitcher {books} {activeBookDir} onSelect={(path) => onSwitchBook?.(path)} />
    {/if}
    {#if showStatus}
      <span class="divider" aria-hidden="true"></span>
      <button
        type="button"
        class="status-control {line.tone}"
        onclick={() => onOpenOnlineCopy?.()}
        title={line.title}
      ><Icon name={line.icon} size={13} /><span class="status-text" aria-live="polite" aria-atomic="true">{line.text}</span></button>
    {/if}
    {#if showManualSync}
      <!-- Automatic backing up is off: one pass gets the latest changes, then
           backs up this computer's. -->
      <button
        type="button"
        class="status-icon-btn labelled"
        class:has-updates={updatesAvailable}
        onclick={() => void onForceSync?.()}
        disabled={forceSyncing}
        title={updatesAvailable ? "Sync — new changes are online: get them, then back up yours" : "Sync: get the latest changes from the online copy, then back up yours"}
        aria-label={updatesAvailable ? "Sync — new changes are online" : undefined}
      ><Icon name="refresh-cw" size={14} /><span>{forceSyncing ? "Syncing…" : "Sync"}</span></button>
    {/if}
  </div>

  <div class="shell-actions" aria-label="Application actions">
    <button class="status-icon-btn" onclick={() => onOpenSettings?.()} title="Settings (Ctrl+,)" aria-label="Settings">
      <Icon name="settings" size={14} />
    </button>
    <button class="status-icon-btn" onclick={onOpenHelp} title="Help" aria-label="Help">
      <Icon name="circle-help" size={14} />
    </button>
  </div>
</div>

<style>
  .status-bar {
    display: flex;
    align-items: stretch;
    flex-shrink: 0;
    background: var(--app-surface-raised);
    border-top: 1px solid var(--app-border);
    /* The bar is one flex row in normal document flow. The Problems list is not
       part of it — ProblemsPanel renders that as its own row directly above. */
    position: relative;
    z-index: var(--app-z-popover);
    /* The book switcher opens upward out of the bar. */
    overflow: visible;
  }

  /* ── Left cluster (Books, book switcher, status control, Sync) ───────── */
  /* It gives way before settings and help do: the status line is the one item
     inside that shrinks (and ellipsizes). */
  .status-left {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    min-height: 28px;
    flex: 0 1 auto;
    min-width: 0;
  }

  /* ── Bare icon button (Books, Sync, settings, help) ──────────────────── */
  .status-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* 14px glyph + 5px padding = 24x24 hit area (WCAG 2.5.8); the -3px margin
       keeps the layout footprint at 18x18 so the bar height is unchanged. */
    padding: 5px;
    margin: -3px;
    border: none;
    background: transparent;
    color: var(--app-text-secondary);
    cursor: pointer;
    border-radius: 3px;
    flex-shrink: 0;
    transition: color 0.12s, background 0.12s;
  }
  .status-icon-btn:hover:not(:disabled) {
    color: var(--app-text);
    background: var(--app-surface-hover);
  }
  .status-icon-btn:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 1px;
  }
  /* Sync is the one icon button with a word. With changes waiting online it
     takes the accent and a dot, so the cue is never colour alone. */
  .labelled {
    gap: 4px;
    font-size: 11px;
  }
  .labelled.has-updates {
    color: var(--app-link);
    font-weight: 600;
  }
  .labelled.has-updates::after {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .status-icon-btn:disabled {
    cursor: default;
  }

  /* The one status control: a button that opens Book setup → Online copy.
     Resting is calm but readable; in flight is italic; what needs the author
     takes the warning token and a failed save the error token (the icon's
     shape says the same). */
  .status-control {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 340px;
    font-size: 11px;
    background: transparent;
    border: none;
    padding: 2px 6px;
    border-radius: 3px;
    cursor: pointer;
    color: var(--app-text-secondary);
  }
  .status-control :global(svg) { flex-shrink: 0; }
  .status-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status-control:hover { color: var(--app-text); background: var(--app-surface-hover); }
  .status-control:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  .status-control.pending { font-style: italic; }
  .status-control.warn { color: var(--app-warning-text); }
  .status-control.error { color: var(--app-error-text); font-weight: 600; }
  /* Narrow (the app's single-pane layout): the line gives way to the buttons beside it. */
  @media screen and (max-width: 820px) {
    .status-control { max-width: 160px; }
  }

  /* A `|` before each group after the Books button. Rendered only with the
     group it leads, so a hidden switcher or status control leaves no stray line. */
  .divider {
    align-self: stretch;
    width: 1px;
    flex-shrink: 0;
    background: var(--app-border);
  }

  .shell-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px 0 8px;
    flex: 0 0 auto;
    margin-left: auto;
  }
</style>
