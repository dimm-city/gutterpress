/**
 * Unit tests for WebAdapter persistence (#33, Phase 3) — IndexedDB-backed
 * handles + recents/favorites/prefs/project-state, exercised against the
 * in-memory fake store (dependency-injected via the WebAdapter constructor) and
 * a hand-built mock FSA directory handle with mockable
 * query/requestPermission.
 *
 * GOAL under test: project access + preferences SURVIVE A PAGE RELOAD. A reload
 * is simulated by building a FRESH WebAdapter (so its in-memory handle registry
 * is empty) that shares the SAME store — and asserting the persisted handle is
 * reloaded and re-permissioned when its key is reopened.
 */
import { test, expect, beforeEach } from "bun:test";
import { WebAdapter } from "../../src/lib/platform/web-adapter";
import { InMemoryWebStore } from "../../src/lib/platform/web-store";
import { resetRegistry } from "../../src/lib/platform/web-fs";

beforeEach(() => resetRegistry());

// ── A mock FSA directory handle with permission + structured-clone semantics ──
// Real FileSystemDirectoryHandle is structured-cloneable; the in-memory store
// keeps object identity, which is a fine stand-in for clone round-tripping.
class MockDirHandle {
  readonly kind = "directory" as const;
  perm: PermissionState;
  requestResult: PermissionState;
  queryCalls = 0;
  requestCalls = 0;
  constructor(
    public name: string,
    opts: { perm?: PermissionState; requestResult?: PermissionState } = {},
  ) {
    this.perm = opts.perm ?? "granted";
    this.requestResult = opts.requestResult ?? "granted";
  }
  async queryPermission() {
    this.queryCalls++;
    return this.perm;
  }
  async requestPermission() {
    this.requestCalls++;
    this.perm = this.requestResult;
    return this.requestResult;
  }
}

function makeAdapter(store = new InMemoryWebStore()) {
  return { adapter: new WebAdapter(store), store };
}

/** Install a fake window.showDirectoryPicker that returns the given handle. */
function stubPicker(handle: unknown) {
  // @ts-expect-error test global
  globalThis.window = { showDirectoryPicker: () => Promise.resolve(handle) };
}
function clearPicker() {
  // @ts-expect-error test global
  globalThis.window = undefined;
}

// ── openFolder persists the handle + adds a recents entry ─────────────────────

test("openFolder persists the handle to the store and records a recents entry", async () => {
  const handle = new MockDirHandle("my-book");
  stubPicker(handle);
  try {
    const { adapter, store } = makeAdapter();
    const ref = await adapter.openFolder();
    expect(ref).not.toBeNull();
    const key = ref!.key;

    // Handle persisted under its key.
    const persisted = await store.get("handles", key);
    expect((persisted as { handle: MockDirHandle }).handle).toBe(handle);

    // Recents entry recorded with the contract shape.
    const recents = await adapter.getRecentFolders();
    expect(recents).toHaveLength(1);
    expect(recents[0]!.key).toBe(key);
    expect(recents[0]!.displayName).toBe("my-book");
    expect(recents[0]!.exists).toBe(true);
    expect(typeof recents[0]!.openedAt).toBe("string");

    // getLastProject points at the just-opened key.
    expect(await adapter.getLastProject()).toBe(key);
  } finally {
    clearPicker();
  }
});

// ── reload simulation: fresh registry, populated store → reopen reloads ───────

test("reopenFolder reloads a persisted handle across a reload and requests permission", async () => {
  const handle = new MockDirHandle("my-book", { perm: "prompt", requestResult: "granted" });
  stubPicker(handle);
  let key: string;
  let store: InMemoryWebStore;
  try {
    const first = makeAdapter();
    store = first.store;
    const ref = await first.adapter.openFolder();
    key = ref!.key;
  } finally {
    clearPicker();
  }

  // Simulate a page reload: brand-new adapter (empty in-memory registry) sharing
  // the SAME persisted store. The handle is NOT in the registry now.
  resetRegistry();
  const { adapter: reloaded } = makeAdapter(store!);

  // Reopening drives the permission re-grant gesture (perm was "prompt").
  const ref2 = await reloaded.reopenFolder(key!);
  expect(ref2).not.toBeNull();
  expect(ref2!.key).toBe(key!);
  expect(ref2!.displayName).toBe("my-book");
  expect(handle.requestCalls).toBe(1);

  // After reopen the handle is back in the registry → fs primitives resolve it.
  // (readFile would walk it; here we just assert the key resolves without throw
  // via a no-arg listProjectFiles call path is covered elsewhere — assert the
  // ref is usable by re-reopening without a second request when already granted.)
  const ref3 = await reloaded.reopenFolder(key!);
  expect(ref3!.key).toBe(key!);
  // Already granted now → no second prompt.
  expect(handle.requestCalls).toBe(1);
});

test("reopenFolder surfaces a clear error when permission is denied", async () => {
  const handle = new MockDirHandle("my-book", { perm: "prompt", requestResult: "denied" });
  stubPicker(handle);
  let key: string;
  let store: InMemoryWebStore;
  try {
    const first = makeAdapter();
    store = first.store;
    key = (await first.adapter.openFolder())!.key;
  } finally {
    clearPicker();
  }
  resetRegistry();
  const { adapter: reloaded } = makeAdapter(store!);
  await expect(reloaded.reopenFolder(key!)).rejects.toThrow(/permission/i);
});

test("reopenFolder errors clearly when the key has no persisted handle", async () => {
  const { adapter } = makeAdapter();
  await expect(adapter.reopenFolder("web:never-saved")).rejects.toThrow();
});

// ── recents / favorites round-trip ────────────────────────────────────────────

test("toggleFavorite adds then removes a favorite (round-trip via the store)", async () => {
  const handle = new MockDirHandle("my-book");
  stubPicker(handle);
  let key: string;
  let store: InMemoryWebStore;
  try {
    const a = makeAdapter();
    store = a.store;
    key = (await a.adapter.openFolder())!.key;
  } finally {
    clearPicker();
  }
  const { adapter } = makeAdapter(store!);

  const on = await adapter.toggleFavorite(key!, "My Book");
  expect(on.favorited).toBe(true);
  let favs = await adapter.getFavorites();
  expect(favs).toHaveLength(1);
  expect(favs[0]!.key).toBe(key!);
  expect(favs[0]!.displayName).toBe("my-book");
  expect(favs[0]!.title).toBe("My Book");
  expect(favs[0]!.exists).toBe(true);

  const off = await adapter.toggleFavorite(key!, "My Book");
  expect(off.favorited).toBe(false);
  favs = await adapter.getFavorites();
  expect(favs).toHaveLength(0);
});

test("removeRecent drops a recents entry", async () => {
  const handle = new MockDirHandle("my-book");
  stubPicker(handle);
  let key: string;
  let store: InMemoryWebStore;
  try {
    const a = makeAdapter();
    store = a.store;
    key = (await a.adapter.openFolder())!.key;
  } finally {
    clearPicker();
  }
  const { adapter } = makeAdapter(store!);
  expect(await adapter.getRecentFolders()).toHaveLength(1);
  const res = await adapter.removeRecent(key!);
  expect(res.ok).toBe(true);
  expect(await adapter.getRecentFolders()).toHaveLength(0);
});

test("removeRecent clears the last-project pointer when it was the removed key", async () => {
  const handle = new MockDirHandle("my-book");
  stubPicker(handle);
  let key: string;
  let store: InMemoryWebStore;
  try {
    const a = makeAdapter();
    store = a.store;
    key = (await a.adapter.openFolder())!.key;
  } finally {
    clearPicker();
  }
  const { adapter } = makeAdapter(store!);
  expect(await adapter.getLastProject()).toBe(key!);
  await adapter.removeRecent(key!);
  // The user explicitly dropped it → getLastProject must not resurface it.
  expect(await adapter.getLastProject()).toBeNull();
});

test("getRecentFolders returns newest-first", async () => {
  const h1 = new MockDirHandle("book-a");
  const h2 = new MockDirHandle("book-b");
  const store = new InMemoryWebStore();
  let k1: string;
  let k2: string;
  stubPicker(h1);
  try {
    k1 = (await new WebAdapter(store).openFolder())!.key;
  } finally {
    clearPicker();
  }
  await new Promise((r) => setTimeout(r, 2));
  stubPicker(h2);
  try {
    k2 = (await new WebAdapter(store).openFolder())!.key;
  } finally {
    clearPicker();
  }
  const recents = await new WebAdapter(store).getRecentFolders();
  expect(recents.map((r) => r.key)).toEqual([k2!, k1!]);
});

// ── prefs + project-state round-trip ──────────────────────────────────────────

test("getViewerPrefs/setViewerPrefs round-trip via the store and merge patches", async () => {
  const store = new InMemoryWebStore();
  const a = new WebAdapter(store);
  // Default before any write: an empty-ish prefs object (not a reject).
  const initial = await a.getViewerPrefs();
  expect(initial).toBeDefined();

  await a.setViewerPrefs({ sidebarOpen: true });
  await a.setViewerPrefs({ lastProjectDir: "web:abc" });

  // Survives "reload": a fresh adapter on the same store sees both fields.
  const reloaded = new WebAdapter(store);
  const prefs = await reloaded.getViewerPrefs();
  expect(prefs.sidebarOpen).toBe(true);
  expect(prefs.lastProjectDir).toBe("web:abc");
});

test("getViewerProjectState/setViewerProjectState round-trip keyed by FolderRef.key", async () => {
  const store = new InMemoryWebStore();
  const a = new WebAdapter(store);

  expect(await a.getViewerProjectState("web:a")).toBeNull();

  await a.setViewerProjectState("web:a", { currentPage: 7 });
  await a.setViewerProjectState("web:a", { viewMode: "single" });
  // A different key is isolated.
  await a.setViewerProjectState("web:b", { currentPage: 99 });

  const reloaded = new WebAdapter(store);
  expect(await reloaded.getViewerProjectState("web:a")).toEqual({
    currentPage: 7,
    viewMode: "single",
  });
  expect(await reloaded.getViewerProjectState("web:b")).toEqual({ currentPage: 99 });
  expect(await reloaded.getViewerProjectState("web:c")).toBeNull();
});
