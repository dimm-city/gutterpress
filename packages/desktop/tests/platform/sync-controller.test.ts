import { expect, test } from "bun:test";
import {
  combinedFilesMessage,
  keptBothMessage,
  SyncController,
} from "../../src/lib/routes/sync-controller.svelte";
import type { SyncOutcome, KeptBothFile, ProjectRemoteDiagnosis } from "../../src/lib/platform/contract";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests. The production compiler replaces $state; the class only
// needs plain values for these behavior tests (same shim as
// page-nav-controller.test / export-controller.test).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

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

class FakeSync {
  calls: string[] = [];
  next: SyncOutcome = { status: "up-to-date", message: "" };
  fn = (dir: string): Promise<SyncOutcome> => {
    this.calls.push(dir);
    return Promise.resolve(this.next);
  };
}

const DIAG: ProjectRemoteDiagnosis = {
  hasRemote: true,
  protocol: "https",
  host: "github.com",
  provider: "github",
  connected: true,
  connectionLabel: null,
  tokenSettingsUrl: null,
  canSync: true,
  guidance: "ready-to-sync",
} as unknown as ProjectRemoteDiagnosis;

interface Harness {
  ctrl: SyncController;
  sync: FakeSync;
  toast: ReturnType<typeof makeToast>;
  onSyncCompleted: Spy<[boolean, boolean]>;
  onFilesChanged: Spy<[]>;
  dir: string | null;
  diagnose: { next: ProjectRemoteDiagnosis | null; throws: boolean };
}

function make(): Harness {
  const sync = new FakeSync();
  const toast = makeToast();
  const onSyncCompleted = spy<[boolean, boolean]>();
  const onFilesChanged = spy<[]>();
  const h: Harness = {
    ctrl: null as unknown as SyncController,
    sync,
    toast,
    onSyncCompleted,
    onFilesChanged,
    dir: "/proj",
    diagnose: { next: DIAG, throws: false },
  };
  h.ctrl = new SyncController({
    syncChanges: (d) => sync.fn(d),
    diagnose: () =>
      h.diagnose.throws
        ? Promise.reject(new Error("diag down"))
        : Promise.resolve(h.diagnose.next as ProjectRemoteDiagnosis),
    currentDir: () => h.dir,
    toast: () => toast,
    onSyncCompleted: (merged, filesChanged) => onSyncCompleted(merged, filesChanged),
    onFilesChanged: () => onFilesChanged(),
  });
  return h;
}

const CLASH: KeptBothFile = {
  path: "images/cover.png",
  onlinePath: "images/cover.online.png",
};

// ── Initial state ────────────────────────────────────────────────────────────

test("initial public rune state", () => {
  const h = make();
  expect(h.ctrl.syncDiag).toBe(null);
  expect(h.ctrl.forceSyncing).toBe(false);
});

// ── handleForceSync ──────────────────────────────────────────────────────────

test("synced -> onSyncCompleted with merged/filesChanged flags", async () => {
  const h = make();
  h.sync.next = { status: "synced", message: "", mergedRemoteChanges: true, filesChanged: true };
  await h.ctrl.handleForceSync();
  expect(h.onSyncCompleted.calls).toEqual([[true, true]]);
  expect(h.ctrl.forceSyncing).toBe(false);
});

test("synced with a converge report -> one toast per kind of kept-both file", async () => {
  const h = make();
  h.sync.next = {
    status: "synced",
    message: "",
    mergedRemoteChanges: true,
    combinedFiles: ["chapters/chapter-02.md"],
    keptBothFiles: [CLASH],
  };
  await h.ctrl.handleForceSync();
  expect(h.toast.info.calls).toHaveLength(2);
  expect(h.toast.info.calls[0]![0]).toContain("chapter-02.md");
  expect(h.toast.info.calls[0]![0]).toContain("both versions are kept");
  expect(h.toast.info.calls[1]![0]).toContain("cover.png");
  expect(h.toast.info.calls[1]![0]).toContain("cover.online.png");
});

test("up-to-date without changes -> info toast only", async () => {
  const h = make();
  h.sync.next = { status: "up-to-date", message: "" };
  await h.ctrl.handleForceSync();
  expect(h.toast.info.calls).toEqual([["Already up to date — no changes to sync."]]);
  expect(h.onSyncCompleted.calls).toEqual([]);
});

test("up-to-date WITH filesChanged -> onSyncCompleted(false, true)", async () => {
  const h = make();
  h.sync.next = { status: "up-to-date", message: "", filesChanged: true };
  await h.ctrl.handleForceSync();
  expect(h.onSyncCompleted.calls).toEqual([[false, true]]);
});

test("auth -> error toast; onFilesChanged only when filesChanged", async () => {
  const noChange = make();
  noChange.sync.next = { status: "auth", message: "" };
  await noChange.ctrl.handleForceSync();
  expect(noChange.toast.error.calls).toEqual([
    ["Not connected. Use Connect in the sidebar to set up syncing."],
  ]);
  expect(noChange.onFilesChanged.calls.length).toBe(0);

  const changed = make();
  changed.sync.next = { status: "auth", message: "", filesChanged: true };
  await changed.ctrl.handleForceSync();
  expect(changed.onFilesChanged.calls.length).toBe(1);
});

test("offline -> info toast", async () => {
  const h = make();
  h.sync.next = { status: "offline", message: "" };
  await h.ctrl.handleForceSync();
  expect(h.toast.info.calls).toEqual([["You appear to be offline. Try again when connected."]]);
});

test("error -> the outcome's authored guidance is shown, not a false 'we'll try again later'", async () => {
  // The lib's error-arm messages are ALL authored writer copy (the MSG_*
  // constants or an authored generic — transport.ts failureOutcome), and
  // some are actionable in a way a generic retry promise is not.
  const h = make();
  h.sync.next = {
    status: "error",
    message:
      "The online address points at a different project's files, so the two can't be combined. Check the project's online address.",
  };
  await h.ctrl.handleForceSync();
  expect(h.toast.error.calls).toEqual([
    [
      "The online address points at a different project's files, so the two can't be combined. Check the project's online address.",
    ],
  ]);
});

test("error with no message -> the fixed reassuring fallback", async () => {
  const h = make();
  h.sync.next = { status: "error", message: "" };
  await h.ctrl.handleForceSync();
  expect(h.toast.error.calls).toEqual([
    ["Couldn't update the online copy. Your work is saved on this computer — we'll try again later."],
  ]);
});

test("rejection -> reassuring toast (no raw message); clears forceSyncing", async () => {
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
  expect(toast.error.calls).toEqual([
    ["Couldn't update the online copy. Your work is saved on this computer — we'll try again later."],
  ]);
  expect(ctrl.forceSyncing).toBe(false);
});

test("project switched mid-sync -> no state applied", async () => {
  const h = make();
  const inner = h.sync.fn;
  h.sync.next = {
    status: "synced",
    message: "",
    mergedRemoteChanges: true,
    keptBothFiles: [CLASH],
  };
  h.sync.fn = async (dir) => {
    h.dir = "/other"; // switch DURING the sync
    return inner(dir);
  };
  h.dir = "/proj";
  await h.ctrl.handleForceSync();
  expect(h.onSyncCompleted.calls).toEqual([]);
  expect(h.toast.info.calls).toEqual([]);
});

test("re-entry guarded by forceSyncing", async () => {
  const h = make();
  h.ctrl.forceSyncing = true;
  await h.ctrl.handleForceSync();
  expect(h.sync.calls).toEqual([]);
});

// ── Converge report ─────────────────────────────────────────────────────────

test("applyConvergeReport with nothing to report is a no-op", () => {
  const h = make();
  h.ctrl.applyConvergeReport(undefined, undefined);
  h.ctrl.applyConvergeReport([], []);
  expect(h.toast.info.calls).toEqual([]);
});

test("keptBothMessage names the pair and never says 'conflict'", () => {
  const one = keptBothMessage([CLASH]);
  expect(one).toContain("cover.png");
  expect(one).toContain("cover.online.png");
  expect(one).toContain("changed in two places");
  expect(one).not.toContain("conflict");
  const many = keptBothMessage(
    ["a", "b", "c", "d", "e"].map((n) => ({ path: `${n}.png`, onlinePath: `${n}.online.png` })),
  );
  expect(many).toContain("and 2 more");
});

test("combinedFilesMessage names up to three files then counts the rest", () => {
  expect(combinedFilesMessage(["a/one.md"])).toContain("one.md");
  const many = combinedFilesMessage(["a.md", "b.md", "c.md", "d.md", "e.md"]);
  expect(many).toContain("a.md, b.md, c.md");
  expect(many).toContain("and 2 more");
});

// ── refreshSyncDiag ──────────────────────────────────────────────────────────

test("refreshSyncDiag sets syncDiag for the current project", async () => {
  const h = make();
  await h.ctrl.refreshSyncDiag("/proj");
  expect(h.ctrl.syncDiag).toBe(DIAG);
});

test("refreshSyncDiag does NOT set syncDiag when the project changed mid-flight", async () => {
  const h = make();
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
