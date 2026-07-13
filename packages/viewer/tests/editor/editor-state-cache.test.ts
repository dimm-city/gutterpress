import { test, expect } from "bun:test";
import { EditorStateCache } from "../../src/lib/editor/editor-state-cache";

// ── Basic get/set round-trip ──────────────────────────────────────────────────

test("set/get round-trips a value", () => {
  const cache = new EditorStateCache<string>(5);
  cache.set("/a.md", "state-a");
  expect(cache.get("/a.md")).toBe("state-a");
});

test("get on a missing key returns undefined", () => {
  const cache = new EditorStateCache<string>(5);
  expect(cache.get("/missing.md")).toBeUndefined();
});

test("has() reflects presence without side effects", () => {
  const cache = new EditorStateCache<string>(5);
  expect(cache.has("/a.md")).toBe(false);
  cache.set("/a.md", "state-a");
  expect(cache.has("/a.md")).toBe(true);
});

test("size reflects the number of distinct entries", () => {
  const cache = new EditorStateCache<string>(5);
  cache.set("/a.md", "1");
  cache.set("/b.md", "2");
  expect(cache.size).toBe(2);
});

test("set overwrites an existing key's value without growing size", () => {
  const cache = new EditorStateCache<string>(5);
  cache.set("/a.md", "first");
  cache.set("/a.md", "second");
  expect(cache.size).toBe(1);
  expect(cache.get("/a.md")).toBe("second");
});

test("delete removes an entry", () => {
  const cache = new EditorStateCache<string>(5);
  cache.set("/a.md", "1");
  cache.delete("/a.md");
  expect(cache.has("/a.md")).toBe(false);
  expect(cache.size).toBe(0);
});

test("delete on a missing key is a no-op (does not throw)", () => {
  const cache = new EditorStateCache<string>(5);
  expect(() => cache.delete("/nope.md")).not.toThrow();
});

test("clear empties the cache", () => {
  const cache = new EditorStateCache<string>(5);
  cache.set("/a.md", "1");
  cache.set("/b.md", "2");
  cache.clear();
  expect(cache.size).toBe(0);
  expect(cache.has("/a.md")).toBe(false);
});

// ── LRU eviction ───────────────────────────────────────────────────────────────

test("evicts the least-recently-used entry once over capacity", () => {
  const cache = new EditorStateCache<string>(2);
  cache.set("/a.md", "1");
  cache.set("/b.md", "2");
  cache.set("/c.md", "3"); // capacity 2 — should evict /a.md (oldest, never touched)
  expect(cache.has("/a.md")).toBe(false);
  expect(cache.has("/b.md")).toBe(true);
  expect(cache.has("/c.md")).toBe(true);
  expect(cache.size).toBe(2);
});

test("get() marks an entry most-recently-used, protecting it from the next eviction", () => {
  const cache = new EditorStateCache<string>(2);
  cache.set("/a.md", "1");
  cache.set("/b.md", "2");
  // Touch /a.md so /b.md becomes the least-recently-used entry.
  expect(cache.get("/a.md")).toBe("1");
  cache.set("/c.md", "3");
  expect(cache.has("/b.md")).toBe(false);
  expect(cache.has("/a.md")).toBe(true);
  expect(cache.has("/c.md")).toBe(true);
});

test("re-setting an existing key also refreshes its recency", () => {
  const cache = new EditorStateCache<string>(2);
  cache.set("/a.md", "1");
  cache.set("/b.md", "2");
  cache.set("/a.md", "1-updated"); // touch /a.md via set — /b.md is now oldest
  cache.set("/c.md", "3");
  expect(cache.has("/b.md")).toBe(false);
  expect(cache.get("/a.md")).toBe("1-updated");
  expect(cache.has("/c.md")).toBe(true);
});

test("bound of ~20 files: the 21st distinct file evicts the 1st (never-touched) file", () => {
  const cache = new EditorStateCache<string>(20);
  for (let i = 0; i < 20; i++) cache.set(`/file-${i}.md`, `state-${i}`);
  expect(cache.size).toBe(20);
  expect(cache.has("/file-0.md")).toBe(true);

  cache.set("/file-20.md", "state-20");

  expect(cache.size).toBe(20);
  expect(cache.has("/file-0.md")).toBe(false); // evicted
  expect(cache.has("/file-1.md")).toBe(true);
  expect(cache.has("/file-20.md")).toBe(true);
});

test("default capacity is 20 when unspecified", () => {
  const cache = new EditorStateCache<string>();
  for (let i = 0; i < 21; i++) cache.set(`/f${i}.md`, `${i}`);
  expect(cache.size).toBe(20);
  expect(cache.has("/f0.md")).toBe(false);
});

// ── Construction guards ───────────────────────────────────────────────────────

test("constructor rejects a capacity below 1", () => {
  expect(() => new EditorStateCache<string>(0)).toThrow();
  expect(() => new EditorStateCache<string>(-3)).toThrow();
});

test("capacity of 1 keeps only the most recent entry", () => {
  const cache = new EditorStateCache<string>(1);
  cache.set("/a.md", "1");
  cache.set("/b.md", "2");
  expect(cache.has("/a.md")).toBe(false);
  expect(cache.get("/b.md")).toBe("2");
  expect(cache.size).toBe(1);
});

// ── Generic value type (documents the CodeMirror use case without depending on it) ──

test("works with an object value shape (state + scroll offsets)", () => {
  interface CachedEntry {
    doc: string;
    scrollTop: number;
  }
  const cache = new EditorStateCache<CachedEntry>(5);
  cache.set("/a.md", { doc: "hello", scrollTop: 120 });
  expect(cache.get("/a.md")).toEqual({ doc: "hello", scrollTop: 120 });
});
