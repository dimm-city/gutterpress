import { expect, test } from "bun:test";
import { ThumbCache } from "../../src/lib/media-thumbs.svelte";

// Bun runs the rune-bearing .svelte.ts without Svelte's compiler; plain values are
// enough here (same shim as the other controller tests).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

/** A loader whose results the test settles by hand, recording how many are in flight. */
function manualLoader() {
  const pending: { url: string; ok: (src: string) => void; fail: () => void }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const load = (url: string) =>
    new Promise<string>((ok, fail) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      pending.push({
        url,
        ok: (src) => { inFlight--; ok(src); },
        fail: () => { inFlight--; fail(new Error("undecodable")); },
      });
    });
  return { load, pending, max: () => maxInFlight };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("never loads more than the concurrency limit at once, and drains the queue", async () => {
  const l = manualLoader();
  const cache = new ThumbCache(l.load, 2);
  for (let i = 0; i < 6; i++) cache.want(`k${i}`, `u${i}`);
  expect(l.pending.length).toBe(2);
  while (l.pending.length) {
    l.pending.shift()!.ok("data:x");
    await tick();
  }
  expect(l.max()).toBe(2);
  expect(cache.src("k5")).toBe("data:x");
});

test("an image that cannot be loaded (e.g. a TIFF) ends as null, not undefined", async () => {
  const l = manualLoader();
  const cache = new ThumbCache(l.load, 2);
  cache.want("plate.tif", "u");
  expect(cache.src("plate.tif")).toBeUndefined();
  l.pending[0]!.fail();
  await tick();
  expect(cache.src("plate.tif")).toBeNull();
});

test("a changed file (new url) is loaded again, showing the old thumbnail until the new one arrives; the old one is revoked", async () => {
  const revoked: string[] = [];
  const realRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (u: string) => void revoked.push(u);
  try {
    const l = manualLoader();
    const cache = new ThumbCache(l.load, 2);
    cache.want("a.png", "a?v=1");
    l.pending.shift()!.ok("blob:old");
    await tick();
    cache.want("a.png", "a?v=1"); // repeat: nothing to do
    expect(l.pending.length).toBe(0);
    cache.want("a.png", "a?v=2");
    expect(cache.src("a.png")).toBe("blob:old");
    l.pending.shift()!.ok("blob:new");
    await tick();
    expect(cache.src("a.png")).toBe("blob:new");
    expect(revoked).toEqual(["blob:old"]);
  } finally {
    URL.revokeObjectURL = realRevoke;
  }
});

test("dropping a tile frees its thumbnail, and a load finishing after the drop is freed too", async () => {
  const revoked: string[] = [];
  const realRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (u: string) => void revoked.push(u);
  try {
    const l = manualLoader();
    const cache = new ThumbCache(l.load, 2);
    cache.want("a", "ua");
    cache.want("b", "ub");
    l.pending.shift()!.ok("blob:a");
    await tick();
    cache.drop("a");
    expect(cache.src("a")).toBeUndefined();
    cache.drop("b");
    l.pending.shift()!.ok("blob:b"); // b finished loading after it was dropped
    await tick();
    expect(revoked.sort()).toEqual(["blob:a", "blob:b"]);
    expect(cache.src("b")).toBeUndefined();
  } finally {
    URL.revokeObjectURL = realRevoke;
  }
});
