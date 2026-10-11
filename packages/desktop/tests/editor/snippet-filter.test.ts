import { test, expect } from "bun:test";
import type { SnippetEntry } from "../../src/lib/api";
import {
  NO_FILTER,
  filterSnippets,
  firstMatch,
  groupSnippets,
  snippetPreview,
} from "../../src/lib/editor/snippet-filter";

function snip(
  name: string,
  body: string,
  source: SnippetEntry["source"] = { kind: "project" },
  component?: string,
): SnippetEntry {
  return { name, fileName: `${name}.md`, variables: [], body, source, component };
}

const dc = { kind: "extension", ref: "gp-dimm-city@1.0.0", name: "Dimm City" } as const;
const list: SnippetEntry[] = [
  snip("Callout", "> A boxed aside for the reader"),
  snip("Skill", "@skill\n\n## {{name}}\nA trained talent", dc, "skill"),
  snip("Card", "@card heroic\n\nCharacter card body", dc, "card"),
  snip("Chapter opener", "@chapter\n# {{title}}", { kind: "core" }),
];

const names = (es: SnippetEntry[]) => es.map((e) => e.name);

test("no filter returns everything in the original order", () => {
  expect(names(filterSnippets(list, NO_FILTER))).toEqual(["Callout", "Skill", "Card", "Chapter opener"]);
});

test("query matches names case-insensitively and ignores surrounding space", () => {
  expect(names(filterSnippets(list, { ...NO_FILTER, query: "  SKI " }))).toEqual(["Skill"]);
});

test("query also matches the preview text, and the component name", () => {
  expect(names(filterSnippets(list, { ...NO_FILTER, query: "boxed aside" }))).toEqual(["Callout"]);
  expect(names(filterSnippets(list, { ...NO_FILTER, query: "talent" }))).toEqual(["Skill"]);
  expect(names(filterSnippets(list, { ...NO_FILTER, query: "card" }))).toEqual(["Card"]);
});

test("level chip keeps only that level", () => {
  expect(names(filterSnippets(list, { ...NO_FILTER, level: "extension" }))).toEqual(["Skill", "Card"]);
  expect(names(filterSnippets(list, { ...NO_FILTER, level: "core" }))).toEqual(["Chapter opener"]);
  expect(names(filterSnippets(list, { ...NO_FILTER, level: "project" }))).toEqual(["Callout"]);
});

test("components-only keeps component examples and combines with the others", () => {
  expect(names(filterSnippets(list, { ...NO_FILTER, componentsOnly: true }))).toEqual(["Skill", "Card"]);
  expect(
    names(filterSnippets(list, { query: "body", level: "extension", componentsOnly: true })),
  ).toEqual(["Card"]);
  expect(filterSnippets(list, { query: "", level: "core", componentsOnly: true })).toEqual([]);
});

test("no match yields an empty list", () => {
  expect(filterSnippets(list, { ...NO_FILTER, query: "zzz" })).toEqual([]);
});

test("firstMatch is the first entry shown, or undefined", () => {
  expect(firstMatch(list, NO_FILTER)?.name).toBe("Callout");
  expect(firstMatch(list, { ...NO_FILTER, level: "extension" })?.name).toBe("Skill");
  expect(firstMatch(list, { ...NO_FILTER, query: "opener" })?.name).toBe("Chapter opener");
  expect(firstMatch(list, { ...NO_FILTER, query: "zzz" })).toBeUndefined();
});

test("groupSnippets makes one section per level, one per extension", () => {
  const other = snip("Note", "n", { kind: "extension", ref: "other@1", name: "Other" });
  const sections = groupSnippets([...list.slice(0, 3), other, list[3]!]);
  expect(sections.map((s) => [s.key, s.extensionName, names(s.entries)])).toEqual([
    ["project", undefined, ["Callout"]],
    ["extension:gp-dimm-city@1.0.0", "Dimm City", ["Skill", "Card"]],
    ["extension:other@1", "Other", ["Note"]],
    ["core", undefined, ["Chapter opener"]],
  ]);
  expect(groupSnippets([])).toEqual([]);
});

test("snippetPreview skips markers, fences and blanks and strips markdown lead-ins", () => {
  expect(snippetPreview("@skill heroic\n\n## {{name}}\n- first\n- second")).toBe("{{name}} first second");
  expect(snippetPreview("---\n> quoted line")).toBe("quoted line");
});

test("snippetPreview drops emphasis marks, table rules and {.class} attributes", () => {
  expect(snippetPreview("**Note.** Keep short")).toBe("Note. Keep short");
  expect(snippetPreview("| d6 | Item |\n|----|------|\n| 1 | Key |")).toBe("d6 · Item 1 · Key");
  expect(snippetPreview("![{{alt}}](a.png) {.gp-bleed}")).toBe("![{{alt}}](a.png)");
});

test("snippetPreview falls back to the raw body and truncates long text", () => {
  expect(snippetPreview("@page")).toBe("@page");
  expect(snippetPreview("")).toBe("");
  const long = snippetPreview("word ".repeat(100), 20);
  expect(long.length).toBeLessThanOrEqual(21);
  expect(long.endsWith("…")).toBe(true);
});
