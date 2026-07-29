import { expect, test } from "bun:test";
import {
  ProjectSessionController,
  resolveActiveBookDir,
  type ProjectBookEntry,
} from "../../src/lib/routes/project-session-controller.svelte";

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
  hasManifest: boolean;
  repoRoot?: string;
  books?: ProjectBookEntry[];
};

interface Harness {
  ctrl: ProjectSessionController;
  classify: Spy<[string]> & { next: ClassifyResult; reject: boolean };
  setDesktopPrefs: Spy<[Record<string, unknown>]>;
}

function makeCaps(over: Partial<Record<string, boolean>> = {}) {
  return {
    canRead: true,
    canWriteLocal: true,
    canEnableVersionHistory: false,
    canSnapshot: true,
    canViewHistory: true,
    canRestoreSnapshot: true,
    authManagedByApp: false,
    ...over,
  };
}

function makeHarness(): Harness {
  const classify = Object.assign(
    spy<[string]>(),
    { next: { source: {}, capabilities: makeCaps(), hasManifest: true } as ClassifyResult, reject: false },
  );
  const classifyProject = (dir: string): Promise<ClassifyResult> => {
    classify(dir);
    return classify.reject
      ? Promise.reject(new Error("boom"))
      : Promise.resolve(classify.next);
  };
  const setDesktopPrefs = spy<[Record<string, unknown>]>();
  const ctrl = new ProjectSessionController({
    classifyProject,
    setDesktopPrefs: (p) => {
      setDesktopPrefs(p);
      return Promise.resolve();
    },
  });
  return { ctrl, classify, setDesktopPrefs };
}

test("reset clears all capability session state", () => {
  const { ctrl } = makeHarness();
  ctrl.projectCapabilities = makeCaps();
  ctrl.projectSubPath = "books/one";
  ctrl.repoRoot = "/repo";
  ctrl.books = [{ path: "/repo/one", title: "one", subPath: "one" }];
  ctrl.activeBookDir = "/repo/one";
  ctrl.activeBookHasManifest = false;

  ctrl.reset();

  expect(ctrl.projectCapabilities).toBeNull();
  expect(ctrl.projectSubPath).toBe("");
  expect(ctrl.repoRoot).toBeNull();
  expect(ctrl.books).toEqual([]);
  expect(ctrl.activeBookDir).toBeNull();
  expect(ctrl.activeBookHasManifest).toBe(true);
});

test("classify: local-git-folder subfolder populates subPath + persists source", async () => {
  const h = makeHarness();
  const source = { type: "local-git-folder", subPath: "books/one" };
  const caps = makeCaps();
  h.classify.next = { source, capabilities: caps, hasManifest: true };

  h.ctrl.classify("/proj");
  await flush();

  expect(h.classify.calls).toEqual([["/proj"]]);
  expect(h.ctrl.projectCapabilities).toEqual(caps);
  expect(h.ctrl.projectSubPath).toBe("books/one");
  expect(h.setDesktopPrefs.calls).toEqual([[{ projectSource: source }]]);
});

test("classify: local-git-folder repo root has an empty subPath", async () => {
  const h = makeHarness();
  h.classify.next = {
    source: { type: "local-git-folder" },
    capabilities: makeCaps(),
    hasManifest: true,
  };

  h.ctrl.classify("/proj");
  await flush();

  expect(h.ctrl.projectSubPath).toBe("");
});

test("classify: local-folder → subPath stays empty regardless of any subPath field", async () => {
  const h = makeHarness();
  h.classify.next = {
    source: { type: "local-folder", subPath: "ignored" },
    capabilities: makeCaps(),
    hasManifest: true,
  };

  h.ctrl.classify("/proj");
  await flush();

  expect(h.ctrl.projectSubPath).toBe("");
});

test("classify: no repoRoot in the result → repoRoot/books/activeBookDir stay empty, picked dir active", async () => {
  const h = makeHarness();
  h.classify.next = {
    source: { type: "local-folder" },
    capabilities: makeCaps(),
    hasManifest: true,
  };

  h.ctrl.classify("/proj");
  await flush();

  expect(h.ctrl.repoRoot).toBeNull();
  expect(h.ctrl.books).toEqual([]);
  expect(h.ctrl.activeBookDir).toBe("/proj");
});

test("classify records manifest absence for a loose local folder", async () => {
  const h = makeHarness();
  h.classify.next = {
    source: { type: "local-folder" },
    capabilities: makeCaps(),
    hasManifest: false,
  };

  await h.ctrl.classify("/loose");

  expect(h.ctrl.activeBookDir).toBe("/loose");
  expect(h.ctrl.activeBookHasManifest).toBe(false);
});

test("a repo-discovered active book is manifest-bearing even when the picked repo root is loose", async () => {
  const h = makeHarness();
  h.classify.next = {
    source: { type: "local-git-folder" },
    capabilities: makeCaps(),
    hasManifest: false,
    repoRoot: "/repo",
    books: [{ path: "/repo/book", title: "book", subPath: "book" }],
  };

  await h.ctrl.classify("/repo");

  expect(h.ctrl.activeBookDir).toBe("/repo/book");
  expect(h.ctrl.activeBookHasManifest).toBe(true);
});

test("classify: repoRoot with zero books behaves as today (no redirect)", async () => {
  const h = makeHarness();
  h.classify.next = {
    source: { type: "local-git-folder" },
    capabilities: makeCaps(),
    hasManifest: true,
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
    hasManifest: true,
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
    hasManifest: true,
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
    hasManifest: true,
    repoRoot: "/repo",
    books,
  };

  h.ctrl.classify("/repo");
  await flush();

  expect(h.ctrl.activeBookDir).toBe("/repo/alpha");
});

// ── C2 (book switcher) ───────────────────────────────────────────────────────

test("classify returns a promise that resolves once the classification settles", async () => {
  const h = makeHarness();
  h.classify.next = {
    source: { type: "local-folder" },
    capabilities: makeCaps(),
    hasManifest: true,
  };

  const result = h.ctrl.classify("/proj");
  expect(result).toBeInstanceOf(Promise);
  await result;

  // Settled synchronously with the internal state, not just "eventually" —
  // +page.svelte awaits this before retargeting the content pipeline.
  expect(h.ctrl.activeBookDir).toBe("/proj");
});

test("classify: switching to a sibling book (re-classify at its path) keeps repoRoot/books identical", async () => {
  const h = makeHarness();
  const books: ProjectBookEntry[] = [
    { path: "/repo/alpha", title: "alpha", subPath: "alpha" },
    { path: "/repo/beta", title: "beta", subPath: "beta" },
  ];
  h.classify.next = {
    source: { type: "local-git-folder" },
    capabilities: makeCaps(),
    hasManifest: true,
    repoRoot: "/repo",
    books,
  };

  await h.ctrl.classify("/repo/alpha");
  expect(h.ctrl.activeBookDir).toBe("/repo/alpha");
  const repoRootAfterFirstOpen = h.ctrl.repoRoot;

  // BookSwitcher.onSelect re-opens at the sibling book's folder — a full
  // reset()+classify(), same as any other folder open.
  h.ctrl.reset();
  await h.ctrl.classify("/repo/beta");

  expect(h.ctrl.activeBookDir).toBe("/repo/beta");
  // Session identity (repoRoot) is unchanged — same repo, per the C2 design
  // note ("session identity pinned to repoRoot").
  expect(h.ctrl.repoRoot).toBe(repoRootAfterFirstOpen);
  expect(h.ctrl.books).toEqual(books);
});

// The remote-diagnosis refresh deliberately does NOT fire from classify():
// it used to, and the SyncController's stale-guard (which compares against
// lifecycle.currentDir — assigned only AFTER the preview host starts)
// discarded the result on every open. The lifecycle controller now refreshes
// it after currentDir is assigned — see project-lifecycle-controller.


test("classify: a rejected classification clears capabilities (never blocks preview)", async () => {
  const h = makeHarness();
  h.ctrl.projectCapabilities = makeCaps();
  h.classify.reject = true;

  h.ctrl.classify("/proj");
  await flush();

  expect(h.ctrl.projectCapabilities).toBeNull();
  expect(h.setDesktopPrefs.calls.length).toBe(0);
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

test("resolveActiveBookDir: multiple books, bare repo root picked → first LISTED book (no re-sort; the classify server sorts by subPath)", () => {
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
