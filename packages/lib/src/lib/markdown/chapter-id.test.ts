/**
 * Chapter identity contract tests.
 *
 * The incremental live-preview splice works ONLY if the `data-chapter-src`
 * the build writes and the `content-update` string the file-watcher
 * broadcasts are the SAME string for the same source file. These tests pin
 * that contract for every manifest spelling that previously diverged
 * (`./`-prefixed entries, backslashes, duplicate slashes, subdirectories).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { canonicalChapterId } from "./chapter-id";
import { renderChapters } from "./index";
import { resolveDestinationForChange } from "../../preview/file-watcher";

describe("canonicalChapterId", () => {
  test("passes through an already-canonical id", () => {
    expect(canonicalChapterId("chapters/03-the-players.md")).toBe("chapters/03-the-players.md");
    expect(canonicalChapterId("chapter-03.md")).toBe("chapter-03.md");
  });

  test("strips ./ prefixes (including repeated)", () => {
    expect(canonicalChapterId("./chapters/03.md")).toBe("chapters/03.md");
    expect(canonicalChapterId("././a.md")).toBe("a.md");
  });

  test("converts backslashes to forward slashes", () => {
    expect(canonicalChapterId("chapters\\03.md")).toBe("chapters/03.md");
    expect(canonicalChapterId(".\\chapters\\03.md")).toBe("chapters/03.md");
  });

  test("collapses duplicate slashes", () => {
    expect(canonicalChapterId("chapters//03.md")).toBe("chapters/03.md");
  });

  test("preserves spaces and case", () => {
    expect(canonicalChapterId("chapter-02 1 Augmerc.md")).toBe("chapter-02 1 Augmerc.md");
  });
});

describe("identity contract: build tag === watcher broadcast", () => {
  let inputDir: string;
  let tempDir: string;

  beforeEach(async () => {
    inputDir = await mkdtemp(path.join(tmpdir(), "pmd-id-input-"));
    tempDir = await mkdtemp(path.join(tmpdir(), "pmd-id-temp-"));
    await mkdir(path.join(inputDir, "chapters"), { recursive: true });
    await writeFile(path.join(inputDir, "root.md"), "# Root\n");
    await writeFile(path.join(inputDir, "chapters", "03-the-players.md"), "# Players\n");
  });

  afterEach(async () => {
    await rm(inputDir, { recursive: true, force: true });
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Extract data-chapter-src values from rendered HTML, in order. */
  function tagsOf(html: string): string[] {
    return [...html.matchAll(/data-chapter-src="([^"]*)"/g)].map((m) => m[1]!);
  }

  /** What the file-watcher would broadcast for an edit to `absFile`. */
  function broadcastFor(absFile: string): string {
    const dest = resolveDestinationForChange(absFile, path.resolve(inputDir), tempDir, []);
    expect(dest).not.toBeNull();
    return canonicalChapterId(dest!.relativePath);
  }

  test("root file listed as bare basename", async () => {
    const html = await renderChapters(inputDir, { files: ["root.md"], wrapChapters: true });
    expect(tagsOf(html)).toEqual([broadcastFor(path.join(inputDir, "root.md"))]);
  });

  test("subdirectory chapter listed plainly", async () => {
    const html = await renderChapters(inputDir, {
      files: ["chapters/03-the-players.md"],
      wrapChapters: true,
    });
    expect(tagsOf(html)).toEqual([
      broadcastFor(path.join(inputDir, "chapters", "03-the-players.md")),
    ]);
  });

  test("./-prefixed manifest entry (the v0.5.0-rc.2 splice regression)", async () => {
    const html = await renderChapters(inputDir, {
      files: ["./chapters/03-the-players.md"],
      wrapChapters: true,
    });
    expect(tagsOf(html)).toEqual([
      broadcastFor(path.join(inputDir, "chapters", "03-the-players.md")),
    ]);
    expect(tagsOf(html)[0]).toBe("chapters/03-the-players.md");
  });

  test("backslashed manifest entry (Windows-authored manifest)", async () => {
    const html = await renderChapters(inputDir, {
      files: ["chapters\\03-the-players.md"],
      wrapChapters: true,
    });
    expect(tagsOf(html)).toEqual([
      broadcastFor(path.join(inputDir, "chapters", "03-the-players.md")),
    ]);
  });

  test("discovery mode (no files key) tags root files canonically", async () => {
    const html = await renderChapters(inputDir, { files: null, wrapChapters: true });
    expect(tagsOf(html)).toEqual([broadcastFor(path.join(inputDir, "root.md"))]);
  });

  test("content-root layout: every manifest spelling collapses to one id", () => {
    const spellings = [
      "chapters/03-the-players.md",
      "./chapters/03-the-players.md",
      "chapters\\03-the-players.md",
      "chapters//03-the-players.md",
    ];
    const ids = new Set(spellings.map(canonicalChapterId));
    expect([...ids]).toEqual(["chapters/03-the-players.md"]);
  });
});
