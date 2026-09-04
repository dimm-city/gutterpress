/**
 * `DocumentSession` — the pure state-machine core of the desktop editor's
 * edit lifecycle (SFE-P1c, Lane A).
 *
 * This is a mechanical extraction of the PHASE-TRANSITION DECISION LOGIC
 * embedded in `../editor/buffer-state.svelte.ts` (`EditorBuffer`). It is
 * deliberately:
 *
 *   - **Framework-free**: no `$state`, no Svelte import, no `.svelte.ts`.
 *   - **I/O-free**: no `fs`/`node:*`/platform/`fetch` calls. Every fact this
 *     class needs about the outside world (a file's bytes, a disk stat, a
 *     save's outcome) is handed in as a plain argument by the caller; the
 *     class never reaches out to get it.
 *   - **Timer-free**: no `setTimeout`/debounce. `EditorBuffer` owns the
 *     500 ms autosave debounce and the 1000 ms recovery-snapshot debounce
 *     (CLAUDE.md §1's `node:http`/`ws` preview server rule is the sibling
 *     example of "timers live in the host, not the pure core"). Each method
 *     here that would have scheduled a timer instead returns a small
 *     `scheduleSave`/`scheduleRecovery` boolean in its outcome so the host
 *     can decide *how* to schedule (debounce ms, cancellation, coalescing)
 *     without this class knowing timers exist.
 *
 * `EditorBuffer` (`../editor/buffer-state.svelte.ts`) delegates its phase/
 * conflict/baseline logic directly to a private instance of this class —
 * see that file's "Delegation to `DocumentSession`" header section for the
 * wiring. This module remains standalone and framework-free regardless, so
 * it stays unit-testable exhaustively without the `$state` shim.
 *
 * ## Vocabulary alignment (D1/D2/D3)
 *
 * `snapshot: { text, version }` intentionally has the exact shape of
 * `@dimm-city/gutterpress-editor`'s `DocumentSnapshot`
 * (`packages/editor/src/core/contracts.ts`) and this class's version
 * semantics intentionally match that package's `applyEdit`/`MemoryDocumentHost`
 * behavior: **version increments by exactly one on every accepted edit or
 * authoritative external replacement of the document's text — unconditionally,
 * not gated on whether the replacement text is byte-different from what it
 * replaces** (mirroring `applyEdit`'s unconditional `version: currentVersion + 1`
 * and `MemoryDocumentHost.replaceExternal`'s unconditional bump). This file
 * does NOT import from `packages/editor` — the shapes below are this
 * module's own minimal types, kept structurally compatible by convention.
 *
 * `EditorBuffer` has no `version` field today (it tracks dirtiness purely by
 * `content !== diskContent` string comparison). Introducing `version` here is
 * this run's contribution toward D2, layered on top of — not replacing — the
 * exact `phase` semantics `buffer-state.test.ts` already pins. Four operations
 * are new-document-identity events rather than in-place edits —
 * {@link DocumentSession.open}, {@link DocumentSession.openFailed}, and
 * {@link DocumentSession.restore} (opening/recovering a — possibly different —
 * file into this reused session instance), and {@link DocumentSession.reset}
 * (closing the document entirely). **Unlike an earlier version of this file,
 * none of the four reset `version` back to `0`.** `version` is strictly
 * monotonic for the lifetime of one `DocumentSession` instance, including
 * across identity changes — see {@link resetDocument}'s header for why a
 * reset-to-0 was a CONFIRMED review defect (a stale `SourceEdit` captured
 * against one document could validate against a later, unrelated one that
 * happened to land on the same reset value). Everything else that changes
 * `text` while a document stays open increments `version` by exactly one.
 *
 * ## What stays out of this file (by design, per the run spec)
 *
 *   - Debounce timers, timer cancellation, and delay configuration
 *     (`setSaveDelayMs`/`setRecoveryEnabled` in `EditorBuffer`).
 *   - Any generation-counter / stale-async-result suppression (`loadGen` in
 *     `EditorBuffer`). That is exclusively about discarding a superseded
 *     `Promise` result when the user switches files mid-I/O — a concern of
 *     *sequencing async host calls*, not of the phase machine itself. The
 *     contract this class relies on: **the host only calls a `complete*`/
 *     `note*` method with a result that is still relevant** (i.e. the host
 *     has already applied its own "is this the file I'm currently open on"
 *     check before calling in). `EditorBuffer`'s `loadGen` mechanism is
 *     exactly that check, and it stays there.
 *   - The `saveInFlight` promise-cache in `EditorBuffer.doSave` (avoiding two
 *     concurrent `performSave` calls) — pure async-orchestration bookkeeping,
 *     not a phase decision. Callers of {@link DocumentSession.beginSave} are
 *     expected not to call it again before the matching
 *     {@link DocumentSession.completeSave}.
 *   - The self-write-echo short-circuit
 *     (`stat.mtimeMs === this.diskMtimeMs` in
 *     `EditorBuffer.reconcileExternalChange`, skipping a redundant disk
 *     read). This is an I/O-avoidance optimization the host performs BEFORE
 *     ever calling {@link DocumentSession.noteExternalCheck} — comparing a
 *     freshly-stat'd mtime against `session.diskBaseline.stamp` needs no
 *     help from this class.
 *   - The `hasPendingSave` self-echo guard itself
 *     (`if (this.hasPendingSave) return;`, the very first line of
 *     `EditorBuffer.reconcileExternalChange`, run before ANY I/O). This is
 *     exposed as the `hasPendingSave` getter for the host to check BEFORE it
 *     starts its stat/read I/O and BEFORE it calls
 *     {@link DocumentSession.noteExternalCheck} at all, not re-derived
 *     inside that method. Baking the guard into `noteExternalCheck` itself
 *     would be self-defeating: `isDirty` can never be `true` without
 *     `hasPendingSave` also being `true` (phase `"clean"` implies
 *     `isDirty === false` by construction — every method that changes
 *     `text` recomputes `phase` from `isDirty` in the same call), so an
 *     internal guard would make `noteExternalCheck`'s own dirty/conflict
 *     branches permanently unreachable through its own public surface — the
 *     same trap the generation-counter and mtime-echo checks above avoid by
 *     staying in the host.
 */

/** The four phases `EditorBuffer` has pinned since #44 (unchanged here). */
export type DocumentSessionPhase = "clean" | "dirty" | "saving" | "error";

/** D2/D3-shaped snapshot: exact text plus a monotonic version. */
export interface DocumentSnapshot {
  readonly text: string;
  readonly version: number;
}

/**
 * The last known-good disk baseline. `stamp` is deliberately opaque
 * (`unknown`) — the pure session never compares or interprets it, only
 * carries it forward; the desktop host's stamp is a filesystem `mtimeMs`
 * (`number`), but nothing here assumes that.
 */
export interface DiskBaseline {
  readonly text: string;
  readonly stamp: unknown;
}

/** A detected-but-unresolved external change, awaiting Reload / Keep mine. */
export interface PendingExternalChange {
  readonly diskText: string;
  readonly diskStamp: unknown;
  /** `false` when the external change was a deletion. Omitted for edits. */
  readonly exists?: false;
}

export interface OpenOutcome {
  readonly phase: DocumentSessionPhase;
}

export interface EditOutcome {
  readonly phase: DocumentSessionPhase;
  readonly scheduleSave: boolean;
  readonly scheduleRecovery: boolean;
}

export interface RestoreOutcome {
  readonly phase: DocumentSessionPhase;
  readonly scheduleSave: boolean;
}

export interface BeginSaveOutcome {
  /** The exact text to persist — captured now, frozen against later edits. */
  readonly text: string;
  /** The baseline to compare a pre-write disk read against for conflicts. */
  readonly diskBaseline: DiskBaseline;
}

/**
 * What the host's own I/O determined about a save attempt, fed back in one
 * call once every host-side step (conflict check, then write) is settled.
 */
export type SaveResult =
  | { readonly kind: "written"; readonly diskStamp: unknown }
  | { readonly kind: "external-matches"; readonly diskStamp: unknown }
  | {
      readonly kind: "external-conflict";
      readonly diskText: string;
      readonly diskStamp: unknown;
      readonly exists?: false;
    }
  | { readonly kind: "failed" };

export interface CompleteSaveOutcome {
  readonly phase: DocumentSessionPhase;
  readonly scheduleSave: boolean;
  /** True only on a real write success (mirrors the recovery-timer clear in `performSave`). */
  readonly cancelRecoveryTimer: boolean;
  readonly conflict: boolean;
}

/** What the host's stat (+ read, if warranted) found on disk. */
export type ExternalCheckResult =
  | { readonly kind: "deleted" }
  | { readonly kind: "changed"; readonly diskText: string; readonly diskStamp: unknown };

export interface ExternalCheckOutcome {
  readonly phase: DocumentSessionPhase;
  /** True when `snapshot.text` was silently replaced from disk (fire onContentReplaced + onAutoReloaded). */
  readonly replaced: boolean;
  /** True when the change is now surfaced as a conflict (fire onExternalConflict). */
  readonly conflict: boolean;
}

export interface AcceptExternalOutcome {
  readonly phase: DocumentSessionPhase;
  /** False only when there was no pending external change to accept. */
  readonly replaced: boolean;
}

export interface KeepMineOutcome {
  readonly phase: DocumentSessionPhase;
  readonly scheduleSave: boolean;
}

export interface ResetOutcome {
  readonly phase: DocumentSessionPhase;
}

export class DocumentSession {
  private _phase: DocumentSessionPhase = "clean";
  private _documentId: string | null = null;
  private _text = "";
  private _version = 0;
  /**
   * `false` only until the FIRST identity-establishing call
   * (open/openFailed/restore/reset, via {@link resetDocument}) on this
   * instance. That first call leaves `_version` at its field default (`0`)
   * — matching what constructing a fresh host is documented to mean for
   * the shared D3 contract suite (`DocumentHostFactory`: "always version 0
   * at construction") — and flips this flag so every identity-establishing
   * call AFTER that increments `_version` instead; see
   * {@link resetDocument}'s header for why it must never jump back to `0`
   * once a document has been open.
   */
  #everOpened = false;
  private _diskText = "";
  private _diskStamp: unknown = undefined;
  private _externalChange: PendingExternalChange | null = null;
  /** Text captured by {@link beginSave}; `null` iff no save is in progress. */
  private _savingText: string | null = null;

  // ── Derived state ───────────────────────────────────────────────────────

  get phase(): DocumentSessionPhase {
    return this._phase;
  }

  get documentId(): string | null {
    return this._documentId;
  }

  get snapshot(): DocumentSnapshot {
    return { text: this._text, version: this._version };
  }

  get diskBaseline(): DiskBaseline {
    return { text: this._diskText, stamp: this._diskStamp };
  }

  get externalChange(): PendingExternalChange | null {
    return this._externalChange;
  }

  /**
   * Mirrors `EditorBuffer.isDirty`: does the live text differ from the known
   * disk baseline?
   *
   * Invariant every method above maintains: `phase === "clean"` implies
   * `isDirty === false`. Every place `text` or `diskBaseline` changes also
   * recomputes `phase` from `isDirty` in that same call (`edit`,
   * `completeSave`, `noteExternalCheck`'s replace branches, `acceptExternal`,
   * `keepMine`), so `isDirty` can never be `true` while `phase` is `"clean"`,
   * and therefore `isDirty === true` always implies `hasPendingSave === true`
   * (phase is one of `"dirty"` / `"saving"` / `"error"`-while-dirty).
   * `noteExternalCheck`'s doc comment relies on this invariant to explain why
   * its dirty/conflict branches must not be gated by an internal
   * `hasPendingSave` check.
   */
  get isDirty(): boolean {
    return this._text !== this._diskText;
  }

  /** Mirrors `EditorBuffer.hasPendingSave` exactly. */
  get hasPendingSave(): boolean {
    return (
      this._phase === "dirty" ||
      this._phase === "saving" ||
      (this._phase === "error" && this.isDirty)
    );
  }

  /** True while a {@link beginSave} is awaiting its matching {@link completeSave}. */
  get isSaving(): boolean {
    return this._savingText !== null;
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  private setPhase(next: DocumentSessionPhase): void {
    this._phase = next;
  }

  /** An accepted edit or authoritative external replacement of the text (unconditional +1 — see header). */
  private replaceText(next: string): void {
    this._text = next;
    this._version += 1;
  }

  /**
   * A new document identity in this (possibly reused) instance — open,
   * openFailed, restore, or reset. `_version` is STRICTLY MONOTONIC for the
   * lifetime of one `DocumentSession` instance, INCLUDING across identity
   * changes: it always increments from wherever it currently is and never
   * jumps back to `0` once a document has been open.
   *
   * Resetting to `0` on every identity change was a CONFIRMED review defect
   * (SFE-P1c round 1): a `SourceEdit` captured against a version this
   * instance had already used for a PRIOR document could then validate
   * against a DIFFERENT, later document that happened to land on that same
   * reset value — because every re-open reset to exactly `0` regardless of
   * what had come before. `DesktopDocumentHost.open()` re-identifies a
   * LIVE, reused host onto a different document (see that file's header),
   * so the collision was directly reachable there; a fresh
   * `MemoryDocumentHost` is a fresh OBJECT no stale reference can name, but
   * rewinding the counter on a REUSED object is not the same safe case.
   *
   * The one case that still lands on `0`: {@link #everOpened} is `false`
   * only before the FIRST identity-establishing call on a freshly
   * constructed instance, so that call leaves `_version` at its field
   * default (`0`) — matching what constructing a fresh host is documented
   * to mean for the shared D3 contract suite.
   */
  private resetDocument(documentId: string | null, text: string): void {
    this._documentId = documentId;
    this._text = text;
    if (this.#everOpened) {
      this._version += 1;
    } else {
      this.#everOpened = true;
    }
    this._externalChange = null;
    this._savingText = null;
  }

  // ── Open / restore / close ──────────────────────────────────────────────

  /**
   * A successful load (`EditorBuffer.load`'s try branch): the loaded text
   * becomes both the live text and the disk baseline, so the document opens
   * clean by construction.
   */
  open(documentId: string, text: string, diskStamp: unknown): OpenOutcome {
    this.resetDocument(documentId, text);
    this._diskText = text;
    this._diskStamp = diskStamp;
    this.setPhase("clean");
    return { phase: this._phase };
  }

  /** A failed load (`EditorBuffer.load`'s catch branch). */
  openFailed(documentId: string): OpenOutcome {
    this.resetDocument(documentId, "");
    this._diskText = "";
    this._diskStamp = undefined;
    this.setPhase("error");
    return { phase: this._phase };
  }

  /**
   * Phase 1 of a crash-recovery restore (`EditorBuffer.restoreContent`'s
   * entry point, called BEFORE any host I/O runs): establishes the new
   * document identity and its recovered text SYNCHRONOUSLY.
   *
   * This is what makes a concurrent `flush()`/`performSave()` call
   * reachable during `restoreContent`'s `await` window operate against a
   * SINGLE, self-consistent identity+text pair instead of a stale
   * document's identity paired with a new document's text (or vice versa)
   * — a CONFIRMED review defect (SFE-P1c round 1): the host used to write
   * its own `filePath`/`content` fields directly here, ahead of this
   * class, so a save that ran mid-await could read the NEW file's path
   * together with the OLD document's `session` text (or the reverse),
   * letting one open document's bytes silently overwrite a different
   * file's bytes on disk.
   *
   * The disk baseline is not known yet when this is called, so the
   * document is provisionally reported `dirty` against an EMPTY baseline
   * (a save is legal — recovered content should reach disk soon) rather
   * than against the PRIOR document's now-irrelevant baseline. The caller
   * completes the restore by calling {@link finishRestore} once the real
   * baseline is known.
   */
  beginRestore(documentId: string, recoveredText: string): void {
    this.resetDocument(documentId, recoveredText);
    this._diskText = "";
    this._diskStamp = undefined;
    this.setPhase("dirty");
  }

  /**
   * Phase 2 of a crash-recovery restore: supplies the disk baseline
   * resolved for the identity opened by {@link beginRestore}, computing the
   * same final phase/scheduleSave outcome {@link restore} computes in one
   * shot. The caller must not have switched identity again (via `open`,
   * `openFailed`, `restore`, `reset`, or another `beginRestore`) between
   * the two calls — `EditorBuffer`'s `loadGen` generation counter is
   * exactly the guard that keeps this true (see this class's header,
   * "what stays out of this file").
   */
  finishRestore(diskBaseline: DiskBaseline): RestoreOutcome {
    this._diskText = diskBaseline.text;
    this._diskStamp = diskBaseline.stamp;
    const dirty = this.isDirty;
    this.setPhase(dirty ? "dirty" : "clean");
    return { phase: this._phase, scheduleSave: dirty };
  }

  /**
   * A crash-recovery restore in one synchronous call — equivalent to
   * {@link beginRestore} immediately followed by {@link finishRestore} with
   * an already-known disk baseline. Kept for callers (and tests) that have
   * the baseline available up front. `EditorBuffer.restoreContent` uses the
   * two-phase split above instead, because ITS disk baseline is only known
   * after an async read — see {@link beginRestore}'s header.
   */
  restore(documentId: string, recoveredText: string, diskBaseline: DiskBaseline): RestoreOutcome {
    this.beginRestore(documentId, recoveredText);
    return this.finishRestore(diskBaseline);
  }

  /** Drop the document entirely (`EditorBuffer.reset`). */
  reset(): ResetOutcome {
    this.resetDocument(null, "");
    this._diskText = "";
    this._diskStamp = undefined;
    this.setPhase("clean");
    return { phase: this._phase };
  }

  // ── Editing ──────────────────────────────────────────────────────────────

  /**
   * A user edit (`EditorBuffer.edit`). Text updates even with no document
   * open (matching `EditorBuffer`'s unconditional `this.content = text`
   * before its own `if (!this.filePath) return`); phase and scheduling only
   * apply once a document is open.
   */
  edit(text: string): EditOutcome {
    this.replaceText(text);
    if (this._documentId === null) {
      return { phase: this._phase, scheduleSave: false, scheduleRecovery: false };
    }
    const dirty = this.isDirty;
    this.setPhase(dirty ? "dirty" : "clean");
    return { phase: this._phase, scheduleSave: dirty, scheduleRecovery: dirty };
  }

  // ── Saving ───────────────────────────────────────────────────────────────

  /**
   * Begin a save attempt (`EditorBuffer.performSave`'s entry): captures the
   * exact text to persist now, so a later edit during the save's I/O cannot
   * change what gets written for THIS attempt. Returns `null` (and leaves
   * phase untouched) when there is no open document — mirrors
   * `performSave`'s `if (!filePath) return` guard, which runs before its own
   * `setPhase("saving")`.
   */
  beginSave(): BeginSaveOutcome | null {
    if (this._documentId === null) return null;
    this._savingText = this._text;
    this.setPhase("saving");
    return { text: this._text, diskBaseline: this.diskBaseline };
  }

  /**
   * Resolve a save attempt begun by {@link beginSave}, given what the host's
   * own I/O determined. Reproduces `performSave`'s four outcomes exactly:
   *
   *   - `written`: the disk baseline adopts the CAPTURED text (what was
   *     actually written) and the new stamp; phase is `clean` only if the
   *     live text still matches what was written (an edit during the save's
   *     I/O leaves it `dirty` again, matching `performSave`'s
   *     `this.content === snapshot ? "clean" : "dirty"`), and the recovery
   *     timer is always cancelled on this branch.
   *   - `external-matches`: someone else already wrote byte-identical
   *     content — adopt it as the baseline without ever writing; same
   *     clean/dirty recompute as `written`, but the recovery timer is NOT
   *     cancelled (`performSave` only clears it after its own successful
   *     `writeFile`).
   *   - `external-conflict`: disk moved to something else — surface the
   *     conflict; text is untouched, so no reschedule (nothing else will
   *     retry this save automatically; the user must resolve it via
   *     {@link acceptExternal} / {@link keepMine}, or edit again).
   *   - `failed`: the write threw — phase becomes `error`.
   */
  completeSave(result: SaveResult): CompleteSaveOutcome {
    const savingText = this._savingText ?? this._text;
    this._savingText = null;
    switch (result.kind) {
      case "written": {
        this._diskText = savingText;
        this._diskStamp = result.diskStamp;
        const dirty = this._text !== savingText;
        this.setPhase(dirty ? "dirty" : "clean");
        return { phase: this._phase, scheduleSave: dirty, cancelRecoveryTimer: true, conflict: false };
      }
      case "external-matches": {
        this._diskText = savingText;
        this._diskStamp = result.diskStamp;
        this._externalChange = null;
        const dirty = this._text !== savingText;
        this.setPhase(dirty ? "dirty" : "clean");
        return { phase: this._phase, scheduleSave: dirty, cancelRecoveryTimer: false, conflict: false };
      }
      case "external-conflict": {
        this._externalChange = {
          diskText: result.diskText,
          diskStamp: result.diskStamp,
          exists: result.exists,
        };
        this.setPhase("dirty");
        return { phase: this._phase, scheduleSave: false, cancelRecoveryTimer: false, conflict: true };
      }
      case "failed": {
        this.setPhase("error");
        return { phase: this._phase, scheduleSave: false, cancelRecoveryTimer: false, conflict: false };
      }
    }
  }

  // ── External change reconciliation ─────────────────────────────────────

  /**
   * Reconcile a folder-change notification
   * (`EditorBuffer.reconcileExternalChange`), given what the host's own
   * stat (+ read, if warranted) found.
   *
   * The caller is responsible for the two guards
   * `reconcileExternalChange` applies BEFORE this point — this method does
   * not re-derive them (see the class header's "what stays out" list):
   *
   *   - **No open document**: skip entirely if `documentId` is `null`
   *     (mirrors `if (!filePath) return`).
   *   - **Self-echo suppression**: skip entirely — without even starting the
   *     stat/read I/O — whenever `hasPendingSave` is already `true` (mirrors
   *     `if (this.hasPendingSave) return`, the first line of
   *     `reconcileExternalChange`, run before any I/O). Any disk change
   *     observed while a save is pending/in-flight is definitionally our
   *     own pending write, per the `EditorBuffer` doc comment on that
   *     method. This class does NOT bake that check in here: `isDirty` can
   *     never be `true` without `hasPendingSave` already being `true` (see
   *     the class header), so an internal guard would make this method's
   *     own dirty/conflict branches below permanently unreachable through
   *     its own public surface.
   *
   * Given a call that clears both of the above, branch order matches
   * `reconcileExternalChange` exactly:
   *
   *   1. `deleted` + dirty → conflict (never silently resurrect unsaved work
   *      over a deletion).
   *   2. `deleted` + clean → silently adopt the deletion.
   *   3. `changed` and the disk text already matches the live text → just
   *      refresh the baseline, no callbacks (the author's own edit already
   *      caught up to disk).
   *   4. `changed` and the disk text matches the OLD baseline only (a bare
   *      touch, content unchanged — e.g. a checkout that left this file's
   *      bytes alone but bumped its mtime, observed while the buffer is
   *      independently dirty from an unrelated local edit) → refresh the
   *      stamp only, phase left untouched.
   *   5. `changed`, dirty → conflict.
   *   6. `changed`, clean → silently adopt the disk text.
   */
  noteExternalCheck(result: ExternalCheckResult): ExternalCheckOutcome {
    if (this._documentId === null) {
      return { phase: this._phase, replaced: false, conflict: false };
    }

    if (result.kind === "deleted") {
      if (this.isDirty) {
        this._externalChange = { diskText: "", diskStamp: undefined, exists: false };
        this.setPhase("dirty");
        return { phase: this._phase, replaced: false, conflict: true };
      }
      this.replaceText("");
      this._diskText = "";
      this._diskStamp = undefined;
      this.setPhase("clean");
      return { phase: this._phase, replaced: true, conflict: false };
    }

    const { diskText, diskStamp } = result;

    if (diskText === this._text) {
      this._diskText = diskText;
      this._diskStamp = diskStamp;
      this.setPhase("clean");
      return { phase: this._phase, replaced: false, conflict: false };
    }

    if (diskText === this._diskText) {
      this._diskStamp = diskStamp;
      return { phase: this._phase, replaced: false, conflict: false };
    }

    if (this.isDirty) {
      this._externalChange = { diskText, diskStamp };
      this.setPhase("dirty");
      return { phase: this._phase, replaced: false, conflict: true };
    }

    this.replaceText(diskText);
    this._diskText = diskText;
    this._diskStamp = diskStamp;
    this.setPhase("clean");
    return { phase: this._phase, replaced: true, conflict: false };
  }

  // ── Conflict resolution ─────────────────────────────────────────────────

  /** Reload: adopt the pending external disk version (`EditorBuffer.acceptExternal`). */
  acceptExternal(): AcceptExternalOutcome {
    const ext = this._externalChange;
    if (!ext) return { phase: this._phase, replaced: false };
    this.replaceText(ext.diskText);
    this._diskText = ext.diskText;
    this._diskStamp = ext.diskStamp;
    this._externalChange = null;
    this.setPhase("clean");
    return { phase: this._phase, replaced: true };
  }

  /**
   * Keep mine: adopt the disk stamp as the new save baseline so a save
   * isn't blocked; leave `text` untouched (`EditorBuffer.keepMine`).
   */
  keepMine(): KeepMineOutcome {
    const ext = this._externalChange;
    if (!ext) return { phase: this._phase, scheduleSave: false };
    this._diskText = ext.diskText;
    this._diskStamp = ext.diskStamp;
    this._externalChange = null;
    const dirty = this.isDirty;
    this.setPhase(dirty ? "dirty" : "clean");
    return { phase: this._phase, scheduleSave: dirty };
  }
}
