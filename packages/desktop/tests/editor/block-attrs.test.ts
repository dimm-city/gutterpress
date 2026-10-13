/**
 * block-attrs — token-preserving marker-block editing: classes, break before,
 * columns. Every expectation is written against whole documents so a stray
 * byte anywhere fails, and the rendered-HTML checks at the bottom confirm the
 * edited lines still mean what the dialog said (the real core renderer).
 */
import { describe, expect, test } from "bun:test";
import { createMarkdownRenderer } from "gutterpress/render";

import {
  columnsLineCount,
  markerLineClasses,
  markerLineHasClass,
  parseMarkerLine,
  planBlockEdit,
  readBlock,
  setColumnsLineCount,
  setMarkerLineClass,
  type BlockChanges,
  type BlockOptions,
  type LinePatch,
} from "../../src/lib/editor/block-attrs";
import { buildLineStarts, charRange } from "../../src/lib/editor/source-range";

/** Apply a line patch the way the commit engine does (checking `expected`). */
function applyPatch(source: string, patch: LinePatch | null): string {
  if (!patch) return source;
  const [from, to] = charRange(source, buildLineStarts(source), patch.range);
  expect(source.slice(from, to)).toBe(patch.expected);
  return source.slice(0, from) + patch.replacement + source.slice(to);
}

function edit(source: string, line: number, changes: BlockChanges, opts?: BlockOptions): string {
  const result = planBlockEdit(source, line, changes, opts);
  if (!result.ok) throw new Error(result.reason);
  return applyPatch(source, result.patch);
}

describe("parseMarkerLine", () => {
  test("splits like core's parser: quotes keep spaces, offsets index the original text", () => {
    const line = '@gear weapon #sword label="Long sword" .dc-snug';
    const m = parseMarkerLine(line)!;
    expect(m.name).toBe("gear");
    expect(m.tokens.map((t) => line.slice(t.start, t.end))).toEqual([
      "weapon", "#sword", 'label="Long sword"', ".dc-snug",
    ]);
  });

  test("an apostrophe opens a quote the same way core's tokenizer does", () => {
    const m = parseMarkerLine("@section it's fine .x")!;
    expect(m.tokens.map((t) => "@section it's fine .x".slice(t.start, t.end))).toEqual(["it's fine .x"]);
  });

  test("brace groups: the body excludes one leading { and one trailing }", () => {
    const line = "@section {.a .b}";
    const m = parseMarkerLine(line)!;
    expect(m.tokens.map((t) => [line.slice(t.bodyStart, t.bodyEnd), t.opens, t.closes])).toEqual([
      [".a", true, false],
      [".b", false, true],
    ]);
  });

  test("not markers: prose, an empty @, a name with odd characters", () => {
    expect(parseMarkerLine("hello @section")).toBeNull();
    expect(parseMarkerLine("@")).toBeNull();
    expect(parseMarkerLine("@section{.a}")).toBeNull();
    expect(parseMarkerLine("@1abc")).toBeNull();
  });

  test("leading indentation is allowed, as in core", () => {
    expect(parseMarkerLine("   @page")!.name).toBe("page");
  });
});

describe("markerLineClasses", () => {
  test("reads compact, brace and class= spellings in order", () => {
    expect(markerLineClasses("@section card .a {.b .c} class=d,e")).toEqual(["a", "b", "c", "d", "e"]);
    expect(markerLineClasses('@section class="x y"')).toEqual(["x", "y"]);
  });

  test("ids, key=value, labels and the variant word are not classes", () => {
    expect(markerLineClasses('@skill panel #id key=val label="a .b c"')).toEqual([]);
  });

  test("markerLineHasClass is exact, not a prefix match", () => {
    expect(markerLineHasClass("@section .dc-snug-extra", "dc-snug")).toBe(false);
    expect(markerLineHasClass("@section .dc-snug", "dc-snug")).toBe(true);
  });
});

describe("setMarkerLineClass: adding", () => {
  test("appends after the last token, leaving everything else byte-for-byte", () => {
    expect(setMarkerLineClass('@gear weapon #sword label="Long sword" key=v', "dc-snug", true)).toBe(
      '@gear weapon #sword label="Long sword" key=v .dc-snug',
    );
  });

  test("a bare marker gets the class right after the head", () => {
    expect(setMarkerLineClass("@skill", "dc-avoid-split", true)).toBe("@skill .dc-avoid-split");
  });

  test("trailing whitespace stays where it was", () => {
    expect(setMarkerLineClass("@section .a   ", "b", true)).toBe("@section .a .b   ");
  });

  test("a line that ends a brace group keeps writing braces: the class goes inside", () => {
    expect(setMarkerLineClass("@section card {.a .b}", "c", true)).toBe("@section card {.a .b .c}");
    expect(setMarkerLineClass("@section {.a}", "c", true)).toBe("@section {.a .c}");
  });

  test("a compact line stays compact when braces appear only earlier", () => {
    expect(setMarkerLineClass("@section {.a} #x", "c", true)).toBe("@section {.a} #x .c");
  });

  test("adding a class already written (either spelling) changes nothing", () => {
    for (const line of ["@section .c", "@section {.a .c}", "@section class=c,d", '@section class="d c"']) {
      expect(setMarkerLineClass(line, "c", true)).toBe(line);
    }
  });

  test("indentation survives", () => {
    expect(setMarkerLineClass("  @page intro", "dc-snug", true)).toBe("  @page intro .dc-snug");
  });

  test("a non-identifier class is refused", () => {
    expect(setMarkerLineClass("@section", "a b", true)).toBe("@section");
    expect(setMarkerLineClass("@section", "", true)).toBe("@section");
  });

  test("a non-marker line is returned untouched", () => {
    expect(setMarkerLineClass("plain text", "a", true)).toBe("plain text");
  });
});

describe("setMarkerLineClass: removing", () => {
  test("removes a compact class with the space before it", () => {
    expect(setMarkerLineClass("@section card .a .b #x", "a", false)).toBe("@section card .b #x");
    expect(setMarkerLineClass("@section .a", "a", false)).toBe("@section");
  });

  test("removes a whole {.cls} group", () => {
    expect(setMarkerLineClass("@skill {.dc-avoid-split}", "dc-avoid-split", false)).toBe("@skill");
    expect(setMarkerLineClass("@skill x {.dc-avoid-split} #y", "dc-avoid-split", false)).toBe("@skill x #y");
  });

  test("removes one class from a multi-class group and keeps the braces", () => {
    expect(setMarkerLineClass("@section {.a .b .c}", "a", false)).toBe("@section {.b .c}");
    expect(setMarkerLineClass("@section {.a .b .c}", "b", false)).toBe("@section {.a .c}");
    expect(setMarkerLineClass("@section {.a .b .c}", "c", false)).toBe("@section {.a .b}");
    expect(setMarkerLineClass("@section {.a .b}", "b", false)).toBe("@section {.a}");
  });

  test("removes a class from class= and drops the attribute when it empties", () => {
    expect(setMarkerLineClass("@section class=a,b,c", "b", false)).toBe("@section class=a,c");
    expect(setMarkerLineClass("@section class=a,b", "a", false)).toBe("@section class=b");
    expect(setMarkerLineClass('@section class="a b" #x', "a", false)).toBe('@section class="b" #x');
    expect(setMarkerLineClass("@section class=a #x", "a", false)).toBe("@section #x");
  });

  test("removes every spelling when the class is written twice", () => {
    expect(setMarkerLineClass("@section .a {.a .b} class=a,c", "a", false)).toBe("@section {.b} class=c");
  });

  test("removing a class that is not there changes nothing, and never matches a longer name", () => {
    expect(setMarkerLineClass("@section .dc-snug-extra", "dc-snug", false)).toBe("@section .dc-snug-extra");
    expect(setMarkerLineClass("@section card", "dc-snug", false)).toBe("@section card");
  });

  test("ids, key=value, quoted labels and the variant word are untouched", () => {
    const line = '@gear weapon #sword label="Long sword .dc-snug" tier=2 .dc-snug .keep';
    expect(setMarkerLineClass(line, "dc-snug", false)).toBe(
      '@gear weapon #sword label="Long sword .dc-snug" tier=2 .keep',
    );
  });

  test("add then remove is the identity for every spelling", () => {
    for (const line of [
      "@section",
      "@section card .x",
      "@section {.x .y}",
      "@section #id key=val",
      '@gear weapon label="a b"',
      "@section {.x} #id",
      "  @page intro  ",
    ]) {
      expect(setMarkerLineClass(setMarkerLineClass(line, "dc-snug", true), "dc-snug", false)).toBe(line);
    }
  });

  test("toggling is idempotent", () => {
    const on = setMarkerLineClass("@section card", "k", true);
    expect(setMarkerLineClass(on, "k", true)).toBe(on);
    const off = setMarkerLineClass(on, "k", false);
    expect(setMarkerLineClass(off, "k", false)).toBe(off);
  });
});

describe("@columns count", () => {
  test("reads the bare word; bare @columns is 2; anything else is unknown", () => {
    expect(columnsLineCount("@columns 3")).toBe(3);
    expect(columnsLineCount("@columns")).toBe(2);
    expect(columnsLineCount("@columns .wide")).toBe(2);
    expect(columnsLineCount("@columns 9")).toBeNull();
    expect(columnsLineCount("@columns wide")).toBeNull();
    expect(columnsLineCount("@section 3")).toBeNull();
  });

  test("changes only the count, keeping classes, ids and brace groups", () => {
    expect(setColumnsLineCount("@columns 2", 3)).toBe("@columns 3");
    expect(setColumnsLineCount("@columns 2 .wide #cols", 4)).toBe("@columns 4 .wide #cols");
    expect(setColumnsLineCount("@columns {.wide}", 3)).toBe("@columns 3 {.wide}");
    expect(setColumnsLineCount("@columns .wide", 5)).toBe("@columns 5 .wide");
  });

  test("setting the count it already has leaves a bare @columns bare", () => {
    expect(setColumnsLineCount("@columns", 2)).toBe("@columns");
    expect(setColumnsLineCount("@columns 3", 3)).toBe("@columns 3");
  });

  test("an out-of-range count is refused", () => {
    expect(setColumnsLineCount("@columns 2", 7)).toBe("@columns 2");
  });
});

describe("readBlock", () => {
  const doc = [
    "# Title",
    "",
    "@page-break",
    "",
    '@skill .dc-snug label="Fireball"',
    "",
    "Body.",
    "",
    "@end-skill",
    "",
  ].join("\n");

  test("reads classes, break and the end line for a marker", () => {
    const info = readBlock(doc, 4)!;
    expect(info.name).toBe("skill");
    expect(info.classes).toEqual(["dc-snug"]);
    expect(info.breakBefore).toBe(true);
    expect(info.columns).toEqual({ kind: "none" });
  });

  test("not blocks: text, closers, breaks, continue, lines out of range", () => {
    expect(readBlock(doc, 0)).toBeNull();
    expect(readBlock(doc, 2)).toBeNull();
    expect(readBlock(doc, 8)).toBeNull();
    expect(readBlock("@continue\n", 0)).toBeNull();
    expect(readBlock(doc, 99)).toBeNull();
    expect(readBlock(doc, -1)).toBeNull();
  });

  test("a marker inside a code fence is not a block", () => {
    const fenced = "```md\n@section .x\n@end-section\n```\n@section\n@end-section\n";
    expect(readBlock(fenced, 1)).toBeNull();
    expect(readBlock(fenced, 4)).not.toBeNull();
  });

  test("a @page-break inside a fence does not count as a break before", () => {
    const fenced = "```\n@page-break\n```\n@section\n@end-section\n";
    expect(readBlock(fenced, 3)!.breakBefore).toBe(false);
  });

  test("columns are unavailable without an @end line, for a self-closing marker, and on @columns itself", () => {
    expect(readBlock("@section\n\ntext\n", 0)!.columns).toMatchObject({ kind: "unavailable" });
    expect(readBlock("@page\n\ntext\n", 0)!.columns).toMatchObject({ kind: "unavailable" });
    expect(readBlock("@tape\n", 0, { selfClosing: true })!.columns).toMatchObject({ kind: "unavailable" });
    expect(readBlock("@columns 2\n\ntext\n\n@end-columns\n", 0)!.columns).toMatchObject({ kind: "unavailable" });
  });

  test("nested blocks of the same name pair up", () => {
    const nested = "@section\n@section\ninner\n@end-section\nouter\n@end-section\n";
    expect(readBlock(nested, 0)!.columns).toEqual({ kind: "none" });
    // the inner block closes on line 3, so its content is just "inner"
    expect(readBlock(nested, 1)!.columns).toEqual({ kind: "none" });
  });

  test("columns: wrapped, with its count; partial when a run does not cover the content", () => {
    expect(readBlock("@section\n\n@columns 3\n\ntext\n\n@end-columns\n\n@end-section\n", 0)!.columns).toEqual({
      kind: "wrapped",
      count: 3,
    });
    expect(readBlock("@section\n@columns\ntext\n@end-columns\n@end-section\n", 0)!.columns).toEqual({
      kind: "wrapped",
      count: 2,
    });
    expect(readBlock("@section\nintro\n@columns 2\ntext\n@end-columns\n@end-section\n", 0)!.columns).toEqual({
      kind: "partial",
    });
    expect(readBlock("@section\n@columns 2\ntext\n@end-columns\ntail\n@end-section\n", 0)!.columns).toEqual({
      kind: "partial",
    });
  });
});

describe("planBlockEdit: classes", () => {
  const doc = "# Title\n\n@section card .dc-snug\n\nBody.\n\n@end-section\n";

  test("toggles only the marker line", () => {
    expect(edit(doc, 2, { classes: { "dc-avoid-split": true } })).toBe(
      "# Title\n\n@section card .dc-snug .dc-avoid-split\n\nBody.\n\n@end-section\n",
    );
    expect(edit(doc, 2, { classes: { "dc-snug": false } })).toBe(
      "# Title\n\n@section card\n\nBody.\n\n@end-section\n",
    );
  });

  test("several classes in one confirm", () => {
    expect(edit(doc, 2, { classes: { "dc-snug": false, a: true, b: true } })).toBe(
      "# Title\n\n@section card .a .b\n\nBody.\n\n@end-section\n",
    );
  });

  test("the patch is the one marker line", () => {
    const r = planBlockEdit(doc, 2, { classes: { x: true } });
    expect(r.ok && r.patch).toEqual({
      range: [2, 3],
      expected: "@section card .dc-snug\n",
      replacement: "@section card .dc-snug .x\n",
    });
  });

  test("confirming with nothing changed writes nothing", () => {
    expect(planBlockEdit(doc, 2, {})).toEqual({ ok: true, patch: null });
    expect(planBlockEdit(doc, 2, { classes: { "dc-snug": true } })).toEqual({ ok: true, patch: null });
    expect(planBlockEdit(doc, 2, { classes: { nope: false } })).toEqual({ ok: true, patch: null });
    expect(planBlockEdit(doc, 2, { breakBefore: false, columns: null })).toEqual({ ok: true, patch: null });
  });

  test("CRLF files keep their line breaks", () => {
    const crlf = "@section\r\n\r\ntext\r\n\r\n@end-section\r\n";
    const out = edit(crlf, 0, { classes: { k: true }, breakBefore: true });
    expect(out).toBe("@page-break\r\n\r\n@section .k\r\n\r\ntext\r\n\r\n@end-section\r\n");
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
  });

  test("a line that is not a marker is an error, not a guess", () => {
    expect(planBlockEdit(doc, 0, { classes: { x: true } })).toEqual({ ok: false, reason: "This line is not a marker." });
  });
});

describe("planBlockEdit: break before", () => {
  test("inserts @page-break and a blank line directly above the block", () => {
    expect(edit("Text.\n\n@section\nbody\n@end-section\n", 2, { breakBefore: true })).toBe(
      "Text.\n\n@page-break\n\n@section\nbody\n@end-section\n",
    );
  });

  test("works on the first line of a file and on a file with no trailing newline", () => {
    expect(edit("@section\nbody\n@end-section\n", 0, { breakBefore: true })).toBe(
      "@page-break\n\n@section\nbody\n@end-section\n",
    );
    expect(edit("@page intro", 0, { breakBefore: true })).toBe("@page-break\n\n@page intro");
  });

  test("an existing break (with or without blank lines between) is detected and not doubled", () => {
    for (const doc of ["@page-break\n@section\n", "@page-break\n\n@section\n", "@page-break\n\n\n@section\n"]) {
      expect(planBlockEdit(doc, doc.split("\n").indexOf("@section"), { breakBefore: true })).toEqual({
        ok: true,
        patch: null,
      });
    }
  });

  test("removes the break and the blank lines between it and the block, keeping blanks above", () => {
    expect(edit("Text.\n\n@page-break\n\n@section\nbody\n@end-section\n", 4, { breakBefore: false })).toBe(
      "Text.\n\n@section\nbody\n@end-section\n",
    );
    expect(edit("Text.\n@page-break\n@section\n", 2, { breakBefore: false })).toBe("Text.\n@section\n");
  });

  test("removes a stack of breaks", () => {
    expect(edit("Text.\n\n@page-break\n\n@page-break\n\n@section\n", 6, { breakBefore: false })).toBe(
      "Text.\n\n@section\n",
    );
  });

  test("never removes a break that belongs to another block, or text between", () => {
    const doc = "@page-break\n\nSome text.\n\n@section\n";
    expect(planBlockEdit(doc, 4, { breakBefore: false })).toEqual({ ok: true, patch: null });
  });

  test("insert then remove is the identity", () => {
    for (const doc of ["A\n\n@section\nx\n@end-section\n", "@page\n", "A\n@section\n"]) {
      const line = doc.split("\n").findIndex((l) => l.startsWith("@") && !l.startsWith("@end"));
      const added = edit(doc, line, { breakBefore: true });
      const out = edit(added, readBlockLine(added), { breakBefore: false });
      expect(out).toBe(doc);
    }
  });

  test("a break combined with a class edit lands both, with correct line numbers", () => {
    expect(edit("A\n\n@section .x\nbody\n@end-section\n", 2, { breakBefore: true, classes: { y: true } })).toBe(
      "A\n\n@page-break\n\n@section .x .y\nbody\n@end-section\n",
    );
  });
});

function readBlockLine(source: string): number {
  return source.split("\n").findIndex((l) => l.startsWith("@") && !l.startsWith("@end") && !l.startsWith("@page-break"));
}

describe("planBlockEdit: columns", () => {
  const doc = "@section card\n\nOne.\n\nTwo.\n\n@end-section\n";

  test("wraps the content in @columns N … @end-columns", () => {
    expect(edit(doc, 0, { columns: 2 })).toBe(
      "@section card\n\n@columns 2\n\nOne.\n\nTwo.\n\n@end-columns\n\n@end-section\n",
    );
  });

  test("wraps tight content without inventing blank lines at the block edges", () => {
    expect(edit("@section\nOne.\n@end-section\n", 0, { columns: 3 })).toBe(
      "@section\n@columns 3\n\nOne.\n\n@end-columns\n@end-section\n",
    );
  });

  test("an empty block gets an empty run", () => {
    expect(edit("@section\n@end-section\n", 0, { columns: 2 })).toBe("@section\n@columns 2\n\n@end-columns\n@end-section\n");
  });

  test("changes N in place, keeping the wrapper's other tokens", () => {
    const wrapped = "@section\n\n@columns 2 .wide #c\n\nText.\n\n@end-columns\n\n@end-section\n";
    expect(edit(wrapped, 0, { columns: 4 })).toBe(
      "@section\n\n@columns 4 .wide #c\n\nText.\n\n@end-columns\n\n@end-section\n",
    );
  });

  test("the same N again writes nothing", () => {
    const wrapped = "@section\n@columns 3\nText.\n@end-columns\n@end-section\n";
    expect(planBlockEdit(wrapped, 0, { columns: 3 })).toEqual({ ok: true, patch: null });
  });

  test("removing unwraps and restores the original exactly", () => {
    const wrapped = edit(doc, 0, { columns: 2 });
    expect(edit(wrapped, 0, { columns: null })).toBe(doc);
    const tight = "@section\nOne.\n@end-section\n";
    expect(edit(edit(tight, 0, { columns: 5 }), 0, { columns: null })).toBe(tight);
    const empty = "@section\n@end-section\n";
    expect(edit(edit(empty, 0, { columns: 2 }), 0, { columns: null })).toBe(empty);
  });

  test("removing when there is no wrapper writes nothing", () => {
    expect(planBlockEdit(doc, 0, { columns: null })).toEqual({ ok: true, patch: null });
  });

  test("keeps a nested @column-break inside the run", () => {
    expect(edit("@section\nA\n@column-break\nB\n@end-section\n", 0, { columns: 2 })).toBe(
      "@section\n@columns 2\n\nA\n@column-break\nB\n\n@end-columns\n@end-section\n",
    );
  });

  test("a block that cannot hold columns says why", () => {
    const noEnd = planBlockEdit("@section\ntext\n", 0, { columns: 2 });
    expect(noEnd.ok).toBe(false);
    expect(!noEnd.ok && noEnd.reason).toContain("@end-section");
    expect(planBlockEdit("@tape\n", 0, { columns: 2 }, { selfClosing: true }).ok).toBe(false);
    // asking for no columns where none can exist is fine
    expect(planBlockEdit("@section\ntext\n", 0, { columns: null })).toEqual({ ok: true, patch: null });
  });

  test("a block with its own partial run is left to the source", () => {
    const partial = "@section\nintro\n@columns 2\ntext\n@end-columns\n@end-section\n";
    const r = planBlockEdit(partial, 0, { columns: 3 });
    expect(r.ok).toBe(false);
    expect(planBlockEdit(partial, 0, { columns: null }).ok).toBe(false);
  });

  test("out-of-range counts are refused", () => {
    expect(planBlockEdit(doc, 0, { columns: 0 }).ok).toBe(false);
    expect(planBlockEdit(doc, 0, { columns: 6 }).ok).toBe(false);
    expect(planBlockEdit(doc, 0, { columns: 2.5 }).ok).toBe(false);
  });

  test("wrap and a class and a break together", () => {
    expect(edit("A\n\n@section\nbody\n@end-section\n", 2, { columns: 2, classes: { k: true }, breakBefore: true })).toBe(
      "A\n\n@page-break\n\n@section .k\n@columns 2\n\nbody\n\n@end-columns\n@end-section\n",
    );
  });

  test("a plugin marker with its own closer works the same way", () => {
    expect(edit("@skill .a\nbody\n@end-skill\n", 0, { columns: 2 })).toBe(
      "@skill .a\n@columns 2\n\nbody\n\n@end-columns\n@end-skill\n",
    );
  });
});

describe("the edited lines still mean what the dialog said (real core renderer)", () => {
  const md = createMarkdownRenderer();
  const classesOf = (html: string, kind: string): string[] => {
    const m = new RegExp(`<div class="${kind}([^"]*)"`).exec(html);
    return (m?.[1] ?? "").split(/\s+/).filter(Boolean);
  };

  test("a class added to every spelling of a section renders on the .section", () => {
    for (const line of ["@section", "@section card", "@section .a", "@section {.a}", "@section #x label=hi .a"]) {
      const out = setMarkerLineClass(line, "gp-no-break", true);
      const before = classesOf(md.render(`${line}\n\ntext\n\n@end-section\n`), "section");
      const after = classesOf(md.render(`${out}\n\ntext\n\n@end-section\n`), "section");
      expect(after).toEqual([...before, "gp-no-break"].filter((c, i, all) => all.indexOf(c) === i));
    }
  });

  test("removing it restores the rendered classes", () => {
    for (const line of ["@section .a .gp-no-break", "@section {.gp-no-break .a}", "@section {.a .gp-no-break}"]) {
      const out = setMarkerLineClass(line, "gp-no-break", false);
      expect(classesOf(md.render(`${out}\n\ntext\n\n@end-section\n`), "section")).toEqual(["a"]);
    }
  });

  test("a wrapped block renders a .gp-columns-N div inside the section; unwrapped, it does not", () => {
    const source = "@section card\n\nOne.\n\nTwo.\n\n@end-section\n";
    const wrapped = edit(source, 0, { columns: 3 });
    const html = md.render(wrapped);
    expect(html).toContain("gp-columns-3");
    expect(html.indexOf('class="section')).toBeLessThan(html.indexOf("gp-columns-3"));
    expect(md.render(edit(wrapped, 0, { columns: null }))).not.toContain("gp-columns");
  });

  test("a @page-break above renders a break element before the section", () => {
    const html = md.render(edit("Text.\n\n@section\nbody\n@end-section\n", 2, { breakBefore: true }));
    expect(html.indexOf("gp-page-break")).toBeGreaterThan(-1);
    expect(html.indexOf("gp-page-break")).toBeLessThan(html.indexOf('class="section'));
  });
});
