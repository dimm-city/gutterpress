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
 * ## Coordination note — blocked import
 *
 * `packages/desktop/package.json` does not yet declare a dependency on
 * `@dimm-city/gutterpress-editor` (that edge is Lane C's / the
 * integrator's — see the run specification and this run's lane report).
 * Until `bun install` links it, THIS FILE cannot resolve
 * `@dimm-city/gutterpress-editor` and `bun test` on it fails with
 * "Cannot find module" — expected and recorded in the lane report, not
 * worked around with a relative-path fallback import.
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

  test("reset/open re-identity: reset drops the document, open re-establishes a fresh identity at version 0", () => {
    const host = new DesktopDocumentHost("original", { documentId: "/book/a.md" });
    host.applyEdit({ from: 0, to: 0, insert: "!", expectedVersion: 0 });
    expect(host.documentId).toBe("/book/a.md");
    expect(host.getSnapshot().version).toBe(1);

    const resetOutcome = host.reset();
    expect(resetOutcome).toEqual({ phase: "clean" });
    expect(host.documentId).toBeNull();
    expect(host.getSnapshot()).toEqual({ text: "", version: 0 });

    const openOutcome = host.open("/book/b.md", "fresh document", 7);
    expect(openOutcome).toEqual({ phase: "clean" });
    expect(host.documentId).toBe("/book/b.md");
    expect(host.getSnapshot()).toEqual({ text: "fresh document", version: 0 });
    expect(host.diskBaseline).toEqual({ text: "fresh document", stamp: 7 });

    // A stale edit computed against the PRIOR identity's version must not
    // be honored against the new document — proves open() genuinely
    // resets, rather than merely relabeling, the version counter.
    const staleAcrossSwitch = host.applyEdit({ from: 0, to: 0, insert: "x", expectedVersion: 1 });
    expect(staleAcrossSwitch.ok).toBe(false);
    if (!staleAcrossSwitch.ok) expect(staleAcrossSwitch.reason).toBe("stale");
  });

  test("open() notifies subscribers with the new document's snapshot (a genuine identity change)", () => {
    const host = new DesktopDocumentHost("first");
    const seen: Array<{ text: string; version: number }> = [];
    host.subscribe((snapshot) => seen.push(snapshot));

    host.open("/book/other.md", "second", 1);

    expect(seen).toEqual([{ text: "second", version: 0 }]);
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
