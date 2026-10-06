import { expect, test } from "bun:test";
import { EditorBuffer } from "../../src/lib/editor/buffer-state.svelte";
import { EditorFileSession } from "../../src/lib/editor/editor-file-session.svelte";
import type { FileStat, FileWriteResult, Platform } from "../../src/lib/platform/contract";

(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

class TestPlatform implements Partial<Platform> {
  readonly platform = "electron" as const;
  files = new Map<string, string>();
  failWrites = false;
  private clock = 1;
  private blocked = new Map<string, { promise: Promise<string>; resolve: (value: string) => void }>();

  constructor(files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) this.files.set(path, content);
  }

  blockRead(path: string): void {
    let resolve!: (value: string) => void;
    const promise = new Promise<string>((done) => (resolve = done));
    this.blocked.set(path, { promise, resolve });
  }

  releaseRead(path: string): void {
    const blocked = this.blocked.get(path);
    if (!blocked) throw new Error(`read was not blocked: ${path}`);
    this.blocked.delete(path);
    blocked.resolve(this.files.get(path) ?? "");
  }

  async readFile(path: string): Promise<string> {
    return this.blocked.get(path)?.promise ?? this.files.get(path) ?? "";
  }

  async statFile(path: string): Promise<FileStat> {
    const content = this.files.get(path);
    return content == null
      ? { exists: false, size: 0, mtimeMs: 0 }
      : { exists: true, size: content.length, mtimeMs: this.clock };
  }

  async writeFile(path: string, content: string): Promise<FileWriteResult> {
    if (this.failWrites) throw new Error("disk full");
    this.files.set(path, content);
    return { mtimeMs: ++this.clock };
  }
}

function harness(files: Record<string, string>, saveDelayMs = 60_000) {
  const platform = new TestPlatform(files);
  const activated: string[] = [];
  const create = () => new EditorBuffer({
    platform: platform as Platform,
    saveDelayMs,
    recoveryEnabled: false,
  });
  const session = new EditorFileSession({
    createBuffer: create,
    flush: async (buffer) => {
      try {
        await buffer.flush();
        return true;
      } catch {
        return false;
      }
    },
    onActivate: (buffer) => activated.push(buffer.filePath ?? ""),
  });
  return { platform, session, activated };
}

test("latest selection wins when an older file read resolves last", async () => {
  const h = harness({ "/a.md": "A", "/b.md": "B" });
  await h.session.select("/a.md");
  h.platform.blockRead("/b.md");
  const selectB = h.session.select("/b.md");
  expect(await h.session.select("/a.md")).toBe(true);
  h.platform.releaseRead("/b.md");
  expect(await selectB).toBe(false);
  expect(h.session.active?.filePath).toBe("/a.md");
  expect(h.session.active?.content).toBe("A");
  h.session.reset();
});

test("a delayed automatic default cannot overtake a newer explicit selection", async () => {
  const h = harness({ "/default.md": "default", "/chosen.md": "chosen" });
  let resolveDefault!: (path: string) => void;
  const defaultPath = new Promise<string>((resolve) => (resolveDefault = resolve));
  const automatic = h.session.ensureDefault(() => defaultPath);
  await h.session.select("/chosen.md");
  resolveDefault("/default.md");
  expect(await automatic).toBe(false);
  expect(h.session.active?.filePath).toBe("/chosen.md");
  h.session.reset();
});

test("a failed outgoing flush prevents the atomic handoff", async () => {
  const h = harness({ "/a.md": "A", "/b.md": "B" });
  await h.session.select("/a.md");
  h.session.active!.edit("A typed");
  h.platform.failWrites = true;
  expect(await h.session.select("/b.md")).toBe(false);
  expect(h.session.active?.filePath).toBe("/a.md");
  expect(h.session.active?.content).toBe("A typed");
  h.session.reset();
});

test("concurrent recovery restores serialize and flush each outgoing file", async () => {
  const h = harness({ "/a.md": "A", "/b.md": "B", "/c.md": "C" });
  await h.session.select("/a.md");
  h.session.active!.edit("A typed");
  const restoreB = h.session.restore("/b.md", "B recovered");
  const restoreC = h.session.restore("/c.md", "C recovered");
  expect(await restoreB).toBe(true);
  expect(await restoreC).toBe(true);
  expect(h.platform.files.get("/a.md")).toBe("A typed");
  expect(h.platform.files.get("/b.md")).toBe("B recovered");
  expect(h.session.active?.filePath).toBe("/c.md");
  expect(h.session.active?.content).toBe("C recovered");
  h.session.reset();
});

test("reset cancels a recovery restore before its queued work starts", async () => {
  const h = harness({ "/a.md": "A" });
  const restoring = h.session.restore("/a.md", "A recovered");
  h.session.reset();
  expect(await restoring).toBe(false);
  expect(h.session.active).toBeNull();
  expect(h.activated).toEqual([]);
});

test("reset cancels queued restores and their orphan autosaves", async () => {
  const h = harness({ "/a.md": "A", "/b.md": "B", "/c.md": "C" }, 5);
  h.platform.blockRead("/b.md");
  const restoreB = h.session.restore("/b.md", "B recovered");
  await Promise.resolve();
  await Promise.resolve();
  const restoreC = h.session.restore("/c.md", "C recovered");
  h.session.reset();
  h.platform.releaseRead("/b.md");
  expect(await restoreB).toBe(false);
  expect(await restoreC).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(h.session.active).toBeNull();
  expect(h.platform.files.get("/b.md")).toBe("B");
  expect(h.platform.files.get("/c.md")).toBe("C");
});
