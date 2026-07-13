import { expect, test } from "bun:test";
import path from "node:path";
import { createPickedFilesService } from "../../electron/server-bridge/picked-files";

// Unit coverage for the picked-files allow-set itself (P1 review), isolated
// from any route/HostServices wiring.

test("a path is consumable exactly once after being registered", () => {
  const svc = createPickedFilesService();
  const p = "/some/host/file.png";
  svc.register([p]);
  expect(svc.consume(p)).toBe(true);
  expect(svc.consume(p)).toBe(false);
});

test("a path that was never registered is never consumable", () => {
  const svc = createPickedFilesService();
  expect(svc.consume("/never/registered.png")).toBe(false);
});

test("register normalizes the path the same way consume does (relative segments collapse)", () => {
  const svc = createPickedFilesService();
  svc.register([path.join("/some/host", "a", "..", "file.png")]);
  expect(svc.consume("/some/host/file.png")).toBe(true);
});

test("re-registering the same path refreshes it instead of creating a second entry", () => {
  const svc = createPickedFilesService({ maxEntries: 1 });
  const p = "/some/host/file.png";
  svc.register([p]);
  svc.register(["/some/host/other.png"]); // would evict `p` if it were a distinct 2nd entry
  // Re-register `p`, which should keep it live (and now evict "other.png"
  // instead, since `p` was just refreshed to the front of the eviction queue).
  svc.register([p]);
  expect(svc.consume(p)).toBe(true);
});

test("bounded size: registering beyond maxEntries evicts the oldest un-consumed entry", () => {
  const svc = createPickedFilesService({ maxEntries: 2 });
  svc.register(["/a", "/b"]);
  svc.register(["/c"]); // pushes total registrations to 3; "/a" (oldest) should be evicted
  expect(svc.consume("/a")).toBe(false);
  expect(svc.consume("/b")).toBe(true);
  expect(svc.consume("/c")).toBe(true);
});

test("TTL: an entry older than ttlMs is no longer consumable", () => {
  let now = 1_000_000;
  const svc = createPickedFilesService({ ttlMs: 1000, now: () => now });
  svc.register(["/a"]);
  now += 1001; // past the TTL
  expect(svc.consume("/a")).toBe(false);
});

test("TTL: an entry within ttlMs is still consumable", () => {
  let now = 1_000_000;
  const svc = createPickedFilesService({ ttlMs: 1000, now: () => now });
  svc.register(["/a"]);
  now += 500; // within the TTL
  expect(svc.consume("/a")).toBe(true);
});

// Regression (fix-round-1 review finding): dialog/pick-image-files enables
// `multiSelections`, so a single native-dialog bulk pick can register far
// more than the default 64-entry cap in ONE register() call. The old
// oldest-first eviction ran per-path against the fixed `maxEntries`, so
// registering a >maxEntries batch evicted the batch's OWN earliest members
// before the caller ever got a chance to consume them — MediaPanel's
// importImages loop (which imports picked paths in order, oldest first)
// would then 403 on the very first file. A single dialog batch must never
// self-evict its own members.
test("bulk import: a single register() batch larger than maxEntries never evicts its own members", () => {
  const svc = createPickedFilesService({ maxEntries: 64 });
  const batch = Array.from({ length: 65 }, (_, i) => `/picked/${i}.png`);
  svc.register(batch);
  // Consumed in the SAME order MediaPanel's importImages loop would use
  // (oldest-picked first) — this is exactly the order the pre-fix eviction
  // broke, since the oldest entries were the ones self-evicted.
  for (const p of batch) {
    expect(svc.consume(p)).toBe(true);
  }
});

// A batch bigger than maxEntries should still bound eviction of PRIOR,
// unrelated entries — auto-sizing the cap to the batch length must not
// become "no cap at all" for stale entries from earlier, separate picks.
test("bulk import: a large batch still evicts older, unrelated pre-existing entries down to the batch size", () => {
  const svc = createPickedFilesService({ maxEntries: 2 });
  svc.register(["/old/1", "/old/2"]); // fills the (small) cap from an earlier, separate pick
  const batch = Array.from({ length: 5 }, (_, i) => `/picked/${i}.png`);
  svc.register(batch);
  // The stale pre-existing entries are gone (evicted to make room)...
  expect(svc.consume("/old/1")).toBe(false);
  expect(svc.consume("/old/2")).toBe(false);
  // ...but every member of the new batch survived intact.
  for (const p of batch) {
    expect(svc.consume(p)).toBe(true);
  }
});
