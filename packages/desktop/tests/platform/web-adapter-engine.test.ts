/**
 * Unit tests for `readProjectEngine` (WP-C item 2): a real YAML parse of
 * `manifest.yaml`'s top-level `engine:` scalar, replacing the old regex that
 * silently defaulted to `paged` on any shape it didn't match (quoted,
 * commented, nested). The default (missing/unreadable/malformed manifest, or
 * an unrecognised value) is now `native` — see `manifest.ts`'s
 * `c.engine ?? m.engine ?? "native"`.
 *
 * Uses the same hand-built mock FSA tree as web-fs.test.ts — no real browser
 * needed.
 */
import { test, expect } from "bun:test";
import { readProjectEngine } from "../../src/lib/platform/web-adapter";

// ── A minimal in-memory mock of the File System Access API (root-only) ──────

class MockFile {
  readonly kind = "file" as const;
  constructor(
    public name: string,
    public contents = "",
  ) {}
  async getFile() {
    const self = this;
    return {
      name: self.name,
      lastModified: 1000,
      size: new TextEncoder().encode(self.contents).length,
      text: () => Promise.resolve(self.contents),
    };
  }
}

class MockDir {
  readonly kind = "directory" as const;
  children = new Map<string, MockFile | MockDir>();
  constructor(public name: string) {}
  addFile(name: string, contents = ""): MockFile {
    const f = new MockFile(name, contents);
    this.children.set(name, f);
    return f;
  }
  async getDirectoryHandle(name: string) {
    const child = this.children.get(name);
    if (!child || child.kind !== "directory") {
      throw new DOMException("NotFoundError", "NotFoundError");
    }
    return child;
  }
  async getFileHandle(name: string) {
    const child = this.children.get(name);
    if (!child || child.kind !== "file") {
      throw new DOMException("NotFoundError", "NotFoundError");
    }
    return child;
  }
}

function rootWithManifest(contents: string): FileSystemDirectoryHandle {
  const root = new MockDir("book");
  root.addFile("manifest.yaml", contents);
  return root as unknown as FileSystemDirectoryHandle;
}

test("plain top-level engine: native", async () => {
  await expect(
    readProjectEngine(rootWithManifest("title: Book\nengine: native\n")),
  ).resolves.toBe("native");
});

test("plain top-level engine: paged", async () => {
  await expect(
    readProjectEngine(rootWithManifest("title: Book\nengine: paged\n")),
  ).resolves.toBe("paged");
});

test("quoted engine value is honoured by a real parse", async () => {
  await expect(
    readProjectEngine(rootWithManifest('title: Book\nengine: "native"\n')),
  ).resolves.toBe("native");
  await expect(
    readProjectEngine(rootWithManifest("title: Book\nengine: 'native'\n")),
  ).resolves.toBe("native");
});

test("commented-out engine: line does NOT match (defaults native)", async () => {
  await expect(
    readProjectEngine(rootWithManifest("title: Book\n# engine: paged\n")),
  ).resolves.toBe("native");
});

test("engine nested under another key does NOT match top level (defaults native)", async () => {
  await expect(
    readProjectEngine(
      rootWithManifest("title: Book\nbuild:\n  engine: paged\n"),
    ),
  ).resolves.toBe("native");
});

test("missing engine: key defaults to native", async () => {
  await expect(readProjectEngine(rootWithManifest("title: Book\n"))).resolves.toBe(
    "native",
  );
});

test("unrecognised engine value defaults to native", async () => {
  await expect(
    readProjectEngine(rootWithManifest("title: Book\nengine: bogus\n")),
  ).resolves.toBe("native");
});

test("missing manifest.yaml defaults to native", async () => {
  const root = new MockDir("book") as unknown as FileSystemDirectoryHandle;
  await expect(readProjectEngine(root)).resolves.toBe("native");
});

test("malformed YAML defaults to native instead of throwing", async () => {
  await expect(
    readProjectEngine(rootWithManifest("title: [unterminated\nengine: paged\n")),
  ).resolves.toBe("native");
});

test("a manifest that parses to a scalar/array, not a mapping, defaults to native", async () => {
  await expect(readProjectEngine(rootWithManifest("just a string\n"))).resolves.toBe(
    "native",
  );
  await expect(readProjectEngine(rootWithManifest("- one\n- two\n"))).resolves.toBe(
    "native",
  );
});
