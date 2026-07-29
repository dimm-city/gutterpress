import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  MarkdownFileLaunchQueue,
  markdownFilePathsFromArgv,
  resolveMarkdownFileLaunch,
} from "../../electron/markdown-file-launch";
import type { MarkdownFileLaunchEvent } from "../../electron/bridge-types";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "gutterpress-file-launch-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("argv extraction accepts absolute/relative .md paths and ignores other arguments", () => {
  const absolute = path.join(root, "absolute.MD");
  expect(
    markdownFilePathsFromArgv(
      ["desktop", "--flag", "chapter.md", absolute, `"${absolute}"`, "notes.markdown", "https://example.test/x.md"],
      root,
    ),
  ).toEqual([path.join(root, "chapter.md"), absolute]);
});

test("argv extraction decodes local file: URLs and rejects remote schemes/hosts", () => {
  const chapter = path.join(root, "chapter with spaces.md");
  expect(
    markdownFilePathsFromArgv(
      [
        pathToFileURL(chapter).href,
        "https://example.test/chapter.md",
        "Gutterpress://open/chapter.md",
        "file://remote.example/share/chapter.md",
      ],
      root,
    ),
  ).toEqual([chapter]);
});

test("a chapter resolves to the nearest manifest-bearing ancestor", async () => {
  const project = path.join(root, "project");
  const nestedBook = path.join(project, "books", "nested");
  const chapter = path.join(nestedBook, "chapters", "one.md");
  await mkdir(path.dirname(chapter), { recursive: true });
  await writeFile(path.join(project, "manifest.yaml"), "title: Outer\n");
  await writeFile(path.join(nestedBook, "manifest.yaml"), "title: Nested\n");
  await writeFile(chapter, "# One\n");

  await expect(resolveMarkdownFileLaunch(chapter)).resolves.toEqual({
    type: "open",
    filePath: chapter,
    projectDir: nestedBook,
  });
  await expect(resolveMarkdownFileLaunch(pathToFileURL(chapter).href)).resolves.toEqual({
    type: "open",
    filePath: chapter,
    projectDir: nestedBook,
  });
});

test("a chapter without manifest.yaml is rejected", async () => {
  const project = path.join(root, "legacy-project");
  const chapter = path.join(project, "chapters", "one.md");
  await mkdir(path.dirname(chapter), { recursive: true });
  await writeFile(chapter, "# One\n");

  const result = await resolveMarkdownFileLaunch(chapter);
  expect(result.type).toBe("error");
  if (result.type === "error") expect(result.message).toContain("manifest.yaml");
});

test("an unrelated Markdown file is rejected instead of opening a loose folder", async () => {
  const chapter = path.join(root, "notes", "random.md");
  await mkdir(path.dirname(chapter), { recursive: true });
  await writeFile(chapter, "# Notes\n");

  const result = await resolveMarkdownFileLaunch(chapter);
  expect(result.type).toBe("error");
  if (result.type === "error") {
    expect(result.message).toContain("isn't inside a Gutterpress project");
    expect(result.message).toContain("manifest.yaml");
  }
});

test("a missing selected file produces an understandable error", async () => {
  const result = await resolveMarkdownFileLaunch(path.join(root, "missing.md"));
  expect(result.type).toBe("error");
  if (result.type === "error") expect(result.message).toContain("isn't available");
});

test("launch paths stay queued until ready and ready follows the complete initial replay", async () => {
  const events: MarkdownFileLaunchEvent[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const first = path.join(root, "first.md");
  const second = path.join(root, "second.md");
  const queue = new MarkdownFileLaunchQueue({
    resolve: async (filePath) => {
      if (filePath === first) await firstGate;
      return { type: "open", filePath, projectDir: root };
    },
    emit: (event) => events.push(event),
  });

  queue.enqueue(first);
  expect(events).toEqual([]);
  const ready = queue.markConsumerReady();
  queue.enqueue(second);
  releaseFirst();
  await ready;

  expect(events).toEqual([
    { type: "open", filePath: first, projectDir: root },
    { type: "open", filePath: second, projectDir: root },
    { type: "ready" },
  ]);
});

test("suspending a consumer preserves an in-flight path for the next window", async () => {
  const events: MarkdownFileLaunchEvent[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chapter = path.join(root, "chapter.md");
  const queue = new MarkdownFileLaunchQueue({
    resolve: async (filePath) => {
      await gate;
      return { type: "open", filePath, projectDir: root };
    },
    emit: (event) => events.push(event),
  });

  queue.enqueue(chapter);
  const firstReady = queue.markConsumerReady();
  queue.suspend();
  release();
  await firstReady;
  expect(events).toEqual([]);

  await queue.markConsumerReady();
  expect(events).toEqual([
    { type: "open", filePath: chapter, projectDir: root },
    { type: "ready" },
  ]);
});
