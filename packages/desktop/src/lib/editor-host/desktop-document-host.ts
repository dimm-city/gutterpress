/**
 * `DesktopDocumentHost` — the desktop `EditorDocumentHost` adapter
 * (SFE-P1c, Lane B).
 *
 * Wraps a `DocumentSession` (`../document-session/session.ts`, Lane A's pure
 * phase/conflict/baseline state machine) behind the shared
 * `EditorDocumentHost` contract (`@dimm-city/gutterpress-editor`, D3/D7), so
 * a future editor mount can hold ONE `EditorDocumentHost` reference and work
 * identically whether it is backed by the in-memory test host
 * (`MemoryDocumentHost`) or this desktop adapter — proven by running the
 * SAME shared contract suite (`runDocumentHostContractTests`) against both
 * (`packages/editor/tests/core/contract-tests.test.ts` and this package's
 * own `tests/editor/desktop-document-host.test.ts`).
 *
 * ## What this class is NOT
 *
 * It does not replace, wrap, or get consumed by `EditorBuffer`
 * (`../editor/buffer-state.svelte.ts`) in this run. `EditorBuffer` delegates
 * its OWN phase logic directly to its own private `DocumentSession`
 * instance (Lane C's thinning work) and keeps owning its real debounce
 * timers, `loadGen` generation counter, and platform I/O exactly as before
 * — none of that is this class's concern. `DesktopDocumentHost` is a
 * SEPARATE, standalone adapter: the D7 seam a future rich/source editor
 * mount binds to, proven correct in isolation here. Wiring it into
 * `EditorBuffer`'s real file-I/O pipeline is out of this run's scope.
 *
 * ## Design — D4 (no service locator), D7 (host owns persistence intent)
 *
 * The constructor takes only explicit values and callbacks (no
 * `getPlatform()`, no ambient lookup):
 *
 *   - `initialText` / `documentId` / `diskStamp` seed the wrapped session
 *     via `DocumentSession.open` (mirrors what `EditorBuffer.load`'s
 *     success path does), so `getSnapshot()` starts at `{ text:
 *     initialText, version: 0 }` — matching what constructing a fresh
 *     `MemoryDocumentHost({ text: initialText, version: 0 })` means for the
 *     shared contract suite (`DocumentHostFactory` — always version 0 at
 *     construction).
 *   - `readonly` gates `applyEdit` exactly like `MemoryDocumentHost`'s own
 *     constructor option (D3 binding order: readonly -> stale ->
 *     invalid-range), delegated to the SAME `applyEdit`/validate logic the
 *     memory host uses (imported, not reimplemented), so verdicts are
 *     byte-identical.
 *   - `onScheduleSave` / `onScheduleRecovery` mirror the INTENT signal
 *     `EditorBuffer` itself reacts to today (`if (outcome.scheduleSave)
 *     this.scheduleSave()` — see that class's `edit`/`restore`/
 *     `completeSave`/`keepMine`): this class surfaces the identical boolean
 *     intents from every `DocumentSession` outcome as callback invocations
 *     instead of owning a timer directly. D7 keeps autosave/recovery
 *     debounce timers a HOST responsibility outside `packages/editor`; this
 *     adapter stays timer-free itself and hands the intent outward,
 *     exactly like the pure session it wraps hands the intent to
 *     `EditorBuffer` today.
 *   - `nextDiskStamp` lets a real integration supply monotonic stamps (a
 *     file's mtime, a sync revision, ...) for `replaceExternal`, whose D3
 *     signature (`replaceExternal(text: string): void`) carries no stamp of
 *     its own; it defaults to an internal monotonic counter, since
 *     `DiskBaseline.stamp` is deliberately opaque and never compared by the
 *     session (see session.ts's own header).
 *
 * ## `replaceExternal` — D3: unconditional, version +1 exactly once, WHILE A DOCUMENT IS OPEN
 *
 * `EditorDocumentHost.replaceExternal`'s contract (hosts.ts) is
 * unconditional: "always applies, even against a readonly document",
 * incrementing the version EXACTLY ONCE and notifying subscribers —
 * regardless of whether the incoming text happens to match what is already
 * live. `DocumentSession.noteExternalCheck` — the session's own external-
 * change entry point — is a RICHER, conflict-aware reconciliation built for
 * folder-change notifications, and (correctly, for THAT purpose) treats a
 * byte-identical or "bare touch" change as a no-op that does not bump
 * version. Adapting the simpler, unconditional D3 primitive on top of that
 * richer machinery therefore takes two steps in EVERY branch that has an
 * open document to replace, not a direct pass-through:
 *
 *   1. Feed the replacement through `noteExternalCheck` so the disk
 *      baseline converges on the new text/stamp using the session's own
 *      documented branch logic.
 *   2. If that call surfaced a conflict (the session was dirty against
 *      unrelated local edits), force-adopt it via `acceptExternal` — an
 *      authoritative replacement has no conflict concept of its own, unlike
 *      folder-change reconciliation. If instead the session treated the
 *      call as an already-converged no-op (byte-identical text, or a bare
 *      stamp touch — neither of which bump version), force the version
 *      bump explicitly via one more `session.edit` call against the
 *      now-matching baseline, so the exactly-once-per-call invariant holds
 *      unconditionally, matching `MemoryDocumentHost.replaceExternal`.
 *
 * Every branch above bumps the session version by EXACTLY one net increment
 * — never zero, never two — see the inline comments on `replaceExternal`
 * below for the branch-by-branch accounting.
 *
 * ONE branch is not covered by that accounting: no document open at all
 * (`documentId === null`, e.g. right after {@link reset}). D3's "always
 * applies" guarantee describes replacing an OPEN document's authoritative
 * text; it presumes an identity to replace onto, which `replaceExternal`'s
 * own signature (`text` only, no `documentId`) cannot supply on its own. A
 * CONFIRMED review finding (SFE-P1c round 1) found this branch previously
 * fell through to `noteExternalCheck`'s own `documentId === null` guard
 * (`session.ts`), which returns a no-op WITHOUT touching `_diskText` —
 * followed by the "already-converged no-op" fallback's `session.edit`
 * call, which ALSO no-ops on the same null-`documentId` check — leaving
 * the session `phase: "clean"` while `isDirty` was `true` (`_text` had
 * changed, `_diskText` had not), breaking the load-bearing "clean implies
 * not dirty" invariant `session.ts` documents. `replaceExternal` now
 * guards this branch explicitly as a no-op — see below.
 *
 * ## Notification — "did the snapshot actually change?"
 *
 * Every session-mutating method here (the four `EditorDocumentHost`
 * members and the desktop-only extras below) is routed through
 * {@link withSessionMutation}, which compares `getSnapshot()` before and
 * after the call and notifies subscribers if and only if `text` or
 * `version` actually changed. This is provably correct against D3's
 * subscribe contract ("Subscribes to snapshot changes ... never rejected
 * edits") without hand-tracking which of `DocumentSession`'s many branches
 * happen to call `replaceText` internally.
 */
import { DocumentSession } from "../document-session/session";
import type {
  AcceptExternalOutcome,
  BeginSaveOutcome,
  CompleteSaveOutcome,
  DiskBaseline,
  DocumentSessionPhase,
  ExternalCheckOutcome,
  ExternalCheckResult,
  KeepMineOutcome,
  OpenOutcome,
  PendingExternalChange,
  ResetOutcome,
  RestoreOutcome,
  SaveResult,
} from "../document-session/session";
import { applyEdit as applyEditPure } from "@dimm-city/gutterpress-editor";
import type { ApplyEditResult, DocumentSnapshot, EditorDocumentHost, SourceEdit } from "@dimm-city/gutterpress-editor";

export interface DesktopDocumentHostOptions {
  /** Identity fed to `DocumentSession.open` on construction. Defaults to `"document"`. */
  readonly documentId?: string;
  /** Disk stamp fed to `DocumentSession.open` on construction. Opaque — never compared. */
  readonly diskStamp?: unknown;
  /** Construct the host in readonly mode (matches `MemoryDocumentHostOptions.readonly`). */
  readonly readonly?: boolean;
  /** Invoked whenever a session outcome's `scheduleSave` intent is `true`. */
  readonly onScheduleSave?: () => void;
  /** Invoked whenever a session outcome's `scheduleRecovery` intent is `true`. */
  readonly onScheduleRecovery?: () => void;
  /** Supplies the opaque disk stamp `replaceExternal` feeds the session. Defaults to an internal monotonic counter. */
  readonly nextDiskStamp?: () => unknown;
}

/**
 * The desktop `EditorDocumentHost` adapter. Implements the four D3/D7
 * members plus a handful of desktop-only pass-throughs to the wrapped
 * `DocumentSession` (`open`, `beginSave`, `completeSave`,
 * `noteExternalCheck`, `acceptExternal`, `keepMine`, `reset`, and read-only
 * `phase`/`documentId`/`diskBaseline`/`externalChange`/`isDirty`/
 * `hasPendingSave`/`isSaving` getters) — the "extra behaviors" the shared
 * contract suite's `DocumentHostFactory` type is deliberately written to
 * tolerate (return-type covariance: a factory returning this richer type
 * satisfies a parameter typed as the plain `EditorDocumentHost` interface).
 * The shared suite exercises only the four `EditorDocumentHost` members;
 * this package's own test file exercises the extras directly for the
 * desktop-specific phase-interaction cases the run specification calls for.
 */
export class DesktopDocumentHost implements EditorDocumentHost {
  readonly #session: DocumentSession;
  readonly #readonly: boolean;
  readonly #onScheduleSave: (() => void) | undefined;
  readonly #onScheduleRecovery: (() => void) | undefined;
  readonly #nextDiskStamp: () => unknown;
  readonly #listeners = new Set<(snapshot: DocumentSnapshot) => void>();
  #externalStampCounter = 0;

  constructor(initialText: string, options: DesktopDocumentHostOptions = {}) {
    this.#session = new DocumentSession();
    this.#session.open(options.documentId ?? "document", initialText, options.diskStamp);
    this.#readonly = options.readonly ?? false;
    this.#onScheduleSave = options.onScheduleSave;
    this.#onScheduleRecovery = options.onScheduleRecovery;
    this.#nextDiskStamp = options.nextDiskStamp ?? (() => ++this.#externalStampCounter);
  }

  // ── EditorDocumentHost (D3/D7) ──────────────────────────────────────────

  getSnapshot(): DocumentSnapshot {
    return this.#session.snapshot;
  }

  applyEdit(edit: SourceEdit): ApplyEditResult {
    return this.#withSessionMutation(() => {
      const result = applyEditPure(this.getSnapshot(), edit, { readonly: this.#readonly });
      if (result.ok) {
        this.#forwardScheduling(this.#session.edit(result.snapshot.text));
      }
      return result;
    });
  }

  replaceExternal(text: string): void {
    this.#withSessionMutation(() => {
      if (this.#session.documentId === null) {
        // No document is open (e.g. right after reset()) — there is no
        // identity for this text-only replacement to apply onto, and
        // replaceExternal's D3 signature carries no documentId of its own
        // to establish one. Treat this as a no-op rather than falling
        // through to noteExternalCheck/edit's own null-documentId guards,
        // which used to leave the session reporting phase "clean" while
        // isDirty was true — a CONFIRMED review finding (see this file's
        // header). A caller that wants to adopt externally-supplied text
        // with no prior identity should call open()/restore() instead,
        // which take an explicit documentId.
        return;
      }
      const stamp = this.#nextDiskStamp();
      const outcome = this.#session.noteExternalCheck({ kind: "changed", diskText: text, diskStamp: stamp });
      if (outcome.conflict) {
        // Net +1: noteExternalCheck's conflict branch does not bump version
        // (it only records the pending change); acceptExternal bumps it
        // once, adopting exactly the text/stamp just fed in above.
        this.#session.acceptExternal();
        return;
      }
      if (!outcome.replaced) {
        // Net +1: noteExternalCheck's no-op branches ("diskText already
        // matches the live text" / "bare stamp touch") do not call
        // replaceText, by design, as a folder-change-reconciliation
        // optimization. D3's replaceExternal has no such optimization — it
        // is unconditional — so force the version bump explicitly. Because
        // diskText now already equals `text` (set by the call above, in
        // every branch reachable past the documentId guard above), this
        // edit's own dirty check always lands `false`, so phase is always
        // recomputed to "clean" — correct: an authoritative replacement
        // can never leave the document "dirty" against itself.
        this.#forwardScheduling(this.#session.edit(text));
        return;
      }
      // outcome.replaced === true: the session's own "silently adopts"
      // branch already called replaceText once — net +1, nothing further
      // to do.
    });
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

  // ── Desktop-only extras: thin pass-throughs to the wrapped session ─────

  get phase(): DocumentSessionPhase {
    return this.#session.phase;
  }

  get documentId(): string | null {
    return this.#session.documentId;
  }

  get diskBaseline(): DiskBaseline {
    return this.#session.diskBaseline;
  }

  get externalChange(): PendingExternalChange | null {
    return this.#session.externalChange;
  }

  get isDirty(): boolean {
    return this.#session.isDirty;
  }

  get hasPendingSave(): boolean {
    return this.#session.hasPendingSave;
  }

  get isSaving(): boolean {
    return this.#session.isSaving;
  }

  /** Re-identifies this host onto a different document (mirrors `EditorBuffer.load`'s success path). */
  open(documentId: string, text: string, diskStamp: unknown): OpenOutcome {
    return this.#withSessionMutation(() => this.#session.open(documentId, text, diskStamp));
  }

  /** Begins a save attempt; see `DocumentSession.beginSave`. Does not itself change text/version, so never notifies. */
  beginSave(): BeginSaveOutcome | null {
    return this.#session.beginSave();
  }

  /** Resolves a save attempt begun by {@link beginSave}; see `DocumentSession.completeSave`. */
  completeSave(result: SaveResult): CompleteSaveOutcome {
    return this.#withSessionMutation(() => {
      const outcome = this.#session.completeSave(result);
      this.#forwardScheduling(outcome);
      return outcome;
    });
  }

  /** Reconciles a folder-change notification; see `DocumentSession.noteExternalCheck`. */
  noteExternalCheck(result: ExternalCheckResult): ExternalCheckOutcome {
    return this.#withSessionMutation(() => this.#session.noteExternalCheck(result));
  }

  /** Reload: adopts the pending external disk version; see `DocumentSession.acceptExternal`. */
  acceptExternal(): AcceptExternalOutcome {
    return this.#withSessionMutation(() => this.#session.acceptExternal());
  }

  /** Keep mine: adopts the disk stamp as the new save baseline; see `DocumentSession.keepMine`. */
  keepMine(): KeepMineOutcome {
    return this.#withSessionMutation(() => {
      const outcome = this.#session.keepMine();
      this.#forwardScheduling(outcome);
      return outcome;
    });
  }

  /** A crash-recovery restore; see `DocumentSession.restore`. */
  restore(documentId: string, recoveredText: string, diskBaseline: DiskBaseline): RestoreOutcome {
    return this.#withSessionMutation(() => {
      const outcome = this.#session.restore(documentId, recoveredText, diskBaseline);
      this.#forwardScheduling(outcome);
      return outcome;
    });
  }

  /** Drops the document entirely; see `DocumentSession.reset`. */
  reset(): ResetOutcome {
    return this.#withSessionMutation(() => this.#session.reset());
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  /**
   * Runs `mutate`, then notifies subscribers if and only if the session's
   * observable `{ text, version }` snapshot actually changed across the
   * call — see this file's header for why this is the correct, provably-
   * exhaustive way to decide when to notify, instead of hand-tracking which
   * branch of each `DocumentSession` method calls `replaceText`/
   * `resetDocument` internally.
   */
  #withSessionMutation<T>(mutate: () => T): T {
    const before = this.getSnapshot();
    const outcome = mutate();
    const after = this.getSnapshot();
    if (after.text !== before.text || after.version !== before.version) {
      this.#notify(after);
    }
    return outcome;
  }

  /** Forwards a session outcome's `scheduleSave`/`scheduleRecovery` intents to the injected callbacks, if present. */
  #forwardScheduling(outcome: { readonly scheduleSave?: boolean; readonly scheduleRecovery?: boolean }): void {
    if (outcome.scheduleSave) this.#onScheduleSave?.();
    if (outcome.scheduleRecovery) this.#onScheduleRecovery?.();
  }

  #notify(snapshot: DocumentSnapshot): void {
    for (const listener of this.#listeners) listener(snapshot);
  }
}
