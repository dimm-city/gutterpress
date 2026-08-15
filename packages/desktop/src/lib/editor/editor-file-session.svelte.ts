import { EditorBuffer } from "$lib/editor/buffer-state.svelte";

export interface EditorFileSessionDeps {
  createBuffer: () => EditorBuffer;
  flush: (buffer: EditorBuffer) => Promise<boolean>;
  onActivate: (buffer: EditorBuffer) => void;
  onClear?: () => void;
  onSelectionError?: (path: string) => void;
}

/**
 * Owns the one active editor buffer and its atomic file handoffs.
 *
 * The outgoing file remains active while the incoming file reads. A handoff
 * happens only after the read and any required outgoing flush both succeed.
 */
export class EditorFileSession {
  active = $state<EditorBuffer | null>(null);

  private epoch = 0;
  /** Invalidates recovery work when a newer file choice or reset takes over. */
  private recoveryGeneration = 0;
  private restoreQueue: Promise<void> = Promise.resolve();

  constructor(private deps: EditorFileSessionDeps) {}

  ensure(): EditorBuffer {
    this.active ??= this.deps.createBuffer();
    return this.active;
  }

  isActive(buffer: EditorBuffer): boolean {
    return this.active === buffer;
  }

  async select(path: string): Promise<boolean> {
    this.recoveryGeneration++;
    const outgoing = this.ensure();
    const epoch = ++this.epoch;
    if (outgoing.filePath === path) return true;

    const incoming = this.deps.createBuffer();
    await incoming.load(path);
    if (epoch !== this.epoch || incoming.filePath !== path) return false;
    if (incoming.phase === "error") {
      this.deps.onSelectionError?.(path);
      return false;
    }
    if (outgoing.hasPendingSave && !(await this.deps.flush(outgoing))) return false;
    if (epoch !== this.epoch) return false;

    this.active = incoming;
    this.deps.onActivate(incoming);
    return true;
  }

  async ensureDefault(loadPath: () => Promise<string | null>): Promise<boolean> {
    const outgoing = this.ensure();
    if (outgoing.filePath) return true;
    const epoch = this.epoch;
    const path = await loadPath();
    if (!path || epoch !== this.epoch || this.active !== outgoing || outgoing.filePath) return false;
    return this.select(path);
  }

  /** Recovery clicks are serialized so each recovered dirty file is flushed
   * before the next recovery item can replace it. */
  restore(path: string, content: string): Promise<boolean> {
    const generation = this.recoveryGeneration;
    const run = async () => this.performRestore(path, content, generation);
    const result = this.restoreQueue.then(run, run);
    this.restoreQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  reset(): void {
    this.epoch++;
    this.recoveryGeneration++;
    this.active?.reset();
    this.active = null;
    this.deps.onClear?.();
  }

  private async performRestore(path: string, content: string, generation: number): Promise<boolean> {
    if (generation !== this.recoveryGeneration) return false;
    const outgoing = this.ensure();
    const epoch = ++this.epoch;
    if (outgoing.hasPendingSave && !(await this.deps.flush(outgoing))) return false;
    if (epoch !== this.epoch || generation !== this.recoveryGeneration) return false;

    const incoming = this.deps.createBuffer();
    await incoming.restoreContent(path, content);
    if (
      epoch !== this.epoch ||
      generation !== this.recoveryGeneration ||
      incoming.filePath !== path
    ) {
      // restoreContent schedules autosave before it resolves. A stale incoming
      // buffer must be reset so an orphan timer cannot write after cancellation.
      incoming.reset();
      return false;
    }
    this.active = incoming;
    this.deps.onActivate(incoming);
    return true;
  }
}
