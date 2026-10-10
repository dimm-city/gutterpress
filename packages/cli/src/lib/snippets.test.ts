import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  extractVariables,
  substituteVariables,
  listSnippets,
  saveSnippet,
  deleteSnippet,
  listMergedSnippets,
  listMarkerComponents,
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
 *  `package.json` (with `meta` merged into its `gutterpress` block) plus one
 *  `.md` file per entry
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
  // wants "no snippets field at all" writes package.json directly
  // instead of going through this helper (see the "declares no snippets
  // field" test below).
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: meta.name, gutterpress: { snippets: snippetsRel } }),
    "utf8",
  );
  for (const [fileName, body] of Object.entries(snippetFiles)) {
    await writeFile(path.join(dir, snippetsRel, fileName), body, "utf8");
  }
  return dir;
}

/** Scaffold a PROJECT look folder at `extensions/<id>/` (package.json + theme.css
 *  + declared snippets/*.md) and wire the manifest's `styles:` so it is the
 *  ACTIVE theme (`getActiveTheme` finds it). */
async function makeActiveThemeFixture(
  projectDir: string,
  id: string,
  meta: { name?: string; snippets?: string },
  snippetFiles: Record<string, string>,
): Promise<void> {
  const dir = path.join(projectDir, "extensions", id);
  const snippetsRel = meta.snippets ?? "snippets";
  await mkdir(path.join(dir, snippetsRel), { recursive: true });
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: meta.name,
      gutterpress: { styles: ["theme.css"], snippets: snippetsRel },
    }),
    "utf8",
  );
  await writeFile(path.join(dir, "theme.css"), "/* theme */\n", "utf8");
  for (const [fileName, body] of Object.entries(snippetFiles)) {
    await writeFile(path.join(dir, snippetsRel, fileName), body, "utf8");
  }
  await writeManifest(projectDir, ["extensions:", `  - ./extensions/${id}`, ""].join("\n"));
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

test("saveSnippet then listSnippets round-trips, bodies included", async () => {
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

    expect(callout.body).toContain("{{text}}");

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

test("deleteSnippet refuses path traversal", async () => {
  const proj = await tmpProject();
  try {
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
    await writeManifest(proj, ["extensions:", "  - ./plugins/dc-components", ""].join("\n"));

    const merged = await listMergedSnippets(proj);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      name: "Skill card",
      fileName: "skill-card.md",
      variables: ["name"],
      source: { kind: "extension", ref: "./plugins/dc-components", name: "Dimm City Components" },
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
    await writeManifest(proj, ["extensions:", "  - ./plugins/dc-components", ""].join("\n"));

    const merged = await listMergedSnippets(proj);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toEqual({
      kind: "extension",
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
      ["extensions:", "  - use: ./plugins/dc-components", "    enabled: false", ""].join("\n"),
    );

    expect(await listMergedSnippets(proj)).toEqual([]);
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("listMergedSnippets ignores an npm-kind plugin entry that is not installed", async () => {
  const proj = await tmpProject();
  try {
    // A folder that HAPPENS to sit at the npm package's own name — proves
    // the skip is driven by the npm entry being uninstalled, not merely "no folder found".
    await mkdir(path.join(proj, "some-npm-pkg", "snippets"), { recursive: true });
    await writeFile(
      path.join(proj, "some-npm-pkg", "package.json"),
      JSON.stringify({ name: "Should not appear", gutterpress: { snippets: "snippets" } }),
      "utf8",
    );
    await writeFile(path.join(proj, "some-npm-pkg", "snippets", "x.md"), "x", "utf8");
    await writeManifest(proj, ["extensions:", "  - some-npm-pkg", ""].join("\n"));

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
      path.join(dir, "package.json"),
      JSON.stringify({ name: "Styles Only", gutterpress: { styles: ["theme.css"] } }),
      "utf8",
    );
    await writeManifest(proj, ["extensions:", "  - ./plugins/styles-only", ""].join("\n"));

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
      source: { kind: "extension", ref: "./extensions/dc-theme", name: "Dimm City" },
    });
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("listMergedSnippets excludes a look that is on disk but not in extensions:", async () => {
  const proj = await tmpProject();
  try {
    // "dormant" is on disk but never listed under `extensions:` — its CSS
    // isn't loaded, so its snippets must not appear either.
    const dormantDir = path.join(proj, "extensions", "dormant");
    await mkdir(path.join(dormantDir, "snippets"), { recursive: true });
    await writeFile(
      path.join(dormantDir, "package.json"),
      JSON.stringify({ name: "Dormant", gutterpress: { styles: ["theme.css"], snippets: "snippets" } }),
      "utf8",
    );
    await writeFile(path.join(dormantDir, "theme.css"), "/* dormant */\n", "utf8");
    await writeFile(path.join(dormantDir, "snippets", "x.md"), "x", "utf8");

    // Only "active" is listed under extensions: — dormant is never mentioned.
    await makeActiveThemeFixture(proj, "active", { name: "Active", snippets: "snippets" }, {
      "y.md": "y",
    });

    const merged = await listMergedSnippets(proj);
    expect(merged.map((e) => e.fileName)).toEqual(["y.md"]);
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("listMergedSnippets keeps same-named snippets from every level, each tagged with its own level", async () => {
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
    await writeManifest(proj, ["extensions:", "  - ./plugins/dc-components", ""].join("\n"));

    const merged = await listMergedSnippets(proj);
    const calloutEntries = merged.filter((e) => e.fileName.toLowerCase() === "callout.md");
    expect(calloutEntries.map((e) => [e.source.kind, e.body])).toEqual([
      ["project", "PROJECT VERSION {{text}}"],
      ["extension", "EXTENSION VERSION"],
    ]);
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
        "extensions:",
        "  - ./plugins/b-ext",
        "  - ./plugins/a-ext",
        "",
      ].join("\n"),
    );

    const merged = await listMergedSnippets(proj);
    expect(merged.map((e) => e.source.kind)).toEqual(["project", "extension", "extension"]);
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
      path.join(dir, "package.json"),
      JSON.stringify({ name: "Sneaky", gutterpress: { snippets: "../../../etc" } }),
      "utf8",
    );
    await writeManifest(proj, ["extensions:", "  - ./plugins/sneaky", ""].join("\n"));

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
    await writeManifest(proj, ["extensions:", "  - ./plugins/dc-components", ""].join("\n"));
    expect(await listMergedSnippets(proj)).toHaveLength(1);

    // "Uninstalling" is just removing the manifest entry (and/or the folder);
    // no dedicated cleanup code exists — the merge is recomputed from scratch.
    await writeManifest(proj, "plugins: []\n");
    expect(await listMergedSnippets(proj)).toEqual([]);
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("listMergedSnippets entries carry their body, for plugin and theme snippets alike", async () => {
  const proj = await tmpProject();
  try {
    await makePluginExtensionFolder(
      proj,
      "dc-components",
      { name: "Dimm City Components" },
      { "skill-card.md": "**{{name}}**\n" },
    );
    await writeManifest(proj, ["extensions:", "  - ./plugins/dc-components", ""].join("\n"));
    expect((await listMergedSnippets(proj))[0]!.body).toBe("**{{name}}**\n");
  } finally {
    await rm(proj, { recursive: true, force: true });
  }

  const themed = await tmpProject();
  try {
    await makeActiveThemeFixture(themed, "dc-theme", { name: "Dimm City" }, {
      "chapter-opener.md": "# {{title}}\n",
    });
    expect((await listMergedSnippets(themed))[0]!.body).toBe("# {{title}}\n");
  } finally {
    await rm(themed, { recursive: true, force: true });
  }
});

// ── listMarkerComponents ────────────────────────────────────────────────────

/** A plugin extension folder whose `plugin.js` declares `markersSource` (a JS object literal). */
async function makeComponentPlugin(
  projectDir: string,
  folderName: string,
  markersSource: string,
  files: Record<string, string>,
  gutterpress: Record<string, unknown> = { snippets: "snippets" },
): Promise<void> {
  const dir = path.join(projectDir, "plugins", folderName);
  await mkdir(dir, { recursive: true });
  // The loader requires a declared snippets folder to exist.
  if (typeof gutterpress.snippets === "string") await mkdir(path.join(dir, gutterpress.snippets), { recursive: true });
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: folderName, main: "plugin.js", gutterpress }),
    "utf8",
  );
  await writeFile(
    path.join(dir, "plugin.js"),
    `export default function () {}\nexport const markers = ${markersSource};\n`,
    "utf8",
  );
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), body, "utf8");
  }
}

test("listMarkerComponents links each marker to its snippet: default name, explicit path, or none", async () => {
  const proj = await tmpProject();
  try {
    await makeComponentPlugin(
      proj,
      "boxes",
      `{
        "term-box": {},
        figure: { snippet: "examples/figure.md" },
        bare: {},
        escape: { snippet: "../outside.md" },
        tip: { alias: "term-box" },
        old: { deprecated: "gone" },
      }`,
      {
        "snippets/term-box.md": "@term-box\n{{body}}\n@end-term-box\n",
        "examples/figure.md": "@figure\n![alt](src.png)\n@end-figure\n",
      },
    );
    await writeFile(path.join(proj, "plugins", "outside.md"), "nope", "utf8");
    await writeManifest(proj, ["extensions:", "  - ./plugins/boxes", ""].join("\n"));

    const source = { kind: "extension" as const, ref: "./plugins/boxes", name: "Boxes" };
    expect(await listMarkerComponents(proj)).toEqual([
      { name: "bare", source, variants: [] },
      { name: "escape", source, variants: [] },
      { name: "figure", source, variants: [], snippet: "@figure\n![alt](src.png)\n@end-figure\n" },
      { name: "term-box", source, variants: [], snippet: "@term-box\n{{body}}\n@end-term-box\n" },
      { name: "tip", source, variants: [] },
    ]);
    // Each component snippet is listed once, tagged — including the one at
    // an explicit path outside the snippets folder.
    expect((await listMergedSnippets(proj)).map((e) => [e.fileName, e.component])).toEqual([
      ["examples/figure.md", "figure"],
      ["term-box.md", "term-box"],
    ]);
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("listMarkerComponents defaults to snippets/ when the extension declares no snippets folder", async () => {
  const proj = await tmpProject();
  try {
    await makeComponentPlugin(proj, "boxes", `{ box: {} }`, { "snippets/box.md": "@box\n@end-box\n" }, {});
    await writeManifest(proj, ["extensions:", "  - ./plugins/boxes", ""].join("\n"));
    const [box] = await listMarkerComponents(proj);
    expect(box).toEqual({ name: "box", source: expect.anything(), variants: [], snippet: "@box\n@end-box\n" });
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("listMarkerComponents skips disabled extensions and tolerates one that fails to load", async () => {
  const proj = await tmpProject();
  try {
    await makeComponentPlugin(proj, "off", `{ off: {} }`, {});
    await makeComponentPlugin(proj, "good", `{ good: {} }`, {});
    await mkdir(path.join(proj, "plugins", "broken"), { recursive: true });
    await writeFile(
      path.join(proj, "plugins", "broken", "package.json"),
      JSON.stringify({ name: "broken", main: "plugin.js" }),
      "utf8",
    );
    await writeFile(path.join(proj, "plugins", "broken", "plugin.js"), "throw new Error('nope');\n", "utf8");
    await writeManifest(
      proj,
      [
        "extensions:",
        "  - use: ./plugins/off",
        "    enabled: false",
        "  - ./plugins/broken",
        "  - ./plugins/good",
        "",
      ].join("\n"),
    );
    expect((await listMarkerComponents(proj)).map((c) => c.name)).toEqual(["good"]);
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("the book's snippets/<component>.md wins over the extension's, and both stay listed", async () => {
  const proj = await tmpProject();
  try {
    await makeComponentPlugin(proj, "boxes", `{ "term-box": {} }`, {
      "snippets/term-box.md": "@term-box\nEXTENSION\n@end-term-box\n",
    });
    await saveSnippet(proj, "Term box", "@term-box\nBOOK\n@end-term-box\n");
    await writeManifest(proj, ["extensions:", "  - ./plugins/boxes", ""].join("\n"));

    const [component] = await listMarkerComponents(proj);
    expect(component!.snippet).toContain("BOOK");
    expect((await listMergedSnippets(proj)).map((e) => [e.source.kind, e.component, e.body.split("\n")[1]])).toEqual([
      ["project", "term-box", "BOOK"],
      ["extension", "term-box", "EXTENSION"],
    ]);
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("listMarkerComponents lists each component's resolved variants; an alias inherits its target's", async () => {
  const proj = await tmpProject();
  try {
    await makeComponentPlugin(
      proj,
      "boxes",
      `{
        skill: { class: "dc-skill", variants: { highlight: "dc-skill-highlight", muted: "dc-skill-muted" } },
        ability: { alias: "skill", preset: { variant: "highlight" } },
        plain: {},
        old: { deprecated: "use skill" },
      }`,
      {},
    );
    await writeManifest(proj, ["extensions:", "  - ./plugins/boxes", ""].join("\n"));
    expect((await listMarkerComponents(proj)).map((c) => [c.name, c.variants])).toEqual([
      ["ability", ["highlight", "muted"]],
      ["plain", []],
      ["skill", ["highlight", "muted"]],
    ]);
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test("listMarkerComponents lists no components when two plugins declare the same marker, but still lists snippets", async () => {
  const proj = await tmpProject();
  try {
    await makeComponentPlugin(proj, "one", `{ box: {} }`, { "snippets/box.md": "@box\n@end-box\n" });
    await makeComponentPlugin(proj, "two", `{ box: {} }`, {});
    await writeManifest(proj, ["extensions:", "  - ./plugins/one", "  - ./plugins/two", ""].join("\n"));
    expect(await listMarkerComponents(proj)).toEqual([]);
    expect((await listMergedSnippets(proj)).map((e) => [e.fileName, e.component])).toEqual([["box.md", undefined]]);
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});
