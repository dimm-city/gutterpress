import { test, expect } from "bun:test";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  scaffoldProject,
  slugifyProjectName,
  escapeYamlScalar,
} from "./project-scaffold.ts";
import type { CreateProjectError } from "./project-scaffold.ts";
import { detectProjectSource } from "./project-source.ts";
import { providerFor } from "./source-provider.ts";

async function tmpParent(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "pmd-scaffold-"));
}

test("slugifyProjectName lowercases, hyphenates, trims", () => {
  expect(slugifyProjectName("My First Book")).toBe("my-first-book");
  expect(slugifyProjectName("  Spaces  &  Symbols!! ")).toBe("spaces-symbols");
  expect(slugifyProjectName("Café Déjà")).toBe("cafe-deja");
  expect(slugifyProjectName("!!!")).toBe("");
});

test("escapeYamlScalar escapes backslashes and quotes", () => {
  expect(escapeYamlScalar('a "quote" and \\ slash')).toBe(
    'a \\"quote\\" and \\\\ slash',
  );
});

test("scaffoldProject (no git) creates a valid project tree", async () => {
  const parent = await tmpParent();
  try {
    const result = await scaffoldProject({
      name: "Test Book",
      author: "Jane Writer",
      parentDir: parent,
      versionHistory: "none",
    });

    expect(result.projectDir).toBe(path.join(parent, "test-book"));
    expect(result.versionHistory).toBe("none");
    expect(result.openFile).toBe(path.join(parent, "test-book", "chapter-01.md"));

    const manifest = await readFile(result.manifestPath, "utf8");
    expect(manifest).toContain('title: "Test Book"');
    expect(manifest).toContain('- "Jane Writer"');
    expect(manifest).toContain("test-book.pdf");
    expect(manifest).toContain("chapter-01.md");

    const chapter = await readFile(result.openFile, "utf8");
    expect(chapter).toContain("Test Book");
    expect(chapter).not.toContain("{{TITLE}}");

    // assets/ dir exists.
    expect((await stat(path.join(result.projectDir, "assets"))).isDirectory()).toBe(true);
    // No git when versionHistory: "none".
    const source = await detectProjectSource(result.projectDir);
    expect(source.type).toBe("local-folder");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("scaffoldProject blank author falls back to a friendly default", async () => {
  const parent = await tmpParent();
  try {
    const result = await scaffoldProject({
      name: "No Author Book",
      parentDir: parent,
      versionHistory: "none",
    });
    const manifest = await readFile(result.manifestPath, "utf8");
    expect(manifest).toContain('- "Anonymous"');
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("scaffoldProject refuses to overwrite an existing target", async () => {
  const parent = await tmpParent();
  try {
    await scaffoldProject({ name: "Dup", parentDir: parent, versionHistory: "none" });
    let err: CreateProjectError | undefined;
    try {
      await scaffoldProject({ name: "Dup", parentDir: parent, versionHistory: "none" });
    } catch (e) {
      err = e as CreateProjectError;
    }
    expect(err).toBeDefined();
    expect(err?.code).toBe("target-exists");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("scaffoldProject rejects an unusable name", async () => {
  const parent = await tmpParent();
  try {
    let err: CreateProjectError | undefined;
    try {
      await scaffoldProject({ name: "!!!", parentDir: parent, versionHistory: "none" });
    } catch (e) {
      err = e as CreateProjectError;
    }
    expect(err?.code).toBe("invalid-name");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("scaffoldProject default initialises local git version history", async () => {
  const parent = await tmpParent();
  try {
    const result = await scaffoldProject({
      name: "Versioned Book",
      author: "Git Writer",
      parentDir: parent,
      // default versionHistory: local-git
    });
    expect(result.versionHistory).toBe("local-git");

    const source = await detectProjectSource(result.projectDir);
    expect(source.type).toBe("local-git-folder");

    const provider = providerFor(source);
    const history = await provider.listHistory(result.projectDir);
    expect(history.length).toBe(1);
    expect(history[0]!.message).toBe("Created project");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("provider snapshot + restore round-trips the working tree", async () => {
  const parent = await tmpParent();
  try {
    const result = await scaffoldProject({
      name: "Snap Book",
      parentDir: parent,
    });
    const source = await detectProjectSource(result.projectDir);
    const provider = providerFor(source);

    // Modify the chapter, snapshot, then change again and restore.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(result.openFile, "# Edited\n\nNew content.\n", "utf8");
    const snap = await provider.snapshot({
      projectDir: result.projectDir,
      message: "Edit chapter",
    });
    expect(snap.id).toMatch(/^[0-9a-f]{40}$/);

    await writeFile(result.openFile, "# Throwaway\n", "utf8");
    await provider.restore({ projectDir: result.projectDir, id: snap.id });
    const restored = await readFile(result.openFile, "utf8");
    expect(restored).toContain("New content.");

    const history = await provider.listHistory(result.projectDir);
    expect(history.length).toBe(2);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
