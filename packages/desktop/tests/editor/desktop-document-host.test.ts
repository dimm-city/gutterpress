/**
 * `DesktopDocumentHost` tests (SFE-P1c, Lane B).
 *
 * Two parts:
 *
 *   1. The SHARED `EditorDocumentHost` contract suite
 *      (`@dimm-city/gutterpress-editor`'s `runDocumentHostContractTests`),
 *      run here with mocked persistence — the SAME assertions
 *      `packages/editor/tests/core/contract-tests.test.ts` runs against
 *      `MemoryDocumentHost`, proving `DesktopDocumentHost` is
 *      substitutable for it (D7).
 *   2. Desktop-specific cases the shared suite does not (and should not)
 *      cover: phase interactions with the wrapped `DocumentSession`,
 *      conflict handling, and open/reset re-identity.
 *
 * `packages/desktop/package.json` declares a `workspace:*` dependency on
 * `@dimm-city/gutterpress-editor`, so this file resolves it normally
 * through the workspace install — no relative-path fallback import needed.
 */
import { describe, expect, test } from "bun:test";
import { runDocumentHostContractTests } from "@dimm-city/gutterpress-editor";
import { DesktopDocumentHost } from "../../src/lib/editor-host/desktop-document-host";

// ── 1. Shared contract suite (mocked persistence: no callbacks needed — the
//      suite never exercises save/recovery scheduling) ─────────────────────

runDocumentHostContractTests(
  describe,
  test,
  expect,
  (initialText, opts) => new DesktopDocumentHost(initialText, { readonly: opts?.readonly }),
);

// ── 2. Desktop-specific cases ────────────────────────────────────────────

describe("DesktopDocumentHost — desktop-specific phase interactions", () => {
  test("an accepted applyEdit forwards scheduleSave + scheduleRecovery to the injected callbacks", () => {
    let saveCalls = 0;
    let recoveryCalls = 0;
    const host = new DesktopDocumentHost("original", {
      onScheduleSave: () => saveCalls++,
      onScheduleRecovery: () => recoveryCalls++,
    });

    host.applyEdit({ from: 0, to: 8, insert: "changed", expectedVersion: 0 });

    expect(saveCalls).toBe(1);
    expect(recoveryCalls).toBe(1);
    expect(host.phase).toBe("dirty");
  });

  test("an edit that reverts text back to the disk baseline schedules nothing and returns to clean", () => {
    let saveCalls = 0;
    const host = new DesktopDocumentHost("original", { onScheduleSave: () => saveCalls++ });

    host.applyEdit({ from: 0, to: 8, insert: "changed", expectedVersion: 0 });
    expect(saveCalls).toBe(1);
    expect(host.phase).toBe("dirty");

    // Revert back to "original" via a second edit.
    const snapshot = host.getSnapshot();
    host.applyEdit({ from: 0, to: snapshot.text.length, insert: "original", expectedVersion: snapshot.version });

    expect(host.phase).toBe("clean");
    expect(host.getSnapshot()).toEqual({ text: "original", version: 2 });
  });

  test("a rejected edit (stale) never reaches the session — phase and scheduling untouched", () => {
    let saveCalls = 0;
    const host = new DesktopDocumentHost("original", { onScheduleSave: () => saveCalls++ });
    expect(host.phase).toBe("clean");

    const result = host.applyEdit({ from: 0, to: 1, insert: "X", expectedVersion: 99 });

    expect(result.ok).toBe(false);
    expect(host.phase).toBe("clean");
    expect(saveCalls).toBe(0);
  });

  test("edit during saving via the host: beginSave captures the pre-edit text, a later edit re-dirties, completeSave('written') reflects what was actually captured", () => {
    const host = new DesktopDocumentHost("original");

    host.applyEdit({ from: 0, to: 8, insert: "edit one", expectedVersion: 0 });
    expect(host.getSnapshot().text).toBe("edit one");

    const beginOutcome = host.beginSave();
    expect(beginOutcome).not.toBeNull();
    expect(beginOutcome?.text).toBe("edit one");
    expect(host.phase).toBe("saving");
    expect(host.isSaving).toBe(true);

    // A further edit lands while the save above is still in flight.
    const midFlightSnapshot = host.getSnapshot();
    host.applyEdit({
      from: 0,
      to: midFlightSnapshot.text.length,
      insert: "edit two mid-flight",
      expectedVersion: midFlightSnapshot.version,
    });
    expect(host.getSnapshot().text).toBe("edit two mid-flight");

    const completeOutcome = host.completeSave({ kind: "written", diskStamp: 99 });

    // The write captured (and persisted) "edit one", not the later
    // mid-flight edit, so the document is dirty again against that older
    // disk baseline — exactly `DocumentSession.completeSave`'s documented
    // "written" behavior, now proven reachable through the host's own
    // public surface.
    expect(completeOutcome.phase).toBe("dirty");
    expect(completeOutcome.scheduleSave).toBe(true);
    expect(host.diskBaseline.text).toBe("edit one");
    expect(host.getSnapshot().text).toBe("edit two mid-flight");
    expect(host.isSaving).toBe(false);
  });

  test("conflict handling does not corrupt version monotonicity: conflict -> keepMine -> a later successful save", () => {
    const host = new DesktopDocumentHost("original");
    host.applyEdit({ from: 0, to: 8, insert: "local edit", expectedVersion: 0 });
    const versionAfterEdit = host.getSnapshot().version;

    host.beginSave();
    const conflictOutcome = host.completeSave({
      kind: "external-conflict",
      diskText: "remote text from elsewhere",
      diskStamp: 5,
    });
    expect(conflictOutcome.conflict).toBe(true);
    expect(host.externalChange).not.toBeNull();
    // A conflict never touches text/version — only save-completion phase
    // bookkeeping — so getSnapshot() is untouched by it.
    expect(host.getSnapshot().version).toBe(versionAfterEdit);

    const keepMineOutcome = host.keepMine();
    expect(keepMineOutcome.scheduleSave).toBe(true);
    expect(host.externalChange).toBeNull();
    // keepMine adopts the disk baseline/stamp without touching live text,
    // so version is still untouched.
    expect(host.getSnapshot().version).toBe(versionAfterEdit);

    host.beginSave();
    const writtenOutcome = host.completeSave({ kind: "written", diskStamp: 6 });
    expect(writtenOutcome).toEqual({
      phase: "clean",
      scheduleSave: false,
      cancelRecoveryTimer: true,
      conflict: false,
    });
    // Version only ever moved via the ONE accepted applyEdit above —
    // conflict detection and resolution never bumped it a second time.
    expect(host.getSnapshot().version).toBe(versionAfterEdit);
  });

  test("noteExternalCheck silently adopting a clean buffer's disk change notifies subscribers with the new snapshot", () => {
    const host = new DesktopDocumentHost("original");
    const seen: Array<{ text: string; version: number }> = [];
    host.subscribe((snapshot) => seen.push(snapshot));

    const outcome = host.noteExternalCheck({ kind: "changed", diskText: "changed elsewhere", diskStamp: 3 });

    expect(outcome).toEqual({ phase: "clean", replaced: true, conflict: false });
    expect(host.getSnapshot()).toEqual({ text: "changed elsewhere", version: 1 });
    expect(seen).toEqual([{ text: "changed elsewhere", version: 1 }]);
  });

  test("reset/open re-identity: version stays strictly monotonic across reset/open — it never rewinds to a value a stale edit against the prior identity could still match", () => {
    // CONFIRMED review regression (SFE-P1c round 1): resetDocument used to
    // reset `_version` to exactly 0 on EVERY open()/reset() call, so any
    // two documents opened in sequence on a reused host both started at
    // version 0. An edit captured against the first document's version 0
    // then silently validated against the second, unrelated document too.
    const host = new DesktopDocumentHost("original", { documentId: "/book/a.md" });
    host.applyEdit({ from: 0, to: 0, insert: "!", expectedVersion: 0 });
    expect(host.documentId).toBe("/book/a.md");
    const versionAfterFirstEdit = host.getSnapshot().version;
    expect(versionAfterFirstEdit).toBe(1);

    const resetOutcome = host.reset();
    expect(resetOutcome.phase).toBe("clean");
    expect(host.documentId).toBeNull();
    expect(host.getSnapshot().text).toBe("");
    // Closing a document still consumes a version number — it must never
    // rewind, so a later re-open cannot land back on a version number an
    // in-flight edit against the OLD document already captured.
    expect(host.getSnapshot().version).toBeGreaterThan(versionAfterFirstEdit);
    const versionAfterReset = host.getSnapshot().version;

    const openOutcome = host.open("/book/b.md", "fresh document", 7);
    expect(openOutcome.phase).toBe("clean");
    expect(host.documentId).toBe("/book/b.md");
    expect(host.getSnapshot().text).toBe("fresh document");
    // The version counter must keep climbing, never reset to a value
    // already used by a prior identity on this same (reused) host.
    expect(host.getSnapshot().version).toBeGreaterThan(versionAfterReset);
    expect(host.diskBaseline).toEqual({ text: "fresh document", stamp: 7 });

    // The exact reproduction from the review finding: every re-open used
    // to reset version to exactly 0, so an edit captured against version 0
    // of ANY document silently validated against whichever document
    // happened to be open next. Confirm that collision is now closed.
    const collisionAcrossSwitch = host.applyEdit({ from: 0, to: 0, insert: "HACKED", expectedVersion: 0 });
    expect(collisionAcrossSwitch.ok).toBe(false);
    if (!collisionAcrossSwitch.ok) expect(collisionAcrossSwitch.reason).toBe("stale");
    expect(host.getSnapshot().text).toBe("fresh document");

    // A stale edit computed against the PRIOR identity's own real version
    // must also still be rejected.
    const staleAcrossSwitch = host.applyEdit({
      from: 0,
      to: 0,
      insert: "x",
      expectedVersion: versionAfterFirstEdit,
    });
    expect(staleAcrossSwitch.ok).toBe(false);
    if (!staleAcrossSwitch.ok) expect(staleAcrossSwitch.reason).toBe("stale");
  });

  test("open() notifies subscribers with the new document's snapshot (a genuine identity change)", () => {
    const host = new DesktopDocumentHost("first");
    const seen: Array<{ text: string; version: number }> = [];
    host.subscribe((snapshot) => seen.push(snapshot));

    host.open("/book/other.md", "second", 1);

    // Version continues from the host's construction-time open() call
    // (version 0) rather than resetting back to 0 a second time.
    expect(seen).toEqual([{ text: "second", version: 1 }]);
  });

  test("replaceExternal after reset() is a no-op: no document is open, so there is nothing to replace", () => {
    // CONFIRMED review regression (SFE-P1c round 1): replaceExternal used
    // to fall through to noteExternalCheck's/edit's own null-documentId
    // no-op guards, which leave phase "clean" without ever touching
    // `_diskText` — landing the session in a state where isDirty is true
    // while phase is "clean", breaking the documented "clean implies not
    // dirty" invariant.
    const host = new DesktopDocumentHost("original", { documentId: "/book/a.md" });
    host.reset();
    expect(host.documentId).toBeNull();

    const seen: Array<{ text: string; version: number }> = [];
    host.subscribe((snapshot) => seen.push(snapshot));

    host.replaceExternal("authoritative text");

    expect(host.documentId).toBeNull();
    expect(host.getSnapshot().text).toBe("");
    expect(host.phase).toBe("clean");
    expect(host.isDirty).toBe(false);
    expect(host.hasPendingSave).toBe(false);
    expect(seen).toEqual([]);
  });

  test("beginSave/completeSave never notify EditorDocumentHost subscribers (text/version untouched by save bookkeeping)", () => {
    const host = new DesktopDocumentHost("original");
    host.applyEdit({ from: 0, to: 0, insert: "x", expectedVersion: 0 }); // one legitimate notification
    const seen: Array<{ text: string; version: number }> = [];
    host.subscribe((snapshot) => seen.push(snapshot));

    host.beginSave();
    host.completeSave({ kind: "written", diskStamp: 1 });

    expect(seen).toEqual([]);
  });
});

describe("DesktopDocumentHost — replaceExternal, backed by the session's adoption path", () => {
  test("replaceExternal on a dirty buffer force-adopts (no lingering conflict), version +1 exactly once", () => {
    const host = new DesktopDocumentHost("original");
    host.applyEdit({ from: 0, to: 8, insert: "local dirty edit", expectedVersion: 0 });
    expect(host.phase).toBe("dirty");
    const versionBefore = host.getSnapshot().version;

    host.replaceExternal("authoritative replacement");

    expect(host.getSnapshot()).toEqual({ text: "authoritative replacement", version: versionBefore + 1 });
    expect(host.phase).toBe("clean");
    expect(host.externalChange).toBeNull();
  });

  test("replaceExternal with text identical to the current live text still bumps version exactly once", () => {
    const host = new DesktopDocumentHost("same text");
    const versionBefore = host.getSnapshot().version;

    host.replaceExternal("same text");

    expect(host.getSnapshot()).toEqual({ text: "same text", version: versionBefore + 1 });
    expect(host.phase).toBe("clean");
  });
});

// -- 3. Undo/redo: the page's history lives with the chapter's host -------
// The shared editor routes Ctrl+Z / Ctrl+Y to the host (D7). This host
// records every edit it accepts and replays the inverse through its own
// applyEdit, so an undo is one more bounded, versioned edit that notifies
// subscribers, and the source stays byte-exact along the way.

function typing(host: DesktopDocumentHost, at: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    const result = host.applyEdit({ from: at + i, to: at + i, insert: text[i], expectedVersion: host.getSnapshot().version });
    expect(result.ok).toBe(true);
  }
}

describe("DesktopDocumentHost - undo/redo", () => {
  /** A host whose clock steps by `stepMs` per edit, so grouping is decided by the test, not the wall clock. */
  const spaced = (text: string, stepMs: number, opts: { readonly?: boolean } = {}) => {
    let t = 0;
    return new DesktopDocumentHost(text, { ...opts, now: () => (t += stepMs) });
  };

  test("undo takes back the last accepted edit byte for byte and says where the caret goes", () => {
    const host = spaced("hello world", 1000);
    host.applyEdit({ from: 5, to: 5, insert: ",", expectedVersion: 0 });
    host.applyEdit({ from: 12, to: 12, insert: "!", expectedVersion: 1 });
    expect(host.getSnapshot().text).toBe("hello, world!");
    expect(host.undo()).toBe(12);
    expect(host.getSnapshot().text).toBe("hello, world");
    expect(host.undo()).toBe(5);
    expect(host.getSnapshot().text).toBe("hello world");
    expect(host.undo()).toBeNull();
    expect(host.getSnapshot().text).toBe("hello world");
  });

  test("redo puts an undone edit back; a new edit after an undo drops what could be redone", () => {
    const host = spaced("ab", 1000);
    host.applyEdit({ from: 1, to: 2, insert: "XY", expectedVersion: 0 });
    expect(host.undo()).toBe(2);
    expect(host.getSnapshot().text).toBe("ab");
    expect(host.redo()).toBe(3);
    expect(host.getSnapshot().text).toBe("aXY");
    expect(host.redo()).toBeNull();
    host.undo();
    host.applyEdit({ from: 0, to: 0, insert: "-", expectedVersion: host.getSnapshot().version });
    expect(host.redo()).toBeNull();
    expect(host.getSnapshot().text).toBe("-ab");
  });

  test("a run of typing within the grouping window is one step; a pause starts the next", () => {
    const host = spaced("hello", 100);
    typing(host, 5, " world");
    expect(host.getSnapshot().text).toBe("hello world");
    expect(host.undo()).toBe(5);
    expect(host.getSnapshot().text).toBe("hello");
    expect(host.redo()).toBe(11);
    const slow = spaced("hello", 1000);
    typing(slow, 5, " ok");
    expect(slow.undo()).toBe(7);
    expect(slow.getSnapshot().text).toBe("hello o");
  });

  test("a run of backspaces, and a run of forward deletes, are each one step", () => {
    const back = spaced("abcdef", 100);
    for (let at = 6; at > 3; at--) back.applyEdit({ from: at - 1, to: at, insert: "", expectedVersion: back.getSnapshot().version });
    expect(back.getSnapshot().text).toBe("abc");
    expect(back.undo()).toBe(6);
    expect(back.getSnapshot().text).toBe("abcdef");
    const forward = spaced("abcdef", 100);
    for (let i = 0; i < 3; i++) forward.applyEdit({ from: 1, to: 2, insert: "", expectedVersion: forward.getSnapshot().version });
    expect(forward.getSnapshot().text).toBe("aef");
    expect(forward.undo()).toBe(4);
    expect(forward.getSnapshot().text).toBe("abcdef");
  });

  test("an undo is a versioned edit like any other: version +1, subscribers told, save scheduled", () => {
    const saves: number[] = [];
    let t = 0;
    const host = new DesktopDocumentHost("x", { now: () => (t += 1000), onScheduleSave: () => saves.push(host.getSnapshot().version) });
    const seen: string[] = [];
    host.subscribe((snapshot) => seen.push(snapshot.text));
    host.applyEdit({ from: 1, to: 1, insert: "y", expectedVersion: 0 });
    host.undo();
    expect(host.getSnapshot().version).toBe(2);
    expect(seen).toEqual(["xy", "x"]);
    expect(saves.length).toBeGreaterThanOrEqual(1);
  });

  test("a change by any other path clears the history rather than replaying edits that no longer line up", () => {
    const host = spaced("one", 1000);
    host.applyEdit({ from: 3, to: 3, insert: " two", expectedVersion: 0 });
    host.replaceExternal("something else");
    expect(host.undo()).toBeNull();
    expect(host.getSnapshot().text).toBe("something else");
    host.applyEdit({ from: 0, to: 0, insert: "!", expectedVersion: host.getSnapshot().version });
    expect(host.undo()).toBe(0);
    expect(host.getSnapshot().text).toBe("something else");
  });

  test("a readonly host has nothing to undo, and a rejected edit records nothing", () => {
    const locked = spaced("keep", 1000, { readonly: true });
    expect(locked.applyEdit({ from: 0, to: 0, insert: "x", expectedVersion: 0 }).ok).toBe(false);
    expect(locked.undo()).toBeNull();
    const host = spaced("keep", 1000);
    expect(host.applyEdit({ from: 0, to: 0, insert: "x", expectedVersion: 99 }).ok).toBe(false);
    expect(host.undo()).toBeNull();
    expect(host.getSnapshot().text).toBe("keep");
  });

  test("the history holds the last 200 steps", () => {
    const host = spaced("", 1000);
    for (let i = 0; i < 205; i++) host.applyEdit({ from: i, to: i, insert: "a", expectedVersion: i });
    let undone = 0;
    while (host.undo() !== null) undone++;
    expect(undone).toBe(200);
    expect(host.getSnapshot().text).toBe("aaaaa");
  });
});
