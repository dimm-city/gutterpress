import { expect, test } from "bun:test";
import {
  ProjectSessionController,
  resolveActiveBookDir,
  type ProjectBookEntry,
} from "../../src/lib/routes/project-session-controller.svelte";
import type { ProjectClassification } from "../../src/lib/platform/contract";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests. The production compiler replaces $state; the class only
// needs plain values for these behavior tests (same shim as
// page-nav-controller.test / sync-controller.test).
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

type ClassifyResult = {
  source: unknown;
  capabilities: unknown;
  repoRoot?: string;
  books?: ProjectBookEntry[];
};

interface Harness {
  ctrl: ProjectSessionController;
  classify: Spy<[string]> & { next: ClassifyResult; reject: boolean };
  setViewerPrefs: Spy<[Record<string, unknown>]>;
  notifyHistoryRefresh: Spy<[]>;
  refreshSyncDiag: Spy<[string]>;
}

function makeCaps(over: Partial<Record<string, boolean>> = {}) {
  return {
    canRead: true,
    canWriteLocal: true,
    canEnableVersionHistory: false,
    canSnapshot: true,
    canViewHistory: true,
    canRestoreSnapshot: true,
    canSync: false,
    authManagedByApp: false,
    ...over,
  };
}

function makeHarness(): Harness {
  const classify = Object.assign(
    spy<[string]>(),
    { next: { source: {}, capabilities: makeCaps() } as ClassifyResult, reject: false },
  );
  const classifyProject = (dir: string): Promise<ClassifyResult> => {
    classify(dir);
    return classify.reject
      ? Promise.reject(new Error("boom"))
      : Promise.resolve(classify.next);
  };
  const setViewerPrefs = spy<[Record<string, unknown>]>();
  const notifyHistoryRefresh = spy<[]>();
  const refreshSyncDiag = spy<[string]>();
  const ctrl = new ProjectSessionController({
    classifyProject,
    setViewerPrefs: (p) => {
      setViewerPrefs(p);
      return Promise.resolve();
    },
    notifyHistoryRefresh: () => notifyHistoryRefresh(),
    refreshSyncDiag: (d) => refreshSyncDiag(d),
  });
  return { ctrl, classify, setViewerPrefs, notifyHistoryRefresh, refreshSyncDiag };
}

test("reset clears all capability session state", () => {
  const { ctrl } = makeHarness();
  ctrl.projectCapabilities = makeCaps();
  ctrl.projectSubPath = "books/one";
  ctrl.projectSharesParentHistory = true;
  ctrl.repoRoot = "/repo";
  ctrl.books = [{ path: "/repo/one", title: "one", subPath: "one" }];
  ctrl.activeBookDir = "/repo/one";

  ctrl.reset();

  expect(ctrl.projectCapabilities).toBeNull();
  expect(ctrl.projectSubPath).toBe("");
  expect(ctrl.projectSharesParentHistory).toBe(false);
  expect(ctrl.repoRoot).toBeNull();
  expect(ctrl.books).toEqual([]);
  expect(ctrl.activeBookDir).toBeNull();
});

test("classify: local-git-folder subfolder populates subPath + sharesParentHistory + persists source", async () => {
  const h = makeHarness();
  const source = { type: "local-git-folder", subPath: "books/one" };
  const caps = makeCaps({ canSync: false });
  h.classify.next = { source, capabilities: caps };

  h.ctrl.classify("/proj");
  await flush();

  expect(h.classify.calls).toEqual([["/proj"]]);
  expect(h.ctrl.projectCapabilities).toEqual(caps);
  expect(h.ctrl.projectSubPath).toBe("books/one");
  expect(h.ctrl.projectSharesParentHistory).toBe(true);
  expect(h.setViewerPrefs.calls).toEqual([[{ projectSource: source }]]);
  expect(h.notifyHistoryRefresh.calls.length).toBe(1);
  // canSync false → no diagnosis refresh.
  expect(h.refreshSyncDiag.calls.length).toBe(0);
});

test("classify: local-git-folder repo root (no subPath) → sharesParentHistory false", async () => {
  const h = makeHarness();
  h.classify.next = { source: { type: "local-git-folder" }, capabilities: makeCaps() };

  h.ctrl.classify("/proj");
  await flush();

  expect(h.ctrl.projectSubPath).toBe("");
  expect(h.ctrl.projectSharesParentHistory).toBe(false);
});

test("classify: local-folder → subPath stays empty regardless of any subPath field", async () => {
  const h = makeHarness();
  h.classify.next = {
    source: { type: "local-folder", subPath: "ignored" },
    capabilities: makeCaps(),
  };

  h.ctrl.classify("/proj");
  await flush();

  expect(h.ctrl.projectSubPath).toBe("");
  expect(h.ctrl.projectSharesParentHistory).toBe(false);
});

test("classify: no repoRoot in the result → repoRoot/books/activeBookDir stay empty, picked dir active", async () => {
  const h = makeHarness();
  h.classify.next = { source: { type: "local-folder" }, capabilities: makeCaps() };

  h.ctrl.classify("/proj");
  await flush();

  expect(h.ctrl.repoRoot).toBeNull();
  expect(h.ctrl.books).toEqual([]);
  expect(h.ctrl.activeBookDir).toBe("/proj");
});

test("classify: repoRoot with zero books behaves as today (no redirect)", async () => {
  const h = makeHarness();
  h.classify.next = {
    source: { type: "local-git-folder" },
    capabilities: makeCaps(),
    repoRoot: "/repo",
    books: [],
  };

  h.ctrl.classify("/repo");
  await flush();

  expect(h.ctrl.repoRoot).toBe("/repo");
  expect(h.ctrl.books).toEqual([]);
  expect(h.ctrl.activeBookDir).toBe("/repo");
});

test("classify: single book in the repo is always active", async () => {
  const h = makeHarness();
  const books: ProjectBookEntry[] = [{ path: "/repo/one", title: "one", subPath: "one" }];
  h.classify.next = {
    source: { type: "local-git-folder" },
    capabilities: makeCaps(),
    repoRoot: "/repo",
    books,
  };

  h.ctrl.classify("/repo");
  await flush();

  expect(h.ctrl.books).toEqual(books);
  expect(h.ctrl.activeBookDir).toBe("/repo/one");
});

test("classify: multiple books, picked folder IS a book → that book stays active", async () => {
  const h = makeHarness();
  const books: ProjectBookEntry[] = [
    { path: "/repo/alpha", title: "alpha", subPath: "alpha" },
    { path: "/repo/beta", title: "beta", subPath: "beta" },
  ];
  h.classify.next = {
    source: { type: "local-git-folder" },
    capabilities: makeCaps(),
    repoRoot: "/repo",
    books,
  };

  h.ctrl.classify("/repo/beta");
  await flush();

  expect(h.ctrl.activeBookDir).toBe("/repo/beta");
});

test("classify: multiple books, bare repo root picked → first book alphabetically is active", async () => {
  const h = makeHarness();
  const books: ProjectBookEntry[] = [
    { path: "/repo/alpha", title: "alpha", subPath: "alpha" },
    { path: "/repo/beta", title: "beta", subPath: "beta" },
  ];
  h.classify.next = {
    source: { type: "local-git-folder" },
    capabilities: makeCaps(),
    repoRoot: "/repo",
    books,
  };

  h.ctrl.classify("/repo");
  await flush();

  expect(h.ctrl.activeBookDir).toBe("/repo/alpha");
});

test("classify: canSync capability triggers a scoped diagnosis refresh", async () => {
  const h = makeHarness();
  h.classify.next = { source: { type: "local-git-folder" }, capabilities: makeCaps({ canSync: true }) };

  h.ctrl.classify("/proj");
  await flush();

  expect(h.refreshSyncDiag.calls).toEqual([["/proj"]]);
});

test("classify: a rejected classification clears capabilities (never blocks preview)", async () => {
  const h = makeHarness();
  h.ctrl.projectCapabilities = makeCaps();
  h.classify.reject = true;

  h.ctrl.classify("/proj");
  await flush();

  expect(h.ctrl.projectCapabilities).toBeNull();
  expect(h.setViewerPrefs.calls.length).toBe(0);
  expect(h.notifyHistoryRefresh.calls.length).toBe(0);
});

test("applyReclassify adopts upgraded capabilities + persists source, leaving subPath untouched", () => {
  const h = makeHarness();
  h.ctrl.projectSubPath = "books/one";
  const caps = makeCaps({ canViewHistory: true, canSnapshot: true });
  const source = { type: "local-git-folder", subPath: "books/one" } as unknown;
  const result = { source, capabilities: caps } as unknown as ProjectClassification;

  h.ctrl.applyReclassify(result);

  expect(h.ctrl.projectCapabilities).toEqual(caps as never);
  expect(h.setViewerPrefs.calls).toEqual([[{ projectSource: source }]]);
  // Reclassify is a capability upgrade only — subPath/shares are not recomputed here.
  expect(h.ctrl.projectSubPath).toBe("books/one");
});

// ── resolveActiveBookDir (pure) — C1 book-selection rules ────────────────────

test("resolveActiveBookDir: no repoRoot → picked dir active (no repo at all)", () => {
  expect(resolveActiveBookDir("/proj", undefined, [])).toBe("/proj");
});

test("resolveActiveBookDir: repoRoot but zero books → picked dir active (no redirect)", () => {
  expect(resolveActiveBookDir("/repo", "/repo", [])).toBe("/repo");
});

test("resolveActiveBookDir: exactly one book → that book is active, even if a different dir was picked", () => {
  const books: ProjectBookEntry[] = [{ path: "/repo/only", title: "only", subPath: "" }];
  expect(resolveActiveBookDir("/repo", "/repo", books)).toBe("/repo/only");
  expect(resolveActiveBookDir("/repo/assets", "/repo", books)).toBe("/repo/only");
});

test("resolveActiveBookDir: multiple books, picked folder is one of them → stays active", () => {
  const books: ProjectBookEntry[] = [
    { path: "/repo/alpha", title: "alpha", subPath: "alpha" },
    { path: "/repo/beta", title: "beta", subPath: "beta" },
  ];
  expect(resolveActiveBookDir("/repo/beta", "/repo", books)).toBe("/repo/beta");
});

test("resolveActiveBookDir: multiple books, bare repo root picked → first alphabetically by subPath", () => {
  const books: ProjectBookEntry[] = [
    { path: "/repo/zeta", title: "zeta", subPath: "zeta" },
    { path: "/repo/alpha", title: "alpha", subPath: "alpha" },
  ];
  expect(resolveActiveBookDir("/repo", "/repo", books)).toBe("/repo/zeta");
  // Order in the array is respected (caller/server sorts by subPath); the
  // function itself does not re-sort.
  const sorted: ProjectBookEntry[] = [...books].sort((a, b) => (a.subPath < b.subPath ? -1 : 1));
  expect(resolveActiveBookDir("/repo", "/repo", sorted)).toBe("/repo/alpha");
});
