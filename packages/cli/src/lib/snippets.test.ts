import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  extractVariables,
  substituteVariables,
  listSnippets,
  readSnippet,
  saveSnippet,
  deleteSnippet,
  listMergedSnippets,
  readExtensionSnippet,
  SNIPPETS_DIR,
} from "./snippets.ts";

async function tmpProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "gutterpress-snippets-"));
}

/** Write a project manifest.yaml verbatim — mirrors plugin-manager.test.ts's
 *  own `writeManifest` helper (a literal YAML block per scenario is clearer
 *  here than a builder, matching this file's existing style). */
async function writeManifest(projectDir: string, body: string): Promise<void> {
  await writeFile(path.join(projectDir, "manifest.yaml"), body, "utf8");
}

/** Scaffold a local-plugin extension folder at `plugins/<folderName>/`: a
 *  `gutterpress.json` (with `meta` merged in) plus one `.md` file per entry
 *  in `snippetFiles` under `<meta.snippets ?? "snippets">/`. Does NOT touch
 *  the manifest — callers wire (or omit) the `plugins:` entry themselves so
 *  enabled/disabled and the exact `path:` spelling stay visible at the call
 *  site. */
async function makePluginExtensionFolder(
  projectDir: string,
  folderName: string,
  meta: { name?: string; snippets?: string },
  snippetFiles: Record<string, string>,
): Promise<string> {
  const dir = path.join(projectDir, "plugins", folderName);
  const snippetsRel = meta.snippets ?? "snippets";
  await mkdir(path.join(dir, snippetsRel), { recursive: true });
  // Always declare `snippets` in the written metadata (defaulting to the
  // same folder the files are actually scaffolded into) — a caller that
  // wants "no snippets field at all" writes gutterpress.json directly
  // instead of going through this helper (see the "declares no snippets
  // field" test below).
  await writeFile(
    path.join(dir, "gutterpress.json"),
    JSON.stringify({ ...meta, snippets: snippetsRel }),
    "utf8",
  );
  for (const [fileName, body] of Object.entries(snippetFiles)) {
    await writeFile(path.join(dir, snippetsRel, fileName), body, "utf8");
  }
  return dir;
}

/** Scaffold a PROJECT theme folder at `themes/<id>/` (theme.json + theme.css
 *  + declared snippets/*.md) and wire the manifest's `styles:` so it is the
 *  ACTIVE theme (`getActiveTheme` finds it). */
async function makeActiveThemeFixture(
  projectDir: string,
  id: string,
  meta: { name?: string; snippets?: string },
  snippetFiles: Record<string, string>,
): Promise<void> {
  const dir = path.join(projectDir, "themes", id);
  const snippetsRel = meta.snippets ?? "snippets";
  await mkdir(path.join(dir, snippetsRel), { recursive: true });
  await writeFile(
    path.join(dir, "theme.json"),
    JSON.stringify({ ...meta, snippets: snippetsRel }),
    "utf8",
  );
  await writeFile(path.join(dir, "theme.css"), "/* theme */\n", "utf8");
  for (const [fileName, body] of Object.entries(snippetFiles)) {
    await writeFile(path.join(dir, snippetsRel, fileName), body, "utf8");
  }
  await writeManifest(projectDir, ["styles:", `  - themes/${id}/theme.css`, ""].join("\n"));
}

test("extractVariables finds unique placeholder names in order", () => {
  const tpl = "Hello {{name}}, welcome to {{place}}. Bye {{name}}.";
  expect(extractVariables(tpl)).toEqual(["name", "place"]);
});

test("extractVariables returns [] when there are no placeholders", () => {
  expect(extractVariables("plain text, no vars")).toEqual([]);
});

test("extractVariables trims whitespace inside the braces", () => {
  expect(extractVariables("a {{ first }} b {{second}}")).toEqual([
    "first",
    "second",
  ]);
});

test("substituteVariables replaces every occurrence of a provided key", () => {
  const out = substituteVariables("{{name}} and again {{name}}", {
    name: "Ada",
  });
  expect(out).toBe("Ada and again Ada");
});

test("substituteVariables handles whitespace inside braces", () => {
  expect(substituteVariables("{{ name }}", { name: "Ada" })).toBe("Ada");
});

test("substituteVariables leaves a missing key as an empty string", () => {
  expect(substituteVariables("Hi {{name}}!", {})).toBe("Hi !");
});

test("substituteVariables does not touch non-placeholder braces", () => {
  expect(substituteVariables("a {single} brace", {})).toBe("a {single} brace");
});

test("listSnippets returns [] when there is no snippets folder", async () => {
  const proj = await tmpProject();
  try {
    expect(await listSnippets(proj)).toEqual([]);
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("saveSnippet then listSnippets / readSnippet round-trips", async () => {
  const proj = await tmpProject();
  try {
    await saveSnippet(proj, "Callout", "> **Note:** {{text}}\n");
    await saveSnippet(proj, "Stat Block", "**HP:** {{hp}}\n");

    const list = await listSnippets(proj);
    // Listed names are derived from the filename stem (prettified).
    expect(list.map((s) => s.name).sort()).toEqual(["Callout", "Stat block"]);

    // Each entry carries the variables parsed from its body.
    const callout = list.find((s) => s.name === "Callout")!;
    expect(callout.variables).toEqual(["text"]);

    const body = await readSnippet(proj, callout.fileName);
    expect(body).toContain("{{text}}");

    // Stored under the snippets/ folder as a .md file.
    const onDisk = await readFile(
      path.join(proj, SNIPPETS_DIR, callout.fileName),
      "utf8",
    );
    expect(onDisk).toContain("{{text}}");
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("saveSnippet slugifies the name into a safe .md filename", async () => {
  const proj = await tmpProject();
  try {
    const entry = await saveSnippet(proj, "My Fancy Block!!", "x");
    expect(entry.fileName).toBe("my-fancy-block.md");
    expect(entry.name).toBe("My Fancy Block!!");
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

// Characterization: lock the observable slugify + prettify behaviour of the
// snippet call site across unicode, diacritics, spaces and punctuation so the
// slug/prettify consolidation is proven to change no user-visible filenames.
test("saveSnippet slug/prettify: diacritics, spaces and punctuation", async () => {
  const proj = await tmpProject();
  try {
    const entry = await saveSnippet(proj, "Café  Déjà — Vu!!", "x");
    expect(entry.fileName).toBe("cafe-deja-vu.md");
    // The prettified display name is derived from the slugged stem.
    const [listed] = await listSnippets(proj);
    expect(listed!.name).toBe("Cafe deja vu");
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("saveSnippet rejects a name with no usable characters (empty slug)", async () => {
  const proj = await tmpProject();
  try {
    await expect(saveSnippet(proj, "!!!", "x")).rejects.toThrow();
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("deleteSnippet removes the file", async () => {
  const proj = await tmpProject();
  try {
    const entry = await saveSnippet(proj, "Temp", "x");
    expect((await listSnippets(proj)).length).toBe(1);
    await deleteSnippet(proj, entry.fileName);
    expect((await listSnippets(proj)).length).toBe(0);
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("readSnippet / deleteSnippet refuse path traversal", async () => {
  const proj = await tmpProject();
  try {
    await expect(readSnippet(proj, "../secret.md")).rejects.toThrow();
    await expect(deleteSnippet(proj, "../../etc/passwd")).rejects.toThrow();
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

// ── Extension snippet merge (#242) ──────────────────────────────────────────

test("listMergedSnippets returns exactly the project's own snippets when nothing is installed", async () => {
  const proj = await tmpProject();
  try {
    await saveSnippet(proj, "Callout", "> {{text}}\n");
    const merged = await listMergedSnippets(proj);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      name: "Callout",
      fileName: "callout.md",
      variables: ["text"],
      source: { kind: "project" },
    });
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("listMergedSnippets merges an enabled local-plugin extension's declared snippets, tagged with its name+ref", async () => {
  const proj = await tmpProject();
  try {
    await makePluginExtensionFolder(
      proj,
      "dc-components",
      { name: "Dimm City Components", snippets: "snippets" },
      { "skill-card.md": "**{{name}}**\n" },
    );
    await writeManifest(proj, ["plugins:", "  - path: ./plugins/dc-components", ""].join("\n"));

    const merged = await listMergedSnippets(proj);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      name: "Skill card",
      fileName: "skill-card.md",
      variables: ["name"],
      source: { kind: "plugin", ref: "./plugins/dc-components", name: "Dimm City Components" },
    });
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("listMergedSnippets falls back to a prettified folder name when the extension declares no name", async () => {
  const proj = await tmpProject();
  try {
    await makePluginExtensionFolder(proj, "dc-components", { snippets: "snippets" }, {
      "x.md": "x",
    });
    await writeManifest(proj, ["plugins:", "  - path: ./plugins/dc-components", ""].join("\n"));

    const merged = await listMergedSnippets(proj);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toEqual({
      kind: "plugin",
      ref: "./plugins/dc-components",
      name: "Dc components",
    });
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("listMergedSnippets excludes a DISABLED plugin's snippets (matches: never loaded, never contributes)", async () => {
  const proj = await tmpProject();
  try {
    await makePluginExtensionFolder(
      proj,
      "dc-components",
      { name: "Dimm City Components" },
      { "x.md": "x" },
    );
    await writeManifest(
      proj,
      ["plugins:", "  - path: ./plugins/dc-components", "    enabled: false", ""].join("\n"),
    );

    expect(await listMergedSnippets(proj)).toEqual([]);
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("listMergedSnippets ignores an npm-kind plugin entry (no gutterpress.json is read for name: entries today)", async () => {
  const proj = await tmpProject();
  try {
    // A folder that HAPPENS to sit at the npm package's own name — proves
    // the skip is driven by `kind !== "local"`, not merely "no folder found".
    await mkdir(path.join(proj, "some-npm-pkg", "snippets"), { recursive: true });
    await writeFile(
      path.join(proj, "some-npm-pkg", "gutterpress.json"),
      JSON.stringify({ name: "Should not appear", snippets: "snippets" }),
      "utf8",
    );
    await writeFile(path.join(proj, "some-npm-pkg", "snippets", "x.md"), "x", "utf8");
    await writeManifest(proj, ["plugins:", "  - name: some-npm-pkg", ""].join("\n"));

    expect(await listMergedSnippets(proj)).toEqual([]);
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("listMergedSnippets ignores a plugin folder that declares no snippets field", async () => {
  const proj = await tmpProject();
  try {
    const dir = path.join(proj, "plugins", "styles-only");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "gutterpress.json"),
      JSON.stringify({ name: "Styles Only" }),
      "utf8",
    );
    await writeManifest(proj, ["plugins:", "  - path: ./plugins/styles-only", ""].join("\n"));

    expect(await listMergedSnippets(proj)).toEqual([]);
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("listMergedSnippets includes the ACTIVE theme's snippets", async () => {
  const proj = await tmpProject();
  try {
    await makeActiveThemeFixture(
      proj,
      "dc-theme",
      { name: "Dimm City", snippets: "snippets" },
      { "chapter-opener.md": "# {{title}}\n" },
    );

    const merged = await listMergedSnippets(proj);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      name: "Chapter opener",
      fileName: "chapter-opener.md",
      variables: ["title"],
      source: { kind: "theme", ref: "dc-theme", name: "Dimm City" },
    });
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("listMergedSnippets excludes an INACTIVE theme's snippets (present on disk, not in styles:)", async () => {
  const proj = await tmpProject();
  try {
    // "dormant" is on disk (e.g. kept around for Revert to previous theme)
    // but never referenced from manifest `styles:` — its CSS isn't loaded,
    // so its snippets must not appear either.
    const dormantDir = path.join(proj, "themes", "dormant");
    await mkdir(path.join(dormantDir, "snippets"), { recursive: true });
    await writeFile(
      path.join(dormantDir, "theme.json"),
      JSON.stringify({ name: "Dormant", snippets: "snippets" }),
      "utf8",
    );
    await writeFile(path.join(dormantDir, "theme.css"), "/* dormant */\n", "utf8");
    await writeFile(path.join(dormantDir, "snippets", "x.md"), "x", "utf8");

    // Only the active theme is wired into styles: — dormant is never mentioned.
    await makeActiveThemeFixture(proj, "active", { name: "Active", snippets: "snippets" }, {
      "y.md": "y",
    });

    const merged = await listMergedSnippets(proj);
    expect(merged.map((e) => e.fileName)).toEqual(["y.md"]);
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("listMergedSnippets: project-local wins on a filename collision, case-insensitively; the extension copy is dropped, not renamed", async () => {
  const proj = await tmpProject();
  try {
    await saveSnippet(proj, "Callout", "PROJECT VERSION {{text}}");
    // The extension's own file happens to be spelled with different casing —
    // still the same slug identity, still must collide.
    await makePluginExtensionFolder(
      proj,
      "dc-components",
      { name: "Dimm City Components" },
      { "Callout.md": "EXTENSION VERSION" },
    );
    await writeManifest(proj, ["plugins:", "  - path: ./plugins/dc-components", ""].join("\n"));

    const merged = await listMergedSnippets(proj);
    const calloutEntries = merged.filter((e) => e.fileName.toLowerCase() === "callout.md");
    expect(calloutEntries).toHaveLength(1);
    expect(calloutEntries[0]!.source).toEqual({ kind: "project" });

    const body = await readSnippet(proj, calloutEntries[0]!.fileName);
    expect(body).toContain("PROJECT VERSION");
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("listMergedSnippets groups project-first, then extensions alphabetical by display name", async () => {
  const proj = await tmpProject();
  try {
    await saveSnippet(proj, "Zzz project snippet", "z");
    await makePluginExtensionFolder(proj, "b-ext", { name: "Bravo Extension" }, {
      "p.md": "p",
    });
    await makePluginExtensionFolder(proj, "a-ext", { name: "Alpha Extension" }, {
      "q.md": "q",
    });
    await writeManifest(
      proj,
      [
        "plugins:",
        "  - path: ./plugins/b-ext",
        "  - path: ./plugins/a-ext",
        "",
      ].join("\n"),
    );

    const merged = await listMergedSnippets(proj);
    expect(merged.map((e) => e.source.kind)).toEqual(["project", "plugin", "plugin"]);
    // Alpha sorts before Bravo regardless of manifest declaration order.
    expect(merged[1]!.source).toMatchObject({ name: "Alpha Extension" });
    expect(merged[2]!.source).toMatchObject({ name: "Bravo Extension" });
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("listMergedSnippets tolerates (skips) an extension whose declared snippets path escapes its own folder", async () => {
  const proj = await tmpProject();
  try {
    const dir = path.join(proj, "plugins", "sneaky");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "gutterpress.json"),
      JSON.stringify({ name: "Sneaky", snippets: "../../../etc" }),
      "utf8",
    );
    await writeManifest(proj, ["plugins:", "  - path: ./plugins/sneaky", ""].join("\n"));

    // Must not throw, and must not surface anything from outside the folder.
    await expect(listMergedSnippets(proj)).resolves.toEqual([]);
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("listMergedSnippets stops surfacing an extension's snippets once it is removed from the manifest (#242 removal)", async () => {
  const proj = await tmpProject();
  try {
    await makePluginExtensionFolder(
      proj,
      "dc-components",
      { name: "Dimm City Components" },
      { "x.md": "x" },
    );
    await writeManifest(proj, ["plugins:", "  - path: ./plugins/dc-components", ""].join("\n"));
    expect(await listMergedSnippets(proj)).toHaveLength(1);

    // "Uninstalling" is just removing the manifest entry (and/or the folder);
    // no dedicated cleanup code exists — the merge is recomputed from scratch.
    await writeManifest(proj, "plugins: []\n");
    expect(await listMergedSnippets(proj)).toEqual([]);
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("readExtensionSnippet reads a plugin-sourced entry's body", async () => {
  const proj = await tmpProject();
  try {
    await makePluginExtensionFolder(
      proj,
      "dc-components",
      { name: "Dimm City Components" },
      { "skill-card.md": "**{{name}}**\n" },
    );
    await writeManifest(proj, ["plugins:", "  - path: ./plugins/dc-components", ""].join("\n"));

    const [entry] = await listMergedSnippets(proj);
    if (entry!.source.kind === "project") throw new Error("expected a plugin-sourced entry");
    const body = await readExtensionSnippet(proj, entry!.source, entry!.fileName);
    expect(body).toBe("**{{name}}**\n");
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("readExtensionSnippet reads a theme-sourced entry's body", async () => {
  const proj = await tmpProject();
  try {
    await makeActiveThemeFixture(proj, "dc-theme", { name: "Dimm City" }, {
      "chapter-opener.md": "# {{title}}\n",
    });

    const [entry] = await listMergedSnippets(proj);
    if (entry!.source.kind === "project") throw new Error("expected a theme-sourced entry");
    const body = await readExtensionSnippet(proj, entry!.source, entry!.fileName);
    expect(body).toBe("# {{title}}\n");
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("readExtensionSnippet throws when the extension is no longer installed/active", async () => {
  const proj = await tmpProject();
  try {
    await expect(
      readExtensionSnippet(proj, { kind: "plugin", ref: "./plugins/gone" }, "x.md"),
    ).rejects.toThrow();
    await expect(
      readExtensionSnippet(proj, { kind: "theme", ref: "no-such-theme" }, "x.md"),
    ).rejects.toThrow();
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("readExtensionSnippet refuses path traversal in fileName", async () => {
  const proj = await tmpProject();
  try {
    await makePluginExtensionFolder(
      proj,
      "dc-components",
      { name: "Dimm City Components" },
      { "x.md": "x" },
    );
    await writeManifest(proj, ["plugins:", "  - path: ./plugins/dc-components", ""].join("\n"));

    await expect(
      readExtensionSnippet(
        proj,
        { kind: "plugin", ref: "./plugins/dc-components" },
        "../../../../etc/passwd",
      ),
    ).rejects.toThrow();
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});
