/**
 * Unit tests for the PWA File System Access (FSA) primitives (#33, Phase 1).
 *
 * These run under `bun test` with a hand-built MOCK FSA tree — no real browser
 * needed. The mock implements the narrow slice of the FSA contract the adapter
 * uses: `getDirectoryHandle`/`getFileHandle` for walking, async-iterable
 * `entries()` for listing, `getFile()` for read/stat, and
 * `createWritable()`/`write()`/`close()` for writes.
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import {
  registerHandle,
  resolveHandle,
  resetRegistry,
  readFileFromRoot,
  writeFileToRoot,
  listDirFromRoot,
  statFileFromRoot,
  listProjectFilesFromRoot,
  hasFsa,
} from "../../src/lib/platform/web-fs";

// ── A minimal in-memory mock of the File System Access API ───────────────────

type MockNode = MockFile | MockDir;

class MockFile {
  readonly kind = "file" as const;
  contents: string;
  lastModified: number;
  constructor(
    public name: string,
    contents = "",
    lastModified = 1000,
  ) {
    this.contents = contents;
    this.lastModified = lastModified;
  }
  async getFile() {
    const self = this;
    return {
      name: self.name,
      lastModified: self.lastModified,
      size: new TextEncoder().encode(self.contents).length,
      text: () => Promise.resolve(self.contents),
    };
  }
  async createWritable() {
    const self = this;
    return {
      async write(data: string) {
        self.contents = data;
      },
      async close() {
        // bump mtime on close, like a real FS
        self.lastModified = 2000;
      },
    };
  }
}

class MockDir {
  readonly kind = "directory" as const;
  children = new Map<string, MockNode>();
  constructor(public name: string) {}

  addFile(name: string, contents = "", lastModified = 1000): MockFile {
    const f = new MockFile(name, contents, lastModified);
    this.children.set(name, f);
    return f;
  }
  addDir(name: string): MockDir {
    const d = new MockDir(name);
    this.children.set(name, d);
    return d;
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    let child = this.children.get(name);
    if (!child && options?.create) child = this.addDir(name);
    if (!child) throw new DOMException("NotFoundError", "NotFoundError");
    if (child.kind !== "directory") throw new DOMException("TypeMismatch", "TypeMismatchError");
    return child;
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    let child = this.children.get(name);
    if (!child && options?.create) child = this.addFile(name);
    if (!child) throw new DOMException("NotFoundError", "NotFoundError");
    if (child.kind !== "file") throw new DOMException("TypeMismatch", "TypeMismatchError");
    return child;
  }
  async *entries(): AsyncGenerator<[string, MockNode]> {
    for (const [k, v] of this.children) yield [k, v];
  }
}

function makeBookTree(): MockDir {
  const root = new MockDir("my-book");
  root.addFile("01-intro.md", "# Intro\n", 1111);
  root.addFile("02-body.md", "# Body\n");
  root.addFile("theme.css", "body { color: red }");
  root.addFile("manifest.yaml", "title: My Book");
  root.addFile("README.txt", "ignore me");
  const assets = root.addDir("assets");
  assets.addFile("cover.png", "PNGDATA");
  return root;
}

beforeEach(() => resetRegistry());
afterEach(() => resetRegistry());

test("registerHandle mints an opaque key and resolveHandle returns the same handle", () => {
  const root = makeBookTree();
  const key = registerHandle(root as unknown as FileSystemDirectoryHandle);
  expect(typeof key).toBe("string");
  expect(key.length).toBeGreaterThan(0);
  expect(resolveHandle(key)).toBe(root as unknown as FileSystemHandle);
  // Keys are unique per registration.
  const key2 = registerHandle(root as unknown as FileSystemDirectoryHandle);
  expect(key2).not.toBe(key);
});

test("resolveHandle throws for an unknown key", () => {
  expect(() => resolveHandle("web:does-not-exist")).toThrow();
});

test("readFileFromRoot walks a project-root-relative POSIX path and returns text", async () => {
  const root = makeBookTree();
  await expect(
    readFileFromRoot(root as unknown as FileSystemDirectoryHandle, "01-intro.md"),
  ).resolves.toBe("# Intro\n");
  await expect(
    readFileFromRoot(root as unknown as FileSystemDirectoryHandle, "assets/cover.png"),
  ).resolves.toBe("PNGDATA");
  // Leading "./" and leading "/" are normalised away.
  await expect(
    readFileFromRoot(root as unknown as FileSystemDirectoryHandle, "./theme.css"),
  ).resolves.toBe("body { color: red }");
});

test("writeFileToRoot writes content and returns the re-stat mtime", async () => {
  const root = makeBookTree();
  const res = await writeFileToRoot(
    root as unknown as FileSystemDirectoryHandle,
    "01-intro.md",
    "# Changed\n",
  );
  expect(res.mtimeMs).toBe(2000); // bumped on close
  expect(res.size).toBe(new TextEncoder().encode("# Changed\n").length);
  await expect(
    readFileFromRoot(root as unknown as FileSystemDirectoryHandle, "01-intro.md"),
  ).resolves.toBe("# Changed\n");
});

test("writeFileToRoot creates a missing file (and parent dirs)", async () => {
  const root = makeBookTree();
  await writeFileToRoot(
    root as unknown as FileSystemDirectoryHandle,
    "sub/new.md",
    "hello",
  );
  await expect(
    readFileFromRoot(root as unknown as FileSystemDirectoryHandle, "sub/new.md"),
  ).resolves.toBe("hello");
});

test("listDirFromRoot stamps each entry path as <rootKey>/<relpath> (round-trips into readFile)", async () => {
  const root = makeBookTree();
  const KEY = "web:test-root";
  const entries = await listDirFromRoot(root as unknown as FileSystemDirectoryHandle, "", KEY);
  const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
  expect(byName["01-intro.md"]).toEqual({
    name: "01-intro.md",
    path: "web:test-root/01-intro.md",
    isDir: false,
  });
  expect(byName["assets"]).toEqual({
    name: "assets",
    path: "web:test-root/assets",
    isDir: true,
  });

  const sub = await listDirFromRoot(root as unknown as FileSystemDirectoryHandle, "assets", KEY);
  expect(sub).toEqual([
    { name: "cover.png", path: "web:test-root/assets/cover.png", isDir: false },
  ]);
});

test("statFileFromRoot returns size/mtimeMs/exists", async () => {
  const root = makeBookTree();
  const stat = await statFileFromRoot(
    root as unknown as FileSystemDirectoryHandle,
    "01-intro.md",
  );
  expect(stat).toEqual({
    size: new TextEncoder().encode("# Intro\n").length,
    mtimeMs: 1111,
    exists: true,
  });
});

test("statFileFromRoot returns exists:false for a missing file", async () => {
  const root = makeBookTree();
  const stat = await statFileFromRoot(
    root as unknown as FileSystemDirectoryHandle,
    "nope.md",
  );
  expect(stat).toEqual({ size: 0, mtimeMs: 0, exists: false });
});

test("listProjectFilesFromRoot filters top-level .md/.css and sorts them", async () => {
  const root = makeBookTree();
  const res = await listProjectFilesFromRoot(root as unknown as FileSystemDirectoryHandle);
  expect(res.md).toEqual(["01-intro.md", "02-body.md"]);
  expect(res.css).toEqual(["theme.css"]);
});

test("hasFsa reflects window.showDirectoryPicker presence", () => {
  expect(hasFsa()).toBe(false);
  // @ts-expect-error test global
  globalThis.window = { showDirectoryPicker: () => {} };
  try {
    expect(hasFsa()).toBe(true);
  } finally {
    // @ts-expect-error test global
    globalThis.window = undefined;
  }
});
