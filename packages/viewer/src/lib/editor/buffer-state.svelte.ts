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

export type EditorBufferPhase = "clean" | "dirty" | "saving" | "error";

/** Pending external-edit details awaiting the user's Reload / Keep-mine call. */
export interface ExternalChange {
  diskContent: string;
  diskMtimeMs: number;
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
  isDirty = $derived(this.content !== this.diskContent);
  hasPendingSave = $derived(this.phase === "dirty" || this.phase === "saving");

  private opts: EditorBufferOptions;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: EditorBufferOptions) {
    this.opts = opts;
  }

  private get platform(): Platform {
    return this.opts.platform;
  }

  /** Toggle crash-recovery snapshotting at runtime (#45 setting). */
  setRecoveryEnabled(enabled: boolean): void {
    this.opts.recoveryEnabled = enabled;
    if (!enabled && this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  /** Load a file from disk into the buffer, clearing any prior pending state. */
  async load(filePath: string): Promise<void> {
    this.cancelTimers();
    this.filePath = filePath;
    this.externalChange = null;
    try {
      const text = await this.platform.readFile(filePath);
      const st = await this.platform.statFile(filePath).catch(() => null);
      this.content = text;
      this.diskContent = text;
      this.diskMtimeMs = st?.mtimeMs ?? 0;
      this.phase = "clean";
    } catch (e) {
      this.content = "";
      this.diskContent = "";
      this.diskMtimeMs = 0;
      this.phase = "error";
      this.opts.onError?.(
        `Could not open file: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Load recovered content (from a crash-recovery snapshot) for `filePath`.
   * Marks the buffer dirty against the current disk baseline so it saves on the
   * next debounce.
   */
  async restoreContent(filePath: string, recovered: string): Promise<void> {
    this.cancelTimers();
    this.filePath = filePath;
    this.externalChange = null;
    const st = await this.platform.statFile(filePath).catch(() => null);
    // The disk baseline is whatever is currently on disk; recovered content is
    // the (dirtier) in-memory version we want to keep.
    try {
      this.diskContent = await this.platform.readFile(filePath);
    } catch {
      this.diskContent = "";
    }
    this.diskMtimeMs = st?.mtimeMs ?? 0;
    this.content = recovered;
    this.phase = this.isDirty ? "dirty" : "clean";
    if (this.isDirty) this.scheduleSave();
  }

  /** Record a user edit; schedules the debounced disk save + recovery snapshot. */
  edit(text: string): void {
    this.content = text;
    if (!this.filePath) return;
    this.phase = this.isDirty ? "dirty" : "clean";
    if (this.isDirty) {
      this.scheduleSave();
      this.scheduleRecovery();
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.doSave();
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
    if (!filePath || this.opts.recoveryEnabled === false) return;
    try {
      await this.platform.writeRecovery(filePath, this.content, this.diskMtimeMs);
    } catch {
      // Recovery is best-effort; never surface as a hard error.
    }
  }

  private async doSave(): Promise<void> {
    const filePath = this.filePath;
    if (!filePath) return;
    const snapshot = this.content;
    this.phase = "saving";
    try {
      const { mtimeMs } = await this.platform.writeFile(filePath, snapshot);
      // Only adopt the new baseline if the buffer still matches what we wrote;
      // a keystroke during the await leaves the buffer dirty for the next save.
      this.diskContent = snapshot;
      this.diskMtimeMs = mtimeMs;
      this.phase = this.content === snapshot ? "clean" : "dirty";
      // A successful disk save clears the crash-recovery sidecar.
      if (this.opts.recoveryEnabled !== false) {
        this.platform.clearRecovery(filePath).catch(() => {});
      }
      this.opts.onSaved?.(filePath);
      if (this.phase === "dirty") this.scheduleSave();
    } catch (e) {
      this.phase = "error";
      this.opts.onError?.(
        `Save failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Force any pending save to run now and await it (close/navigate flush). */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    if (this.filePath && this.isDirty) {
      await this.doSave();
    }
  }

  /**
   * Reconcile a folder-change notification (#44). Re-stats + re-reads the open
   * file and applies the decision table. Returns a hint for the caller's UI.
   */
  async reconcileExternalChange(): Promise<void> {
    const filePath = this.filePath;
    if (!filePath) return;
    let stat: { mtimeMs: number; size: number; exists: boolean };
    try {
      stat = await this.platform.statFile(filePath);
    } catch {
      return;
    }
    if (!stat.exists) return; // file removed; nothing to reconcile here
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
      this.phase = "clean";
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
      this.phase = "clean";
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
    this.phase = "clean";
    this.externalChange = null;
    if (this.filePath && this.opts.recoveryEnabled !== false) {
      this.platform.clearRecovery(this.filePath).catch(() => {});
    }
  }

  /** Keep mine: adopt the disk mtime as the new baseline so our save isn't
   * blocked, leave content untouched, and let the debounce overwrite disk. */
  keepMine(): void {
    const ext = this.externalChange;
    if (!ext) return;
    this.diskMtimeMs = ext.diskMtimeMs;
    this.externalChange = null;
    // content stays; isDirty is recomputed against the unchanged diskContent.
    this.phase = this.isDirty ? "dirty" : "clean";
    if (this.isDirty) this.scheduleSave();
  }

  /** Drop the buffer entirely (e.g. closing a folder / switching to URL mode). */
  reset(): void {
    this.cancelTimers();
    this.filePath = null;
    this.content = "";
    this.diskContent = "";
    this.diskMtimeMs = 0;
    this.phase = "clean";
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
}
