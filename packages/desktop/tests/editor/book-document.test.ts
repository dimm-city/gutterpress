import { expect, test, describe } from "bun:test";
import { BookDocument, resolveBookChapters } from "../../src/lib/editor/book-document.svelte";
import type { FileStat, FileWriteResult, Platform } from "../../src/lib/platform/contract";

/**
 * BookDocument — the buffer registry behind the continuous book document.
 *
 * The point of the design is that opening the whole book did NOT weaken the
 * per-file save machinery: every chapter still has its own `EditorBuffer`, its
 * own dirty state, its own debounced write, and its own external-edit
 * reconciliation. These tests drive the REAL EditorBuffer (not a fake) through
 * that registry, so a regression that starts cross-contaminating chapters —
 * one file's edit saved over another, a stale conflict routed to the wrong
 * buffer — fails here.
 *
 * Bun imports the rune-bearing .svelte.ts module without Svelte's compiler; the
 * production compiler replaces $state, and the class only needs plain values
 * for these behavior tests (same shim as buffer-state.test.ts).
 */
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

class MemoryPlatform implements Partial<Platform> {
  readonly platform = "electron" as const;
  private files = new Map<string, { content: string; mtimeMs: number }>();
  private clock = 1000;
  /** Paths whose read throws — a chapter the manifest lists but disk doesn't have. */
  unreadable = new Set<string>();

  constructor(initial: Record<string, string>) {
    for (const [path, content] of Object.entries(initial)) {
      this.files.set(path, { content, mtimeMs: this.tick() });
    }
  }

  getContent(path: string): string | null {
    return this.files.get(path)?.content ?? null;
  }

  externalWrite(path: string, content: string): void {
    this.files.set(path, { content, mtimeMs: this.tick() });
  }

  async readFile(path: string): Promise<string> {
    if (this.unreadable.has(path)) throw new Error(`ENOENT ${path}`);
    const file = this.files.get(path);
    if (!file) throw new Error(`ENOENT ${path}`);
    return file.content;
  }

  async writeFile(path: string, content: string): Promise<FileWriteResult> {
    const mtimeMs = this.tick();
    this.files.set(path, { content, mtimeMs });
    return { mtimeMs };
  }

  async statFile(path: string): Promise<FileStat> {
    const file = this.files.get(path);
    if (!file) return { exists: false, size: 0, mtimeMs: 0 };
    return {
      exists: true,
      size: new TextEncoder().encode(file.content).length,
      mtimeMs: file.mtimeMs,
    };
  }

  private tick(): number {
    this.clock += 1;
    return this.clock;
  }
}

interface Harness {
  book: BookDocument;
  platform: MemoryPlatform;
  events: string[];
}

function make(
  files: Record<string, string>,
  opts: { saveDelayMs?: number } = {},
): Harness {
  const platform = new MemoryPlatform(files);
  const events: string[] = [];
  const book = new BookDocument({
    platform: platform as Platform,
    saveDelayMs: opts.saveDelayMs ?? 10_000,
    recoveryEnabled: false,
    onError: (message) => events.push(`error:${message}`),
    onExternalConflict: (path) => events.push(`conflict:${path}`),
    onAutoReloaded: (path) => events.push(`auto:${path}`),
    onContentReplaced: (path) => events.push(`replaced:${path}`),
    onDirty: (pending) => events.push(`dirty:${pending}`),
    onSectionsUnavailable: (paths) => events.push(`unavailable:${paths.join(",")}`),
  });
  return { book, platform, events };
}

const refs = (...chapters: string[]) =>
  chapters.map((chapter) => ({ chapter, path: `/book/${chapter}` }));

// ── resolveBookChapters ──────────────────────────────────────────────────────

describe("resolveBookChapters", () => {
  test("uses the manifest's source.files order when it lists any", () => {
    expect(resolveBookChapters(["a.md", "b.md"], ["b.md", "a.md"])).toEqual(["b.md", "a.md"]);
  });

  test("falls back to every markdown file, lexicographically — matching the renderer", () => {
    // packages/cli/src/lib/markdown/index.ts sorts with a plain `.sort()`; the
    // editor must agree or the manuscript reads in a different order than it
    // prints.
    expect(resolveBookChapters(["10.md", "2.md", "1.md"], null)).toEqual([
      "1.md",
      "10.md",
      "2.md",
    ]);
    expect(resolveBookChapters(["b.md"], [])).toEqual(["b.md"]);
    expect(resolveBookChapters(["b.md"], undefined)).toEqual(["b.md"]);
  });

  test("normalizes manifest separators and drops blank entries", () => {
    expect(resolveBookChapters([], ["chapters\\03.md", "  ", " 01.md "])).toEqual([
      "chapters/03.md",
      "01.md",
    ]);
  });
});

// ── opening ──────────────────────────────────────────────────────────────────

describe("open", () => {
  test("loads every chapter and returns them in book order", async () => {
    const h = make({ "/book/01.md": "one\n", "/book/02.md": "two\n" });
    const sections = await h.book.open(refs("01.md", "02.md"));
    expect(sections).toEqual([
      { path: "/book/01.md", chapter: "01.md", content: "one\n" },
      { path: "/book/02.md", chapter: "02.md", content: "two\n" },
    ]);
    expect(h.book.activePath).toBe("/book/01.md");
    expect(h.book.isSection("/book/02.md")).toBe(true);
    expect(h.book.chapterFor("/book/02.md")).toBe("02.md");
    expect(h.book.pathForChapter("02.md")).toBe("/book/02.md");
  });

  test("drops a chapter it can't read instead of opening it as an empty buffer", async () => {
    // An empty buffer would become the live value and the next edit anywhere in
    // the book would save it over the file.
    const h = make({ "/book/01.md": "one\n" });
    h.platform.unreadable.add("/book/missing.md");
    const sections = await h.book.open(refs("01.md", "missing.md"));
    expect(sections.map((s) => s.chapter)).toEqual(["01.md"]);
    expect(h.book.isSection("/book/missing.md")).toBe(false);
    // Reported once, as a batch — not one error toast per unreadable file.
    expect(h.events).toContain("unavailable:/book/missing.md");
    expect(h.events.some((e) => e.startsWith("error:"))).toBe(false);
  });

  test("matchesSections compares what was ASKED for, so a missing chapter isn't churn", async () => {
    const h = make({ "/book/01.md": "one\n" });
    h.platform.unreadable.add("/book/missing.md");
    await h.book.open(refs("01.md", "missing.md"));
    // The folder watcher re-resolves the same list on every save; it must not
    // look like the book's shape changed just because one entry has no file.
    expect(h.book.matchesSections(refs("01.md", "missing.md"))).toBe(true);
    expect(h.book.matchesSections(refs("01.md"))).toBe(false);
    expect(h.book.matchesSections(refs("01.md", "missing.md", "03.md"))).toBe(false);
  });

  test("a rebuild does NOT re-read a chapter with unsaved edits", async () => {
    // A rebuild is triggered by the book's SHAPE changing (a chapter added or
    // deleted on disk, `source.files` reordered) — which says nothing about the
    // content of a chapter the author is mid-edit in. Reloading it would
    // discard an edit still inside the autosave debounce, and the folder
    // watcher's own reconciliation deliberately skips a file with a save
    // outstanding, so nothing else would catch it.
    const h = make({ "/book/01.md": "one\n", "/book/02.md": "two\n", "/book/03.md": "three\n" });
    await h.book.open(refs("01.md", "02.md"));
    h.book.applyEdit("/book/01.md", "UNSAVED\n");
    await h.book.open(refs("01.md", "02.md", "03.md"));
    expect(h.book.contentFor("/book/01.md")).toBe("UNSAVED\n");
    expect(h.book.bufferFor("/book/01.md")!.isDirty).toBe(true);
    // Clean chapters still pick up whatever is on disk now.
    expect(h.book.contentFor("/book/02.md")).toBe("two\n");
  });

  test("a rebuild keeps standalone buffers and their pending saves", async () => {
    // Dropping them would reset() a stylesheet the author is editing, silently
    // cancelling its debounced save. The book changing shape has nothing to do
    // with a file that isn't in the book.
    const h = make({ "/book/01.md": "a\n", "/book/02.md": "b\n", "/book/style.css": "css\n" });
    await h.book.open(refs("01.md"));
    await h.book.openStandalone("/book/style.css");
    h.book.applyEdit("/book/style.css", "edited css\n");

    await h.book.open(refs("01.md", "02.md"));

    expect(h.book.standalonePaths).toEqual(["/book/style.css"]);
    expect(h.book.contentFor("/book/style.css")).toBe("edited css\n");
    expect(h.book.bufferFor("/book/style.css")!.hasPendingSave).toBe(true);
    await h.book.flushAll();
    expect(h.platform.getContent("/book/style.css")).toBe("edited css\n");
  });

  test("a rebuild keeps the author on the file they had active", async () => {
    const h = make({ "/book/01.md": "a\n", "/book/02.md": "b\n", "/book/style.css": "css\n" });
    await h.book.open(refs("01.md", "02.md"));
    await h.book.openStandalone("/book/style.css");
    await h.book.open(refs("01.md", "02.md"));
    expect(h.book.activePath).toBe("/book/style.css");

    h.book.setActive("/book/02.md");
    await h.book.open(refs("01.md", "02.md"));
    expect(h.book.activePath).toBe("/book/02.md");
  });

  test("a standalone file the author adds to source.files becomes a section", async () => {
    const h = make({ "/book/01.md": "a\n", "/book/notes.md": "notes\n" });
    await h.book.open(refs("01.md"));
    await h.book.openStandalone("/book/notes.md");
    await h.book.open(refs("01.md", "notes.md"));
    expect(h.book.isSection("/book/notes.md")).toBe(true);
    expect(h.book.standalonePaths).toEqual([]);
    expect(h.book.activePath).toBe("/book/notes.md");
  });

  test("a rebuild that loses the active file falls back to the first chapter", async () => {
    const h = make({ "/book/01.md": "a\n", "/book/02.md": "b\n" });
    await h.book.open(refs("01.md", "02.md"));
    h.book.setActive("/book/02.md");
    await h.book.open(refs("01.md"));
    expect(h.book.activePath).toBe("/book/01.md");
  });

  test("re-opening drops buffers for files that left the book", async () => {
    const h = make({ "/book/01.md": "one\n", "/book/02.md": "two\n" });
    await h.book.open(refs("01.md", "02.md"));
    await h.book.open(refs("01.md"));
    expect(h.book.bufferFor("/book/02.md")).toBeNull();
    expect(h.book.contentFor("/book/02.md")).toBeNull();
  });
});

// ── editing ──────────────────────────────────────────────────────────────────

describe("applyEdit", () => {
  test("routes each chapter's text to its OWN buffer", async () => {
    const h = make({ "/book/01.md": "one\n", "/book/02.md": "two\n" });
    await h.book.open(refs("01.md", "02.md"));
    h.book.applyEdit("/book/02.md", "two EDITED\n");
    expect(h.book.contentFor("/book/02.md")).toBe("two EDITED\n");
    expect(h.book.contentFor("/book/01.md")).toBe("one\n");
    expect(h.book.bufferFor("/book/02.md")!.isDirty).toBe(true);
    expect(h.book.bufferFor("/book/01.md")!.isDirty).toBe(false);
  });

  test("an edit crossing a boundary saves BOTH files independently", async () => {
    // A paste or a delete across a chapter boundary changes two files at once;
    // each must reach its own file's save machinery.
    const h = make({ "/book/01.md": "one\n", "/book/02.md": "two\n" }, { saveDelayMs: 0 });
    await h.book.open(refs("01.md", "02.md"));
    h.book.applyEdit("/book/01.md", "merged\n");
    h.book.applyEdit("/book/02.md", "");
    await h.book.flushAll();
    expect(h.platform.getContent("/book/01.md")).toBe("merged\n");
    expect(h.platform.getContent("/book/02.md")).toBe("");
  });

  test("an edit to a file the book doesn't hold is a no-op, not a new file", async () => {
    const h = make({ "/book/01.md": "one\n" });
    await h.book.open(refs("01.md"));
    h.book.applyEdit("/book/not-open.md", "should not appear");
    await h.book.flushAll();
    expect(h.platform.getContent("/book/not-open.md")).toBeNull();
  });
});

// ── aggregate state ──────────────────────────────────────────────────────────

describe("aggregate state", () => {
  test("reports the WHOLE book's save state, not just the active chapter", async () => {
    // The author can leave unsaved edits several chapters back; a status bar
    // describing only the caret's chapter would say "saved" while they pend.
    const h = make({ "/book/01.md": "one\n", "/book/02.md": "two\n" });
    await h.book.open(refs("01.md", "02.md"));
    expect(h.book.phase).toBe("clean");
    expect(h.book.isDirty).toBe(false);

    h.book.applyEdit("/book/02.md", "edited\n");
    h.book.setActive("/book/01.md"); // caret sits in the CLEAN chapter
    expect(h.book.active).toBe(h.book.bufferFor("/book/01.md"));
    expect(h.book.phase).toBe("dirty");
    expect(h.book.isDirty).toBe(true);
    expect(h.book.hasPendingSave).toBe(true);
  });

  test("onDirty fires once on the aggregate edge, not per file", async () => {
    const h = make({ "/book/01.md": "a\n", "/book/02.md": "b\n" }, { saveDelayMs: 0 });
    await h.book.open(refs("01.md", "02.md"));
    h.events.length = 0;
    h.book.applyEdit("/book/01.md", "a1\n");
    h.book.applyEdit("/book/02.md", "b1\n");
    expect(h.events.filter((e) => e === "dirty:true")).toEqual(["dirty:true"]);
    await h.book.flushAll();
    expect(h.events.filter((e) => e === "dirty:false")).toEqual(["dirty:false"]);
  });

  test("setActive only accepts a file the book actually holds", async () => {
    const h = make({ "/book/01.md": "a\n" });
    await h.book.open(refs("01.md"));
    expect(h.book.setActive("/book/nope.md")).toBe(false);
    expect(h.book.activePath).toBe("/book/01.md");
  });
});

// ── external edits ───────────────────────────────────────────────────────────

describe("external changes", () => {
  test("auto-reloads a clean chapter and reports which file was replaced", async () => {
    const h = make({ "/book/01.md": "a\n", "/book/02.md": "b\n" });
    await h.book.open(refs("01.md", "02.md"));
    h.platform.externalWrite("/book/02.md", "b from elsewhere\n");
    await h.book.reconcileAll();
    expect(h.book.contentFor("/book/02.md")).toBe("b from elsewhere\n");
    expect(h.events).toContain("replaced:/book/02.md");
    expect(h.book.conflict).toBeNull();
  });

  test("surfaces a conflict for the file it belongs to, and resolves only that one", async () => {
    const h = make({ "/book/01.md": "a\n", "/book/02.md": "b\n" });
    await h.book.open(refs("01.md", "02.md"));
    h.book.applyEdit("/book/02.md", "my edit\n");
    h.platform.externalWrite("/book/02.md", "their edit\n");
    // The save's own live disk compare is what catches this: a DIRTY buffer
    // skips watcher-driven reconciliation (any change while a save is
    // outstanding is definitionally its own echo).
    await h.book.flushAll().catch(() => {});

    expect(h.events).toContain("conflict:/book/02.md");
    expect(h.book.conflict?.path).toBe("/book/02.md");
    expect(h.book.conflict?.change.diskContent).toBe("their edit\n");
    // The other chapter is untouched — no cross-contamination.
    expect(h.platform.getContent("/book/01.md")).toBe("a\n");

    h.book.acceptExternal();
    expect(h.book.contentFor("/book/02.md")).toBe("their edit\n");
    expect(h.book.contentFor("/book/01.md")).toBe("a\n");
    expect(h.book.conflict).toBeNull();
  });

  test("a conflict in one chapter does not block another chapter's save", async () => {
    const h = make({ "/book/01.md": "a\n", "/book/02.md": "b\n" });
    await h.book.open(refs("01.md", "02.md"));
    h.book.applyEdit("/book/01.md", "clean edit\n");
    h.book.applyEdit("/book/02.md", "my edit\n");
    h.platform.externalWrite("/book/02.md", "their edit\n");
    await h.book.flushAll().catch(() => {});
    // 01 wrote through even though 02 raised a conflict — flushAll fans out
    // over every file rather than stopping at the first failure.
    expect(h.platform.getContent("/book/01.md")).toBe("clean edit\n");
    expect(h.book.conflict?.path).toBe("/book/02.md");
  });

  test("keepMine adopts the disk baseline so the author's version still saves", async () => {
    const h = make({ "/book/01.md": "a\n" });
    await h.book.open(refs("01.md"));
    h.book.applyEdit("/book/01.md", "mine\n");
    h.platform.externalWrite("/book/01.md", "theirs\n");
    await h.book.flushAll().catch(() => {});
    expect(h.book.conflict).not.toBeNull();
    h.book.keepMine();
    await h.book.flushAll();
    expect(h.platform.getContent("/book/01.md")).toBe("mine\n");
  });
});

// ── standalone files ─────────────────────────────────────────────────────────

describe("standalone files", () => {
  test("a stylesheet opens beside the book without joining the document", async () => {
    const h = make({ "/book/01.md": "a\n", "/book/style.css": "p { color: red }\n" });
    await h.book.open(refs("01.md"));
    const content = await h.book.openStandalone("/book/style.css");
    expect(content).toBe("p { color: red }\n");
    expect(h.book.isSection("/book/style.css")).toBe(false);
    expect(h.book.activePath).toBe("/book/style.css");
    expect(h.book.sections.map((s) => s.path)).toEqual(["/book/01.md"]);
  });

  test("a chapter's unsaved edits survive a trip out to a stylesheet and back", async () => {
    const h = make({ "/book/01.md": "a\n", "/book/style.css": "css\n" });
    await h.book.open(refs("01.md"));
    h.book.applyEdit("/book/01.md", "unsaved\n");
    await h.book.openStandalone("/book/style.css");
    h.book.setActive("/book/01.md");
    expect(h.book.contentFor("/book/01.md")).toBe("unsaved\n");
    expect(h.book.bufferFor("/book/01.md")!.isDirty).toBe(true);
  });

  test("flushAll writes standalone files too", async () => {
    const h = make({ "/book/01.md": "a\n", "/book/style.css": "css\n" }, { saveDelayMs: 0 });
    await h.book.open(refs("01.md"));
    await h.book.openStandalone("/book/style.css");
    h.book.applyEdit("/book/style.css", "edited css\n");
    await h.book.flushAll();
    expect(h.platform.getContent("/book/style.css")).toBe("edited css\n");
  });
});

// ── teardown ─────────────────────────────────────────────────────────────────

describe("forget / reset", () => {
  test("forget drops one file and moves the active pointer off it", async () => {
    const h = make({ "/book/01.md": "a\n", "/book/02.md": "b\n" });
    await h.book.open(refs("01.md", "02.md"));
    h.book.setActive("/book/02.md");
    h.book.forget("/book/02.md");
    expect(h.book.bufferFor("/book/02.md")).toBeNull();
    expect(h.book.sections.map((s) => s.path)).toEqual(["/book/01.md"]);
    expect(h.book.activePath).toBe("/book/01.md");
  });

  test("a forgotten file's pending edit can never be written afterwards", async () => {
    // The "must not silently point at a missing path" case: a stray save would
    // recreate the deleted file.
    const h = make({ "/book/01.md": "a\n" }, { saveDelayMs: 0 });
    await h.book.open(refs("01.md"));
    h.book.applyEdit("/book/01.md", "edited\n");
    h.book.forget("/book/01.md");
    await h.book.flushAll();
    expect(h.platform.getContent("/book/01.md")).toBe("a\n");
  });

  test("reset drops everything (project close/switch)", async () => {
    const h = make({ "/book/01.md": "a\n", "/book/02.md": "b\n" });
    await h.book.open(refs("01.md", "02.md"));
    h.book.reset();
    expect(h.book.sections).toEqual([]);
    expect(h.book.standalonePaths).toEqual([]);
    expect(h.book.activePath).toBeNull();
    expect(h.book.active).toBeNull();
    expect(h.book.phase).toBe("clean");
    expect(h.book.matchesSections(refs("01.md", "02.md"))).toBe(false);
  });

  test("a reset discards an in-flight open rather than resurrecting the old project", async () => {
    const h = make({ "/book/01.md": "a\n" });
    const opening = h.book.open(refs("01.md"));
    h.book.reset();
    expect(await opening).toEqual([]);
    expect(h.book.sections).toEqual([]);
  });
});
