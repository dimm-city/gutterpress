/**
 * CrashRecoveryController (Phase 5 slice 2) — the single owner of the
 * crash-recovery scan/restore/discard flow (#44) that used to live inline in
 * `+page.svelte`, extracted per UX review H5 / ARCH review #10. Mirrors
 * `RecoveryUiController` (the sibling transparent-sync recovery machine) in
 * spirit, but this one drives host round-trips of its own rather than only
 * reacting to already-computed events, so — like `ProjectLifecycleController`
 * — its host coupling is injected (§8 / ADR 0004): the recovery-list/clear
 * round-trips, the sidecar file read, the buffer restore, the editor-pane
 * open, and the toast surface. `RecoveryItem` is a type-only import
 * from `CrashRecoveryDialog.svelte` (already how `+page.svelte` imports it) —
 * zero `node:*` / lib value imports.
 *
 * Preserves W4's M12 two-step-Discard / recovered-vs-on-disk-preview UI
 * (that lives in the dialog component itself, unaffected by this move) and
 * M22's routed-through-`friendlyHostError` restore-failure toast — both
 * injected here as `friendlyHostError` / `toast`.
 */

import { basenameOf } from "../platform/paths";
import type { RecoveryItem } from "../components/crash-recovery-types";

export type { RecoveryItem };

/** Minimal toast surface the controller drives. */
interface CrashRecoveryToast {
  error(message: string): void;
}

/** One pending recovery snapshot as the host reports it (pre-`fileName`). */
export interface CrashRecoveryEntry {
  filePath: string;
  recoveryPath: string;
  savedAt: number;
}

export interface CrashRecoveryDeps {
  isDesktop: () => boolean;
  /** Live `settings.current.editor.crashRecovery` toggle. */
  crashRecoveryEnabled: () => boolean;
  listRecovery: (dir: string) => Promise<CrashRecoveryEntry[]>;
  clearRecovery: (filePath: string) => Promise<unknown>;
  readRecoveryFile: (recoveryPath: string) => Promise<string>;
  /** Loads the recovered bytes into the live edit buffer (`buf.restoreContent`). */
  restoreIntoBuffer: (filePath: string, content: string) => Promise<boolean>;
  /** Explicitly reveal and focus the restored file in the editor UI. */
  showEditor: () => void;
  toast: () => CrashRecoveryToast | null;
  friendlyHostError: (message: string) => string;
}

export class CrashRecoveryController {
  /** Pending recovery entries for the open project, offered Restore/Discard per item. */
  items = $state<RecoveryItem[]>([]);

  private deps: CrashRecoveryDeps;
  /** Guards against re-scanning the same folder twice (moved verbatim). */
  private scanDir: string | null = null;
  /** Invalidates async scan/restore continuations on project teardown. */
  private generation = 0;

  constructor(deps: CrashRecoveryDeps) {
    this.deps = deps;
  }

  /**
   * After a project opens, scan for crash-recovery snapshots belonging to it
   * (an unclean exit). `scanDir` guards against re-scanning the same folder
   * twice within one open.
   */
  async scan(dir: string): Promise<void> {
    const d = this.deps;
    if (!d.isDesktop()) return;
    if (this.scanDir === dir) return;
    this.scanDir = dir;
    const generation = ++this.generation;
    this.items = [];
    if (!d.crashRecoveryEnabled()) return;
    try {
      const entries = await d.listRecovery(dir);
      if (generation !== this.generation) return;
      this.items = entries.map((e) => ({
        filePath: e.filePath,
        recoveryPath: e.recoveryPath,
        fileName: basenameOf(e.filePath),
        savedAt: e.savedAt,
      }));
    } catch {
      if (generation === this.generation) this.items = [];
    }
  }

  /**
   * Load a recovered snapshot into the editor. The recovered bytes live in
   * the sidecar snapshot (an absolute path under userData); loading them
   * against the current disk baseline marks the buffer dirty so it re-saves
   * on the next debounce, preserving the recovered edits.
   */
  async restore(item: RecoveryItem): Promise<void> {
    const d = this.deps;
    const generation = this.generation;
    const itemIndex = Math.max(0, this.items.findIndex((i) => i.filePath === item.filePath));
    this.items = this.items.filter((i) => i.filePath !== item.filePath);
    if (!d.isDesktop()) return;
    try {
      const recovered = await d.readRecoveryFile(item.recoveryPath);
      if (generation !== this.generation) return;
      const restored = await d.restoreIntoBuffer(item.filePath, recovered);
      if (!restored) {
        this.reoffer(item, itemIndex, generation);
        return;
      }
      if (generation !== this.generation) return;
      d.showEditor();
    } catch (e) {
      if (generation !== this.generation) return;
      this.reoffer(item, itemIndex, generation);
      d.toast()?.error(
        `Could not restore: ${d.friendlyHostError(e instanceof Error ? e.message : String(e))}`,
      );
    }
  }

  private reoffer(item: RecoveryItem, index: number, generation: number): void {
    if (generation !== this.generation || this.items.some((i) => i.filePath === item.filePath)) return;
    const next = [...this.items];
    next.splice(Math.min(index, next.length), 0, item);
    this.items = next;
  }

  /** Delete the recovery sidecar only — never the real file. */
  discard(item: RecoveryItem): void {
    const d = this.deps;
    this.items = this.items.filter((i) => i.filePath !== item.filePath);
    if (d.isDesktop()) {
      d.clearRecovery(item.filePath).catch(() => {});
    }
  }

  /** "Decide later" — hide the dialog without resolving any entry. */
  dismiss(): void {
    this.items = [];
  }

  /**
   * Full teardown for a project-close/reset (called from
   * `ProjectLifecycleController`'s single `resetExtras` hook, replacing the
   * hand-listed `recoveryScanDir = null; recoveryItems = [];` that used to
   * live at each of the divergent teardown sites — see H5).
   */
  reset(): void {
    this.generation++;
    this.scanDir = null;
    this.items = [];
  }
}
