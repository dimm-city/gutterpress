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
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { canonicalChapterId } from "./chapter-id";
import { renderChapters } from "./index";
import { describeChange } from "../../preview/file-watcher";

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

  test("stays in lockstep with preview-shell's inline normId copy", async () => {
    const previewShell = await readFile(
      new URL("../../assets/preview/scripts/preview-shell.js", import.meta.url),
      "utf8",
    );
    const match = previewShell.match(/function normId\(s\) \{([\s\S]*?)\n  \}/);
    expect(match).not.toBeNull();

    const previewNormId = new Function(
      "s",
      match![1]!,
    ) as (input: string) => string;
    const fixtures = [
      "",
      "chapter-03.md",
      "./chapters/03.md",
      "././a.md",
      "chapters\\03.md",
      ".\\chapters\\03.md",
      "chapters//03.md",
      "chapters//nested\\03 the players.md",
      "chapter-02 1 Augmerc.md",
    ];

    for (const fixture of fixtures) {
      expect(previewNormId(fixture)).toBe(canonicalChapterId(fixture));
    }
  });
});

describe("identity contract: build tag === watcher broadcast", () => {
  let inputDir: string;

  beforeEach(async () => {
    inputDir = await mkdtemp(path.join(tmpdir(), "pmd-id-input-"));
    await mkdir(path.join(inputDir, "chapters"), { recursive: true });
    await writeFile(path.join(inputDir, "root.md"), "# Root\n");
    await writeFile(path.join(inputDir, "chapters", "03-the-players.md"), "# Players\n");
  });

  afterEach(async () => {
    await rm(inputDir, { recursive: true, force: true });
  });

  /** Extract data-chapter-src values from rendered HTML, in order. */
  function tagsOf(html: string): string[] {
    return [...html.matchAll(/data-chapter-src="([^"]*)"/g)].map((m) => m[1]!);
  }

  /** What the file-watcher would broadcast for an edit to `absFile`. */
  function broadcastFor(absFile: string): string {
    const dest = describeChange(absFile, path.resolve(inputDir));
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
