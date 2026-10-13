import { expect, test } from "bun:test";
import {
  combinedFilesMessage,
  keptBothMessage,
  SyncController,
} from "../../src/lib/routes/sync-controller.svelte";
import type { SyncOutcome } from "../../src/lib/api";
import type { KeptBothFile, ProjectRemoteDiagnosis } from "../../src/lib/platform/contract";

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
    repair: () => Promise.reject(new Error("not wired in this test")),
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
  expect(h.toast.info.calls).toEqual([["Already up to date — nothing new to back up."]]);
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
    ["Not signed in to online backup. Use the button in Where your work is kept to sign in."],
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
  expect(h.toast.info.calls).toEqual([["You're offline. Try the online backup again when you're connected."]]);
});

test("error -> the outcome's authored guidance is shown, not a false 'we'll try again later'", async () => {
  // The lib's error-arm messages are ALL authored writer copy (the MSG_*
  // constants or an authored generic — transport.ts failureOutcome), and
  // some are actionable in a way a generic retry promise is not.
  const h = make();
  h.sync.next = {
    status: "error",
    message:
      "The online address points at a different book's files, so the two can't be combined. Check the book's online address.",
  };
  await h.ctrl.handleForceSync();
  expect(h.toast.error.calls).toEqual([
    [
      "The online address points at a different book's files, so the two can't be combined. Check the book's online address.",
    ],
  ]);
});

test("error with no message -> the fixed reassuring fallback", async () => {
  const h = make();
  h.sync.next = { status: "error", message: "" };
  await h.ctrl.handleForceSync();
  expect(h.toast.error.calls).toEqual([
    ["Couldn't finish the online backup. Your work is saved on this computer — we'll try again later."],
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
    ["Couldn't finish the online backup. Your work is saved on this computer — we'll try again later."],
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

test("a manual backup publishes its outcome for the status dialog (state + finish time)", async () => {
  const h = make();
  expect(h.ctrl.lastManual).toBeNull();
  h.sync.next = { status: "offline", message: "" };
  await h.ctrl.handleForceSync();
  expect(h.ctrl.lastManual).toMatchObject({ state: "offline" });
  expect(Number.isNaN(Date.parse(h.ctrl.lastManual!.at))).toBe(false);
  h.sync.next = { status: "up-to-date", message: "" };
  await h.ctrl.handleForceSync();
  expect(h.ctrl.lastManual!.state).toBe("synced");
  h.sync.next = { status: "auth", message: "" };
  await h.ctrl.handleForceSync();
  expect(h.ctrl.lastManual!.state).toBe("auth");
  h.sync.next = { status: "error", message: "" };
  await h.ctrl.handleForceSync();
  expect(h.ctrl.lastManual!.state).toBe("error");
});

test("with automatic online backup off, a failure never promises an automatic retry", async () => {
  const toast = makeToast();
  const ctrl = new SyncController({
    syncChanges: () => Promise.reject(new Error("net down")),
    diagnose: () => Promise.resolve(DIAG),
    currentDir: () => "/proj",
    toast: () => toast,
    onSyncCompleted: () => {},
    onFilesChanged: () => {},
    autoBackup: () => false,
  });
  await ctrl.handleForceSync();
  expect(toast.error.calls).toEqual([
    ["Couldn't finish the online backup. Your work is saved on this computer — try again when you're ready."],
  ]);
  expect(ctrl.lastManual!.state).toBe("error");
});

// ── Repair online backup ─────────────────────────────────────────────────────

function makeWithRepair(result: { outcome: SyncOutcome; restoredFiles: string[] } | Error) {
  const h = make() as Harness & { calls: string[] };
  const calls: string[] = [];
  h.calls = calls;
  h.ctrl = new SyncController({
    syncChanges: (d) => h.sync.fn(d),
    repair: (d) => {
      calls.push(d);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
    diagnose: () => Promise.resolve(DIAG),
    currentDir: () => h.dir,
    toast: () => h.toast,
    onSyncCompleted: (m, f) => h.onSyncCompleted(m, f),
    onFilesChanged: () => h.onFilesChanged(),
  });
  return h;
}

test("handleRepair: a repaired book reports synced, toasts once, and reloads the files", async () => {
  const h = makeWithRepair({ outcome: { status: "synced", message: "", mergedRemoteChanges: false }, restoredFiles: ["b.md"] });
  await h.ctrl.handleRepair();
  expect(h.calls).toEqual(["/proj"]);
  expect(h.ctrl.lastManual?.state).toBe("synced");
  expect(h.toast.success.calls[0][0]).toContain("repaired");
  expect(h.toast.success.calls[0][0]).toContain("1 file");
  expect(h.onSyncCompleted.calls[0]).toEqual([true, true]);
});

test("handleRepair: a repair whose closing backup failed shows the lib's message and records error", async () => {
  const h = makeWithRepair({ outcome: { status: "error", message: "Everything is in sync." }, restoredFiles: [] });
  await h.ctrl.handleRepair();
  expect(h.ctrl.lastManual?.state).toBe("error");
  expect(h.toast.error.calls[0][0]).toBe("Everything is in sync.");
});

test("handleRepair: a thrown repair toasts the fixed failure line and records error", async () => {
  const h = makeWithRepair(new Error("ENOSPC"));
  await h.ctrl.handleRepair();
  expect(h.toast.error.calls[0][0]).toContain("The repair didn't finish");
  expect(h.ctrl.lastManual?.state).toBe("error");
});

test("handleRepair: a no-op when no project is open", async () => {
  const h = makeWithRepair({ outcome: { status: "synced", message: "", mergedRemoteChanges: false }, restoredFiles: [] });
  h.dir = null;
  await h.ctrl.handleRepair();
  expect(h.calls).toEqual([]);
});

// ── Get latest and the "new changes online" prompt ──────────────────────────

function makeManual(opts: { auto?: boolean; available?: boolean; reason?: string; latest?: SyncOutcome | Error } = {}) {
  const toast = { ...makeToast(), show: spy<[string, string?, number?, { label: string; onClick: () => void }?]>() };
  const onFilesChanged = spy<[]>();
  const checks: string[] = [];
  const pulls: string[] = [];
  const state = { dir: "/proj" as string | null, available: opts.available ?? true, reason: opts.reason };
  const latest = opts.latest ?? { status: "synced", message: "", mergedRemoteChanges: true, filesChanged: true };
  const ctrl = new SyncController({
    syncChanges: () => Promise.resolve({ status: "up-to-date", message: "" }),
    getLatest: (d) => {
      pulls.push(d);
      return latest instanceof Error ? Promise.reject(latest) : Promise.resolve(latest);
    },
    checkUpdates: (d) => {
      checks.push(d);
      return Promise.resolve({ available: state.available, ...(state.reason ? { reason: state.reason } : {}) });
    },
    repair: () => Promise.reject(new Error("not wired")),
    diagnose: () => Promise.resolve(DIAG),
    currentDir: () => state.dir,
    toast: () => toast,
    onSyncCompleted: () => {},
    onFilesChanged: () => onFilesChanged(),
    autoBackup: () => opts.auto ?? false,
  });
  return { ctrl, toast, onFilesChanged, checks, pulls, state };
}

test("checkForUpdates: automatic backup off -> one sticky prompt with a Get latest action", async () => {
  const m = makeManual();
  await m.ctrl.refreshSyncDiag("/proj");
  await m.ctrl.checkForUpdates();
  expect(m.ctrl.updatesAvailable).toBe(true);
  expect(m.toast.show.calls).toHaveLength(1);
  const [message, type, duration, action] = m.toast.show.calls[0]!;
  expect(message).toBe("New changes are online for this book.");
  expect(type).toBe("info");
  expect(duration).toBe(0);
  expect(action!.label).toBe("Get latest");
});

test("checkForUpdates: automatic backup on never checks (it gets changes on its own)", async () => {
  const m = makeManual({ auto: true });
  await m.ctrl.refreshSyncDiag("/proj");
  await m.ctrl.checkForUpdates();
  expect(m.checks).toEqual([]);
  expect(m.ctrl.updatesAvailable).toBe(false);
});

test("checkForUpdates: a book that can't sync never checks", async () => {
  const m = makeManual();
  await m.ctrl.checkForUpdates(); // no diagnosis yet
  expect(m.checks).toEqual([]);
});

test("checkForUpdates: a check that couldn't tell (offline/auth) stays quiet", async () => {
  const m = makeManual({ available: false, reason: "offline" });
  await m.ctrl.refreshSyncDiag("/proj");
  await m.ctrl.checkForUpdates();
  expect(m.ctrl.updatesAvailable).toBe(false);
  expect(m.toast.show.calls).toEqual([]);
  expect(m.toast.error.calls).toEqual([]);
});

test("handleGetLatest: merges, reloads the files, clears the flag, toasts success", async () => {
  const m = makeManual();
  await m.ctrl.refreshSyncDiag("/proj");
  await m.ctrl.checkForUpdates();
  await m.toast.show.calls[0]![3]!.onClick(); // the prompt's action
  await Promise.resolve();
  expect(m.pulls).toEqual(["/proj"]);
  expect(m.ctrl.updatesAvailable).toBe(false);
  expect(m.ctrl.gettingLatest).toBe(false);
  expect(m.onFilesChanged.calls).toHaveLength(1);
  expect(m.toast.success.calls).toEqual([["Got the latest changes from online."]]);
});

test("handleGetLatest: nothing new -> info toast, no reload", async () => {
  const m = makeManual({ latest: { status: "up-to-date", message: "" } });
  await m.ctrl.handleGetLatest();
  expect(m.onFilesChanged.calls).toEqual([]);
  expect(m.toast.info.calls).toEqual([["Already up to date — nothing new online."]]);
});

test("handleGetLatest: a thrown call toasts the fixed failure and clears gettingLatest", async () => {
  const m = makeManual({ latest: new Error("net down") });
  await m.ctrl.handleGetLatest();
  expect(m.toast.error.calls[0]![0]).toContain("Couldn't get the latest changes");
  expect(m.ctrl.gettingLatest).toBe(false);
});

test("watchForUpdates: checks on focus and stops after cleanup", async () => {
  const m = makeManual({ available: false });
  await m.ctrl.refreshSyncDiag("/proj");
  const checksBefore = m.checks.length;
  const listeners: Array<() => void> = [];
  const win = {
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.splice(listeners.indexOf(fn), 1),
  } as unknown as Pick<Window, "addEventListener" | "removeEventListener">;
  const stop = m.ctrl.watchForUpdates(win);
  listeners[0]!();
  await Promise.resolve();
  expect(m.checks.length).toBe(checksBefore + 1);
  stop();
  expect(listeners).toEqual([]);
});
