import { describe, expect, test } from "bun:test";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { externalWatchTargets } from "../cli/src/preview/file-watcher";
import { loadManifest, resolveConfig } from "../cli/src/lib/manifest";
import {
  renderChapters,
  resolveActiveMarkdownFiles,
} from "../cli/src/lib/markdown/index";

const packageRoot = import.meta.dir;
const pluginRoot = path.join(packageRoot, "plugin");
const fixturesRoot = path.join(packageRoot, "test-fixtures");

async function readJson(relativePath: string): Promise<any> {
  return JSON.parse(await readFile(path.join(packageRoot, relativePath), "utf8"));
}

async function packagedFiles(dir = pluginRoot): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(pluginRoot, absolute).replace(/\\/g, "/");
    const stat = await lstat(absolute);
    expect(stat.isSymbolicLink()).toBe(false);
    if (entry.isDirectory()) files.push(...await packagedFiles(absolute));
    else files.push(relative);
  }
  return files;
}

async function renderFixture(relativePath: string): Promise<string> {
  const book = path.join(fixturesRoot, relativePath);
  const manifest = await loadManifest(book);
  const config = resolveConfig({}, manifest);
  return renderChapters(book, {
    title: config.title,
    styles: config.styles,
    files: config.source?.files ?? null,
  });
}

describe("Open Design package contract", () => {
  test("declares the current refine workflow without unusable apply-time inputs", async () => {
    const manifest = await readJson("plugin/open-design.json");

    expect(manifest.specVersion).toBe("1.0.0");
    expect(manifest.name).toBe("print-md-publishing");
    expect(manifest.version).toBe("0.2.0");
    expect(manifest.tags).toContain("refine");
    expect(manifest.od.taskKind).toBe("tune-collab");
    expect(manifest.od.mode).toBe("refine");
    expect(manifest.od.engineRequirements.od).toBe(">=0.16.1");
    expect(manifest.od.inputs).toBeUndefined();
    expect(manifest.od.useCase.query).not.toContain("{{");
    expect(manifest.od.capabilities).toEqual(["prompt:inject", "fs:read", "fs:write"]);
    expect(manifest.od.pipeline.stages).toEqual([
      { id: "inspect", atoms: ["file-read", "todo-write"] },
      { id: "edit", atoms: ["file-edit", "file-write"] },
      { id: "verify", atoms: ["file-read"] },
    ]);
  });

  test("ships a self-contained skill plus optional reference documents", async () => {
    const manifest = await readJson("plugin/open-design.json");
    const files = await packagedFiles();
    const skill = await readFile(path.join(pluginRoot, "SKILL.md"), "utf8");
    const requiredReferences = [
      "project-contract.md",
      "themes-styles-assets.md",
      "semantic-layout.md",
      "preview-and-source-maps.md",
      "git-and-plugin-ownership.md",
    ];

    expect(files).toContain(manifest.compat.agentSkills[0].path.replace(/^\.\//, ""));
    expect(files).toContain(manifest.od.context.skills[0].path.replace(/^\.\//, ""));
    for (const reference of requiredReferences) {
      expect(files).toContain(`references/${reference}`);
    }
    expect(skill).toContain("<question-form id=\"print-md-brief\">");
    expect(skill).toContain("[form answers — print-md-brief]");
    expect(skill).toContain("complete workflow contract.");
    expect(skill).not.toContain("Read `references/");
    expect(skill).toContain("Do not add `source.assets` or `output`");
    expect(skill).toContain("Never add a root `DESIGN.md`");

    let totalBytes = 0;
    for (const file of files) {
      totalBytes += (await lstat(path.join(pluginRoot, file))).size;
    }
    expect(totalBytes).toBeLessThan(50 * 1024 * 1024);
  });

  test("includes behavioral evals for safety-critical workflows", async () => {
    const evals = await readJson("plugin/evals/evals.json");
    expect(evals.skill_name).toBe("print-md-publishing");
    expect(evals.evals.map((entry: { id: string }) => entry.id)).toEqual([
      "single-book-theme-change",
      "ambiguous-multi-book-target",
      "book-only-over-shared-foundation",
      "implicit-manuscript-safety",
    ]);
    for (const entry of evals.evals) {
      expect(entry.prompt.length).toBeGreaterThan(0);
      expect(entry.expected_output.length).toBeGreaterThan(0);
      expect(entry.assertions.length).toBeGreaterThan(0);
    }
  });
});

describe("Print-MD compatibility fixtures", () => {
  test("explicit source membership excludes a root design document", async () => {
    const book = path.join(fixturesRoot, "simple-explicit");
    const manifest = await loadManifest(book);
    const files = await resolveActiveMarkdownFiles(book, manifest.source?.files);
    const html = await renderFixture("simple-explicit");

    expect(files).toEqual(["chapters/01-introduction.md"]);
    expect(html).toContain("Explicit chapter text");
    expect(html).not.toContain("Fixture design direction");
  });

  test("implicit discovery includes root Markdown but never nested design notes", async () => {
    const book = path.join(fixturesRoot, "simple-implicit");
    const files = await resolveActiveMarkdownFiles(book);
    const html = await renderFixture("simple-implicit");

    expect(files).toEqual(["01-introduction.md", "README.md"]);
    expect(html).toContain("Implicit chapter text");
    expect(html).toContain("Fixture root readme");
    expect(html).not.toContain("Nested design note");
  });

  test("theme and book CSS preserve authored cascade order", async () => {
    const html = await renderFixture("themed-book");
    expect(html.indexOf("--fixture-accent: #345995")).toBeLessThan(
      html.indexOf("--fixture-accent: #b23a48"),
    );
  });

  test("a nested book renders shared dependencies without its sibling", async () => {
    const repo = path.join(fixturesRoot, "multi-book-repo");
    const book = path.join(repo, "books", "core-book");
    const manifest = await loadManifest(book);
    const config = resolveConfig({}, manifest);
    const html = await renderFixture("multi-book-repo/books/core-book");
    const targets = await externalWatchTargets(book, config);

    expect(html).toContain("Core book text");
    expect(html).not.toContain("Supplement text");
    expect(html.indexOf("--shared-accent: #264653")).toBeLessThan(
      html.indexOf("--shared-accent: #e76f51"),
    );
    expect(targets.sort()).toEqual([
      path.join(repo, "shared", "fonts", "Publisher.woff2"),
      path.join(repo, "shared", "plugins", "publisher-components.js"),
      path.join(repo, "shared", "styles", "components.css"),
      path.join(repo, "shared", "themes", "publisher", "palette.css"),
      path.join(repo, "shared", "themes", "publisher", "theme.css"),
    ].sort());
  });
});
