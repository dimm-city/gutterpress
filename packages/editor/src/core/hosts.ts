import type { ApplyEditResult, DocumentSnapshot, SourceEdit } from "./contracts.ts";

/**
 * D7 — Document hosts, persistence, and undo.
 *
 * "`EditorDocumentHost` owns the authoritative snapshot, accepted edits,
 * external replacements, and persistence integration." Desktop and VS Code
 * each implement this over their own real persistence/undo machinery in
 * later runs (P1c, P3c); `memory-host.ts`'s `MemoryDocumentHost` is the
 * in-memory implementation this run uses to prove the contract in
 * isolation. Autosave, recovery, and filesystem-conflict handling are
 * explicitly D7 host responsibilities OUTSIDE this interface ("Autosave,
 * recovery, and filesystem conflicts remain host responsibilities, outside
 * packages/editor") — a real host wraps those concerns and calls into this
 * seam only for the four primitives below.
 */
export interface EditorDocumentHost {
  /**
   * D7: "owns the authoritative snapshot." Returns the CURRENT snapshot,
   * synchronously — there is no host that resolves this asynchronously in
   * the D3/D7 design.
   */
  getSnapshot(): DocumentSnapshot;

  /**
   * D7: "owns ... accepted edits." Applies a `SourceEdit` per the D3
   * contract's binding check order (readonly -> stale -> invalid-range;
   * see apply-edit.ts). Never throws — failures are reported through the
   * returned `ApplyEditResult`, never an exception.
   */
  applyEdit(edit: SourceEdit): ApplyEditResult;

  /**
   * D7: "owns ... external replacements." D3: "Host-originated
   * replacements include the complete authoritative snapshot." Replaces
   * the ENTIRE text with a host-originated authoritative value (a file
   * changed on disk, a VS Code `TextDocument` change event, ...),
   * incrementing the version EXACTLY ONCE and notifying subscribers with
   * the new snapshot. Unlike `applyEdit`, this does not go through
   * readonly/stale/invalid-range checks: the host itself — not an editor
   * command — is declaring the new authoritative state (D14:
   * `EDITOR_EXTERNAL_REPLACEMENT`), so it always applies, even against a
   * readonly document (a readonly view must still reflect a change made
   * outside the editor).
   */
  replaceExternal(text: string): void;

  /**
   * D3: "Hosts increment the version exactly once per accepted edit or
   * authoritative external replacement" — this is the channel subscribers
   * observe both kinds of change through. Subscribes to snapshot changes
   * (accepted edits AND external replacements alike, never rejected
   * edits). Returns an unsubscribe function; calling the returned function
   * more than once is a no-op.
   */
  subscribe(listener: (snapshot: DocumentSnapshot) => void): () => void;
}
