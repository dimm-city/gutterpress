import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { EditorBuffer } from "../../src/lib/editor/buffer-state.svelte";
import { isPathAtOrUnder } from "../../src/lib/platform/paths";
import type { FileStat, FileWriteResult, Platform } from "../../src/lib/platform/contract";

// UX review M9 (WP FT): "renaming/deleting the OPEN file must behave" — the
// folder watcher can't cover this (it's a single NON-RECURSIVE fs.watch on
// the project ROOT — electron/folder-watch/watcher.ts — so it never fires
// for a rename/delete of a file in a nested folder), so +page.svelte's
// FileTree callbacks (`onTreeBeforeRename`/`onTreeFileRenamed`/
// `onTreeFileDeleted`) are the only place this gets handled. These tests
// exercise the REAL EditorBuffer (not a fake) through the exact sequence
// those three handlers perform, since +page.svelte itself (a large .svelte
// SFC) isn't unit-testable in isolation.

(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

class MemoryPlatform implements Partial<Platform> {
  readonly platform = "electron" as const;
  private files = new Map<string, { content: string; mtimeMs: number }>();
  private clock = 1000;

  constructor(initial: Record<string, string>) {
    for (const [p, content] of Object.entries(initial)) {
      this.files.set(p, { content, mtimeMs: this.tick() });
    }
  }

  has(p: string): boolean {
    return this.files.has(p);
  }

  getContent(p: string): string {
    const file = this.files.get(p);
    if (!file) throw new Error(`missing test file ${p}`);
    return file.content;
  }

  /** Simulate the fs/rename route: move content from oldPath to newPath. */
  externalRename(oldPath: string, newPath: string): void {
    const file = this.files.get(oldPath);
    if (!file) throw new Error(`missing test file ${oldPath}`);
    this.files.delete(oldPath);
    this.files.set(newPath, { content: file.content, mtimeMs: this.tick() });
  }

  externalDelete(filePath: string): void {
    this.files.delete(filePath);
  }

  async readFile(p: string): Promise<string> {
    return this.getContent(p);
  }

  async writeFile(p: string, content: string): Promise<FileWriteResult> {
    const mtimeMs = this.tick();
    this.files.set(p, { content, mtimeMs });
    return { mtimeMs };
  }

  async statFile(p: string): Promise<FileStat> {
    const file = this.files.get(p);
    if (!file) return { exists: false, size: 0, mtimeMs: 0 };
    return { exists: true, size: new TextEncoder().encode(file.content).length, mtimeMs: file.mtimeMs };
  }

  private tick(): number {
    this.clock += 1;
    return this.clock;
  }
}

function makeBuffer(platform: MemoryPlatform): EditorBuffer {
  return new EditorBuffer({
    platform: platform as Platform,
    saveDelayMs: 10_000,
    recoveryEnabled: false,
  });
}

/** Mirrors +page.svelte's `selectEditorFile` closely enough for this test:
 *  flush a pending save on the CURRENT file first, then load the new path. */
async function selectEditorFile(buffer: EditorBuffer, path: string): Promise<boolean> {
  if (buffer.filePath === path) return true;
  const wasPending = buffer.hasPendingSave;
  if (buffer.filePath && wasPending) {
    try {
      await buffer.flush();
    } catch {
      return false;
    }
  }
  await buffer.load(path);
  return true;
}

test("renaming the open file: flush-before-rename, then reload at the new path — no ghost file, no lost edits", async () => {
  const platform = new MemoryPlatform({ "/book/chapter-01.md": "saved text" });
  const buffer = makeBuffer(platform);
  await buffer.load("/book/chapter-01.md");
  buffer.edit("saved text + unsaved edit");
  expect(buffer.hasPendingSave).toBe(true);

  // onTreeBeforeRename: flush BEFORE the rename call.
  if (buffer.filePath === "/book/chapter-01.md") {
    await buffer.flush().catch(() => {});
  }
  expect(buffer.phase).toBe("clean");
  expect(platform.getContent("/book/chapter-01.md")).toBe("saved text + unsaved edit");

  // The rename itself (what api.fs.renamePath does on disk).
  platform.externalRename("/book/chapter-01.md", "/book/intro.md");

  // onTreeFileRenamed: reload at the new path.
  await selectEditorFile(buffer, "/book/intro.md");

  expect(buffer.filePath).toBe("/book/intro.md");
  expect(buffer.content).toBe("saved text + unsaved edit");
  expect(buffer.phase).toBe("clean");
  expect(platform.has("/book/chapter-01.md")).toBe(false);
});

test("renaming a FOLDER containing the dirty open file: flush-before-rename must fire on containment (isPathAtOrUnder), not exact path match, so the edit is preserved", async () => {
  const platform = new MemoryPlatform({ "/book/ch1/page.md": "saved text" });
  const buffer = makeBuffer(platform);
  await buffer.load("/book/ch1/page.md");
  buffer.edit("saved text + unsaved edit");
  expect(buffer.hasPendingSave).toBe(true);

  const oldFolder = "/book/ch1";
  const newFolder = "/book/intro";

  // onTreeBeforeRename: the item being renamed is the FOLDER, not the exact
  // open file path — the open file is nested under it, so the flush must
  // still fire (isPathAtOrUnder), matching the fixed +page.svelte handler.
  if (buffer.filePath && isPathAtOrUnder(buffer.filePath, oldFolder)) {
    await buffer.flush().catch(() => {});
  }
  expect(buffer.phase).toBe("clean");
  expect(platform.getContent("/book/ch1/page.md")).toBe("saved text + unsaved edit");

  // The folder rename itself moves every file nested under it.
  platform.externalRename("/book/ch1/page.md", "/book/intro/page.md");

  // onTreeFileRenamed: reload at the new nested path.
  await selectEditorFile(buffer, "/book/intro/page.md");

  expect(buffer.filePath).toBe("/book/intro/page.md");
  expect(buffer.content).toBe("saved text + unsaved edit");
  expect(buffer.phase).toBe("clean");
  expect(platform.has("/book/ch1/page.md")).toBe(false);
});

test("renaming the open file in the WRONG order (flush after rename) strands the unsaved edit behind a spurious conflict banner — this is exactly what flush-before-rename avoids", async () => {
  const platform = new MemoryPlatform({ "/book/chapter-01.md": "saved text" });
  const buffer = makeBuffer(platform);
  await buffer.load("/book/chapter-01.md");
  buffer.edit("saved text + unsaved edit");

  // Rename BEFORE flushing (the wrong order) — the buffer still thinks its
  // file is the old (now-renamed-away) path and has unsaved edits.
  platform.externalRename("/book/chapter-01.md", "/book/intro.md");

  // A flush now stats the buffer's still-old `filePath`, finds it MISSING,
  // and (correctly, per EditorBuffer's own externalChangeBeforeSave check)
  // refuses to write — but that means it raises an "external change" —
  // i.e. the author's OWN rename now reads back as a confusing conflict
  // banner ("this file was deleted") instead of just... being renamed. The
  // edit is neither saved under the old name nor carried over to the new
  // one; it sits stranded in the dirty buffer.
  await buffer.flush().catch(() => {});

  expect(platform.has("/book/chapter-01.md")).toBe(false); // no ghost file — the buffer's own safety net holds
  expect(buffer.externalChange).toEqual({ diskContent: "", diskMtimeMs: 0, exists: false });
  expect(buffer.phase).toBe("dirty"); // stuck dirty against a path that no longer exists
  expect(platform.getContent("/book/intro.md")).toBe("saved text"); // stale, pre-edit content — never picked up the edit
});

test("deleting the open file: the buffer is reset, not left pointing at a missing path", async () => {
  const platform = new MemoryPlatform({ "/book/chapter-01.md": "saved text" });
  const buffer = makeBuffer(platform);
  await buffer.load("/book/chapter-01.md");
  expect(buffer.filePath).toBe("/book/chapter-01.md");

  // The delete route removes the file on disk; onTreeFileDeleted resets.
  buffer.reset();

  expect(buffer.filePath).toBeNull();
  expect(buffer.content).toBe("");
  expect(buffer.phase).toBe("clean");
  expect(buffer.hasPendingSave).toBe(false);
});

test("deleting the dirty open file flushes before delete, then resets the buffer", async () => {
  const platform = new MemoryPlatform({ "/book/chapter-01.md": "saved text" });
  const buffer = makeBuffer(platform);
  await buffer.load("/book/chapter-01.md");
  buffer.edit("saved text + unsaved edit");
  expect(buffer.hasPendingSave).toBe(true);

  await buffer.flush();
  expect(platform.getContent("/book/chapter-01.md")).toBe("saved text + unsaved edit");
  platform.externalDelete("/book/chapter-01.md");
  buffer.reset();

  expect(buffer.filePath).toBeNull();
  expect(buffer.hasPendingSave).toBe(false);
  expect(platform.has("/book/chapter-01.md")).toBe(false);
});

test("a failed pre-delete flush preserves the dirty file buffer for retry", async () => {
  class FailingWritePlatform extends MemoryPlatform {
    override async writeFile(): Promise<FileWriteResult> {
      throw new Error("disk full");
    }
  }
  const platform = new FailingWritePlatform({ "/book/chapter-01.md": "saved text" });
  const buffer = makeBuffer(platform);
  await buffer.load("/book/chapter-01.md");
  buffer.edit("saved text + unsaved edit");

  let flushed = true;
  try {
    await buffer.flush();
  } catch {
    flushed = false;
  }
  if (flushed) {
    platform.externalDelete("/book/chapter-01.md");
    buffer.reset();
  }

  expect(flushed).toBe(false);
  expect(buffer.filePath).toBe("/book/chapter-01.md");
  expect(buffer.content).toBe("saved text + unsaved edit");
  expect(buffer.hasPendingSave).toBe(true);
  expect(platform.getContent("/book/chapter-01.md")).toBe("saved text");
});

// ── Wiring check ──────────────────────────────────────────────────────────
// +page.svelte itself (a large .svelte SFC) can't be imported/driven by
// bun:test directly (no Svelte compiler in this harness — see
// buffer-state.test.ts's header comment on the same limitation). This pins
// that the four handlers above are actually DEFINED and WIRED to LeftPanel,
// same convention as git-identity-and-activity.test.ts's route-wiring checks
// in this file.
test("+page.svelte defines and wires the FileTree open-file rename/delete handlers", () => {
  const root = path.resolve(import.meta.dir, "../..");
  const page = readFileSync(path.join(root, "src/routes/+page.svelte"), "utf8");
  expect(page).toContain("function onTreeBeforeRename");
  expect(page).toContain("function onTreeBeforeDelete");
  expect(page).toContain("function onTreeFileRenamed");
  expect(page).toContain("function onTreeFileDeleted");
  expect(page).toContain("book?.forget(filePath)");
  expect(page).toContain("loadBookDocument(true)");
  // The delete handler must treat a deleted DIRECTORY as affecting every open
  // file nested inside it (code-review), not only an exact path match — the
  // containment predicate is unit-tested in paths.test.ts.
  expect(page).toContain("isPathAtOrUnder(filePath, path)");
  expect(page).toContain("isPathAtOrUnder(active, oldPath)");
  expect(page).toContain("onBeforeRenameOpenFile={onTreeBeforeRename}");
  expect(page).toContain("onBeforeDeleteOpenFile={onTreeBeforeDelete}");
  expect(page).toContain("onFileRenamed={onTreeFileRenamed}");
  expect(page).toContain("onFileDeleted={onTreeFileDeleted}");
});

// Maintainer review finding #8: the pre-rename FLUSH must not be skipped for
// a dirty file the rename affects. It used to be conditional — matched
// against "the one open file" — and an exact-match-only check silently
// skipped the flush when a FOLDER containing the dirty file was renamed, so
// the edit was carried away unsaved under the buffer's still-old path. With
// the whole book open, the editor can hold unsaved edits in several chapters
// at once and any of them may be under the renamed path, so the handler
// flushes EVERYTHING unconditionally — strictly stronger than the containment
// check it replaced, and nothing left for a predicate to get wrong.
test("+page.svelte's rename/delete pre-hooks flush unconditionally", () => {
  const root = path.resolve(import.meta.dir, "../..");
  const page = readFileSync(path.join(root, "src/routes/+page.svelte"), "utf8");
  for (const name of ["onTreeBeforeRename", "onTreeBeforeDelete"]) {
    const match = page.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n  \\}`));
    expect(match).not.toBeNull();
    const body = match![0];
    expect(body).toContain("return flushEditorBuffer();");
    // No condition guarding the flush — that is the whole point.
    expect(body).not.toContain("if (");
  }
});
