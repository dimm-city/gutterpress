/**
 * class-completions — `.class` autocomplete after a dot on a marker line and
 * inside attribute braces. Each context is tested as a pure function and then
 * through the CodeMirror source with a real markdown syntax tree.
 */
import { describe, expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { CompletionContext } from "@codemirror/autocomplete";
import type { ClassCatalogEntry } from "../../src/lib/api";
import { classCompletionSource, classContextAt, classOptions } from "../../src/lib/editor/class-completions";
import { CORE_CLASSES } from "../../src/lib/editor/core-classes";

const dc = { kind: "extension" as const, ref: "gp-dimm-city@1.6.2", name: "Dimm City" };
const catalog: ClassCatalogEntry[] = [
  { class: "dc-avoid-split", modifier: true, appliesTo: ["section", "skill"], label: "Avoid split", description: "break-inside: avoid — the section or card moves to the next page.", source: dc },
  { class: "dc-snug", modifier: true, appliesTo: ["section", "page"], label: "Snug", description: "Paragraph margins drop so a long section fits.", source: dc },
  { class: "dc-chevron", appliesTo: [], label: "Chevron", description: "A chevron title bar.", source: dc },
  { class: "dc-highlight", appliesTo: ["skill"], label: "Skill", source: dc },
  { class: "my-note", appliesTo: [], source: { kind: "book" } },
  { class: "gp-right", appliesTo: [], source: { kind: "book" } },
];

/** `caret` marks the cursor in `doc`. */
function ctx(doc: string) {
  const col = doc.indexOf("|");
  const text = doc.replace("|", "");
  return classContextAt(text, col === -1 ? text.length : col);
}

describe("classContextAt: marker lines", () => {
  test("after a dot that starts a word", () => {
    expect(ctx("@section .|")).toEqual({ kind: "marker", marker: "section", from: 10, dot: true });
    expect(ctx("@section .dc-sn|")).toEqual({ kind: "marker", marker: "section", from: 10, dot: true });
    expect(ctx("@skill card #id .|")).toMatchObject({ kind: "marker", marker: "skill", dot: true });
    expect(ctx("  @gear weapon label=Sword .gp|")).toMatchObject({ kind: "marker", marker: "gear" });
  });

  test("the word's start is where the replacement begins", () => {
    expect(ctx("@section .dc-sn|")!.from).toBe("@section .".length);
  });

  test("not after a bare word, an id, or a dot inside a token", () => {
    expect(ctx("@section card|")).toBeNull();
    expect(ctx("@section #id|")).toBeNull();
    expect(ctx("@section a.b|")).toBeNull();
    expect(ctx("@section|")).toBeNull();
  });

  test("not inside a quoted value", () => {
    expect(ctx('@gear label="a .|')).toBeNull();
    expect(ctx('@gear label="a .b" .|')).toMatchObject({ kind: "marker" });
  });

  test("closers, breaks and continue take no classes", () => {
    for (const m of ["@end-section", "@page-break", "@column-break", "@continue"]) expect(ctx(`${m} .|`)).toBeNull();
  });

  test("not on ordinary text", () => {
    expect(ctx("Some text .|")).toBeNull();
    expect(ctx("see v1.2.|")).toBeNull();
    expect(ctx("| a.b |")).toBeNull();
  });
});

describe("classContextAt: attribute braces", () => {
  test("inside braces on a marker line", () => {
    expect(ctx("@section {.|")).toEqual({ kind: "marker", marker: "section", from: 11, dot: true });
    expect(ctx("@section {.a .dc-|")).toMatchObject({ kind: "marker", dot: true });
    expect(ctx("@section {.a .b|}")).toMatchObject({ kind: "marker", dot: true });
  });

  test("on an image", () => {
    expect(ctx("![Art](a.png){.|")).toEqual({ kind: "image", from: 15, dot: true });
    expect(ctx("![Art](a.png){.gp-sm|}")).toMatchObject({ kind: "image", from: 15 });
    expect(ctx("text ![Art](a.png) {.|")).toMatchObject({ kind: "image" });
  });

  test("on any other element", () => {
    expect(ctx("## Title {.|")).toEqual({ kind: "brace", from: 11, dot: true });
    expect(ctx("> quote {.dc-|")).toMatchObject({ kind: "brace" });
    expect(ctx("- item {#id .|")).toMatchObject({ kind: "brace" });
    expect(ctx("[link](x){.|")).toMatchObject({ kind: "brace" });
  });

  test("only for a word that starts with a dot, unless nothing is typed yet", () => {
    expect(ctx("## Title {id|")).toMatchObject({ dot: false, from: 10 });
    expect(ctx("## Title {|")).toMatchObject({ dot: false, from: 10 });
    expect(ctx("## Title {key=va|")).toBeNull();
    expect(ctx('## Title {width="3|')).toBeNull();
  });

  test("closed braces, snippet placeholders and a stray brace do not count", () => {
    expect(ctx("## Title {.a} .|")).toBeNull();
    expect(ctx("{{name}} .|")).toBeNull();
    expect(ctx("{{na|")).toBeNull();
    expect(ctx("a } .|")).toBeNull();
  });

  test("a second group after a closed one works", () => {
    expect(ctx("## T {.a}{.|")).toMatchObject({ kind: "brace", dot: true });
  });
});

describe("classOptions", () => {
  const labels = (o: ReturnType<typeof classOptions>) => o.map((x) => x.label);

  test("core, plugin and book classes, one entry per name (core wins over a repeat)", () => {
    const o = classOptions({ kind: "marker", marker: "section", dot: true }, catalog);
    const names = labels(o);
    expect(names).toContain("gp-no-break");
    expect(names).toContain("dc-avoid-split");
    expect(names).toContain("my-note");
    expect(names.filter((n) => n === "gp-right")).toHaveLength(1);
    expect(o.find((x) => x.label === "gp-right")!.detail).toContain("core");
  });

  test("a suggestion shows its one-line description and where it comes from", () => {
    const o = classOptions({ kind: "marker", marker: "section", dot: true }, catalog);
    expect(o.find((x) => x.label === "dc-snug")!.detail).toBe(
      "Paragraph margins drop so a long section fits. · Dimm City",
    );
    expect(o.find((x) => x.label === "gp-no-break")!.detail).toContain("Keep this block whole");
    expect(o.find((x) => x.label === "my-note")!.detail).toBe("your stylesheet");
    expect(o.find((x) => x.label === "dc-highlight")!.detail).toBe("Dimm City");
  });

  test("on a marker line, classes documented for that marker come first, then other modifiers", () => {
    const sorted = (kind: Parameters<typeof classOptions>[0]) =>
      classOptions(kind, catalog).sort((a, b) => (b.boost ?? 0) - (a.boost ?? 0)).map((x) => x.label);
    const forSkill = sorted({ kind: "marker", marker: "skill", dot: true });
    expect(forSkill.indexOf("dc-avoid-split")).toBeLessThan(forSkill.indexOf("dc-snug"));
    expect(forSkill.indexOf("dc-highlight")).toBeLessThan(forSkill.indexOf("gp-no-break"));
    expect(forSkill.indexOf("gp-no-break")).toBeLessThan(forSkill.indexOf("gp-right"));
  });

  test("on an image, the image vocabulary leads", () => {
    const o = classOptions({ kind: "image", dot: true }, catalog).sort((a, b) => (b.boost ?? 0) - (a.boost ?? 0));
    expect(labels(o).indexOf("gp-right")).toBeLessThan(labels(o).indexOf("gp-no-break"));
    expect(labels(o).indexOf("gp-no-break")).toBeLessThan(labels(o).indexOf("dc-chevron"));
  });

  test("everything in core's offered vocabulary is listed", () => {
    const names = labels(classOptions({ kind: "brace", dot: true }, []));
    expect(names).toEqual(CORE_CLASSES.map((c) => c.class));
  });

  test("without a typed dot the dot is part of what gets inserted", () => {
    const o = classOptions({ kind: "brace", dot: false }, catalog);
    expect(o.find((x) => x.label === "dc-snug")!.apply).toBe(".dc-snug");
    expect(classOptions({ kind: "brace", dot: true }, catalog).every((x) => x.apply === undefined)).toBe(true);
  });
});

describe("classCompletionSource", () => {
  function complete(doc: string, explicit = false, list: readonly ClassCatalogEntry[] = catalog) {
    const text = doc.replace("|", "");
    const pos = doc.includes("|") ? doc.indexOf("|") : text.length;
    const state = EditorState.create({ doc: text, extensions: [markdown({ codeLanguages: languages })] });
    return classCompletionSource(() => list)(new CompletionContext(state, pos, explicit));
  }

  test("offers on a marker line and inside braces, replacing from after the dot", () => {
    const r = complete("@section card .dc-s|");
    expect(r!.from).toBe("@section card .".length);
    expect(r!.options.map((o) => o.label)).toContain("dc-snug");
    expect(complete("![a](b.png){.gp-|")!.from).toBe("![a](b.png){.".length);
    expect(complete("## Title {.|")!.options.length).toBeGreaterThan(CORE_CLASSES.length - 1);
  });

  test("works on a later line of a document", () => {
    const r = complete("# Title\n\n@section .|\n\nText\n");
    expect(r!.from).toBe("# Title\n\n@section .".length);
  });

  test("nothing without a dot unless asked (Ctrl+Space), and then the dot is inserted", () => {
    expect(complete("## Title {|")).toBeNull();
    const r = complete("## Title {|", true)!;
    expect(r.options.find((o) => o.label === "dc-snug")!.apply).toBe(".dc-snug");
  });

  test("nothing on ordinary text, and nothing for the @ sources' triggers", () => {
    expect(complete("Some text .")).toBeNull();
    expect(complete("@sec")).toBeNull();
    expect(complete("@page ")).toBeNull();
    expect(complete("@")).toBeNull();
  });

  test("nothing inside code, where a brace is code", () => {
    expect(complete("```css\na {.|\n```\n")).toBeNull();
    expect(complete("Use `{.|` here")).toBeNull();
    expect(complete("    a {.|")).toBeNull();
  });

  test("core's vocabulary is offered with an empty catalog, and a refreshed catalog needs no rebuild", () => {
    expect(complete("@section .|", false, [])!.options.map((o) => o.label)).toEqual(CORE_CLASSES.map((c) => c.class));
    let list: readonly ClassCatalogEntry[] = [];
    const source = classCompletionSource(() => list);
    const state = EditorState.create({ doc: "@section .", extensions: [markdown()] });
    const ask = () => source(new CompletionContext(state, 10, false))!.options.map((o) => o.label);
    expect(ask()).not.toContain("dc-snug");
    list = catalog;
    expect(ask()).toContain("dc-snug");
  });

  test("validFor keeps the list while a class name is typed", () => {
    const r = complete("@section .|")!;
    expect(r.validFor).toBeInstanceOf(RegExp);
    expect((r.validFor as RegExp).test("dc-sn")).toBe(true);
    expect((r.validFor as RegExp).test("dc sn")).toBe(false);
  });
});
