import { applyEdit as applyEditPure } from "./apply-edit.ts";
import type { ApplyEditResult, DocumentSnapshot, SourceEdit } from "./contracts.ts";
import type { EditorDocumentHost } from "./hosts.ts";

export interface MemoryDocumentHostOptions {
  /** Constructs the host in readonly mode (D3/behavior table: "Readonly host"). */
  readonly readonly?: boolean;
}

/**
 * In-memory `EditorDocumentHost` (SFE-P1a). This is a TEST host, not a
 * product host: desktop and VS Code get their own `EditorDocumentHost`
 * adapters in later runs (P1c, P3c) that layer real persistence, autosave,
 * and recovery — which D7 keeps OUTSIDE `packages/editor` — on top of the
 * exact same D3 contract this class proves in isolation here.
 */
export class MemoryDocumentHost implements EditorDocumentHost {
  #snapshot: DocumentSnapshot;
  readonly #readonly: boolean;
  readonly #listeners = new Set<(snapshot: DocumentSnapshot) => void>();

  constructor(initial: DocumentSnapshot, options: MemoryDocumentHostOptions = {}) {
    this.#snapshot = initial;
    this.#readonly = options.readonly ?? false;
  }

  getSnapshot(): DocumentSnapshot {
    return this.#snapshot;
  }

  applyEdit(edit: SourceEdit): ApplyEditResult {
    const result = applyEditPure(this.#snapshot, edit, { readonly: this.#readonly });
    // Only an ACCEPTED edit changes state and notifies — a rejection must
    // never fire a listener with anything other than the truth (D3: a
    // rejected edit "changes nothing").
    if (result.ok) {
      this.#snapshot = result.snapshot;
      this.#notify();
    }
    return result;
  }

  replaceExternal(text: string): void {
    // Deliberately bypasses the readonly flag: see hosts.ts's
    // EditorDocumentHost.replaceExternal doc comment — an out-of-band
    // authoritative replacement always applies, readonly view or not.
    this.#snapshot = { text, version: this.#snapshot.version + 1 };
    this.#notify();
  }

  subscribe(listener: (snapshot: DocumentSnapshot) => void): () => void {
    this.#listeners.add(listener);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.#listeners.delete(listener);
    };
  }

  #notify(): void {
    for (const listener of this.#listeners) listener(this.#snapshot);
  }
}
