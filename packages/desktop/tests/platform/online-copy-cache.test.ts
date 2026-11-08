import { describe, expect, test } from "bun:test";
import { createOnlineCopyCache, FRESH_MS, type OnlineCopyReads } from "../../src/lib/routes/online-copy-cache";

const diag = { remoteUrl: "https://github.com/a/b.git" } as never;
const plain = { remoteUrl: undefined } as never;
const list = (current: string, extra = {}) => ({ current, revisions: [], repairCopies: [], checkedOnline: true, ...extra }) as never;

function fakes(opts: { d?: unknown; delay?: number } = {}) {
  const calls = { diagnose: 0, local: 0, online: 0 };
  let current = "main";
  const reads: OnlineCopyReads = {
    diagnose: async () => (calls.diagnose++, (opts.d ?? diag) as never),
    listRevisions: async (_dir, o) => {
      if (o?.refresh) {
        calls.online++;
        if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
      } else calls.local++;
      return list(current);
    },
  };
  return { reads, calls, setCurrent: (c: string) => (current = c) };
}

describe("online-copy cache", () => {
  test("first get reads once; a second get inside 60 s is instant and reads nothing", async () => {
    let t = 1_000_000;
    const f = fakes();
    const c = createOnlineCopyCache(f.reads, () => t);
    await c.refresh("/b");
    expect(f.calls).toEqual({ diagnose: 1, local: 1, online: 1 });
    t += 30_000;
    const s = await c.get("/b");
    expect(s.checkedOnline).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    // The online check is not repeated inside 60 s; what the online copy is (local) is read again.
    expect(f.calls).toEqual({ diagnose: 2, local: 2, online: 1 });
  });

  test("an old snapshot is returned at once and refreshed behind it", async () => {
    let t = 1_000_000;
    const f = fakes();
    const c = createOnlineCopyCache(f.reads, () => t);
    await c.refresh("/b");
    t += FRESH_MS + 1;
    await c.get("/b");
    await new Promise((r) => setTimeout(r, 5));
    expect(f.calls.online).toBe(2);
  });

  test("publishes the local answer with checking before the online check lands", async () => {
    const f = fakes({ delay: 20 });
    const c = createOnlineCopyCache(f.reads);
    const seen: boolean[] = [];
    c.subscribe("/b", (s) => seen.push(s.checking));
    await c.refresh("/b");
    expect(seen).toEqual([true, false]);
  });

  test("the first get answers from this computer while the online check is still running", async () => {
    const f = fakes({ delay: 80 });
    const c = createOnlineCopyCache(f.reads);
    const started = Date.now();
    const s = await c.get("/b");
    expect(Date.now() - started).toBeLessThan(60);
    expect(s.checking).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    expect(c.peek("/b")?.checking).toBe(false);
  });

  test("a local refresh does not touch the network or diagnose again", async () => {
    const f = fakes();
    const c = createOnlineCopyCache(f.reads);
    await c.refresh("/b");
    f.setCurrent("Second-edition");
    const s = await c.refresh("/b", { network: false });
    expect(s.revisions?.current).toBe("Second-edition");
    expect(f.calls).toEqual({ diagnose: 1, local: 2, online: 1 });
    expect(s.checkedAt).not.toBeNull();
  });

  test("a book with no online copy is never checked online", async () => {
    const f = fakes({ d: plain });
    const c = createOnlineCopyCache(f.reads);
    const s = await c.get("/b");
    expect(f.calls.online).toBe(0);
    expect(s.checking).toBe(false);
    expect(s.checkedAt).toBeNull();
  });

  test("uses the host's checkedAt when it sends one, and invalidate starts over", async () => {
    const reads: OnlineCopyReads = {
      diagnose: async () => diag,
      listRevisions: async () => list("main", { checkedAt: 123_456 }),
    };
    const c = createOnlineCopyCache(reads);
    expect((await c.refresh("/b")).checkedAt).toBe(123_456);
    c.invalidate("/b");
    expect(c.peek("/b")).toBeUndefined();
  });

  test("a failed online check keeps the list and says it was not online", async () => {
    const reads: OnlineCopyReads = {
      diagnose: async () => diag,
      listRevisions: async (_d, o) => {
        if (o?.refresh) throw new Error("offline");
        return list("main");
      },
    };
    const s = await createOnlineCopyCache(reads).refresh("/b");
    expect(s.checkedOnline).toBe(false);
    expect(s.revisions?.current).toBe("main");
    expect(s.checking).toBe(false);
  });

  test("version history first page is prefetched once and taken once", async () => {
    let n = 0;
    const reads: OnlineCopyReads = { ...fakes().reads, firstVersionsPage: async () => (n++, { entries: [], hasMore: false }) };
    const c = createOnlineCopyCache(reads);
    c.prefetchVersions("/b");
    c.prefetchVersions("/b");
    expect(n).toBe(1);
    expect(await c.takeVersionsPage("/b")).toEqual({ entries: [], hasMore: false });
    expect(c.takeVersionsPage("/b")).toBeUndefined();
  });

  test("only failures that are not offline count, and a good backup resets them", () => {
    const c = createOnlineCopyCache(fakes().reads);
    expect(c.noteBackupResult("/b", "offline")).toBe(0);
    expect(c.noteBackupResult("/b", "error")).toBe(1);
    expect(c.noteBackupResult("/b", "offline")).toBe(1);
    expect(c.noteBackupResult("/b", "auth")).toBe(2);
    expect(c.noteBackupResult("/b", "synced")).toBe(0);
  });
});

describe("online-copy cache: after an action", () => {
  test("a fresh refresh does not join a check that started before the action", async () => {
    const f = fakes({ delay: 40 });
    const c = createOnlineCopyCache(f.reads);
    const first = c.refresh("/b");
    await new Promise((r) => setTimeout(r, 5));
    const second = c.refresh("/b", { fresh: true });
    await Promise.all([first, second]);
    expect(f.calls.online).toBe(2);
    // Without `fresh` a running check is shared.
    const f2 = fakes({ delay: 40 });
    const c2 = createOnlineCopyCache(f2.reads);
    await Promise.all([c2.refresh("/b"), c2.refresh("/b")]);
    expect(f2.calls.online).toBe(1);
  });

  test("a late old read after invalidate does not come back into the snapshot", async () => {
    const f = fakes({ delay: 40 });
    const c = createOnlineCopyCache(f.reads);
    const old = c.refresh("/b");
    await new Promise((r) => setTimeout(r, 5));
    c.invalidate("/b");
    await old;
    expect(c.peek("/b")).toBeUndefined();
  });

  test("a prefetched Version history page that has aged is read again", async () => {
    let t = 1000, n = 0;
    const reads: OnlineCopyReads = { ...fakes().reads, firstVersionsPage: async () => (n++, { entries: [], hasMore: false }) };
    const c = createOnlineCopyCache(reads, () => t);
    c.prefetchVersions("/b");
    t += 6000;
    expect(c.takeVersionsPage("/b")).toBeUndefined();
    c.prefetchVersions("/b");
    c.prefetchVersions("/b");
    expect(n).toBe(2);
  });

  test("the same failing status seen twice counts once; a new one counts again", () => {
    const c = createOnlineCopyCache(fakes().reads);
    expect(c.noteBackupResult("/b", "error", "t1")).toBe(1);
    expect(c.noteBackupResult("/b", "error", "t1")).toBe(1);
    expect(c.noteBackupResult("/b", "error", "t2")).toBe(2);
  });
});
