import { expect, test } from "bun:test";
import { SyncController } from "../../src/lib/routes/sync-controller.svelte";
import type { SyncOutcome } from "../../src/lib/api";
import type { ConflictFileInfo, ProjectRemoteDiagnosis } from "../../src/lib/platform/contract";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests. The production compiler replaces $state; the class only
// needs plain values for these behavior tests (same shim as
// page-nav-controller.test / export-controller.test).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

/** Flush the microtask/macrotask queue so `.then().catch()` chains settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

type Spy<A extends unknown[] = unknown[]> = ((...a: A) => void) & { calls: A[] };
const spy = <A extends unknown[] = unknown[]>(): Spy<A> => {
  const fn = ((...a: A) => {
    fn.calls.push(a);
  }) as Spy<A>;
  fn.calls = [];
  return fn;
};

/** A fake toast surface capturing success/info/error copy. */
function makeToast() {
  return {
    success: spy<[string]>(),
    info: spy<[string]>(),
    error: spy<[string]>(),
  };
}

/**
 * Fake syncChanges: resolves each call with a configurable SyncOutcome. In
 * `manual` mode the resolution is deferred so a test can flip currentDir /
 * conflictOpen mid-flight before it settles.
 */
class FakeSync {
  calls: string[] = [];
  next: SyncOutcome = { status: "up-to-date", message: "" };
  manual = false;
  private pending: Array<(v: SyncOutcome) => void> = [];

  fn = (dir: string): Promise<SyncOutcome> => {
    this.calls.push(dir);
    if (this.manual) {
      return new Promise<SyncOutcome>((res) => this.pending.push(res));
    }
    return Promise.resolve(this.next);
  };

  resolveAll(): void {
    const s = this.next;
    this.pending.splice(0).forEach((r) => r(s));
  }
}

interface Harness {
  ctrl: SyncController;
  sync: FakeSync;
  toast: ReturnType<typeof makeToast> | null;
  dir: string | null;
  diagnose: Spy<[string]> & { next: ProjectRemoteDiagnosis | null; throws: boolean };
  onSyncCompleted: Spy<[boolean, boolean]>;
  onFilesChanged: Spy<[]>;
}

const DIAG: ProjectRemoteDiagnosis = {
  classification: "git-local" as ProjectRemoteDiagnosis["classification"],
  remoteProtocol: "https",
  credentialPresent: true,
  provider: "github",
} as ProjectRemoteDiagnosis;

function make(over: Partial<{ dir: string | null; hasToast: boolean }> = {}): Harness {
  const sync = new FakeSync();
  const toast = over.hasToast === false ? null : makeToast();
  const onSyncCompleted = spy<[boolean, boolean]>();
  const onFilesChanged = spy<[]>();
  const diagnose = Object.assign(spy<[string]>(), {
    next: DIAG as ProjectRemoteDiagnosis | null,
    throws: false,
  });
  const h = {
    sync,
    toast,
    dir: over.dir === undefined ? "/proj" : over.dir,
    diagnose,
    onSyncCompleted,
    onFilesChanged,
  } as Harness;
  h.ctrl = new SyncController({
    syncChanges: (dir) => sync.fn(dir),
    diagnose: (dir) => {
      diagnose(dir);
      if (h.diagnose.throws) return Promise.reject(new Error("boom"));
      return Promise.resolve(h.diagnose.next as ProjectRemoteDiagnosis);
    },
    currentDir: () => h.dir,
    toast: () => h.toast,
    onSyncCompleted: (merged, filesChanged) => onSyncCompleted(merged, filesChanged),
    onFilesChanged: () => onFilesChanged(),
  });
  return h;
}

const FILES: ConflictFileInfo[] = [{ path: "a.md", kind: "both-edited" }];

// ── initial state ────────────────────────────────────────────────────────────

test("initial public rune state matches the +page.svelte defaults", () => {
  const { ctrl } = make();
  expect(ctrl.conflictOpen).toBe(false);
  expect(ctrl.conflictFiles).toEqual([]);
  expect(ctrl.conflictLocalId).toBe(null);
  expect(ctrl.conflictRemoteId).toBe(null);
  expect(ctrl.conflictPending).toBe(false);
  expect(ctrl.conflictFetchFailed).toBe(false);
  expect(ctrl.forceSyncing).toBe(false);
  expect(ctrl.syncDiag).toBe(null);
});

// ── handleForceSync ──────────────────────────────────────────────────────────

test("handleForceSync no-ops when there is no open project", async () => {
  const h = make({ dir: null });
  await h.ctrl.handleForceSync();
  expect(h.sync.calls.length).toBe(0);
  expect(h.ctrl.forceSyncing).toBe(false);
});

test("handleForceSync no-ops when a sync is already in flight", async () => {
  const h = make();
  h.ctrl.forceSyncing = true;
  await h.ctrl.handleForceSync();
  expect(h.sync.calls.length).toBe(0);
});

test("handleForceSync sets forceSyncing during flight and clears it after", async () => {
  const h = make();
  h.sync.manual = true;
  h.sync.next = { status: "up-to-date", message: "" };
  const p = h.ctrl.handleForceSync();
  expect(h.ctrl.forceSyncing).toBe(true);
  expect(h.sync.calls).toEqual(["/proj"]);
  h.sync.resolveAll();
  await p;
  expect(h.ctrl.forceSyncing).toBe(false);
});

test("handleForceSync conflict -> fills files/ids and opens the dialog", async () => {
  const h = make();
  h.sync.next = {
    status: "conflict",
    message: "",
    files: FILES,
    localId: "L1",
    remoteId: "R1",
  };
  await h.ctrl.handleForceSync();
  expect(h.ctrl.conflictFiles).toEqual(FILES);
  expect(h.ctrl.conflictLocalId).toBe("L1");
  expect(h.ctrl.conflictRemoteId).toBe("R1");
  expect(h.ctrl.conflictOpen).toBe(true);
  expect(h.ctrl.conflictPending).toBe(false);
  expect(h.ctrl.conflictFetchFailed).toBe(false);
  expect(h.onSyncCompleted.calls.length).toBe(0);
});

test("handleForceSync synced -> onSyncCompleted(merged, filesChanged)", async () => {
  const h = make();
  h.sync.next = { status: "synced", message: "", mergedRemoteChanges: true, filesChanged: true };
  await h.ctrl.handleForceSync();
  expect(h.onSyncCompleted.calls).toEqual([[true, true]]);
});

test("handleForceSync synced -> filesChanged coerces missing to false", async () => {
  const h = make();
  h.sync.next = { status: "synced", message: "", mergedRemoteChanges: false };
  await h.ctrl.handleForceSync();
  expect(h.onSyncCompleted.calls).toEqual([[false, false]]);
});

test("handleForceSync up-to-date WITH filesChanged -> onSyncCompleted(false,true), no info toast", async () => {
  const h = make();
  h.sync.next = { status: "up-to-date", message: "", filesChanged: true };
  await h.ctrl.handleForceSync();
  expect(h.onSyncCompleted.calls).toEqual([[false, true]]);
  expect(h.toast!.info.calls.length).toBe(0);
});

test("handleForceSync up-to-date no change -> info toast only", async () => {
  const h = make();
  h.sync.next = { status: "up-to-date", message: "" };
  await h.ctrl.handleForceSync();
  expect(h.onSyncCompleted.calls.length).toBe(0);
  expect(h.toast!.info.calls).toEqual([["Already up to date — no changes to sync."]]);
});

test("handleForceSync auth -> error toast; onFilesChanged only when filesChanged", async () => {
  const noChange = make();
  noChange.sync.next = { status: "auth", message: "" };
  await noChange.ctrl.handleForceSync();
  expect(noChange.toast!.error.calls).toEqual([
    ["Not connected. Use Connect in the sidebar to set up syncing."],
  ]);
  expect(noChange.onFilesChanged.calls.length).toBe(0);

  const changed = make();
  changed.sync.next = { status: "auth", message: "", filesChanged: true };
  await changed.ctrl.handleForceSync();
  expect(changed.onFilesChanged.calls.length).toBe(1);
  expect(changed.toast!.error.calls.length).toBe(1);
});

test("handleForceSync offline -> info toast; onFilesChanged only when filesChanged", async () => {
  const noChange = make();
  noChange.sync.next = { status: "offline", message: "" };
  await noChange.ctrl.handleForceSync();
  expect(noChange.toast!.info.calls).toEqual([
    ["You appear to be offline. Try again when connected."],
  ]);
  expect(noChange.onFilesChanged.calls.length).toBe(0);

  const changed = make();
  changed.sync.next = { status: "offline", message: "", filesChanged: true };
  await changed.ctrl.handleForceSync();
  expect(changed.onFilesChanged.calls.length).toBe(1);
});

test("handleForceSync error -> error toast; onFilesChanged only when filesChanged", async () => {
  const noChange = make();
  noChange.sync.next = { status: "error", message: "" };
  await noChange.ctrl.handleForceSync();
  expect(noChange.toast!.error.calls).toEqual([
    ["Couldn't update the online copy. Your work is saved on this computer — we'll try again later."],
  ]);
  expect(noChange.onFilesChanged.calls.length).toBe(0);

  const changed = make();
  changed.sync.next = { status: "error", message: "", filesChanged: true };
  await changed.ctrl.handleForceSync();
  expect(changed.onFilesChanged.calls.length).toBe(1);
});

test("handleForceSync rejection -> reassuring error toast (no raw message); clears forceSyncing", async () => {
  const toast = makeToast();
  const ctrl = new SyncController({
    syncChanges: () => Promise.reject(new Error("net down")),
    diagnose: () => Promise.resolve(DIAG),
    currentDir: () => "/proj",
    toast: () => toast,
    onSyncCompleted: () => {},
    onFilesChanged: () => {},
  });
  await ctrl.handleForceSync();
  // The raw error text ("net down") is deliberately NOT surfaced — the writer
  // gets a calm, reassuring message that says their local work is safe.
  expect(toast.error.calls).toEqual([
    ["Couldn't update the online copy. Your work is saved on this computer — we'll try again later."],
  ]);
  expect(ctrl.forceSyncing).toBe(false);
});

test("handleForceSync project switch mid-sync -> no state applied, forceSyncing stays set for stale dir", async () => {
  const h = make();
  h.sync.manual = true;
  h.sync.next = {
    status: "conflict",
    message: "",
    files: FILES,
    localId: "L1",
    remoteId: "R1",
  };
  const p = h.ctrl.handleForceSync();
  expect(h.ctrl.forceSyncing).toBe(true);
  // User switches projects before the sync resolves.
  h.dir = "/other";
  h.sync.resolveAll();
  await p;
  // Stale outcome must be discarded entirely.
  expect(h.ctrl.conflictOpen).toBe(false);
  expect(h.ctrl.conflictFiles).toEqual([]);
  expect(h.onSyncCompleted.calls.length).toBe(0);
  // finally only clears forceSyncing when currentDir still matches dir.
  expect(h.ctrl.forceSyncing).toBe(true);
});

// ── onPillConflict ─────────────────────────────────────────────────────────

test("onPillConflict no-ops when there is no open project", async () => {
  const h = make({ dir: null });
  h.ctrl.onPillConflict(FILES);
  expect(h.ctrl.conflictOpen).toBe(false);
  expect(h.sync.calls.length).toBe(0);
});

test("onPillConflict opens the dialog immediately with files + nulled ids, and fetches ids (legacy/no-id emit site)", () => {
  const h = make();
  h.sync.manual = true;
  h.ctrl.onPillConflict(FILES);
  expect(h.ctrl.conflictOpen).toBe(true);
  expect(h.ctrl.conflictFiles).toEqual(FILES);
  expect(h.ctrl.conflictLocalId).toBe(null);
  expect(h.ctrl.conflictRemoteId).toBe(null);
  expect(h.ctrl.conflictPending).toBe(true);
  expect(h.sync.calls).toEqual(["/proj"]);
});

// ── M13: ids carried directly on the conflict payload — no second sync ──────

test("onPillConflict with localId+remoteId already present skips the network fetch entirely (M13)", () => {
  const h = make();
  h.ctrl.onPillConflict(FILES, "L1", "R1");
  expect(h.ctrl.conflictOpen).toBe(true);
  expect(h.ctrl.conflictFiles).toEqual(FILES);
  expect(h.ctrl.conflictLocalId).toBe("L1");
  expect(h.ctrl.conflictRemoteId).toBe("R1");
  expect(h.ctrl.conflictPending).toBe(false);
  expect(h.ctrl.conflictFetchFailed).toBe(false);
  // The whole point: no second network sync was made.
  expect(h.sync.calls.length).toBe(0);
});

test("onPillConflict falls back to the network fetch when only ONE id is present", () => {
  const h = make();
  h.sync.manual = true;
  h.ctrl.onPillConflict(FILES, "L1", undefined);
  expect(h.ctrl.conflictLocalId).toBe(null);
  expect(h.ctrl.conflictPending).toBe(true);
  expect(h.sync.calls).toEqual(["/proj"]);
});

test("onPillConflict fallback fetch sets conflictPending then clears it on success", async () => {
  const h = make();
  h.sync.manual = true;
  h.sync.next = {
    status: "conflict",
    message: "",
    files: FILES,
    localId: "L9",
    remoteId: "R9",
  };
  h.ctrl.onPillConflict(FILES);
  expect(h.ctrl.conflictPending).toBe(true);
  h.sync.resolveAll();
  await flush();
  expect(h.ctrl.conflictPending).toBe(false);
  expect(h.ctrl.conflictFetchFailed).toBe(false);
  expect(h.ctrl.conflictLocalId).toBe("L9");
  expect(h.ctrl.conflictRemoteId).toBe("R9");
});

test("onPillConflict fallback fetch failure sets conflictFetchFailed (not a dead silent button)", async () => {
  const ctrl = new SyncController({
    syncChanges: () => Promise.reject(new Error("net down")),
    diagnose: () => Promise.resolve(DIAG),
    currentDir: () => "/proj",
    toast: () => null,
    onSyncCompleted: () => {},
    onFilesChanged: () => {},
  });
  ctrl.onPillConflict(FILES);
  expect(ctrl.conflictPending).toBe(true);
  await flush();
  expect(ctrl.conflictPending).toBe(false);
  expect(ctrl.conflictFetchFailed).toBe(true);
  expect(ctrl.conflictOpen).toBe(true); // dialog stays open, not silently dead
});

test("onPillConflict fallback fetch resolving to auth/offline/error sets conflictFetchFailed", async () => {
  const h = make();
  h.sync.next = { status: "auth", message: "" };
  h.ctrl.onPillConflict(FILES);
  await flush();
  expect(h.ctrl.conflictFetchFailed).toBe(true);
  expect(h.ctrl.conflictPending).toBe(false);
  expect(h.ctrl.conflictOpen).toBe(true);
});

test("retryConflictIds re-runs the fallback fetch and can recover from a failure", async () => {
  const h = make();
  h.sync.next = { status: "auth", message: "" };
  h.ctrl.onPillConflict(FILES);
  await flush();
  expect(h.ctrl.conflictFetchFailed).toBe(true);

  h.sync.next = {
    status: "conflict",
    message: "",
    files: FILES,
    localId: "LR",
    remoteId: "RR",
  };
  h.ctrl.retryConflictIds();
  expect(h.ctrl.conflictPending).toBe(true);
  await flush();
  expect(h.ctrl.conflictFetchFailed).toBe(false);
  expect(h.ctrl.conflictLocalId).toBe("LR");
  expect(h.ctrl.conflictRemoteId).toBe("RR");
  expect(h.sync.calls).toEqual(["/proj", "/proj"]);
});

test("retryConflictIds no-ops when there is no open project or dialog is closed", () => {
  const noProject = make({ dir: null });
  noProject.ctrl.retryConflictIds();
  expect(noProject.sync.calls.length).toBe(0);

  const closed = make();
  closed.ctrl.retryConflictIds();
  expect(closed.sync.calls.length).toBe(0);
});

test("onPillConflict conflict outcome -> fills localId/remoteId", async () => {
  const h = make();
  h.sync.next = {
    status: "conflict",
    message: "",
    files: FILES,
    localId: "L9",
    remoteId: "R9",
  };
  h.ctrl.onPillConflict([{ path: "seed.md", kind: "both-edited" }]);
  await flush();
  expect(h.ctrl.conflictOpen).toBe(true);
  expect(h.ctrl.conflictFiles).toEqual(FILES);
  expect(h.ctrl.conflictLocalId).toBe("L9");
  expect(h.ctrl.conflictRemoteId).toBe("R9");
});

test("onPillConflict synced outcome -> closes dialog + onSyncCompleted(merged,filesChanged)", async () => {
  const h = make();
  h.sync.next = { status: "synced", message: "", mergedRemoteChanges: true, filesChanged: true };
  h.ctrl.onPillConflict(FILES);
  await flush();
  expect(h.ctrl.conflictOpen).toBe(false);
  expect(h.onSyncCompleted.calls).toEqual([[true, true]]);
});

test("onPillConflict up-to-date outcome -> closes dialog + onSyncCompleted(false,filesChanged)", async () => {
  const h = make();
  h.sync.next = { status: "up-to-date", message: "", filesChanged: true };
  h.ctrl.onPillConflict(FILES);
  await flush();
  expect(h.ctrl.conflictOpen).toBe(false);
  expect(h.onSyncCompleted.calls).toEqual([[false, true]]);
});

test("onPillConflict discards result if the project switched mid-fetch", async () => {
  const h = make();
  h.sync.manual = true;
  h.sync.next = {
    status: "conflict",
    message: "",
    files: FILES,
    localId: "L1",
    remoteId: "R1",
  };
  h.ctrl.onPillConflict([{ path: "seed.md", kind: "both-edited" }]);
  h.dir = "/other";
  h.sync.resolveAll();
  await flush();
  // Ids never filled because the fetch result was discarded.
  expect(h.ctrl.conflictLocalId).toBe(null);
  expect(h.ctrl.conflictRemoteId).toBe(null);
});

test("onPillConflict discards result if the dialog was closed mid-fetch", async () => {
  const h = make();
  h.sync.manual = true;
  h.sync.next = { status: "synced", message: "", mergedRemoteChanges: false };
  h.ctrl.onPillConflict(FILES);
  // Author closes the dialog before the sync resolves.
  h.ctrl.conflictOpen = false;
  h.sync.resolveAll();
  await flush();
  expect(h.onSyncCompleted.calls.length).toBe(0);
});

test("onPillConflict swallows a rejected sync and leaves the dialog open", async () => {
  const h = make();
  const reject = () => Promise.reject(new Error("net"));
  const ctrl = new SyncController({
    syncChanges: reject,
    diagnose: () => Promise.resolve(DIAG),
    currentDir: () => "/proj",
    toast: () => h.toast,
    onSyncCompleted: () => {},
    onFilesChanged: () => {},
  });
  ctrl.onPillConflict(FILES);
  await flush();
  expect(ctrl.conflictOpen).toBe(true);
  expect(ctrl.conflictFiles).toEqual(FILES);
});

// ── refreshSyncDiag ────────────────────────────────────────────────────────

test("refreshSyncDiag sets syncDiag on success when the project still matches", async () => {
  const h = make();
  h.diagnose.next = DIAG;
  await h.ctrl.refreshSyncDiag("/proj");
  expect(h.diagnose.calls).toEqual([["/proj"]]);
  expect(h.ctrl.syncDiag).toBe(DIAG);
});

test("refreshSyncDiag does NOT set syncDiag when the project changed mid-flight", async () => {
  const h = make();
  h.diagnose.next = DIAG;
  const p = h.ctrl.refreshSyncDiag("/proj");
  h.dir = "/other";
  await p;
  expect(h.ctrl.syncDiag).toBe(null);
});

test("refreshSyncDiag nulls syncDiag on a thrown diagnosis", async () => {
  const h = make();
  h.ctrl.syncDiag = DIAG;
  h.diagnose.throws = true;
  await h.ctrl.refreshSyncDiag("/proj");
  expect(h.ctrl.syncDiag).toBe(null);
});

// ── clearConflict ──────────────────────────────────────────────────────────

test("clearConflict resets files/ids/pending/failed (dialog onResolved cleanup) without touching conflictOpen", () => {
  const h = make();
  h.ctrl.conflictFiles = FILES;
  h.ctrl.conflictLocalId = "L1";
  h.ctrl.conflictRemoteId = "R1";
  h.ctrl.conflictPending = true;
  h.ctrl.conflictFetchFailed = true;
  h.ctrl.clearConflict();
  expect(h.ctrl.conflictFiles).toEqual([]);
  expect(h.ctrl.conflictLocalId).toBe(null);
  expect(h.ctrl.conflictRemoteId).toBe(null);
  expect(h.ctrl.conflictPending).toBe(false);
  expect(h.ctrl.conflictFetchFailed).toBe(false);
});

// ── applyReconflict (2026-08 field incident) ────────────────────────────────

test("applyReconflict replaces files/ids so the dialog re-renders against the NEW conflict", () => {
  const h = make();
  h.ctrl.conflictOpen = true;
  h.ctrl.conflictFiles = FILES;
  h.ctrl.conflictLocalId = "L1";
  h.ctrl.conflictRemoteId = "R1";
  h.ctrl.conflictPending = true;
  h.ctrl.conflictFetchFailed = true;
  const fresh: ConflictFileInfo[] = [{ path: "b.md", kind: "both-edited" }];
  h.ctrl.applyReconflict(fresh, "L2", "R2");
  expect(h.ctrl.conflictFiles).toEqual(fresh);
  expect(h.ctrl.conflictLocalId).toBe("L2");
  expect(h.ctrl.conflictRemoteId).toBe("R2");
  expect(h.ctrl.conflictPending).toBe(false);
  expect(h.ctrl.conflictFetchFailed).toBe(false);
});

test("applyReconflict is a no-op when the dialog is already closed (stale resolution result)", () => {
  const h = make();
  h.ctrl.conflictOpen = false;
  h.ctrl.conflictFiles = FILES;
  h.ctrl.conflictLocalId = "L1";
  h.ctrl.conflictRemoteId = "R1";
  h.ctrl.applyReconflict([{ path: "b.md", kind: "both-edited" }], "L2", "R2");
  expect(h.ctrl.conflictFiles).toEqual(FILES);
  expect(h.ctrl.conflictLocalId).toBe("L1");
  expect(h.ctrl.conflictRemoteId).toBe("R1");
});
