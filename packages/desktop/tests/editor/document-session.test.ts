/**
 * Exhaustive phase x event transition table for `DocumentSession`
 * (SFE-P1c, Lane A).
 *
 * These files are rune-free (`session.ts` has no `$state`), so — unlike
 * `buffer-state.test.ts` — this file needs NO `$state` shim: it imports and
 * exercises a plain TypeScript class directly.
 *
 * Every `describe` block below corresponds to one `DocumentSession` method
 * (one "event"); within each block, tests are grouped to cover every
 * reachable starting `phase` ("clean" / "dirty" / "saving" / "error") for
 * that event, per the run spec's "every phase x every event" transition
 * table. `phase` is asserted directly on every outcome so a change to any
 * transition's resulting phase fails a test here, not silently.
 */
import { describe, expect, test } from "bun:test";
import { DocumentSession } from "../../src/lib/document-session/session";

// ── Helpers to reach each phase deterministically ──────────────────────────

function openClean(text = "original"): DocumentSession {
  const s = new DocumentSession();
  s.open("/book/chapter.md", text, 1);
  return s;
}

function openDirty(): DocumentSession {
  const s = openClean();
  s.edit("original + edit");
  return s;
}

function openSaving(): DocumentSession {
  const s = openDirty();
  s.beginSave();
  return s;
}

/** phase 'error' with isDirty === false (a load failure). */
function openErrorClean(): DocumentSession {
  const s = new DocumentSession();
  s.openFailed("/book/chapter.md");
  return s;
}

/** phase 'error' with isDirty === true (a failed save while dirty). */
function openErrorDirty(): DocumentSession {
  const s = openDirty();
  s.beginSave();
  s.completeSave({ kind: "failed" });
  return s;
}

// ── Construction ─────────────────────────────────────────────────────────

describe("construction", () => {
  test("default state is clean, empty, and undirtied", () => {
    const s = new DocumentSession();
    expect(s.phase).toBe("clean");
    expect(s.documentId).toBeNull();
    expect(s.snapshot).toEqual({ text: "", version: 0 });
    expect(s.diskBaseline).toEqual({ text: "", stamp: undefined });
    expect(s.externalChange).toBeNull();
    expect(s.isDirty).toBe(false);
    expect(s.hasPendingSave).toBe(false);
    expect(s.isSaving).toBe(false);
  });
});

// ── open() ───────────────────────────────────────────────────────────────

describe("open", () => {
  test("establishes a clean document at version 0, text === disk baseline", () => {
    const s = new DocumentSession();
    const outcome = s.open("/book/a.md", "hello", 42);
    expect(outcome).toEqual({ phase: "clean" });
    expect(s.phase).toBe("clean");
    expect(s.documentId).toBe("/book/a.md");
    expect(s.snapshot).toEqual({ text: "hello", version: 0 });
    expect(s.diskBaseline).toEqual({ text: "hello", stamp: 42 });
    expect(s.externalChange).toBeNull();
    expect(s.isDirty).toBe(false);
  });

  test.each([
    ["clean", openClean],
    ["dirty", openDirty],
    ["saving", openSaving],
    ["error", openErrorDirty],
  ] as const)("switches identity to clean from phase=%s (file switch), version never rewinds to 0", (_label, make) => {
    const s = make();
    const versionBefore = s.snapshot.version;
    s.open("/book/b.md", "b text", 7);
    expect(s.phase).toBe("clean");
    expect(s.documentId).toBe("/book/b.md");
    expect(s.snapshot.text).toBe("b text");
    // CONFIRMED review regression (SFE-P1c round 1): version used to reset
    // to exactly 0 on every open() call, so a SourceEdit captured against
    // the PRIOR document's version could validate against this new one
    // too, whenever both happened to reset to the same value. Version must
    // only ever climb on a reused session instance.
    expect(s.snapshot.version).toBeGreaterThan(versionBefore);
    expect(s.diskBaseline).toEqual({ text: "b text", stamp: 7 });
    expect(s.externalChange).toBeNull();
    expect(s.isSaving).toBe(false);
  });

  test("clears a pending external conflict on file switch", () => {
    const s = openDirty();
    s.beginSave();
    s.completeSave({ kind: "external-conflict", diskText: "remote", diskStamp: 9 });
    expect(s.externalChange).not.toBeNull();
    s.open("/book/other.md", "other text", 1);
    expect(s.externalChange).toBeNull();
  });
});

// ── openFailed() ─────────────────────────────────────────────────────────

describe("openFailed", () => {
  test("enters error with empty text/disk baseline, version 0", () => {
    const s = new DocumentSession();
    const outcome = s.openFailed("/book/missing.md");
    expect(outcome).toEqual({ phase: "error" });
    expect(s.phase).toBe("error");
    expect(s.documentId).toBe("/book/missing.md");
    expect(s.snapshot).toEqual({ text: "", version: 0 });
    expect(s.diskBaseline).toEqual({ text: "", stamp: undefined });
    expect(s.isDirty).toBe(false);
    expect(s.hasPendingSave).toBe(false);
  });

  test.each([
    ["clean", openClean],
    ["dirty", openDirty],
    ["saving", openSaving],
    ["error", openErrorDirty],
  ] as const)("switches identity to error from phase=%s (file switch onto a failing load), version never rewinds to 0", (_label, make) => {
    const s = make();
    const versionBefore = s.snapshot.version;
    s.openFailed("/book/missing.md");
    expect(s.phase).toBe("error");
    expect(s.snapshot.text).toBe("");
    // See the sibling "open" test.each above for the CONFIRMED regression
    // this pins: version must never rewind to 0 on a reused instance.
    expect(s.snapshot.version).toBeGreaterThan(versionBefore);
    expect(s.externalChange).toBeNull();
    expect(s.isSaving).toBe(false);
  });
});

// ── restore() ────────────────────────────────────────────────────────────

describe("restore", () => {
  test("recovered text matching the disk baseline opens clean, no save scheduled", () => {
    const s = new DocumentSession();
    const outcome = s.restore("/book/a.md", "same text", { text: "same text", stamp: 3 });
    expect(outcome).toEqual({ phase: "clean", scheduleSave: false });
    expect(s.snapshot).toEqual({ text: "same text", version: 0 });
    expect(s.diskBaseline).toEqual({ text: "same text", stamp: 3 });
  });

  test("recovered text differing from the disk baseline opens dirty and schedules a save", () => {
    const s = new DocumentSession();
    const outcome = s.restore("/book/a.md", "recovered text", { text: "disk text", stamp: 3 });
    expect(outcome).toEqual({ phase: "dirty", scheduleSave: true });
    expect(s.snapshot).toEqual({ text: "recovered text", version: 0 });
    expect(s.diskBaseline).toEqual({ text: "disk text", stamp: 3 });
    expect(s.isDirty).toBe(true);
  });

  test.each([
    ["clean", openClean],
    ["dirty", openDirty],
    ["saving", openSaving],
    ["error", openErrorDirty],
  ] as const)("switches identity, never rewinding version to 0, and clears external state from phase=%s", (_label, make) => {
    const s = make();
    const versionBefore = s.snapshot.version;
    s.restore("/book/b.md", "recovered", { text: "recovered", stamp: 5 });
    expect(s.snapshot.text).toBe("recovered");
    // See the "open" test.each above for the CONFIRMED regression this
    // pins: version must never rewind to 0 on a reused instance.
    expect(s.snapshot.version).toBeGreaterThan(versionBefore);
    expect(s.externalChange).toBeNull();
    expect(s.isSaving).toBe(false);
  });
});

// ── beginRestore() / finishRestore() (two-phase restore, SFE-P1c round 1) ──
//
// `EditorBuffer.restoreContent` establishes identity SYNCHRONOUSLY via
// beginRestore before its async disk-baseline read, then completes with
// finishRestore once the read resolves — see buffer-state.svelte.ts's
// header for the CONFIRMED cross-file-write regression this closes.
// `restore()` above is exactly `beginRestore` + `finishRestore` composed in
// one call (proven directly below), so its own tests already cover the
// combined-result shape; these tests cover the INTERMEDIATE state between
// the two calls, which `restore()` alone can never expose.

describe("beginRestore / finishRestore", () => {
  test("restore() is exactly beginRestore() followed by finishRestore()", () => {
    const viaRestore = new DocumentSession();
    viaRestore.restore("/book/a.md", "recovered", { text: "disk text", stamp: 3 });

    const viaTwoPhase = new DocumentSession();
    viaTwoPhase.beginRestore("/book/a.md", "recovered");
    const outcome = viaTwoPhase.finishRestore({ text: "disk text", stamp: 3 });

    expect(viaTwoPhase.snapshot).toEqual(viaRestore.snapshot);
    expect(viaTwoPhase.diskBaseline).toEqual(viaRestore.diskBaseline);
    expect(viaTwoPhase.phase).toBe(viaRestore.phase);
    expect(outcome).toEqual({ phase: "dirty", scheduleSave: true });
  });

  test("beginRestore alone establishes the new identity+text immediately, phase dirty, baseline provisionally empty", () => {
    const s = new DocumentSession();
    s.beginRestore("/book/a.md", "recovered text");

    expect(s.documentId).toBe("/book/a.md");
    expect(s.snapshot.text).toBe("recovered text");
    expect(s.phase).toBe("dirty");
    expect(s.hasPendingSave).toBe(true);
    // The real disk baseline is not known yet — provisionally empty, not
    // whatever a PRIOR document (if any) left behind, so a save attempted
    // in this window never compares against a stale, unrelated baseline.
    expect(s.diskBaseline).toEqual({ text: "", stamp: undefined });
  });

  test("beginRestore establishes identity+text atomically even mid-flight on a reused, dirty session (no cross-document mismatch window)", () => {
    // CONFIRMED review regression (SFE-P1c round 1): the host used to write
    // its own identity/text fields directly, ahead of the session, so a
    // caller reading "current identity" and "current text" between those
    // two writes could see one document's identity paired with another
    // document's text. beginRestore makes that pairing atomic: identity
    // and text change together, synchronously, in one call.
    const s = openDirty(); // "/book/chapter.md", text = "original + edit"
    const versionBefore = s.snapshot.version;

    s.beginRestore("/book/other.md", "other recovered");

    expect(s.documentId).toBe("/book/other.md");
    expect(s.snapshot.text).toBe("other recovered");
    expect(s.snapshot.version).toBeGreaterThan(versionBefore);
    expect(s.phase).toBe("dirty");
  });

  test("finishRestore supplies the real baseline and recomputes phase: clean when recovered text matches disk", () => {
    const s = new DocumentSession();
    s.beginRestore("/book/a.md", "same text");
    const outcome = s.finishRestore({ text: "same text", stamp: 9 });

    expect(outcome).toEqual({ phase: "clean", scheduleSave: false });
    expect(s.phase).toBe("clean");
    expect(s.diskBaseline).toEqual({ text: "same text", stamp: 9 });
    expect(s.isDirty).toBe(false);
  });

  test("finishRestore supplies the real baseline and recomputes phase: dirty + schedules a save when recovered text differs from disk", () => {
    const s = new DocumentSession();
    s.beginRestore("/book/a.md", "recovered text");
    const outcome = s.finishRestore({ text: "disk text", stamp: 9 });

    expect(outcome).toEqual({ phase: "dirty", scheduleSave: true });
    expect(s.diskBaseline).toEqual({ text: "disk text", stamp: 9 });
    expect(s.isDirty).toBe(true);
  });
});

// ── edit() ───────────────────────────────────────────────────────────────

describe("edit", () => {
  test("updates text even with no document open, but does not touch phase/scheduling", () => {
    const s = new DocumentSession();
    const outcome = s.edit("typed with nothing open");
    expect(outcome).toEqual({ phase: "clean", scheduleSave: false, scheduleRecovery: false });
    expect(s.snapshot.text).toBe("typed with nothing open");
    expect(s.documentId).toBeNull();
  });

  test("clean -> dirty when the new text differs from disk, schedules save + recovery", () => {
    const s = openClean("original");
    const outcome = s.edit("original edited");
    expect(outcome).toEqual({ phase: "dirty", scheduleSave: true, scheduleRecovery: true });
    expect(s.phase).toBe("dirty");
    expect(s.isDirty).toBe(true);
  });

  test("clean -> clean when the new text equals disk (no-op content), no scheduling", () => {
    const s = openClean("original");
    const outcome = s.edit("original");
    expect(outcome).toEqual({ phase: "clean", scheduleSave: false, scheduleRecovery: false });
  });

  test("dirty -> dirty on a further edit still differing from disk, reschedules both", () => {
    const s = openDirty();
    const outcome = s.edit("original + edit + more");
    expect(outcome).toEqual({ phase: "dirty", scheduleSave: true, scheduleRecovery: true });
  });

  test("dirty -> clean when an edit reverts text to match disk (undo)", () => {
    const s = openDirty();
    const outcome = s.edit("original");
    expect(outcome).toEqual({ phase: "clean", scheduleSave: false, scheduleRecovery: false });
    expect(s.isDirty).toBe(false);
  });

  test("saving -> dirty when an edit lands mid-flight and still differs from disk", () => {
    const s = openSaving();
    expect(s.phase).toBe("saving");
    const outcome = s.edit("latest edit");
    expect(outcome).toEqual({ phase: "dirty", scheduleSave: true, scheduleRecovery: true });
  });

  test("saving -> clean when an edit lands mid-flight and happens to match disk", () => {
    const s = openSaving(); // text = "original + edit", disk = "original"
    const outcome = s.edit("original");
    expect(outcome).toEqual({ phase: "clean", scheduleSave: false, scheduleRecovery: false });
  });

  test("error -> dirty on an edit differing from disk (recovers from a load/save failure)", () => {
    const s = openErrorClean(); // text='', disk=''
    const outcome = s.edit("typed after error");
    expect(outcome).toEqual({ phase: "dirty", scheduleSave: true, scheduleRecovery: true });
  });

  test("error -> clean on an edit matching disk", () => {
    const s = openErrorClean(); // text='', disk=''
    const outcome = s.edit("");
    expect(outcome).toEqual({ phase: "clean", scheduleSave: false, scheduleRecovery: false });
  });

  test("version increments by exactly one per edit call, even for a byte-identical call", () => {
    const s = openClean("original");
    expect(s.snapshot.version).toBe(0);
    s.edit("original edited");
    expect(s.snapshot.version).toBe(1);
    s.edit("original edited"); // same text as current — still an accepted edit call
    expect(s.snapshot.version).toBe(2);
    s.edit("original");
    expect(s.snapshot.version).toBe(3);
  });
});

// ── beginSave() ──────────────────────────────────────────────────────────

describe("beginSave", () => {
  test("returns null and leaves phase untouched when no document is open", () => {
    const s = new DocumentSession();
    expect(s.beginSave()).toBeNull();
    expect(s.phase).toBe("clean");
    expect(s.isSaving).toBe(false);
  });

  test.each([
    ["clean", openClean],
    ["dirty", openDirty],
    ["error", openErrorDirty],
  ] as const)("captures the current text/disk baseline and enters saving from phase=%s", (_label, make) => {
    const s = make();
    const before = s.snapshot.text;
    const outcome = s.beginSave();
    expect(outcome).toEqual({ text: before, diskBaseline: s.diskBaseline });
    expect(s.phase).toBe("saving");
    expect(s.isSaving).toBe(true);
  });

});

// ── completeSave() ───────────────────────────────────────────────────────

describe("completeSave", () => {
  describe("written", () => {
    test("text unchanged since beginSave -> clean, cancels the recovery timer, no reschedule", () => {
      const s = openDirty();
      s.beginSave();
      const outcome = s.completeSave({ kind: "written", diskStamp: 99 });
      expect(outcome).toEqual({
        phase: "clean",
        scheduleSave: false,
        cancelRecoveryTimer: true,
        conflict: false,
      });
      expect(s.diskBaseline).toEqual({ text: "original + edit", stamp: 99 });
      expect(s.isSaving).toBe(false);
    });

    test("text changed since beginSave (edit mid-flight) -> dirty again, reschedules", () => {
      const s = openDirty(); // text = "original + edit"
      s.beginSave(); // captures "original + edit"
      s.edit("latest edit"); // phase flips to dirty via edit() itself too
      const outcome = s.completeSave({ kind: "written", diskStamp: 100 });
      expect(outcome).toEqual({
        phase: "dirty",
        scheduleSave: true,
        cancelRecoveryTimer: true,
        conflict: false,
      });
      // The disk baseline adopts what was ACTUALLY written (the captured
      // text), not the buffer's current (further-edited) text.
      expect(s.diskBaseline).toEqual({ text: "original + edit", stamp: 100 });
      expect(s.isDirty).toBe(true);
    });
  });

  describe("external-matches", () => {
    test("adopts the matching disk content, clears any conflict, does not cancel the recovery timer", () => {
      const s = openDirty();
      s.beginSave();
      const outcome = s.completeSave({ kind: "external-matches", diskStamp: 55 });
      expect(outcome).toEqual({
        phase: "clean",
        scheduleSave: false,
        cancelRecoveryTimer: false,
        conflict: false,
      });
      expect(s.diskBaseline).toEqual({ text: "original + edit", stamp: 55 });
      expect(s.externalChange).toBeNull();
    });

    test("text changed since beginSave -> dirty again despite the match", () => {
      const s = openDirty();
      s.beginSave();
      s.edit("even newer text");
      const outcome = s.completeSave({ kind: "external-matches", diskStamp: 56 });
      expect(outcome.phase).toBe("dirty");
      expect(outcome.scheduleSave).toBe(true);
    });
  });

  describe("external-conflict", () => {
    test("surfaces the conflict, phase dirty, no reschedule, text untouched", () => {
      const s = openDirty();
      const textBefore = s.snapshot.text;
      s.beginSave();
      const outcome = s.completeSave({
        kind: "external-conflict",
        diskText: "remote text from pull",
        diskStamp: 8,
      });
      expect(outcome).toEqual({
        phase: "dirty",
        scheduleSave: false,
        cancelRecoveryTimer: false,
        conflict: true,
      });
      expect(s.externalChange).toEqual({
        diskText: "remote text from pull",
        diskStamp: 8,
        exists: undefined,
      });
      expect(s.snapshot.text).toBe(textBefore);
      expect(s.isSaving).toBe(false);
    });

    test("carries an exists:false deletion conflict through unchanged", () => {
      const s = openDirty();
      s.beginSave();
      const outcome = s.completeSave({
        kind: "external-conflict",
        diskText: "",
        diskStamp: 0,
        exists: false,
      });
      expect(outcome.conflict).toBe(true);
      expect(s.externalChange).toEqual({ diskText: "", diskStamp: 0, exists: false });
    });
  });

  describe("failed", () => {
    test.each([
      ["clean", openClean],
      ["dirty", openDirty],
    ] as const)("write failure -> error from a save begun in phase=%s", (_label, make) => {
      const s = make();
      s.beginSave();
      const outcome = s.completeSave({ kind: "failed" });
      expect(outcome).toEqual({
        phase: "error",
        scheduleSave: false,
        cancelRecoveryTimer: false,
        conflict: false,
      });
      expect(s.phase).toBe("error");
      expect(s.isSaving).toBe(false);
    });
  });
});

// ── noteExternalCheck() ──────────────────────────────────────────────────

describe("noteExternalCheck", () => {
  test("no-ops when no document is open", () => {
    const s = new DocumentSession();
    const outcome = s.noteExternalCheck({ kind: "changed", diskText: "x", diskStamp: 1 });
    expect(outcome).toEqual({ phase: "clean", replaced: false, conflict: false });
  });

  // Self-echo / pending-save suppression ("if (this.hasPendingSave) return"
  // in EditorBuffer.reconcileExternalChange, run before any I/O) is the
  // HOST's guard, not this method's — see the doc comment on
  // noteExternalCheck. Nothing to pin here beyond the getter itself
  // (covered by the dedicated hasPendingSave describe block below); this
  // method must NOT re-derive it, which the dirty/conflict branch tests
  // immediately below prove by reaching those branches from a dirty phase.

  describe("deleted", () => {
    test("clean -> clean, adopts the deletion silently, bumps version", () => {
      const s = openClean("old local text");
      const versionBefore = s.snapshot.version;
      const outcome = s.noteExternalCheck({ kind: "deleted" });
      expect(outcome).toEqual({ phase: "clean", replaced: true, conflict: false });
      expect(s.snapshot).toEqual({ text: "", version: versionBefore + 1 });
      expect(s.diskBaseline).toEqual({ text: "", stamp: undefined });
      expect(s.externalChange).toBeNull();
    });

    test("error+clean (a prior load failure) -> clean, adopts the deletion silently", () => {
      const s = openErrorClean(); // text='', disk='' -> isDirty === false
      const outcome = s.noteExternalCheck({ kind: "deleted" });
      expect(outcome).toEqual({ phase: "clean", replaced: true, conflict: false });
      expect(s.phase).toBe("clean");
    });

    test("a dirty buffer surfaces a conflict instead of resurrecting the deletion, text untouched", () => {
      const s = openClean("old local text");
      s.edit("stale edit after remote deletion");
      const outcome = s.noteExternalCheck({ kind: "deleted" });
      expect(outcome).toEqual({ phase: "dirty", replaced: false, conflict: true });
      expect(s.externalChange).toEqual({ diskText: "", diskStamp: undefined, exists: false });
      expect(s.snapshot.text).toBe("stale edit after remote deletion");
    });
  });

  describe("changed", () => {
    test("disk text already matches the live (edited) text -> clean, baseline refresh only, no replace", () => {
      const s = openClean("old local text");
      s.edit("same final text");
      const outcome = s.noteExternalCheck({ kind: "changed", diskText: "same final text", diskStamp: 9 });
      expect(outcome).toEqual({ phase: "clean", replaced: false, conflict: false });
      expect(s.diskBaseline).toEqual({ text: "same final text", stamp: 9 });
    });

    test("clean buffer, disk text differs -> silently adopts it, bumps version", () => {
      const s = openClean("old local text");
      const versionBefore = s.snapshot.version;
      const outcome = s.noteExternalCheck({
        kind: "changed",
        diskText: "remote text from pull",
        diskStamp: 4,
      });
      expect(outcome).toEqual({ phase: "clean", replaced: true, conflict: false });
      expect(s.snapshot).toEqual({ text: "remote text from pull", version: versionBefore + 1 });
      expect(s.diskBaseline).toEqual({ text: "remote text from pull", stamp: 4 });
    });

    test("dirty buffer, disk text differs from both live text and old baseline -> conflict", () => {
      const s = openClean("old local text");
      s.edit("dirty local edit that conflicts");
      const outcome = s.noteExternalCheck({
        kind: "changed",
        diskText: "remote text from pull",
        diskStamp: 4,
      });
      expect(outcome).toEqual({ phase: "dirty", replaced: false, conflict: true });
      expect(s.externalChange).toEqual({ diskText: "remote text from pull", diskStamp: 4 });
      expect(s.snapshot.text).toBe("dirty local edit that conflicts");
    });

    test("disk text matches only the OLD baseline (a bare touch) while saving -> stamp refresh only, phase left untouched", () => {
      // open: text = diskText = "original". edit: text = "original + edit",
      // diskText still "original". A touch (mtime moved, bytes unchanged)
      // is then observed mid-save — phase must stay "saving", not be
      // recomputed to "dirty" (proving this branch does not call setPhase
      // at all, distinct from every other branch in this method).
      const s = openSaving();
      const outcome = s.noteExternalCheck({ kind: "changed", diskText: "original", diskStamp: 77 });
      expect(outcome).toEqual({ phase: "saving", replaced: false, conflict: false });
      expect(s.phase).toBe("saving");
      expect(s.diskBaseline).toEqual({ text: "original", stamp: 77 });
    });

    test("error+clean buffer, disk text differs -> silently adopts it (recovers from a load failure)", () => {
      const s = openErrorClean(); // text='', disk=''
      const outcome = s.noteExternalCheck({ kind: "changed", diskText: "now on disk", diskStamp: 2 });
      expect(outcome).toEqual({ phase: "clean", replaced: true, conflict: false });
      expect(s.snapshot.text).toBe("now on disk");
    });
  });
});

// ── acceptExternal() ─────────────────────────────────────────────────────

describe("acceptExternal", () => {
  test("no-ops when there is no pending external change", () => {
    const s = openClean();
    const outcome = s.acceptExternal();
    expect(outcome).toEqual({ phase: "clean", replaced: false });
  });

  test("Reload: adopts the pending disk text, clears the conflict, phase clean, bumps version", () => {
    const s = openClean("old local text");
    s.edit("dirty local edit that conflicts");
    s.noteExternalCheck({ kind: "changed", diskText: "remote text from pull", diskStamp: 4 });
    expect(s.externalChange).not.toBeNull();
    const versionBefore = s.snapshot.version;

    const outcome = s.acceptExternal();

    expect(outcome).toEqual({ phase: "clean", replaced: true });
    expect(s.snapshot).toEqual({ text: "remote text from pull", version: versionBefore + 1 });
    expect(s.diskBaseline).toEqual({ text: "remote text from pull", stamp: 4 });
    expect(s.externalChange).toBeNull();
    expect(s.isDirty).toBe(false);
  });

  test("Reload from a deletion conflict adopts the empty text", () => {
    const s = openClean("old local text");
    s.edit("stale edit after remote deletion");
    s.noteExternalCheck({ kind: "deleted" });

    const outcome = s.acceptExternal();

    expect(outcome).toEqual({ phase: "clean", replaced: true });
    expect(s.snapshot.text).toBe("");
    expect(s.diskBaseline).toEqual({ text: "", stamp: undefined });
  });
});

// ── keepMine() ───────────────────────────────────────────────────────────

describe("keepMine", () => {
  test("no-ops when there is no pending external change", () => {
    const s = openClean();
    const outcome = s.keepMine();
    expect(outcome).toEqual({ phase: "clean", scheduleSave: false });
  });

  test("Keep mine: adopts the disk baseline, leaves text untouched, stays dirty, schedules a save", () => {
    const s = openClean("old local text");
    s.edit("author intentionally keeps local text");
    s.noteExternalCheck({ kind: "changed", diskText: "remote text from pull", diskStamp: 4 });
    const versionBefore = s.snapshot.version;

    const outcome = s.keepMine();

    expect(outcome).toEqual({ phase: "dirty", scheduleSave: true });
    expect(s.snapshot).toEqual({ text: "author intentionally keeps local text", version: versionBefore });
    expect(s.diskBaseline).toEqual({ text: "remote text from pull", stamp: 4 });
    expect(s.externalChange).toBeNull();
  });

  test("Keep mine when the adopted baseline happens to match local text -> clean, no reschedule", () => {
    const s = openClean("old local text");
    s.edit("dirty local edit that conflicts");
    s.noteExternalCheck({ kind: "changed", diskText: "converged text", diskStamp: 4 });
    expect(s.externalChange).not.toBeNull();
    // The author retypes to literally match the pending external text before
    // resolving the banner — session.diskBaseline is still the OLD baseline
    // here (only the pending externalChange record holds "converged text"),
    // so this edit is still reported dirty.
    const editOutcome = s.edit("converged text");
    expect(editOutcome.phase).toBe("dirty");

    const outcome = s.keepMine();

    expect(outcome).toEqual({ phase: "clean", scheduleSave: false });
    expect(s.diskBaseline).toEqual({ text: "converged text", stamp: 4 });
    expect(s.isDirty).toBe(false);
  });
});

// ── reset() ──────────────────────────────────────────────────────────────

describe("reset", () => {
  test.each([
    ["clean", openClean],
    ["dirty", openDirty],
    ["saving", openSaving],
    ["error", openErrorDirty],
  ] as const)("clears everything back to the construction defaults from phase=%s, without rewinding version to 0", (_label, make) => {
    const s = make();
    const versionBefore = s.snapshot.version;
    const outcome = s.reset();
    expect(outcome).toEqual({ phase: "clean" });
    expect(s.phase).toBe("clean");
    expect(s.documentId).toBeNull();
    expect(s.snapshot.text).toBe("");
    // See the "open" test.each above for the CONFIRMED regression this
    // pins: closing a document still consumes a version number, so a
    // later re-open on this same instance can never land back on a value
    // an in-flight edit against the closed document already captured.
    expect(s.snapshot.version).toBeGreaterThan(versionBefore);
    expect(s.diskBaseline).toEqual({ text: "", stamp: undefined });
    expect(s.externalChange).toBeNull();
    expect(s.isDirty).toBe(false);
    expect(s.hasPendingSave).toBe(false);
    expect(s.isSaving).toBe(false);
  });
});

// ── Derived getters across the full phase matrix ────────────────────────

describe("hasPendingSave", () => {
  test("false when clean", () => {
    expect(openClean().hasPendingSave).toBe(false);
  });

  test("true when dirty", () => {
    expect(openDirty().hasPendingSave).toBe(true);
  });

  test("true when saving", () => {
    expect(openSaving().hasPendingSave).toBe(true);
  });

  test("true when error with isDirty (failed save while dirty)", () => {
    expect(openErrorDirty().hasPendingSave).toBe(true);
  });

  test("false when error without isDirty (a load failure)", () => {
    expect(openErrorClean().hasPendingSave).toBe(false);
  });
});

// ── Composite scenario: a full flush-style retry loop ───────────────────

describe("flush-style composition (beginSave/completeSave loop, matching EditorBuffer.flush)", () => {
  test("a conflict leaves hasPendingSave true so the host's flush loop keeps retrying material", () => {
    const s = openDirty();
    s.beginSave();
    s.completeSave({ kind: "external-conflict", diskText: "remote text from pull", diskStamp: 4 });
    expect(s.hasPendingSave).toBe(true);
    expect(s.externalChange).not.toBeNull();
  });

  test("keepMine after a conflict lets a subsequent save attempt succeed and reach clean", () => {
    const s = openDirty(); // text = "original + edit"
    s.beginSave();
    s.completeSave({ kind: "external-conflict", diskText: "remote text from pull", diskStamp: 4 });
    s.keepMine();
    expect(s.hasPendingSave).toBe(true); // still dirty, save now unblocked

    s.beginSave();
    const outcome = s.completeSave({ kind: "written", diskStamp: 5 });
    expect(outcome).toEqual({
      phase: "clean",
      scheduleSave: false,
      cancelRecoveryTimer: true,
      conflict: false,
    });
    expect(s.hasPendingSave).toBe(false);
  });

  test("a write that already matches disk reaches clean with no conflict (no-op save)", () => {
    const s = openDirty(); // text = "original + edit", disk = "original"
    s.beginSave();
    const outcome = s.completeSave({ kind: "external-matches", diskStamp: 6 });
    expect(outcome.phase).toBe("clean");
    expect(s.hasPendingSave).toBe(false);
  });
});
