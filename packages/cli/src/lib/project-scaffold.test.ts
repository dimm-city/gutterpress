import { test, expect } from "bun:test";
import { mkdtemp, readFile, stat, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  scaffoldProject,
  adoptFolder,
  slugifyProjectName,
  escapeYamlScalar,
} from "./project-scaffold.ts";
import type { CreateProjectError } from "./project-scaffold.ts";
import { detectProjectSource } from "./project-source.ts";
import { providerFor } from "./source-provider.ts";
import { loadManifest, resolveConfig } from "./manifest.ts";

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
    expect(manifest).toContain("chapter-01.md");
    // The manifest references the scaffolded stylesheet.
    expect(manifest).toContain("styles/book.css");
    // No `output:` block: output location is a convention (output-paths.ts),
    // and resolveConfig THROWS a UsageError if a manifest still carries one —
    // scaffolding one in would hard-fail every build of a fresh project.
    expect(manifest).not.toContain("output:");
    expect(manifest).not.toContain("{{OUTPUT_PDF}}");
    // The generated manifest must actually resolve without throwing.
    const parsed = await loadManifest(result.projectDir);
    expect(() => resolveConfig({}, parsed)).not.toThrow();

    const chapter = await readFile(result.openFile, "utf8");
    expect(chapter).toContain("Test Book");
    expect(chapter).not.toContain("{{TITLE}}");

    // assets/ dir exists.
    expect((await stat(path.join(result.projectDir, "assets"))).isDirectory()).toBe(true);
    // styles/book.css scaffolded with editable :root custom properties so the
    // guided Design panel is never empty on a fresh project.
    const bookCss = await readFile(path.join(result.projectDir, "styles", "book.css"), "utf8");
    expect(bookCss).toContain(":root");
    expect(bookCss).toMatch(/--color-ink|--color-accent/);
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

test("scaffoldProject inside an already-versioned folder reports a friendly notice, not a raw error", async () => {
  const parent = await tmpParent();
  try {
    // Make `parent` itself an enclosing repo (as if it were an existing
    // multi-book project) before scaffolding a new book inside it.
    await providerFor({ type: "local-folder", path: parent }).initVersionHistory({
      projectDir: parent,
    });

    const result = await scaffoldProject({
      name: "Second Book",
      parentDir: parent,
      // default versionHistory: local-git
    });

    // The new book still scaffolds successfully — just without its own repo.
    expect(result.versionHistory).toBe("none");
    expect(result.versionHistoryError).toContain(path.basename(parent));
    expect(result.versionHistoryError).toContain("shared version history");
    expect(result.versionHistoryError).not.toMatch(/won't create a separate history/i);

    // No nested .git was created inside the new book's folder.
    const source = await detectProjectSource(result.projectDir);
    expect(source.type).toBe("local-git-folder");
    if (source.type === "local-git-folder") {
      expect(source.repoRoot).toBe(parent);
      expect(source.subPath).toBe("second-book");
    }
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("adoptFolder: uses existing markdown + scaffolds manifest/book.css in place", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pmd-adopt-"));
  await writeFile(path.join(dir, "intro.md"), "# Intro\n\nHello.", "utf8");
  await writeFile(path.join(dir, "02-body.md"), "# Body\n", "utf8");

  const result = await adoptFolder({ dir, versionHistory: "none" });

  expect(result.projectDir).toBe(dir);
  // Opens the first existing markdown file (alphabetical), not a scaffolded one.
  expect(result.openFile).toBe(path.join(dir, "02-body.md"));

  const manifest = await readFile(result.manifestPath, "utf8");
  expect(manifest).toContain("02-body.md");
  expect(manifest).toContain("intro.md");
  expect(manifest).toContain("styles/book.css");
  // No chapter-01.md scaffolded when the folder already has markdown.
  expect(existsSync(path.join(dir, "chapter-01.md"))).toBe(false);

  const bookCss = await readFile(path.join(dir, "styles", "book.css"), "utf8");
  expect(bookCss).toContain(":root");

  await rm(dir, { recursive: true, force: true });
});

test("adoptFolder: scaffolds a chapter when the folder has no markdown", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pmd-adopt-empty-"));
  const result = await adoptFolder({ dir, title: "Fresh", versionHistory: "none" });
  expect(result.openFile).toBe(path.join(dir, "chapter-01.md"));
  expect(existsSync(path.join(dir, "chapter-01.md"))).toBe(true);
  expect(await readFile(result.manifestPath, "utf8")).toContain('title: "Fresh"');
  await rm(dir, { recursive: true, force: true });
});

test("adoptFolder: refuses a folder that is already a project", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pmd-adopt-existing-"));
  await writeFile(path.join(dir, "manifest.yaml"), "title: x\n", "utf8");
  await expect(adoptFolder({ dir, versionHistory: "none" })).rejects.toThrow(/already a print-md project/i);
  await rm(dir, { recursive: true, force: true });
});

test("adoptFolder: recognizes manifest.yml as an existing project", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pmd-adopt-existing-yml-"));
  await writeFile(path.join(dir, "manifest.yml"), "title: x\n", "utf8");
  await expect(adoptFolder({ dir, versionHistory: "none" })).rejects.toThrow(/already a print-md project/i);
  await rm(dir, { recursive: true, force: true });
});

test("adoptFolder: recognizes persisted print-md.yaml projects", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pmd-adopt-legacy-"));
  await writeFile(path.join(dir, "print-md.yaml"), "title: legacy\n", "utf8");
  await expect(adoptFolder({ dir, versionHistory: "none" })).rejects.toThrow(
    /already a print-md project/i
  );
  await rm(dir, { recursive: true, force: true });
});

test("adoptFolder: never overwrites an existing styles/book.css", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pmd-adopt-css-"));
  await writeFile(path.join(dir, "doc.md"), "# Doc\n", "utf8");
  await mkdir(path.join(dir, "styles"), { recursive: true });
  await writeFile(path.join(dir, "styles", "book.css"), "/* mine */ :root{}", "utf8");
  await adoptFolder({ dir, versionHistory: "none" });
  expect(await readFile(path.join(dir, "styles", "book.css"), "utf8")).toContain("/* mine */");
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// .gitignore — every scaffolded project must ignore dist/ (build output),
// or the default-on auto-snapshot feature commits and pushes a fresh,
// incompressible PDF on every build until GitHub's 100MB limit rejects it.
// ---------------------------------------------------------------------------

test("scaffoldProject writes a .gitignore excluding dist/", async () => {
  const parent = await tmpParent();
  try {
    const result = await scaffoldProject({
      name: "Ignore Book",
      parentDir: parent,
      versionHistory: "none",
    });
    const gitignore = await readFile(path.join(result.projectDir, ".gitignore"), "utf8");
    expect(gitignore).toContain("dist/");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("scaffoldProject appends dist/ to a custom template's .gitignore without clobbering it", async () => {
  const templateDir = await mkdtemp(path.join(tmpdir(), "pmd-tpl-gitignore-"));
  const parent = await tmpParent();
  try {
    await writeFile(path.join(templateDir, "manifest.yaml"), "title: \"{{TITLE}}\"\n", "utf8");
    await writeFile(path.join(templateDir, "chapter-01.md"), "# {{TITLE}}\n", "utf8");
    await writeFile(path.join(templateDir, ".gitignore"), "node_modules/\n", "utf8");

    const result = await scaffoldProject({
      name: "Custom Tpl Book",
      parentDir: parent,
      templateDir,
      versionHistory: "none",
    });

    const gitignore = await readFile(path.join(result.projectDir, ".gitignore"), "utf8");
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain("dist/");
  } finally {
    await rm(templateDir, { recursive: true, force: true });
    await rm(parent, { recursive: true, force: true });
  }
});

test("scaffoldProject leaves a custom template's .gitignore untouched when it already ignores dist/", async () => {
  const templateDir = await mkdtemp(path.join(tmpdir(), "pmd-tpl-gitignore-has-dist-"));
  const parent = await tmpParent();
  try {
    await writeFile(path.join(templateDir, "manifest.yaml"), "title: \"{{TITLE}}\"\n", "utf8");
    await writeFile(path.join(templateDir, "chapter-01.md"), "# {{TITLE}}\n", "utf8");
    const original = "# my ignores\ndist/\n";
    await writeFile(path.join(templateDir, ".gitignore"), original, "utf8");

    const result = await scaffoldProject({
      name: "Already Ignored Book",
      parentDir: parent,
      templateDir,
      versionHistory: "none",
    });

    const gitignore = await readFile(path.join(result.projectDir, ".gitignore"), "utf8");
    expect(gitignore).toBe(original);
  } finally {
    await rm(templateDir, { recursive: true, force: true });
    await rm(parent, { recursive: true, force: true });
  }
});

test("adoptFolder writes a .gitignore excluding dist/ when the folder has none", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pmd-adopt-gitignore-"));
  await writeFile(path.join(dir, "doc.md"), "# Doc\n", "utf8");
  await adoptFolder({ dir, versionHistory: "none" });
  const gitignore = await readFile(path.join(dir, ".gitignore"), "utf8");
  expect(gitignore).toContain("dist/");
  await rm(dir, { recursive: true, force: true });
});

test("adoptFolder appends dist/ to an existing .gitignore without overwriting it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pmd-adopt-gitignore-existing-"));
  await writeFile(path.join(dir, "doc.md"), "# Doc\n", "utf8");
  await writeFile(path.join(dir, ".gitignore"), "*.log", "utf8"); // no trailing newline
  await adoptFolder({ dir, versionHistory: "none" });
  const gitignore = await readFile(path.join(dir, ".gitignore"), "utf8");
  expect(gitignore).toContain("*.log");
  expect(gitignore).toContain("dist/");
  await rm(dir, { recursive: true, force: true });
});
