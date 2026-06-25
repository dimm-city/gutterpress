import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  listBuiltInTemplates,
  saveProjectAsTemplate,
  listCustomTemplates,
  BUILT_IN_TEMPLATE_IDS,
} from "./project-templates.ts";
import { scaffoldProject } from "./project-scaffold.ts";

async function tmp(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

test("listBuiltInTemplates returns at least the 4 shipped templates", async () => {
  const templates = await listBuiltInTemplates();
  const ids = templates.map((t) => t.id).sort();
  expect(ids).toEqual([...BUILT_IN_TEMPLATE_IDS].sort());
  expect(ids.length).toBeGreaterThanOrEqual(4);
  // Each carries author-friendly display metadata.
  for (const t of templates) {
    expect(t.label.length).toBeGreaterThan(0);
    expect(t.description.length).toBeGreaterThan(0);
  }
});

test("each built-in template scaffolds into a valid project", async () => {
  for (const id of BUILT_IN_TEMPLATE_IDS) {
    const parent = await tmp(`pmd-tpl-${id}-`);
    try {
      const result = await scaffoldProject({
        name: `Demo ${id}`,
        author: "Tester",
        parentDir: parent,
        template: id,
        versionHistory: "none",
      });
      const manifest = await readFile(result.manifestPath, "utf8");
      expect(manifest).toContain(`title: "Demo ${id}"`);
      expect(manifest).not.toContain("{{TITLE}}");
      // The first chapter the wizard opens exists and has no leftover tokens.
      const open = await readFile(result.openFile, "utf8");
      expect(open).not.toContain("{{TITLE}}");
      expect(open.length).toBeGreaterThan(0);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }
});

test("saveProjectAsTemplate captures an existing project as a reusable template", async () => {
  const parent = await tmp("pmd-saveas-src-");
  const templatesRoot = await tmp("pmd-saveas-dest-");
  try {
    // Build a tiny project to capture.
    const result = await scaffoldProject({
      name: "My Source",
      parentDir: parent,
      template: "book",
      versionHistory: "none",
    });
    // Add a custom file + an assets image to prove the whole tree is copied.
    await writeFile(path.join(result.projectDir, "chapter-02.md"), "# Two\n", "utf8");
    await mkdir(path.join(result.projectDir, "assets"), { recursive: true });
    await writeFile(path.join(result.projectDir, "assets", "cover.txt"), "img", "utf8");

    const saved = await saveProjectAsTemplate({
      projectDir: result.projectDir,
      name: "My Template",
      templatesRoot,
    });

    expect(saved.id).toBe("my-template");
    expect(saved.label).toBe("My Template");

    // Files copied under templatesRoot/<id>/.
    const files = await readdir(saved.dir!);
    expect(files).toContain("manifest.yaml");
    expect(files).toContain("chapter-01.md");
    expect(files).toContain("chapter-02.md");

    // Authored title is re-tokenised back to {{TITLE}} so the template is reusable.
    const manifest = await readFile(path.join(saved.dir!, "manifest.yaml"), "utf8");
    expect(manifest).toContain("{{TITLE}}");
    expect(manifest).not.toContain("My Source");
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rm(templatesRoot, { recursive: true, force: true });
  }
});

test("saveProjectAsTemplate re-tokenises the authors block, NOT a leading source list item", async () => {
  // Regression: a manifest that lists `source.files` BEFORE `authors` must not
  // get its first source filename rewritten to {{AUTHOR}} (the re-tokeniser is
  // anchored to the `authors:` key, not the first `- item` in the file).
  const project = await tmp("pmd-retok-src-");
  const templatesRoot = await tmp("pmd-retok-dest-");
  try {
    await writeFile(
      path.join(project, "manifest.yaml"),
      [
        'title: My Book',
        'source:',
        '  files:',
        '    - chapter-01.md',
        '    - chapter-02.md',
        'authors:',
        '  - Jane Author',
        '',
      ].join("\n"),
      "utf8",
    );
    await writeFile(path.join(project, "chapter-01.md"), "# One\n", "utf8");

    const saved = await saveProjectAsTemplate({
      projectDir: project,
      name: "Retok Template",
      templatesRoot,
    });
    const manifest = await readFile(path.join(saved.dir!, "manifest.yaml"), "utf8");

    expect(manifest).toContain('title: "{{TITLE}}"');
    // The source filename survives; the author is tokenised.
    expect(manifest).toContain("- chapter-01.md");
    expect(manifest).toContain('"{{AUTHOR}}"');
    expect(manifest).not.toContain("Jane Author");
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(templatesRoot, { recursive: true, force: true });
  }
});

test("listCustomTemplates returns saved templates and [] for an empty root", async () => {
  const root = await tmp("pmd-customlist-");
  try {
    expect(await listCustomTemplates(root)).toEqual([]);
    const parent = await tmp("pmd-customlist-src-");
    try {
      const result = await scaffoldProject({
        name: "Src",
        parentDir: parent,
        versionHistory: "none",
      });
      await saveProjectAsTemplate({
        projectDir: result.projectDir,
        name: "Custom One",
        templatesRoot: root,
      });
      const list = await listCustomTemplates(root);
      expect(list.map((t) => t.id)).toEqual(["custom-one"]);
      expect(list[0]!.label).toBe("Custom One");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
