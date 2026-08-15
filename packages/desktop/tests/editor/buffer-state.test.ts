import { expect, test } from "bun:test";
import { EditorBuffer } from "../../src/lib/editor/buffer-state.svelte";
import type { FileStat, FileWriteResult, Platform } from "../../src/lib/platform/contract";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests. The production compiler replaces $state; the class only
// needs plain values for this behavior test.
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

class MemoryPlatform implements Partial<Platform> {
  readonly platform = "electron" as const;
  private files = new Map<string, { content: string; mtimeMs: number }>();
  private clock = 1000;

  constructor(initial: Record<string, string>) {
    for (const [path, content] of Object.entries(initial)) {
      this.files.set(path, { content, mtimeMs: this.tick() });
    }
  }

  getContent(path: string): string {
    const file = this.files.get(path);
    if (!file) throw new Error(`missing test file ${path}`);
    return file.content;
  }

  externalWrite(path: string, content: string): void {
    this.files.set(path, { content, mtimeMs: this.tick() });
  }

  externalDelete(path: string): void {
    this.files.delete(path);
  }

  async readFile(path: string): Promise<string> {
    return this.getContent(path);
  }

  async writeFile(path: string, content: string): Promise<FileWriteResult> {
    const mtimeMs = this.tick();
    this.files.set(path, { content, mtimeMs });
    return { mtimeMs };
  }

  async statFile(path: string): Promise<FileStat> {
    const file = this.files.get(path);
    if (!file) return { exists: false, size: 0, mtimeMs: 0 };
    return { exists: true, size: new TextEncoder().encode(file.content).length, mtimeMs: file.mtimeMs };
  }

  private tick(): number {
    this.clock += 1;
    return this.clock;
  }
}

function makeBuffer(platform: MemoryPlatform, events: string[] = []): EditorBuffer {
  return new EditorBuffer({
    platform: platform as Platform,
    saveDelayMs: 10_000,
    recoveryEnabled: false,
    onExternalConflict: () => events.push("conflict"),
    onAutoReloaded: (filePath) => events.push(`auto:${filePath}`),
    onError: (message) => events.push(`error:${message}`),
  });
}

test("changing the autosave delay reschedules a pending edit", async () => {
  const platform = new MemoryPlatform({ "/book/chapter.md": "original" });
  const buffer = makeBuffer(platform);

  await buffer.load("/book/chapter.md");
  buffer.edit("edited");
  expect(platform.getContent("/book/chapter.md")).toBe("original");
  expect(buffer.phase).toBe("dirty");

  buffer.setSaveDelayMs(0);
  for (let attempt = 0; attempt < 20 && buffer.phase !== "clean"; attempt++) {
    await Bun.sleep(5);
  }

  expect(platform.getContent("/book/chapter.md")).toBe("edited");
  expect(buffer.phase).toBe("clean");
});

test("flush refuses to overwrite disk content that changed after the buffer loaded", async () => {
  const platform = new MemoryPlatform({ "/book/chapter.md": "old local text" });
  const events: string[] = [];
  const buffer = makeBuffer(platform, events);

  await buffer.load("/book/chapter.md");
  platform.externalWrite("/book/chapter.md", "remote text from pull");

  buffer.edit("old local text plus stale edit");
  await expect(buffer.flush()).rejects.toThrow(/changed on disk/);

  expect(platform.getContent("/book/chapter.md")).toBe("remote text from pull");
  expect(buffer.externalChange).toEqual({
    diskContent: "remote text from pull",
    diskMtimeMs: expect.any(Number),
  });
  expect(events).toContain("conflict");
  expect(buffer.phase).toBe("dirty");
});

test("keepMine is the explicit override after a stale-save conflict", async () => {
  const platform = new MemoryPlatform({ "/book/chapter.md": "old local text" });
  const buffer = makeBuffer(platform);

  await buffer.load("/book/chapter.md");
  platform.externalWrite("/book/chapter.md", "remote text from pull");

  buffer.edit("author intentionally keeps local text");
  await expect(buffer.flush()).rejects.toThrow(/changed on disk/);
  expect(platform.getContent("/book/chapter.md")).toBe("remote text from pull");

  buffer.keepMine();
  await buffer.flush();

  expect(platform.getContent("/book/chapter.md")).toBe("author intentionally keeps local text");
  expect(buffer.externalChange).toBeNull();
  expect(buffer.phase).toBe("clean");
});

test("flush adopts an external write when it already matches the buffer content", async () => {
  const platform = new MemoryPlatform({ "/book/chapter.md": "old local text" });
  const events: string[] = [];
  const buffer = makeBuffer(platform, events);

  await buffer.load("/book/chapter.md");
  buffer.edit("same final text");
  platform.externalWrite("/book/chapter.md", "same final text");

  await buffer.flush();

  expect(platform.getContent("/book/chapter.md")).toBe("same final text");
  expect(buffer.externalChange).toBeNull();
  expect(buffer.diskContent).toBe("same final text");
  expect(buffer.phase).toBe("clean");
  expect(events).not.toContain("conflict");
});

test("reconcileExternalChange reloads a clean buffer after a pull updates the file", async () => {
  const platform = new MemoryPlatform({ "/book/chapter.md": "old local text" });
  const events: string[] = [];
  const buffer = makeBuffer(platform, events);

  await buffer.load("/book/chapter.md");
  platform.externalWrite("/book/chapter.md", "remote text from pull");

  await buffer.reconcileExternalChange();

  expect(buffer.content).toBe("remote text from pull");
  expect(buffer.diskContent).toBe("remote text from pull");
  expect(buffer.externalChange).toBeNull();
  expect(events).toEqual(["auto:/book/chapter.md"]);
});

test("reconcileExternalChange on a clean buffer fires onContentReplaced with the new content before onAutoReloaded (H1)", async () => {
  const platform = new MemoryPlatform({ "/book/chapter.md": "old local text" });
  const events: string[] = [];
  const buffer = new EditorBuffer({
    platform: platform as Platform,
    saveDelayMs: 10_000,
    recoveryEnabled: false,
    onExternalConflict: () => events.push("conflict"),
    onAutoReloaded: (filePath) => events.push(`auto:${filePath}`),
    onContentReplaced: (filePath, content) => events.push(`replaced:${filePath}:${content}`),
  });

  await buffer.load("/book/chapter.md");
  platform.externalWrite("/book/chapter.md", "remote text from pull");

  await buffer.reconcileExternalChange();

  expect(events).toEqual([
    "replaced:/book/chapter.md:remote text from pull",
    "auto:/book/chapter.md",
  ]);
});

test("acceptExternal (the reloadExternal conflict-banner path) fires the same onContentReplaced callback (H1)", async () => {
  const platform = new MemoryPlatform({ "/book/chapter.md": "old local text" });
  const events: string[] = [];
  const buffer = new EditorBuffer({
    platform: platform as Platform,
    saveDelayMs: 10_000,
    recoveryEnabled: false,
    onExternalConflict: () => events.push("conflict"),
    onContentReplaced: (filePath, content) => events.push(`replaced:${filePath}:${content}`),
  });

  await buffer.load("/book/chapter.md");
  platform.externalWrite("/book/chapter.md", "remote text from pull");
  buffer.edit("dirty local edit that conflicts");
  await expect(buffer.flush()).rejects.toThrow(/changed on disk/);
  expect(buffer.externalChange).not.toBeNull();

  buffer.acceptExternal();

  expect(events).toContain("replaced:/book/chapter.md:remote text from pull");
});

test("reconcileExternalChange does not silently resurrect a clean file deleted by a pull", async () => {
  const platform = new MemoryPlatform({ "/book/chapter.md": "old local text" });
  const events: string[] = [];
  const buffer = makeBuffer(platform, events);

  await buffer.load("/book/chapter.md");
  platform.externalDelete("/book/chapter.md");

  await buffer.reconcileExternalChange();

  expect(buffer.content).toBe("");
  expect(buffer.diskContent).toBe("");
  expect(buffer.diskMtimeMs).toBe(0);
  expect(buffer.externalChange).toBeNull();
  expect(events).toEqual(["auto:/book/chapter.md"]);
});

test("flush reports a conflict instead of recreating a file deleted by a pull", async () => {
  const platform = new MemoryPlatform({ "/book/chapter.md": "old local text" });
  const events: string[] = [];
  const buffer = makeBuffer(platform, events);

  await buffer.load("/book/chapter.md");
  platform.externalDelete("/book/chapter.md");

  buffer.edit("stale edit after remote deletion");
  await expect(buffer.flush()).rejects.toThrow(/changed on disk/);

  await expect(platform.readFile("/book/chapter.md")).rejects.toThrow(/missing test file/);
  expect(buffer.externalChange).toEqual({
    diskContent: "",
    diskMtimeMs: 0,
    exists: false,
  });
  expect(events).toContain("conflict");
});

test("flush reports a conflict when the file disappears between save stat and read", async () => {
  class DeleteOnReadPlatform extends MemoryPlatform {
    deleteOnNextRead = false;

    async readFile(path: string): Promise<string> {
      if (this.deleteOnNextRead) {
        this.deleteOnNextRead = false;
        this.externalDelete(path);
      }
      return super.readFile(path);
    }
  }

  const platform = new DeleteOnReadPlatform({ "/book/chapter.md": "old local text" });
  const events: string[] = [];
  const buffer = makeBuffer(platform, events);

  await buffer.load("/book/chapter.md");
  buffer.edit("stale edit after remote deletion");
  platform.deleteOnNextRead = true;
  await expect(buffer.flush()).rejects.toThrow(/changed on disk/);

  await expect(platform.readFile("/book/chapter.md")).rejects.toThrow(/missing test file/);
  expect(buffer.externalChange).toEqual({
    diskContent: "",
    diskMtimeMs: 0,
    exists: false,
  });
  expect(events).toContain("conflict");
  expect(events.some((event) => event.startsWith("error:"))).toBe(false);
});

test("an in-flight save for an old file does not mutate a newly loaded file", async () => {
  class SlowWritePlatform extends MemoryPlatform {
    releaseWrite: (() => void) | null = null;

    async writeFile(path: string, content: string): Promise<FileWriteResult> {
      await new Promise<void>((resolve) => {
        this.releaseWrite = resolve;
      });
      return super.writeFile(path, content);
    }
  }

  const platform = new SlowWritePlatform({
    "/book/a.md": "a original",
    "/book/b.md": "b original",
  });
  const buffer = makeBuffer(platform);

  await buffer.load("/book/a.md");
  buffer.edit("a edited");
  const saveA = buffer.flush();

  await buffer.load("/book/b.md");
  expect(buffer.filePath).toBe("/book/b.md");
  expect(buffer.content).toBe("b original");

  platform.releaseWrite?.();
  await saveA;

  expect(platform.getContent("/book/a.md")).toBe("a edited");
  expect(buffer.filePath).toBe("/book/b.md");
  expect(buffer.content).toBe("b original");
  expect(buffer.diskContent).toBe("b original");
  expect(buffer.phase).toBe("clean");
});

test("flush serializes behind an in-flight autosave and persists the latest edit", async () => {
  class SlowFirstWritePlatform extends MemoryPlatform {
    writes: string[] = [];
    firstWriteStarted: Promise<void>;
    private markFirstWriteStarted!: () => void;
    releaseFirstWrite: (() => void) | null = null;

    constructor(initial: Record<string, string>) {
      super(initial);
      this.firstWriteStarted = new Promise((resolve) => {
        this.markFirstWriteStarted = resolve;
      });
    }

    async writeFile(path: string, content: string): Promise<FileWriteResult> {
      this.writes.push(content);
      if (this.writes.length === 1) {
        this.markFirstWriteStarted();
        await new Promise<void>((resolve) => {
          this.releaseFirstWrite = resolve;
        });
      }
      return super.writeFile(path, content);
    }
  }

  const platform = new SlowFirstWritePlatform({ "/book/chapter.md": "original" });
  const buffer = new EditorBuffer({
    platform: platform as Platform,
    saveDelayMs: 0,
    recoveryEnabled: false,
  });

  await buffer.load("/book/chapter.md");
  buffer.edit("first edit");
  await platform.firstWriteStarted;

  buffer.edit("latest edit");
  let flushed = false;
  const flush = buffer.flush().then(() => {
    flushed = true;
  });
  await Bun.sleep(5);
  const flushedBeforeFirstWriteFinished = flushed;
  const writesBeforeFirstWriteFinished = [...platform.writes];

  platform.releaseFirstWrite?.();
  await flush;

  expect(flushedBeforeFirstWriteFinished).toBe(false);
  expect(writesBeforeFirstWriteFinished).toEqual(["first edit"]);
  expect(platform.writes).toEqual(["first edit", "latest edit"]);
  expect(platform.getContent("/book/chapter.md")).toBe("latest edit");
  expect(buffer.phase).toBe("clean");
});

test("an in-flight crash-recovery restore does not mutate a newly loaded file", async () => {
  class SlowReadPlatform extends MemoryPlatform {
    releaseRead: (() => void) | null = null;

    async readFile(path: string): Promise<string> {
      if (path === "/book/a.md") {
        await new Promise<void>((resolve) => {
          this.releaseRead = resolve;
        });
      }
      return super.readFile(path);
    }
  }

  const platform = new SlowReadPlatform({
    "/book/a.md": "a original",
    "/book/b.md": "b original",
  });
  const buffer = makeBuffer(platform);

  const restoreA = buffer.restoreContent("/book/a.md", "a recovered");
  expect(buffer.filePath).toBe("/book/a.md");
  expect(buffer.content).toBe("a recovered");

  await buffer.load("/book/b.md");
  platform.releaseRead?.();
  await restoreA;

  expect(buffer.filePath).toBe("/book/b.md");
  expect(buffer.content).toBe("b original");
  expect(buffer.diskContent).toBe("b original");
  expect(buffer.phase).toBe("clean");
});

test("an in-flight external reconcile for file A cannot overwrite newly loaded file B", async () => {
  class SlowExternalReadPlatform extends MemoryPlatform {
    blockA = false;
    readStarted: (() => void) | null = null;
    releaseRead: (() => void) | null = null;

    async readFile(path: string): Promise<string> {
      if (this.blockA && path === "/book/a.md") {
        this.readStarted?.();
        await new Promise<void>((resolve) => {
          this.releaseRead = resolve;
        });
      }
      return super.readFile(path);
    }
  }

  const platform = new SlowExternalReadPlatform({
    "/book/a.md": "a original",
    "/book/b.md": "b original",
  });
  const replaced: Array<[string, string]> = [];
  const buffer = new EditorBuffer({
    platform: platform as Platform,
    recoveryEnabled: false,
    onContentReplaced: (path, content) => replaced.push([path, content]),
  });

  await buffer.load("/book/a.md");
  platform.externalWrite("/book/a.md", "a external");
  platform.blockA = true;
  const readStarted = new Promise<void>((resolve) => (platform.readStarted = resolve));
  const reconcileA = buffer.reconcileExternalChange();
  await readStarted;

  await buffer.load("/book/b.md");
  platform.releaseRead?.();
  await reconcileA;

  expect(buffer.filePath).toBe("/book/b.md");
  expect(buffer.content).toBe("b original");
  expect(buffer.diskContent).toBe("b original");
  expect(replaced).toEqual([]);
});

test("a failed disk write rejects flush and remains dirty for the close gate", async () => {
  class FailingWritePlatform extends MemoryPlatform {
    async writeFile(): Promise<FileWriteResult> {
      throw new Error("disk full");
    }
  }

  const platform = new FailingWritePlatform({ "/book/chapter.md": "original" });
  const dirty: boolean[] = [];
  const errors: string[] = [];
  const buffer = new EditorBuffer({
    platform: platform as Platform,
    saveDelayMs: 10_000,
    recoveryEnabled: false,
    onDirty: (pending) => dirty.push(pending),
    onError: (message) => errors.push(message),
  });

  await buffer.load("/book/chapter.md");
  buffer.edit("unsaved edit");
  await expect(buffer.flush()).rejects.toThrow("disk full");

  expect(buffer.phase).toBe("error");
  expect(buffer.isDirty).toBe(true);
  expect(buffer.hasPendingSave).toBe(true);
  expect(dirty).toEqual([true]);
  expect(errors).toEqual(["Save failed: disk full"]);

  buffer.reset();
  expect(dirty).toEqual([true, false]);
});
