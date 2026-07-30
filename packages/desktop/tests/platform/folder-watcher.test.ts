import { expect, test } from "bun:test";
import type { FSWatcher } from "node:fs";
import {
  FolderWatcher,
  type FolderWatcherDeps,
} from "../../electron/folder-watch/watcher";

const DIR = "/book";

/** The debounce delay startFolderWatch arms (main.ts uses a literal 150ms). */
const DEBOUNCE_MS = 150;

interface FakeTimer {
  id: number;
  cb: () => void;
  ms: number;
}

/** Injectable fake timer manager so tests control when the 150ms debounce fires. */
class FakeClock {
  timers = new Map<number, FakeTimer>();
  private nextId = 1;
  set = (cb: () => void, ms: number): number => {
    const id = this.nextId++;
    this.timers.set(id, { id, cb, ms });
    return id;
  };
  clear = (h: unknown): void => {
    this.timers.delete(h as number);
  };
  /** Fire the single armed timer (the watcher only ever holds one debounce). */
  fireOnly(): void {
    const only = [...this.timers.values()][0];
    if (!only) throw new Error("no timer armed");
    this.timers.delete(only.id);
    only.cb();
  }
  get armedMs(): number | null {
    const only = [...this.timers.values()][0];
    return only ? only.ms : null;
  }
  get size(): number {
    return this.timers.size;
  }
}

/** A fake FSWatcher that records how many times it was closed. */
interface FakeWatcher {
  close: () => void;
  closed: number;
}

interface HarnessOptions {
  /** Override the resolve() normalizer (default: identity). */
  resolve?: (p: string) => string;
  /** When true, deps.watch throws (exercise the try/catch path). */
  watchThrows?: boolean;
}

interface Harness {
  fw: FolderWatcher;
  clock: FakeClock;
  /** Every { dir, options } passed to deps.watch, in order. */
  watchCalls: { dir: string; options: unknown }[];
  events: {
    folderChanged: string[];
    editSignal: string[];
    stop: number;
    watchedDirChanged: (string | null)[];
  };
  /** The most recently created fake watcher (or null before the first start). */
  getWatcher: () => FakeWatcher | null;
  /** Invoke the captured fs.watch callback as if the OS emitted an event. */
  fireCb: (event: string, filename: string | Buffer | null) => void;
}

function makeHarness(opts: HarnessOptions = {}): Harness {
  const clock = new FakeClock();
  const watchCalls: { dir: string; options: unknown }[] = [];
  const events: Harness["events"] = {
    folderChanged: [],
    editSignal: [],
    stop: 0,
    watchedDirChanged: [],
  };
  let currentWatcher: FakeWatcher | null = null;
  let capturedCb:
    | ((event: string, filename: string | Buffer | null) => void)
    | null = null;

  const deps: FolderWatcherDeps = {
    watch: (dir, options, cb) => {
      watchCalls.push({ dir, options });
      if (opts.watchThrows) throw new Error("EACCES: watch failed");
      const w: FakeWatcher = {
        closed: 0,
        close() {
          this.closed += 1;
        },
      };
      currentWatcher = w;
      capturedCb = cb as (
        event: string,
        filename: string | Buffer | null,
      ) => void;
      return w as unknown as FSWatcher;
    },
    resolve: opts.resolve ?? ((p: string) => p),
    onFolderChanged: (name) => events.folderChanged.push(name),
    onEditSignal: (dir) => events.editSignal.push(dir),
    onStop: () => {
      events.stop += 1;
    },
    setTimer: clock.set,
    clearTimer: clock.clear,
    onWatchedDirChanged: (d) => events.watchedDirChanged.push(d),
  };

  return {
    fw: new FolderWatcher(deps),
    clock,
    watchCalls,
    events,
    getWatcher: () => currentWatcher,
    fireCb: (event, filename) => {
      if (!capturedCb) throw new Error("no watch callback captured");
      capturedCb(event, filename);
    },
  };
}

// ── (a) .git-internal writes are ignored ────────────────────────────────────────

test("(a) a watch event for a .git path is ignored (no folderChanged, no editSignal, no debounce)", () => {
  const h = makeHarness();
  h.fw.start(DIR);
  for (const f of [".git", ".git/HEAD", ".git\\index"]) {
    h.fireCb("change", f);
  }
  expect(h.events.folderChanged.length).toBe(0);
  expect(h.events.editSignal.length).toBe(0);
  expect(h.clock.size).toBe(0); // no debounce armed for git-internal writes
});

// ── (b) debounce + immediate normalized edit signal ─────────────────────────────

test("(b) two rapid events debounce to ONE folderChanged after 150ms; editSignal fires per event with the normalized dir", () => {
  const h = makeHarness();
  h.fw.start(DIR);

  h.fireCb("change", "chapter.md");
  h.fireCb("rename", "chapter.md");

  // Exactly one debounce timer armed (the second event reset the first).
  expect(h.clock.size).toBe(1);
  expect(h.clock.armedMs).toBe(DEBOUNCE_MS);
  // folderChanged has NOT fired yet (still debouncing).
  expect(h.events.folderChanged.length).toBe(0);
  // The edit signal fires IMMEDIATELY per event (not debounced), keyed by the
  // normalized dir — matching scheduleAutoSnapshot/autoSync.schedule in main.ts.
  expect(h.events.editSignal).toEqual([DIR, DIR]);

  h.clock.fireOnly();
  expect(h.events.folderChanged).toEqual(["chapter.md"]);
});

// ── (c) resolve() normalization ─────────────────────────────────────────────────

test("(c) start() normalizes dirPath via resolve before storing/keying", () => {
  const h = makeHarness({ resolve: (p) => `/abs/${p}` });
  h.fw.start("book");
  expect(h.fw.getWatchedDir()).toBe("/abs/book");
  // The edit-signal key is the NORMALIZED dir, not the raw dirPath.
  h.fireCb("change", "x.md");
  expect(h.events.editSignal).toEqual(["/abs/book"]);
});

// ── (d) same-dir short-circuit ──────────────────────────────────────────────────

test("(d) start() on the same already-watched dir short-circuits (watch not called again)", () => {
  const h = makeHarness();
  h.fw.start(DIR);
  expect(h.watchCalls.length).toBe(1);
  const stopBefore = h.events.stop;
  h.fw.start(DIR);
  expect(h.watchCalls.length).toBe(1); // no second watch
  expect(h.events.stop).toBe(stopBefore); // no stop on short-circuit
});

// ── (e) switching dirs stops the old watcher first ──────────────────────────────

test("(e) start() on a new dir stops the old (onStop + old watcher.close) then watches the new", () => {
  const h = makeHarness();
  h.fw.start("/a");
  const first = h.getWatcher()!;
  const stopBefore = h.events.stop;

  h.fw.start("/b");
  expect(first.closed).toBe(1); // old watcher closed
  expect(h.events.stop).toBe(stopBefore + 1); // onStop fired for the switch
  expect(h.watchCalls[h.watchCalls.length - 1]?.dir).toBe("/b"); // watched new dir
  expect(h.fw.getWatchedDir()).toBe("/b");
});

// ── (f) stop() tear-down ────────────────────────────────────────────────────────

test("(f) stop() closes the watcher, clears the debounce, nulls watchedDir, fires onStop once", () => {
  const h = makeHarness();
  h.fw.start(DIR);
  const w = h.getWatcher()!;
  h.fireCb("change", "x.md"); // arm the debounce
  expect(h.clock.size).toBe(1);

  const stopBefore = h.events.stop;
  h.fw.stop();

  expect(w.closed).toBe(1);
  expect(h.clock.size).toBe(0); // debounce timer cleared
  expect(h.fw.getWatchedDir()).toBeNull();
  expect(
    h.events.watchedDirChanged[h.events.watchedDirChanged.length - 1],
  ).toBeNull();
  expect(h.events.stop).toBe(stopBefore + 1); // exactly one onStop for this stop()
});

// ── (g) watch() throwing is non-fatal ───────────────────────────────────────────

test("(g) a watch() that throws leaves watchedDir null and does not crash", () => {
  const h = makeHarness({ watchThrows: true });
  expect(() => h.fw.start(DIR)).not.toThrow();
  expect(h.fw.getWatchedDir()).toBeNull();
});

// ── (h) onWatchedDirChanged mirror signal on every transition ───────────────────

test("(h) onWatchedDirChanged fires on every watchedDir set/clear transition", () => {
  const h = makeHarness();
  h.fw.start("/a");
  // A fresh start internally stops first (→ null) then sets (→ /a).
  expect(h.events.watchedDirChanged).toContain("/a");

  h.fw.start("/b");
  expect(h.events.watchedDirChanged).toContain("/b");

  h.fw.stop();
  expect(
    h.events.watchedDirChanged[h.events.watchedDirChanged.length - 1],
  ).toBeNull();
});

// ── 2026-07-29 audit: nested edits must be observed ──────────────────────────
//
// The watch was non-recursive, so its only visible events were the book's
// TOP-LEVEL entries. An external editor saving `chapters/ch01.md` or
// `styles/book.css` produced no folderChanged (the editor/file tree never
// reconciled) and no editSignal (the auto-snapshot/auto-sync debounce never
// armed) — while the embedded CLI preview watcher, which IS recursive, saw the
// same edit and rebuilt the preview. Two observers of one project, two answers.
//
// Recursive watching also means generated and vendored subtrees now produce
// events, so they are filtered: they are never publication SOURCE (R15), and a
// build or a plugin install would otherwise storm the debounce.

test("a nested source file produces a folderChanged + editSignal", () => {
  const h = makeHarness();
  h.fw.start(DIR);
  expect(h.watchCalls[0]?.options).toEqual({ recursive: true });

  h.fireCb("change", "chapters/ch01.md");
  expect(h.events.editSignal).toEqual([DIR]);
  h.clock.fireOnly();
  expect(h.events.folderChanged).toEqual(["chapters/ch01.md"]);
});

test("a nested stylesheet produces a folderChanged + editSignal", () => {
  const h = makeHarness();
  h.fw.start(DIR);
  h.fireCb("change", "styles/book.css");
  expect(h.events.editSignal).toEqual([DIR]);
  h.clock.fireOnly();
  expect(h.events.folderChanged).toEqual(["styles/book.css"]);
});

test("a nested .git path is still ignored at any depth", () => {
  const h = makeHarness();
  h.fw.start(DIR);
  for (const f of [".git/objects/ab/cdef", ".git\\refs\\heads\\main"]) {
    h.fireCb("change", f);
  }
  expect(h.events.editSignal).toEqual([]);
  expect(h.clock.size).toBe(0);
});

test("generated and vendored subtrees are ignored (dist, plugins/npm, node_modules)", () => {
  const h = makeHarness();
  h.fw.start(DIR);
  for (const f of [
    "dist/field-guide/field-guide-pdf.pdf",
    "dist",
    "plugins/npm/some-plugin/1.0.0/index.js",
    "node_modules/.bin/x",
    "dist\\windows\\spelling.pdf",
  ]) {
    h.fireCb("change", f);
  }
  expect(h.events.editSignal).toEqual([]);
  expect(h.clock.size).toBe(0);
});

test("a source file whose name merely STARTS with an ignored segment is not ignored", () => {
  // "distribution.md" is not "dist/", and "node_modules_notes.md" is not
  // "node_modules/" — segment-aware matching, not a prefix test.
  const h = makeHarness();
  h.fw.start(DIR);
  h.fireCb("change", "distribution.md");
  expect(h.events.editSignal).toEqual([DIR]);
  h.clock.fireOnly();
  expect(h.events.folderChanged).toEqual(["distribution.md"]);
});
