/**
 * EditorBuffer (#44) — the single owner of the in-app editor's edit lifecycle.
 *
 * Replaces the loose `editorFilePath` / `editorContent` / `saveDebounce` state
 * that used to live inline in `+page.svelte` and centralises the dirty/save
 * state machine, the debounced disk write, debounced crash-recovery snapshots,
 * the close-flush, and external-edit reconciliation.
 *
 * Single-owner discipline: components never read or mutate the raw fields. They
 * read the derived getters (`isDirty`, `phase`, …) and call the intent methods
 * (`load`, `edit`, `flush`, `acceptExternal`, `keepMine`, `reset`).
 *
 * Desktop-only: the editor is gated behind `isDesktop()` in `+page.svelte`, so
 * every platform call here runs against the ElectronAdapter. On web the buffer
 * is simply never constructed/used.
 */
import type { Platform } from "$lib/platform/contract";
import { api } from "$lib/api";

export type EditorBufferPhase = "clean" | "dirty" | "saving" | "error";

/** Pending external-edit details awaiting the user's Reload / Keep-mine call. */
export interface ExternalChange {
  diskContent: string;
  diskMtimeMs: number;
  /** False when the outside change deleted the open file. Omitted for edits. */
  exists?: false;
}

export interface EditorBufferOptions {
  /** The platform adapter (Electron). */
  platform: Platform;
  /** Disk-save debounce (ms). Defaults to 500 (the responsive edit→preview loop). */
  saveDelayMs?: number;
  /** Crash-recovery snapshot debounce (ms). Defaults to 1000. */
  recoveryDelayMs?: number;
  /** When false, no sidecar recovery snapshots are written (#45 setting). */
  recoveryEnabled?: boolean;
  /** Called after a successful disk write (e.g. to refresh the preview). */
  onSaved?: (filePath: string) => void;
  /** Called on a save/recovery error with a human message. */
  onError?: (message: string) => void;
  /** Called when an external edit is detected and the buffer is dirty. */
  onExternalConflict?: () => void;
  /** Called when an external edit is safely auto-reloaded (buffer was clean). */
  onAutoReloaded?: (filePath: string) => void;
  /**
   * The single content-replacement notification (#H1). Fired synchronously
   * whenever `content` is replaced with a disk version the caller did not
   * type — the clean-buffer auto-reload branches of
   * {@link EditorBuffer.reconcileExternalChange} AND the explicit
   * conflict-banner {@link EditorBuffer.acceptExternal} path both go through
   * this one callback. Consumers should push `content` into the live editor
   * view here so the on-screen document can never desync from the buffer.
   * Fired before `onAutoReloaded` so the editor is already updated by the
   * time any "reloaded from disk" toast appears.
   */
  onContentReplaced?: (filePath: string, content: string) => void;
  /**
   * Called whenever the buffer's pending-save state changes. Receives `true`
   * when there are unsaved edits (dirty or saving) and `false` once clean.
   * Use this to push dirty state to the host (e.g. window close gate) without
   * a reactive `$effect` in the component.
   */
  onDirty?: (pending: boolean) => void;
}

export class EditorBuffer {
  // ── Raw state (private; mutated only through intent methods) ──────────────
  filePath = $state<string | null>(null);
  content = $state<string>("");
  diskContent = $state<string>("");
  diskMtimeMs = $state<number>(0);
  phase = $state<EditorBufferPhase>("clean");
  externalChange = $state<ExternalChange | null>(null);

  // ── Derived ───────────────────────────────────────────────────────────────
  get isDirty(): boolean {
    return this.content !== this.diskContent;
  }

  get hasPendingSave(): boolean {
    return (
      this.phase === "dirty" ||
      this.phase === "saving" ||
      (this.phase === "error" && this.isDirty)
    );
  }

  private opts: EditorBufferOptions;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private saveInFlight: Promise<void> | null = null;
  private lastPendingSave = false;
  // Monotonic generation counter for concurrent load() suppression. Only the
  // most recent load's result is applied; earlier stale reads are discarded.
  private loadGen = 0;

  constructor(opts: EditorBufferOptions) {
    this.opts = opts;
  }

  private get platform(): Platform {
    return this.opts.platform;
  }

  /** Set phase and notify the onDirty callback when pending-save state changes. */
  private setPhase(next: EditorBufferPhase): void {
    this.phase = next;
    const nowPending = this.hasPendingSave;
    if (this.lastPendingSave !== nowPending) {
      this.lastPendingSave = nowPending;
      this.opts.onDirty?.(nowPending);
    }
  }

  /** Toggle crash-recovery snapshotting at runtime (#45 setting). */
  setRecoveryEnabled(enabled: boolean): void {
    this.opts.recoveryEnabled = enabled;
    if (!enabled && this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  /**
   * Load a file from disk into the buffer, clearing any prior pending state.
   *
   * `filePath` and `content` are set TOGETHER (after the async read resolves)
   * so the parent's `{#key filePath}` remount reads the correct `content`
   * prop. Setting `filePath` first — as the old code did — caused the remount
   * to read stale content (the read hadn't resolved yet), and the doc-swap
   * `$effect` that previously pushed the loaded text afterward was removed
   * in the $effect elimination pass. A generation counter guards against
   * stale results when two loads race (e.g. rapid file selection).
   */
  async load(filePath: string): Promise<void> {
    this.cancelTimers();
    const gen = ++this.loadGen;
    this.externalChange = null;
    try {
      const text = await this.platform.readFile(filePath);
      if (gen !== this.loadGen) return; // a newer load superseded this one
      const st = await this.platform.statFile(filePath).catch(() => null);
      if (gen !== this.loadGen) return;
      this.filePath = filePath;
      this.content = text;
      this.diskContent = text;
      this.diskMtimeMs = st?.mtimeMs ?? 0;
      this.setPhase("clean");
    } catch (e) {
      if (gen !== this.loadGen) return;
      this.filePath = filePath;
      this.content = "";
      this.diskContent = "";
      this.diskMtimeMs = 0;
      this.setPhase("error");
      this.opts.onError?.(
        `Could not open file: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Load recovered content (from a crash-recovery snapshot) for `filePath`.
   * Marks the buffer dirty against the current disk baseline so it saves on the
   * next debounce.
   *
   * `filePath` and `content` are set together (the recovered text is known
   * synchronously) before the async disk-baseline read, so the parent's
   * `{#key filePath}` remount reads the correct content prop — same rationale
   * as {@link load}.
   */
  async restoreContent(filePath: string, recovered: string): Promise<void> {
    this.cancelTimers();
    const gen = ++this.loadGen;
    this.externalChange = null;
    this.filePath = filePath;
    this.content = recovered;
    const st = await this.platform.statFile(filePath).catch(() => null);
    if (gen !== this.loadGen) return;
    try {
      this.diskContent = await this.platform.readFile(filePath);
    } catch {
      this.diskContent = "";
    }
    if (gen !== this.loadGen) return;
    this.diskMtimeMs = st?.mtimeMs ?? 0;
    this.setPhase(this.isDirty ? "dirty" : "clean");
    if (this.isDirty) this.scheduleSave();
  }

  /** Record a user edit; schedules the debounced disk save + recovery snapshot. */
  edit(text: string): void {
    this.content = text;
    if (!this.filePath) return;
    this.setPhase(this.isDirty ? "dirty" : "clean");
    if (this.isDirty) {
      this.scheduleSave();
      this.scheduleRecovery();
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      // Debounced saves report through onError; explicit flush() callers need
      // the rejection, but a timer has no caller to receive it.
      void this.doSave().catch(() => {});
    }, this.opts.saveDelayMs ?? 500);
  }

  private scheduleRecovery(): void {
    if (this.opts.recoveryEnabled === false) return;
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = setTimeout(() => {
      void this.doRecovery();
    }, this.opts.recoveryDelayMs ?? 1000);
  }

  private async doRecovery(): Promise<void> {
    const filePath = this.filePath;
    if (!filePath || this.opts.recoveryEnabled === false || !this.isDirty) return;
    try {
      await api.recovery.write(filePath, this.content, this.diskMtimeMs);
    } catch {
      // Recovery is best-effort; never surface as a hard error.
    }
  }

  private doSave(): Promise<void> {
    if (this.saveInFlight) return this.saveInFlight;
    const save = this.performSave();
    this.saveInFlight = save;
    const clear = (): void => {
      if (this.saveInFlight === save) this.saveInFlight = null;
    };
    void save.then(clear, clear);
    return save;
  }

  private async performSave(): Promise<void> {
    const filePath = this.filePath;
    if (!filePath) return;
    const snapshot = this.content;
    const baseline = this.diskContent;
    const gen = this.loadGen;
    this.setPhase("saving");
    try {
      const external = await this.externalChangeBeforeSave(filePath, baseline);
      if (external) {
        if (external.diskContent === snapshot && external.exists !== false) {
          this.diskContent = external.diskContent;
          this.diskMtimeMs = external.diskMtimeMs;
          this.externalChange = null;
          this.setPhase(this.content === snapshot ? "clean" : "dirty");
          if (this.phase === "dirty") this.scheduleSave();
          return;
        }
        // Disk moved since this buffer last adopted a baseline. Do not overwrite
        // teammate/pull/external-editor content until the author explicitly picks
        // Reload or Keep mine in the existing external-change banner.
        this.externalChange = external;
        this.setPhase("dirty");
        this.opts.onExternalConflict?.();
        return;
      }

      const { mtimeMs } = await this.platform.writeFile(filePath, snapshot);
      this.opts.onSaved?.(filePath);
      if (this.opts.recoveryEnabled !== false) {
        api.recovery.clear(filePath).catch(() => {});
      }
      // The save may have completed after the author switched files. The old
      // file was written, but this buffer now represents another document, so
      // never stamp the old snapshot over the new file's clean baseline.
      if (this.filePath !== filePath || this.loadGen !== gen) return;
      // Only adopt the new baseline if the buffer still matches what we wrote;
      // a keystroke during the await leaves the buffer dirty for the next save.
      this.diskContent = snapshot;
      this.diskMtimeMs = mtimeMs;
      this.setPhase(this.content === snapshot ? "clean" : "dirty");
      if (this.recoveryTimer) {
        clearTimeout(this.recoveryTimer);
        this.recoveryTimer = null;
      }
      if (this.phase === "dirty") this.scheduleSave();
    } catch (e) {
      this.setPhase("error");
      this.opts.onError?.(
        `Save failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }

  /** Force any pending save to run now and await it (close/navigate flush). */
  async flush(): Promise<void> {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    // A keystroke can land while a write is in flight. Keep flushing snapshots
    // until the live buffer matches disk; the host watchdog remains the final
    // bound during quit.
    while (this.filePath && this.isDirty) {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      await this.doSave();
      if (this.externalChange) {
        throw new Error("The file changed on disk before the edit could be saved.");
      }
    }
  }

  /**
   * Reconcile a folder-change notification (#44). Re-stats + re-reads the open
   * file and applies the decision table. Returns a hint for the caller's UI.
   */
  async reconcileExternalChange(): Promise<void> {
    const filePath = this.filePath;
    if (!filePath) return;
    // Self-echo suppression (#38 cursor-jump fix): the folder watcher fires on
    // our OWN debounced disk write. The mtime guard below catches the echo once
    // doSave has recorded the post-write mtime — but the watch event can arrive
    // while a save is still pending or mid-flight, when the file on disk already
    // carries a new mtime that diskMtimeMs hasn't caught up to yet. Reconciling
    // then would read back our just-written snapshot, see it differ from the
    // still-typing buffer, and either pop a false conflict banner or auto-reload
    // the document — collapsing the caret/scroll ("editor jumps when I type").
    // Any change while a save is outstanding is definitionally our own; skip it.
    if (this.hasPendingSave) return;
    let stat: { mtimeMs: number; size: number; exists: boolean };
    try {
      stat = await this.platform.statFile(filePath);
    } catch {
      return;
    }
    if (!stat.exists) {
      if (this.isDirty) {
        this.externalChange = { diskContent: "", diskMtimeMs: 0, exists: false };
        this.opts.onExternalConflict?.();
      } else {
        this.content = "";
        this.diskContent = "";
        this.diskMtimeMs = 0;
        this.setPhase("clean");
        this.opts.onContentReplaced?.(filePath, "");
        this.opts.onAutoReloaded?.(filePath);
      }
      return;
    }
    // Our own write echo — mtime unchanged from our last known baseline.
    if (stat.mtimeMs === this.diskMtimeMs) return;
    let diskContent: string;
    try {
      diskContent = await this.platform.readFile(filePath);
    } catch {
      return;
    }
    if (diskContent === this.content) {
      // Author's edit already matches disk — just refresh the baseline.
      this.diskContent = diskContent;
      this.diskMtimeMs = stat.mtimeMs;
      this.setPhase("clean");
      return;
    }
    if (diskContent === this.diskContent) {
      // Only the mtime moved (e.g. a touch) — refresh mtime, stay as-is.
      this.diskMtimeMs = stat.mtimeMs;
      return;
    }
    if (this.isDirty) {
      // True conflict — surface the banner.
      this.externalChange = { diskContent, diskMtimeMs: stat.mtimeMs };
      this.opts.onExternalConflict?.();
    } else {
      // Safe to adopt — silently reload from disk.
      this.content = diskContent;
      this.diskContent = diskContent;
      this.diskMtimeMs = stat.mtimeMs;
      this.setPhase("clean");
      this.opts.onContentReplaced?.(filePath, diskContent);
      this.opts.onAutoReloaded?.(filePath);
    }
  }

  /** Reload: replace the buffer with the pending external disk version. */
  acceptExternal(): void {
    const ext = this.externalChange;
    if (!ext) return;
    this.content = ext.diskContent;
    this.diskContent = ext.diskContent;
    this.diskMtimeMs = ext.diskMtimeMs;
    this.setPhase("clean");
    this.externalChange = null;
    if (this.filePath) {
      // Same notification the silent auto-reload path uses (#H1) — keeps the
      // conflict-banner "Reload" action from needing its own editor-sync call.
      this.opts.onContentReplaced?.(this.filePath, ext.diskContent);
      if (this.opts.recoveryEnabled !== false) {
        api.recovery.clear(this.filePath).catch(() => {});
      }
    }
  }

  /** Keep mine: adopt the disk mtime as the new baseline so our save isn't
   * blocked, leave content untouched, and let the debounce overwrite disk. */
  keepMine(): void {
    const ext = this.externalChange;
    if (!ext) return;
    this.diskContent = ext.diskContent;
    this.diskMtimeMs = ext.diskMtimeMs;
    this.externalChange = null;
    // content stays; isDirty is recomputed against the external disk baseline.
    this.setPhase(this.isDirty ? "dirty" : "clean");
    if (this.isDirty) this.scheduleSave();
  }

  /** Drop the buffer entirely (e.g. closing a folder / switching to URL mode). */
  reset(): void {
    this.loadGen++;
    this.cancelTimers();
    this.filePath = null;
    this.content = "";
    this.diskContent = "";
    this.diskMtimeMs = 0;
    this.setPhase("clean");
    this.externalChange = null;
  }

  private cancelTimers(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  /**
   * Return the live disk version when saving would overwrite content that this
   * buffer has not adopted as its baseline. Reads the file content instead of
   * trusting mtimes alone so same-timestamp pull/checkouts are still caught.
   */
  private async externalChangeBeforeSave(
    filePath: string,
    baseline: string,
  ): Promise<ExternalChange | null> {
    const stat = await this.platform.statFile(filePath).catch(() => null);
    if (!stat?.exists) {
      return baseline === "" && this.diskMtimeMs === 0
        ? null
        : { diskContent: "", diskMtimeMs: 0, exists: false };
    }

    let diskContent: string;
    try {
      diskContent = await this.platform.readFile(filePath);
    } catch {
      return { diskContent: "", diskMtimeMs: 0, exists: false };
    }
    return diskContent === baseline
      ? null
      : { diskContent, diskMtimeMs: stat.mtimeMs };
  }
}
