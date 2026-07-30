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
    const parent = await tmp(`gutterpress-tpl-${id}-`);
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
  const parent = await tmp("gutterpress-saveas-src-");
  const templatesRoot = await tmp("gutterpress-saveas-dest-");
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

test("custom templates preserve and scaffold the recognized manifest.yaml name", async () => {
  const project = await tmp("gutterpress-template-yml-source-");
  const templatesRoot = await tmp("gutterpress-template-yml-saved-");
  const parent = await tmp("gutterpress-template-yml-output-");
  try {
    await writeFile(
      path.join(project, "manifest.yaml"),
      [
        "title: Original",
        "authors:",
        "  - Writer",
        "source:",
        "  files:",
        "    - chapter.md",
        "output:",
        "  filename: original.pdf",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(path.join(project, "chapter.md"), "# {{TITLE}}\n", "utf8");

    const saved = await saveProjectAsTemplate({
      projectDir: project,
      name: "Yml Template",
      templatesRoot,
    });
    expect(await readFile(path.join(saved.dir!, "manifest.yaml"), "utf8")).toContain(
      "{{TITLE}}",
    );

    const created = await scaffoldProject({
      name: "Created From Yml",
      parentDir: parent,
      templateDir: saved.dir,
      versionHistory: "none",
    });
    expect(created.manifestPath).toBe(path.join(created.projectDir, "manifest.yaml"));
    expect(await readFile(created.manifestPath, "utf8")).toContain(
      'title: "Created From Yml"',
    );
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(templatesRoot, { recursive: true, force: true });
    await rm(parent, { recursive: true, force: true });
  }
});

test("saveProjectAsTemplate re-tokenises the authors block, NOT a leading source list item", async () => {
  // Regression: a manifest that lists `source.files` BEFORE `authors` must not
  // get its first source filename rewritten to {{AUTHOR}} (the re-tokeniser is
  // anchored to the `authors:` key, not the first `- item` in the file).
  const project = await tmp("gutterpress-retok-src-");
  const templatesRoot = await tmp("gutterpress-retok-dest-");
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

// Characterization: lock the slug id + prettify label fallback of the template
// call site so the slug/prettify consolidation changes no user-visible ids.
test("saveProjectAsTemplate slugs the id across diacritics and punctuation", async () => {
  const parent = await tmp("gutterpress-tplslug-src-");
  const templatesRoot = await tmp("gutterpress-tplslug-dest-");
  try {
    const result = await scaffoldProject({
      name: "Slug Src",
      parentDir: parent,
      versionHistory: "none",
    });
    const saved = await saveProjectAsTemplate({
      projectDir: result.projectDir,
      name: "Café  Déjà — Vu!!",
      templatesRoot,
    });
    expect(saved.id).toBe("cafe-deja-vu");
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rm(templatesRoot, { recursive: true, force: true });
  }
});

test("listCustomTemplates prettifies a bare folder id as its label fallback", async () => {
  const root = await tmp("gutterpress-prettify-");
  try {
    // A template folder with no metadata sidecar → label falls back to prettify(id).
    await mkdir(path.join(root, "my_cool-template"), { recursive: true });
    const list = await listCustomTemplates(root);
    expect(list.map((t) => ({ id: t.id, label: t.label }))).toEqual([
      { id: "my_cool-template", label: "My cool template" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("listCustomTemplates returns saved templates and [] for an empty root", async () => {
  const root = await tmp("gutterpress-customlist-");
  try {
    expect(await listCustomTemplates(root)).toEqual([]);
    const parent = await tmp("gutterpress-customlist-src-");
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

// ── Shared-ref reconciliation (repo-nested book → portable template) ─────────
//
// A book that lives inside a multi-book repo references shared design with
// `../../shared/...` manifest entries. Copied verbatim into a template, those
// escape the template folder and can't resolve once scaffolded elsewhere. The
// default `sharedRefs: "vendor"` copies the referenced files (and a
// stylesheet's whole url()/@import closure) into the template book-local and
// rewrites the entries; `"exclude"` drops them instead.

/**
 * Build `<repo>/shared/...` plus a nested book that references it, and return
 * the book dir. The shared theme pulls in a font (`url`) and a partial
 * (`@import`), so the closure is more than the one declared file.
 */
async function makeRepoWithNestedBook(repo: string): Promise<string> {
  const book = path.join(repo, "books", "field-guide");
  await mkdir(path.join(repo, "shared", "themes", "publisher"), { recursive: true });
  await mkdir(path.join(repo, "shared", "fonts"), { recursive: true });
  await mkdir(path.join(repo, "shared", "plugins"), { recursive: true });
  await mkdir(book, { recursive: true });

  await writeFile(
    path.join(repo, "shared", "themes", "publisher", "theme.css"),
    '@import "./local.css";\n@font-face { font-family: P; src: url("../../fonts/P.woff2"); }\nbody { color: black }\n',
    "utf8",
  );
  await writeFile(
    path.join(repo, "shared", "themes", "publisher", "local.css"),
    "h1 { letter-spacing: 0.02em }\n",
    "utf8",
  );
  await writeFile(path.join(repo, "shared", "fonts", "P.woff2"), "font-bytes", "utf8");
  await writeFile(path.join(repo, "shared", "plugins", "components.js"), "export default () => {};\n", "utf8");

  await writeFile(path.join(book, "book.css"), "p { margin: 0 }\n", "utf8");
  await writeFile(path.join(book, "chapter-01.md"), "# One\n", "utf8");
  await writeFile(
    path.join(book, "manifest.yaml"),
    [
      "title: Field Guide",
      "authors:",
      "  - A. Writer",
      "styles:",
      "  - ../../shared/themes/publisher/theme.css",
      "  - book.css",
      "plugins:",
      "  - path: ../../shared/plugins/components.js",
      "",
    ].join("\n"),
    "utf8",
  );
  return book;
}

test("saveProjectAsTemplate vendors the shared style closure + plugin book-local by default", async () => {
  const repo = await tmp("gutterpress-vendor-repo-");
  const templatesRoot = await tmp("gutterpress-vendor-dest-");
  try {
    const book = await makeRepoWithNestedBook(repo);

    const saved = await saveProjectAsTemplate({
      projectDir: book,
      name: "Field Template",
      templatesRoot,
    });

    // The escaping entries were rewritten book-local — no `../` survives.
    const manifest = await readFile(path.join(saved.dir!, "manifest.yaml"), "utf8");
    expect(manifest).not.toContain("../");
    expect(manifest).toContain("shared/themes/publisher/theme.css");
    expect(manifest).toContain("book.css"); // the in-book entry is untouched
    expect(manifest).toContain("shared/plugins/components.js");

    // The declared file, its @import partial, its url() font, and the plugin
    // were all copied in — preserving the layout so the CSS's own relative
    // refs still resolve.
    const themeCss = await readFile(
      path.join(saved.dir!, "shared", "themes", "publisher", "theme.css"),
      "utf8",
    );
    expect(themeCss).toContain('url("../../fonts/P.woff2")'); // untouched, still valid
    for (const rel of [
      "shared/themes/publisher/theme.css",
      "shared/themes/publisher/local.css",
      "shared/fonts/P.woff2",
      "shared/plugins/components.js",
    ]) {
      expect(await readFile(path.join(saved.dir!, rel), "utf8")).toBeTruthy();
    }

    expect(saved.vendoredRefs).toContain("shared/themes/publisher/theme.css");
    expect(saved.vendoredRefs).toContain("shared/plugins/components.js");
    expect(saved.excludedRefs ?? []).toHaveLength(0);
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(templatesRoot, { recursive: true, force: true });
  }
});

test("a template vendored from a nested book scaffolds with resolvable styles (no escapes)", async () => {
  const repo = await tmp("gutterpress-vendor-scaffold-repo-");
  const templatesRoot = await tmp("gutterpress-vendor-scaffold-dest-");
  const out = await tmp("gutterpress-vendor-scaffold-out-");
  try {
    const book = await makeRepoWithNestedBook(repo);
    const saved = await saveProjectAsTemplate({ projectDir: book, name: "Portable", templatesRoot });

    // Scaffold the saved template into a fresh, UNRELATED location — the case
    // that used to leave `../../shared/...` dangling.
    const scaffolded = await scaffoldProject({
      name: "New Book",
      parentDir: out,
      templateDir: saved.dir!,
      versionHistory: "none",
    });

    // Every vendored file lands inside the scaffolded project, and the manifest
    // points at them book-local.
    const manifest = await readFile(path.join(scaffolded.projectDir, "manifest.yaml"), "utf8");
    expect(manifest).not.toContain("../");
    expect(
      await readFile(
        path.join(scaffolded.projectDir, "shared", "themes", "publisher", "theme.css"),
        "utf8",
      ),
    ).toBeTruthy();
    expect(
      await readFile(path.join(scaffolded.projectDir, "shared", "fonts", "P.woff2"), "utf8"),
    ).toBeTruthy();
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(templatesRoot, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});

test('saveProjectAsTemplate with sharedRefs:"exclude" drops the escaping entries and copies nothing', async () => {
  const repo = await tmp("gutterpress-exclude-repo-");
  const templatesRoot = await tmp("gutterpress-exclude-dest-");
  try {
    const book = await makeRepoWithNestedBook(repo);

    const saved = await saveProjectAsTemplate({
      projectDir: book,
      name: "Lean Template",
      templatesRoot,
      sharedRefs: "exclude",
    });

    const manifest = await readFile(path.join(saved.dir!, "manifest.yaml"), "utf8");
    expect(manifest).not.toContain("../");
    expect(manifest).not.toContain("shared/"); // nothing vendored
    expect(manifest).toContain("book.css"); // the in-book style survives
    // No shared tree copied in.
    await expect(readdir(path.join(saved.dir!, "shared"))).rejects.toThrow();

    expect(saved.excludedRefs).toContain("../../shared/themes/publisher/theme.css");
    expect(saved.excludedRefs).toContain("../../shared/plugins/components.js");
    expect(saved.vendoredRefs ?? []).toHaveLength(0);
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(templatesRoot, { recursive: true, force: true });
  }
});

test("a self-contained book (no escaping refs) is captured unchanged, no shared/ folder", async () => {
  const project = await tmp("gutterpress-noescape-src-");
  const templatesRoot = await tmp("gutterpress-noescape-dest-");
  try {
    await writeFile(path.join(project, "book.css"), "body{}\n", "utf8");
    await writeFile(path.join(project, "chapter-01.md"), "# One\n", "utf8");
    await writeFile(
      path.join(project, "manifest.yaml"),
      ["title: Solo", "styles:", "  - book.css", ""].join("\n"),
      "utf8",
    );

    const saved = await saveProjectAsTemplate({ projectDir: project, name: "Solo", templatesRoot });

    expect(saved.vendoredRefs ?? []).toHaveLength(0);
    expect(saved.excludedRefs ?? []).toHaveLength(0);
    await expect(readdir(path.join(saved.dir!, "shared"))).rejects.toThrow();
    const manifest = await readFile(path.join(saved.dir!, "manifest.yaml"), "utf8");
    expect(manifest).toContain("book.css");
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(templatesRoot, { recursive: true, force: true });
  }
});
