import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  extractVariables,
  substituteVariables,
  listSnippets,
  readSnippet,
  saveSnippet,
  deleteSnippet,
  SNIPPETS_DIR,
} from "./snippets.ts";

async function tmpProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "gutterpress-snippets-"));
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
