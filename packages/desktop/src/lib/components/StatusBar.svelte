<script lang="ts">
  /**
   * StatusBar — slim bottom bar hosting the start-screen (Books) button, the
   * book switcher, the one status control and the settings and help buttons.
   *
   * Layout (left → right):
   *   [folder → start screen Books] [book switcher] ··· [Get latest] [Back up now] [status] | [settings] [help]
   *
   * The status control is one line for saving AND the online copy ("Saved ·
   * Backed up"); clicking it opens Book setup → Online copy, the one place the
   * rest lives. Get latest and Back up now sit beside it only while automatic
   * backing up is off. A reader sees none of this: they get the latest on their
   * own. The words come from the pure `statusLine` (#lib/save-status); the live
   * state comes from the sync controller. The Problems badge stays on the editor
   * toolbar.
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
    /** Whether a manual Back up now is in progress. */
    forceSyncing = false,
    /** A reader sees no status control, no Get latest and no Back up now. */
    readerMode = false,
    /** Books in the open project's repo; switcher shows only when > 1. */
    books = [] as ProjectBookEntry[],
    /** The book the session currently targets. */
    activeBookDir = null as string | null,
    /** The online copy's last word for the open book (the host's stream or the last Back up now). */
    backup = null as LastBackup | null,
    /** Why automatic versions keep failing, once the host has said so (only while they are on: a failing safety net you turned off isn't news). */
    versionsProblem = null as { message: string | null } | null,
    /** Called with a book's folder path when the author switches books. */
    onSwitchBook = undefined as ((path: string) => void) | undefined,
    /** Called when the author clicks "Back up now". */
    onForceSync = undefined as (() => void | Promise<void>) | undefined,
    /** Called for "Get latest": bring in the online changes without sending any. */
    onGetLatest = undefined as (() => void | Promise<void>) | undefined,
    /** A "Get latest" is in progress. */
    gettingLatest = false,
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
    onGetLatest?: () => void | Promise<void>;
    gettingLatest?: boolean;
    updatesAvailable?: boolean;
    onOpenOnlineCopy?: () => void;
    onOpenSettings?: () => void;
    onOpenHelp?: () => void;
    onOpenBooks?: () => void;
  } = $props();

  // The status control: only for an open folder book, and never for a reader.
  let showStatus = $derived(!!projectDir && sourceMode === "folder" && !readerMode);
  // Manual mode: automatic backing up is off but the book can back up, so the
  // bar offers Get latest and Back up now beside the control.
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
  <!-- Left cluster: [folder → start screen Books] [book switcher]. The online
       copy and saving are grouped at the far right, next to settings and help. -->
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
      <span class="divider" aria-hidden="true"></span>
    {/if}
  </div>

  <!-- Right cluster: [Get latest] [Back up now] [status control] -->
  <div class="status-right">
    {#if showManualSync}
      <!-- Automatic backing up is off: the author gets and sends changes on
           demand. Get latest never sends anything back. -->
      <button
        type="button"
        class="status-icon-btn"
        class:has-updates={updatesAvailable}
        onclick={() => void onGetLatest?.()}
        disabled={gettingLatest || forceSyncing}
        title={updatesAvailable ? "New changes are online — get them (your changes stay on this computer)" : "Get latest: bring in changes from the online copy without sending yours"}
        aria-label={updatesAvailable ? "Get latest — new changes are online" : "Get latest"}
      ><Icon name="arrow-down-to-line" size={14} />{#if updatesAvailable}<span>{gettingLatest ? "Getting…" : "New online"}</span>{/if}</button>
      <button
        type="button"
        class="status-icon-btn"
        onclick={() => void onForceSync?.()}
        disabled={gettingLatest || forceSyncing}
        title="Back up now: send your versions to the online copy (it gets the latest first)"
        aria-label="Back up now"
      ><Icon name="cloud-upload" size={14} /></button>
    {/if}
    {#if showStatus}
      <button
        type="button"
        class="status-control {line.tone}"
        onclick={() => onOpenOnlineCopy?.()}
        title={line.title}
      ><Icon name={line.icon} size={13} /><span class="status-text" aria-live="polite" aria-atomic="true">{line.text}</span></button>
    {/if}
  </div>

  <div class="shell-actions" class:divided={showStatus} aria-label="Application actions">
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

  /* ── Left cluster (Books button, book switcher) ─────────────────────────────────────── */
  .status-left {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    min-height: 28px;
    flex: 0 0 auto;
    min-width: 0;
  }

  /* ── Right cluster (Get latest, Back up now, status control) ─────────── */
  .status-right {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    min-height: 28px;
    flex: 0 0 auto;
    min-width: 0;
    margin-left: auto;
  }

  /* ── Bare icon button (Books, Get latest, Back up now, settings, help) ─ */
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
  /* With changes waiting online the Get latest button names them and takes the accent. */
  .status-icon-btn.has-updates {
    gap: 4px;
    color: var(--app-link);
    font-size: 11px;
    font-weight: 600;
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
  /* Narrow (the app's single-pane layout): the line gives way to the buttons. */
  @media screen and (max-width: 820px) {
    .status-control { max-width: 160px; }
  }

  /* A `|` between status-bar groups: around the book switcher. Rendered only
     beside the item it separates, so a hidden switcher leaves no stray line. */
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
  }
  /* The `|` between the status control and settings/help: only when the
     control is shown, so an empty right side has no stray divider. */
  .shell-actions.divided {
    border-left: 1px solid var(--app-border);
  }
</style>
