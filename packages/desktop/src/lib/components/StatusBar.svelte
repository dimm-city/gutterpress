<script lang="ts">
  /**
   * StatusBar — slim bottom bar hosting the start-screen (Books) button, the
   * book switcher, the one status control with its Update button, and the
   * settings and help buttons.
   *
   * Layout (left → right):
   *   [folder → start screen Books] | [book switcher] | [status ▾] [Update] ··· [settings] [help]
   *
   * The status control is two small clauses, this computer and then the online
   * copy ("Saved here · Backed up 3 mins ago"). Its click does the one thing
   * that fixes or explains the state: "Unsaved changes" saves, two takes open
   * the list to decide, a lost sign-in opens the sign-in; everything else opens
   * a small popover (StatusPopover) with one sentence and the primary action.
   * The Update button replaces Get latest and Sync: it shows only when there is
   * something to get or send (and always in manual mode, where nothing happens
   * on its own). A reader sees none of this: they get the latest on their own.
   * The words come from the pure `statusLine` (#lib/save-status); the live
   * state comes from the sync controller. The Problems badge stays on the
   * editor toolbar.
   *
   * PWA-clean: all host work via api.* routes (CLAUDE.md §8).
   * No node: builtins or gutterpress value imports.
   */
  import { onMount } from "svelte";
  import BookSwitcher from "#lib/components/BookSwitcher.svelte";
  import Icon from "#lib/components/Icon.svelte";
  import StatusPopover from "#lib/components/StatusPopover.svelte";
  import { statusLine, type StatusActionId } from "#lib/save-status.ts";
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
     *  can't back up to: an unknown state is then "Checking online…", never a bare "Saved". */
    hasRemote = false,
    /** The book was classified and its online copy diagnosed, so "no online copy" is a fact. */
    classified = true,
    /** A plain folder: version history is off. */
    noHistory = false,
    /** What the online copy needs from the author before it can back up (from the diagnosis). */
    remoteNeeds = null as "sign-in" | "own-tools" | null,
    /** The renderer's own check for online changes has answered at least once. */
    checked = false,
    /** Passages with two takes (counted from the Problems list). */
    decide = 0,
    /** The Problems list has loaded, so its count beats a host count that may be stale. */
    problemsLoaded = false,
    /** Current save phase from the editor buffer. */
    savePhase = "clean" as "clean" | "dirty" | "saving" | "error",
    /** Why the last save failed, when the editor said. */
    saveError = null as string | null,
    /** Settings → Saving "Save changes automatically". Off, a dirty buffer is
     *  waiting for the author's Save, not about to save itself — so it reads
     *  "Unsaved changes", never "Saving…". */
    autoSave = true,
    /** Settings → Saving "Back up online automatically". */
    autoBackup = true,
    /** Whether a manual force-save is in progress. */
    forceSaving = false,
    /** Whether a manual Back up / Update is in progress. */
    forceSyncing = false,
    /** A reader sees no status control and no Update. */
    readerMode = false,
    /** Books in the open project's repo; switcher shows only when > 1. */
    books = [] as ProjectBookEntry[],
    /** The book the session currently targets. */
    activeBookDir = null as string | null,
    /** The online copy's last word for the open book (the host's stream or the last manual pass). */
    backup = null as LastBackup | null,
    /** Why automatic versions keep failing, once the host has said so (only while they are on: a failing safety net you turned off isn't news). */
    versionsProblem = null as { message: string | null } | null,
    /** Called with a book's folder path when the author switches books. */
    onSwitchBook = undefined as ((path: string) => void) | undefined,
    /** Back up: get the latest changes, then back up yours. */
    onForceSync = undefined as (() => void | Promise<void>) | undefined,
    /** Get the online changes without sending any. */
    onGetLatest = undefined as (() => void | Promise<void>) | undefined,
    /** A "get the changes" is in progress. */
    gettingLatest = false,
    /** The last check found changes online this computer has not got. */
    updatesAvailable = false,
    /** Save now (the click on "Unsaved changes", and Try again after a failed save). */
    onSave = undefined as (() => void | Promise<void>) | undefined,
    /** Open Book setup on Backup & history. */
    onOpenBackup = undefined as (() => void) | undefined,
    /** Open the Problems list on the two-takes entries. */
    onOpenProblems = undefined as (() => void) | undefined,
    /** Turn on version history for a plain folder. */
    onTurnOnHistory = undefined as (() => void | Promise<void>) | undefined,
    /** Save a version (asks for an optional name). */
    onSaveVersion = undefined as (() => void | Promise<unknown>) | undefined,
    onOpenSettings = undefined as (() => void) | undefined,
    onOpenHelp = undefined as (() => void) | undefined,
    /** Called by the folder button: opens the start screen's Books tab. */
    onOpenBooks = undefined as (() => void) | undefined,
  }: {
    projectDir?: string | null;
    sourceMode?: "folder" | "url";
    canSync?: boolean;
    hasRemote?: boolean;
    classified?: boolean;
    noHistory?: boolean;
    remoteNeeds?: "sign-in" | "own-tools" | null;
    checked?: boolean;
    decide?: number;
    problemsLoaded?: boolean;
    autoBackup?: boolean;
    savePhase?: "clean" | "dirty" | "saving" | "error";
    saveError?: string | null;
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
    onSave?: () => void | Promise<void>;
    onOpenBackup?: () => void;
    onOpenProblems?: () => void;
    onTurnOnHistory?: () => void | Promise<void>;
    onSaveVersion?: () => void | Promise<unknown>;
    onOpenSettings?: () => void;
    onOpenHelp?: () => void;
    onOpenBooks?: () => void;
  } = $props();

  // The status control: only for an open folder book, and never for a reader.
  let showStatus = $derived(!!projectDir && sourceMode === "folder" && !readerMode);

  // The clock behind "3 mins ago": it ticks once a minute.
  let now = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  // Cmd on a Mac, Ctrl elsewhere: the key the "Unsaved changes" line names.
  const saveKey = typeof navigator !== "undefined" && /mac/i.test(navigator.platform ?? "") ? "Cmd+S" : "Ctrl+S";

  let line = $derived(
    statusLine({
      savePhase,
      saveError,
      autoSave,
      autoBackup,
      canSync,
      forceSaving,
      versionsProblem,
      backup,
      hasRemote,
      classified,
      noHistory,
      remoteNeeds,
      checked,
      decide,
      problemsLoaded,
      saveKey,
      updatesAvailable,
      backingUp: forceSyncing,
      gettingLatest,
      now,
    }),
  );

  // Screen readers hear a state change, never the minute ticking over: the
  // live region holds `line.announce`, the line without its time, so its text
  // only changes when the state does.

  let popoverOpen = $state(false);
  let statusBtn = $state<HTMLButtonElement | null>(null);
  /** Close the popover; `refocus` puts focus back on the status control (Escape, or an action taken). */
  function closePopover(refocus = false): void {
    popoverOpen = false;
    if (refocus) statusBtn?.focus();
  }
  const busy = $derived(forceSyncing || gettingLatest || forceSaving);

  function run(id: StatusActionId): void {
    closePopover(true);
    switch (id) {
      case "save":
        void onSave?.();
        break;
      case "back-up":
      case "update":
        void onForceSync?.();
        break;
      case "get-changes":
        void onGetLatest?.();
        break;
      case "try-again":
        void (savePhase === "error" ? onSave?.() : onForceSync?.());
        break;
      case "open-backup":
        onOpenBackup?.();
        break;
      case "turn-on-history":
        void onTurnOnHistory?.();
        break;
      case "save-version":
        void onSaveVersion?.();
        break;
      case "open-problems":
        onOpenProblems?.();
        break;
    }
  }

  function clickStatus(): void {
    if (line.click === "action" && line.clickAction) run(line.clickAction);
    else if (line.click === "popover") popoverOpen = !popoverOpen;
    else popoverOpen = false;
  }

  // The Update button: its tooltip says exactly what it will do.
  const buttonTitle = $derived(
    line.button?.action === "get-changes"
      ? "Get the changes from the online copy. Your own changes stay as they are."
      : line.button?.action === "back-up"
        ? "Back up your changes to the online copy."
        : "Get the latest changes from the online copy, then back up yours.",
  );

  // Book switcher: only when the open repo actually has more than one book.
  let showBookSwitcher = $derived(!!projectDir && sourceMode === "folder" && books.length > 1);

</script>

<div class="status-bar" role="group" aria-label="Application status">
  <!-- Left cluster: [folder → start screen Books] | [book switcher] | [status] [Update].
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
      <div class="status-wrap">
        <button
          type="button"
          class="status-control {line.tone}"
          bind:this={statusBtn}
          data-state={line.key}
          onclick={clickStatus}
          title={line.left ? `${line.left}. ${line.title}` : line.title}
          aria-label={line.text}
          aria-haspopup={line.click === "popover" ? "dialog" : undefined}
          aria-expanded={line.click === "popover" ? popoverOpen : undefined}
        ><Icon name={line.icon} size={13} />{#if line.left}<span class="clause here">{line.left}</span><span class="sep" aria-hidden="true">·</span>{/if}<span class="clause status-text">{line.right}</span></button>
        {#if popoverOpen}
          <StatusPopover {line} {busy} onAction={run} onClose={closePopover} />
        {/if}
      </div>
      <!-- Changes only when the state does, never on the minute tick. -->
      <span class="sr-only" aria-live="polite" aria-atomic="true">{line.announce}</span>
      {#if line.button && canSync}
        <button
          type="button"
          class="status-icon-btn labelled"
          class:has-updates={line.key === "behind" || line.key === "behind-ahead"}
          onclick={() => run(line.button!.action)}
          disabled={busy}
          title={buttonTitle}
        ><Icon name="refresh-cw" size={14} /><span>{forceSyncing || gettingLatest ? "Updating…" : line.button.label}</span></button>
      {/if}
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

  /* ── Bare icon button (Books, Get latest, Sync, settings, help) ──────── */
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
  /* Update is the one icon button with a word. With changes waiting online it
     takes the accent and a dot, so the cue is never colour alone. */
  .labelled {
    gap: 4px;
    font-size: 12px;
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

  /* The one status control: a button that does the one thing that fixes or explains its state.
     Resting is calm but readable; in flight is italic; what needs the author
     takes the warning token and a failed save the error token (the icon's
     shape says the same). */
  .status-wrap { position: relative; display: inline-flex; min-width: 0; }
  .status-control {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 460px;
    font-size: 12px;
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
  /* The separator is the one thing that fades: text never carries opacity. */
  .sep { opacity: 0.6; }
  .status-control.error { color: var(--app-error-text); font-weight: 600; }
  /* Narrow (the app's single-pane layout): the line gives way to the buttons beside it. */
  /* Under 820px the "Saved here" clause moves into the tooltip: icon and the
     online clause stay. */
  @media screen and (max-width: 820px) {
    .status-control { max-width: 200px; }
    .status-control .here, .status-control .sep { display: none; }
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
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
