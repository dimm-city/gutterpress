/**
 * Unit tests for the IndexedDB store abstraction (#33, Phase 3).
 *
 * `web-store.ts` exposes a NARROW async key/value-per-object-store interface
 * (get/put/delete/list/clear). Production code talks to an IndexedDB-backed
 * implementation; the WebAdapter is unit-tested against the in-memory fake
 * exported here, so no real browser IndexedDB is needed (dependency injection —
 * see the report's "test strategy" justification).
 *
 * This test pins the CONTRACT of the in-memory fake so the WebAdapter tests can
 * rely on it (and so the real IndexedDB impl has a behavioral spec to match).
 */
import { test, expect } from "bun:test";
import { InMemoryWebStore } from "../../src/lib/platform/web-store";

test("put/get round-trips a value under a store + key", async () => {
  const store = new InMemoryWebStore();
  await store.put("prefs", "singleton", { sidebarOpen: true });
  expect(await store.get("prefs", "singleton")).toEqual({ sidebarOpen: true });
});

test("get returns undefined for a missing key", async () => {
  const store = new InMemoryWebStore();
  expect(await store.get("prefs", "nope")).toBeUndefined();
});

test("put overwrites an existing value", async () => {
  const store = new InMemoryWebStore();
  await store.put("projectStates", "web:a", { currentPage: 1 });
  await store.put("projectStates", "web:a", { currentPage: 9 });
  expect(await store.get("projectStates", "web:a")).toEqual({ currentPage: 9 });
});

test("delete removes a value", async () => {
  const store = new InMemoryWebStore();
  await store.put("recents", "web:a", { key: "web:a" });
  await store.delete("recents", "web:a");
  expect(await store.get("recents", "web:a")).toBeUndefined();
});

test("list returns every {key,value} in a store (and is isolated per store)", async () => {
  const store = new InMemoryWebStore();
  await store.put("recents", "web:a", { n: 1 });
  await store.put("recents", "web:b", { n: 2 });
  await store.put("favorites", "web:a", { n: 99 });
  const recents = await store.list("recents");
  const recentsByKey = Object.fromEntries(recents.map((r) => [r.key, r.value]));
  expect(recentsByKey).toEqual({ "web:a": { n: 1 }, "web:b": { n: 2 } });
  const favorites = await store.list("favorites");
  expect(favorites).toEqual([{ key: "web:a", value: { n: 99 } }]);
});

test("list returns [] for an empty store", async () => {
  const store = new InMemoryWebStore();
  expect(await store.list("recents")).toEqual([]);
});
