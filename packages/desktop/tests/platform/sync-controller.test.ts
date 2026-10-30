import { expect, test } from "bun:test";
import {
  combinedFilesMessage,
  keptBothMessage,
  SyncController,
} from "../../src/lib/routes/sync-controller.svelte";
import type { SyncOutcome } from "../../src/lib/api";
import type { KeptBothFile, ProjectRemoteDiagnosis, SyncStatus } from "../../src/lib/platform/contract";

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
  expect(h.toast.info.calls[0]![0]).toContain("Two takes of a passage were kept");
  expect(h.toast.info.calls[0]![0]).toContain("the online copy's");
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
    ["Not signed in to the online copy. Sign in from Book setup → Online copy."],
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
  expect(h.toast.info.calls).toEqual([["Couldn't reach the online copy. Check your internet connection, or try again later."]]);
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
    ["Couldn't finish backing up. Your work is saved on this computer — we'll try again later."],
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
    ["Couldn't finish backing up. Your work is saved on this computer — we'll try again later."],
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

test("combined files -> a sticky toast with a Review button that opens the Problems list (#407)", () => {
  const show = spy<[string, string | undefined, number | undefined, { label: string; onClick: () => void } | undefined]>();
  const toast = { ...makeToast(), show };
  const onReviewCombined = spy<[]>();
  const ctrl = new SyncController({
    syncChanges: () => Promise.reject(new Error("not wired")),
    getLatest: () => Promise.reject(new Error("not wired")),
    checkUpdates: () => Promise.resolve({ available: false }),
    repair: () => Promise.reject(new Error("not wired")),
    diagnose: () => Promise.resolve(DIAG),
    currentDir: () => "/proj",
    toast: () => toast,
    onSyncCompleted: () => {},
    onFilesChanged: () => {},
    onReviewCombined,
  });
  ctrl.applyConvergeReport(["chapters/chapter-02.md"], []);
  expect(toast.info.calls).toEqual([]);
  expect(show.calls).toHaveLength(1);
  const [message, type, duration, action] = show.calls[0]!;
  expect(message).toContain("chapter-02.md");
  expect(type).toBe("info");
  expect(duration).toBe(0);
  expect(action?.label).toBe("Review");
  action!.onClick();
  expect(onReviewCombined.calls).toHaveLength(1);
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

test("a manual backup publishes its outcome for the status control (state + finish time)", async () => {
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

test("with automatic backing up off, a failure never promises an automatic retry", async () => {
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
    ["Couldn't finish backing up. Your work is saved on this computer — try again when you're ready."],
  ]);
  expect(ctrl.lastManual!.state).toBe("error");
});

// ── Repair the online copy ───────────────────────────────────────────────────

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
  const h = makeWithRepair({ outcome: { status: "error", message: "The online copy didn't accept the saved sign-in." }, restoredFiles: [] });
  await h.ctrl.handleRepair();
  expect(h.ctrl.lastManual?.state).toBe("error");
  expect(h.toast.error.calls[0][0]).toBe("The online copy didn't accept the saved sign-in.");
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

// ── The "new changes online" prompt and Sync ────────────────────────────────

function makeManual(opts: { auto?: boolean; reader?: boolean; available?: boolean; reason?: string; sync?: SyncOutcome | Error; latest?: SyncOutcome | Error; showless?: boolean } = {}) {
  const show = spy<[string, string?, number?, { label: string; onClick: () => void }?]>();
  const toast = { ...makeToast(), ...(opts.showless ? {} : { show }) };
  const onFilesChanged = spy<[]>();
  const onSyncCompleted = spy<[boolean, boolean]>();
  const checks: string[] = [];
  /** Full passes (Sync, Back up now): get the latest, then send. */
  const syncs: string[] = [];
  /** Get latest passes: the same pass with push: false, which never sends. */
  const pulls: string[] = [];
  const state = { dir: "/proj" as string | null, available: opts.available ?? true, reason: opts.reason };
  const outcome = opts.sync ?? { status: "synced", message: "", mergedRemoteChanges: true, filesChanged: true };
  // What the lib's push: false pass returns: always "up-to-date", never "synced".
  const latest = opts.latest ?? { status: "up-to-date", message: "", filesChanged: true };
  const ctrl = new SyncController({
    syncChanges: (d) => {
      syncs.push(d);
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    },
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
    onSyncCompleted: (merged, filesChanged) => onSyncCompleted(merged, filesChanged),
    onFilesChanged: () => onFilesChanged(),
    autoBackup: () => opts.auto ?? false,
    isReader: () => opts.reader ?? false,
  });
  return { ctrl, toast: toast as typeof toast & { show: typeof show }, onFilesChanged, onSyncCompleted, checks, syncs, pulls, state };
}

test("checkForUpdates: automatic backing up off -> one sticky prompt with a Get latest action (#485)", async () => {
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

test("checkForUpdates: without a toast action surface the plain toast points at Get latest", async () => {
  const m = makeManual({ showless: true });
  await m.ctrl.refreshSyncDiag("/proj");
  await m.ctrl.checkForUpdates();
  expect(m.toast.info.calls).toEqual([["New changes are online for this book. Use Get latest to bring them in."]]);
});

test("the prompt's Get latest receives the changes and sends nothing (#485)", async () => {
  const m = makeManual();
  await m.ctrl.refreshSyncDiag("/proj");
  await m.ctrl.checkForUpdates();
  await m.toast.show.calls[0]![3]!.onClick(); // the prompt's action
  await Promise.resolve();
  expect(m.pulls).toEqual(["/proj"]);
  expect(m.syncs).toEqual([]); // no full pass: nothing was sent
  expect(m.ctrl.updatesAvailable).toBe(false);
  expect(m.ctrl.gettingLatest).toBe(false);
  expect(m.onFilesChanged.calls).toHaveLength(1);
  expect(m.onSyncCompleted.calls).toEqual([]); // never "Backed up — …"
  expect(m.toast.success.calls).toEqual([["Got the latest changes from the online copy."]]);
});

test("checkForUpdates: stays quiet while a Sync or a Get latest is in flight", async () => {
  const m = makeManual();
  await m.ctrl.refreshSyncDiag("/proj");
  const before = m.checks.length;
  m.ctrl.forceSyncing = true;
  await m.ctrl.checkForUpdates();
  m.ctrl.forceSyncing = false;
  m.ctrl.gettingLatest = true;
  await m.ctrl.checkForUpdates();
  expect(m.checks.length).toBe(before);
});

// ── Get latest (#485): the lib's own pass with push: false ───────────────────

test("handleGetLatest: this computer's own versions still unsent -> the status reads 'unsent'", async () => {
  const m = makeManual({ latest: { status: "up-to-date", message: "", pushDeferred: true } });
  await m.ctrl.handleGetLatest();
  expect(m.pulls).toEqual(["/proj"]);
  expect(m.syncs).toEqual([]);
  expect(m.ctrl.backup).toMatchObject({ state: "unsent" });
});

test("handleGetLatest: everything already online -> the status reads 'synced'", async () => {
  const m = makeManual({ latest: { status: "up-to-date", message: "" } });
  await m.ctrl.handleGetLatest();
  expect(m.ctrl.backup).toMatchObject({ state: "synced" });
});

test("handleGetLatest: nothing new -> info toast, no reload", async () => {
  const m = makeManual({ latest: { status: "up-to-date", message: "" } });
  await m.ctrl.handleGetLatest();
  expect(m.onFilesChanged.calls).toEqual([]);
  expect(m.toast.info.calls).toEqual([["Already up to date — nothing new online."]]);
});

test("handleGetLatest: overlapping passages are named, as after any pass", async () => {
  const m = makeManual({ showless: true, latest: { status: "up-to-date", message: "", filesChanged: true, pushDeferred: true, combinedFiles: ["chapters/chapter-02.md"] } });
  await m.ctrl.handleGetLatest();
  expect(m.toast.info.calls).toHaveLength(1);
  expect(m.toast.info.calls[0]![0]).toContain("Two takes of a passage were kept in chapter-02.md");
});

test("handleGetLatest: not signed in or offline -> says so in the product's words", async () => {
  const auth = makeManual({ latest: { status: "auth", message: "raw" } });
  await auth.ctrl.handleGetLatest();
  expect(auth.toast.error.calls).toEqual([["Not signed in to the online copy. Sign in from Book setup → Online copy."]]);
  const offline = makeManual({ latest: { status: "offline", message: "raw" } });
  await offline.ctrl.handleGetLatest();
  expect(offline.toast.info.calls).toEqual([["Couldn't reach the online copy. Check your internet connection, or try again later."]]);
});

test("handleGetLatest: a thrown call toasts the fixed failure and clears gettingLatest", async () => {
  const m = makeManual({ latest: new Error("net down") });
  await m.ctrl.handleGetLatest();
  expect(m.toast.error.calls[0]![0]).toContain("Couldn't get the latest changes");
  expect(m.ctrl.gettingLatest).toBe(false);
});

test("Get latest and Sync never run at once", async () => {
  const m = makeManual();
  m.ctrl.forceSyncing = true;
  await m.ctrl.handleGetLatest();
  expect(m.pulls).toEqual([]);
  m.ctrl.forceSyncing = false;
  m.ctrl.gettingLatest = true;
  await m.ctrl.handleForceSync();
  expect(m.syncs).toEqual([]);
});

// ── Back up now (#485): the full pass, with automatic backing up on too ─────

test("Back up now with automatic backing up on: one full pass, and the status says Backed up", async () => {
  const m = makeManual({ auto: true, sync: { status: "synced", message: "", mergedRemoteChanges: false } });
  await m.ctrl.refreshSyncDiag("/proj");
  await m.ctrl.handleForceSync();
  expect(m.syncs).toEqual(["/proj"]);
  expect(m.pulls).toEqual([]);
  expect(m.onSyncCompleted.calls).toEqual([[false, false]]);
  expect(m.ctrl.backup).toMatchObject({ state: "synced" });
  expect(m.ctrl.forceSyncing).toBe(false);
});

test("checkForUpdates: automatic backing up on never checks (it gets changes on its own)", async () => {
  const m = makeManual({ auto: true });
  await m.ctrl.refreshSyncDiag("/proj");
  await m.ctrl.checkForUpdates();
  expect(m.checks).toEqual([]);
  expect(m.ctrl.updatesAvailable).toBe(false);
});

test("checkForUpdates: a reader never checks or hears a prompt (they get the latest quietly)", async () => {
  const m = makeManual({ reader: true });
  await m.ctrl.refreshSyncDiag("/proj");
  await m.ctrl.checkForUpdates();
  expect(m.checks).toEqual([]);
  expect(m.toast.show.calls).toEqual([]);
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

// ── The host's status stream ─────────────────────────────────────────────────

const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  state: "synced",
  projectDir: "/proj",
  lastSyncAt: "2026-10-28T11:58:00Z",
  ...over,
});

test("applyStatus: the open book's newest event is what the online copy last did", () => {
  const h = make();
  expect(h.ctrl.backup).toBeNull();
  h.ctrl.applyStatus(status({ state: "offline" }));
  expect(h.ctrl.backup).toMatchObject({ state: "offline", lastSyncAt: "2026-10-28T11:58:00Z" });
  h.ctrl.applyStatus(status({ state: "unsent" }));
  expect(h.ctrl.backup).toMatchObject({ state: "unsent" });
});

test("applyStatus: another book's event is ignored, and so is the old book's after a switch", () => {
  const h = make();
  h.ctrl.applyStatus(status({ projectDir: "/other" }));
  expect(h.ctrl.backup).toBeNull();
  h.ctrl.applyStatus(status());
  h.dir = "/other";
  expect(h.ctrl.backup).toBeNull();
});

test("the newer of the stream and the last manual Sync wins", async () => {
  const h = make();
  h.ctrl.applyStatus(status({ state: "unsent" }));
  await new Promise((r) => setTimeout(r, 5));
  h.sync.next = { status: "synced", message: "", mergedRemoteChanges: false };
  await h.ctrl.handleForceSync();
  expect(h.ctrl.backup).toMatchObject({ state: "synced" });
  await new Promise((r) => setTimeout(r, 5));
  h.ctrl.applyStatus(status({ state: "offline" }));
  expect(h.ctrl.backup).toMatchObject({ state: "offline" });
});

test("a failing safety net is kept apart from the backup state, and a finished pass clears it", () => {
  const h = make();
  h.ctrl.applyStatus(status({ state: "synced" }));
  h.ctrl.applyStatus(status({ state: "error", source: "versions", message: "Close the other program." }));
  expect(h.ctrl.versionsProblem).toEqual({ dir: "/proj", message: "Close the other program." });
  expect(h.ctrl.backup).toMatchObject({ state: "synced" });
  h.ctrl.applyStatus(status({ state: "unsent" }));
  expect(h.ctrl.versionsProblem).toBeNull();
});

test("the newest operation log the host names is kept for Version history", () => {
  const h = make();
  expect(h.ctrl.logFile).toBeNull();
  h.ctrl.applyStatus(status({ state: "error", logFile: "/logs/book.log" }));
  h.ctrl.applyStatus(status({ state: "idle" }));
  expect(h.ctrl.logFile).toBe("/logs/book.log");
});

test("opening a book reads what the host kept, unless a live event beat it", async () => {
  const kept = status({ state: "auth" });
  const h = makeSeeded(kept);
  await h.ctrl.refreshSyncDiag("/proj");
  await Promise.resolve();
  expect(h.ctrl.backup).toMatchObject({ state: "auth" });

  const live = makeSeeded(kept);
  live.ctrl.applyStatus(status({ state: "synced" }));
  await live.ctrl.refreshSyncDiag("/proj");
  await Promise.resolve();
  expect(live.ctrl.backup).toMatchObject({ state: "synced" });
});

test("a sign-in that was just saved answers a rejected one", async () => {
  const h = makeSeeded(null);
  h.ctrl.applyStatus(status({ state: "auth" }));
  await h.ctrl.refreshSyncDiag("/proj");
  expect(h.ctrl.backup).toBeNull();
  h.ctrl.applyStatus(status({ state: "offline" }));
  await h.ctrl.refreshSyncDiag("/proj");
  expect(h.ctrl.backup).toMatchObject({ state: "offline" });
});

function makeSeeded(kept: SyncStatus | null) {
  const h = make();
  h.ctrl = new SyncController({
    syncChanges: (d) => h.sync.fn(d),
    repair: () => Promise.reject(new Error("not wired")),
    diagnose: () => Promise.resolve(DIAG),
    getStatus: () => Promise.resolve(kept),
    currentDir: () => h.dir,
    toast: () => h.toast,
    onSyncCompleted: () => {},
    onFilesChanged: () => {},
  });
  return h;
}
