/**
 * Galley codec tests — the zero-loss invariant over the real corpus, byte
 * preservation for untouched docs, canonical idempotence, and the
 * marker-DOM parity contract against the actual renderer.
 */
import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createMarkdownRenderer } from "../../lib/markdown/renderer.ts";
import { galleySchema } from "./extensions.ts";
import { buildGalleyDoc, serializeGalleyDoc, type GalleyToken } from "./markdown.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const BOOKS = [
  "examples/gutterpress-user-guide",
  "examples/gutterwire-zine",
  "examples/with-validation",
  "examples/with-design-guide/book-01",
  "examples/with-design-guide/book-02",
  "examples/with-design-guide/design-guide",
  "docs/fixtures/css-authoring-spike/book",
];

const md = createMarkdownRenderer();
const schema = galleySchema();

/** Tokens exactly as the server route ships them: through JSON. */
const tokensOf = (source: string): GalleyToken[] =>
  JSON.parse(JSON.stringify(md.parse(source, {}))) as GalleyToken[];

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/gi) ?? [];

/** Multiset difference a − b: words of `a` missing from `b`. */
function lostWords(a: string, b: string): string[] {
  const pool = new Map<string, number>();
  for (const w of words(b)) pool.set(w, (pool.get(w) ?? 0) + 1);
  const missing: string[] = [];
  for (const w of words(a)) {
    const n = pool.get(w) ?? 0;
    if (n === 0) missing.push(w);
    else pool.set(w, n - 1);
  }
  return missing;
}

interface CorpusFile {
  rel: string;
  source: string;
}

const corpus: CorpusFile[] = [];
for (const book of BOOKS) {
  const dir = path.join(REPO, book);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    corpus.push({
      rel: `${book}/${f}`,
      source: readFileSync(path.join(dir, f), "utf8").replace(/\r\n?/g, "\n"),
    });
  }
}

test("corpus loads", () => {
  expect(corpus.length).toBeGreaterThanOrEqual(30);
});

test("zero content loss across the corpus (canonical serialization)", () => {
  const failures: string[] = [];
  for (const { rel, source } of corpus) {
    const { doc } = buildGalleyDoc(schema, tokensOf(source), source);
    const out = serializeGalleyDoc(schema, doc);
    const lost = lostWords(source, out);
    if (lost.length) failures.push(`${rel}: lost ${lost.length} — ${lost.slice(0, 10).join(" ")}`);
  }
  expect(failures).toEqual([]);
});

test("byte preservation: an untouched doc emits (near-)original bytes", () => {
  let byteIdentical = 0;
  const failures: string[] = [];
  for (const { rel, source } of corpus) {
    const { doc, srcMap } = buildGalleyDoc(schema, tokensOf(source), source);
    const out = serializeGalleyDoc(schema, doc, srcMap);
    if (out.trim() === source.trim()) byteIdentical++;
    const lost = lostWords(source, out);
    if (lost.length) failures.push(`${rel}: lost ${lost.length} — ${lost.slice(0, 10).join(" ")}`);
  }
  expect(failures).toEqual([]);
  // Preservation should keep the overwhelming majority of untouched files
  // byte-identical; the remainder differ only in regenerated marker
  // terminators / blank-line normalization (still zero loss, asserted above).
  expect(byteIdentical).toBeGreaterThanOrEqual(Math.floor(corpus.length * 0.8));
});

test("canonical serialization is idempotent (parse → serialize is a fixed point)", () => {
  const failures: string[] = [];
  for (const { rel, source } of corpus) {
    const { doc } = buildGalleyDoc(schema, tokensOf(source), source);
    const once = serializeGalleyDoc(schema, doc);
    const { doc: doc2 } = buildGalleyDoc(schema, tokensOf(once), once);
    const twice = serializeGalleyDoc(schema, doc2);
    if (twice !== once) {
      const i = [...once].findIndex((c, idx) => twice[idx] !== c);
      failures.push(`${rel}: diverges at ${i}: ${JSON.stringify(once.slice(i, i + 60))} vs ${JSON.stringify(twice.slice(i, i + 60))}`);
    }
  }
  expect(failures).toEqual([]);
});

test("an edited block serializes canonically while its neighbors keep their bytes", () => {
  const source = "First paragraph stays put.\n\nSecond -- to edit.\n\nThird paragraph stays put.\n";
  const { doc, srcMap } = buildGalleyDoc(schema, tokensOf(source), source);
  // Replace the middle paragraph with new content (new node identity).
  const children: unknown[] = [];
  doc.forEach((child, _o, i) => {
    children.push(
      i === 1 ? schema.nodes.paragraph!.create(null, schema.text("Edited text.")) : child,
    );
  });
  const edited = schema.topNodeType.create(null, children as never);
  const out = serializeGalleyDoc(schema, edited, srcMap);
  expect(out).toContain("First paragraph stays put.");
  expect(out).toContain("Second -- to edit.".replace("Second -- to edit.", "Edited text."));
  // The untouched em-dash source spelling survives via preservation…
  expect(out).toContain("Third paragraph stays put.");
  // …and the edited block is canonical.
  expect(out).not.toContain("Second -- to edit.");
});

test("marker DOM parity: markerWrap replays exactly the renderer's div attrs", () => {
  const source = "@section .gp-columns-2 #intro\n\nBody text.\n\n@end-section\n";
  const html = md.render(source);
  const rendered = /<div ([^>]*)>/.exec(html)![1]!;
  const renderedAttrs = new Map(
    [...rendered.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]),
  );
  const { doc } = buildGalleyDoc(schema, tokensOf(source), source);
  const wrap = doc.firstChild!;
  expect(wrap.type.name).toBe("markerWrap");
  const domAttrs = new Map(wrap.attrs.domAttrs as Array<[string, string]>);
  for (const [k, v] of renderedAttrs) {
    expect(domAttrs.get(k)).toBe(v);
  }
});

test("tables round-trip as pipe tables with alignment", () => {
  const source = "| Name | Score |\n| :--- | ---: |\n| Ada | 100 |\n| Bo | 9 |\n";
  const { doc } = buildGalleyDoc(schema, tokensOf(source), source);
  expect(doc.firstChild!.type.name).toBe("table");
  const out = serializeGalleyDoc(schema, doc);
  expect(out).toContain("| Name | Score |");
  expect(out).toContain("| :--- | ---: |");
  expect(out).toContain("| Ada | 100 |");
  // And the canonical form re-parses to the same table.
  const { doc: doc2 } = buildGalleyDoc(schema, tokensOf(out), out);
  expect(doc2.firstChild!.type.name).toBe("table");
  expect(serializeGalleyDoc(schema, doc2)).toBe(out);
});

test("the chapter opener displays but never serializes", () => {
  const source = "@chapter C.01 .chapter-1\n\n@page\n\nBody.\n";
  const { doc } = buildGalleyDoc(schema, tokensOf(source), source);
  let openers = 0;
  doc.descendants((n) => {
    if (n.type.name === "chapterOpener") openers++;
    return true;
  });
  expect(openers).toBe(1);
  const out = serializeGalleyDoc(schema, doc);
  expect(out).not.toContain("chapter-opener");
  expect(out).toContain("@chapter C.01");
});

test("consumed-without-tokens lines survive via the gap sweep (reference-link definitions)", () => {
  // markdown-it's core consumes `[label]: url` definition lines without
  // emitting any token for them — the exact class of loss escalation alone
  // cannot see. The gap sweep must keep the line.
  const source = "See [the repo][gh] for details.\n\n[gh]: https://github.com/dimm-city/gutterpress\n";
  const { doc } = buildGalleyDoc(schema, tokensOf(source), source);
  const out = serializeGalleyDoc(schema, doc);
  expect(out).toContain("[gh]: https://github.com/dimm-city/gutterpress");
  expect(out).toContain("the repo");
});

test("footnote definitions relocate in the token stream without duplicating (coverage-first sweep)", () => {
  const source = "A claim.[^n]\n\nMore prose after the definition.\n\n[^n]: The footnote text.\n";
  const { doc } = buildGalleyDoc(schema, tokensOf(source), source);
  const out = serializeGalleyDoc(schema, doc);
  expect(out.match(/The footnote text/g)?.length).toBe(1);
  expect(out.match(/More prose after/g)?.length).toBe(1);
  expect(out).toContain("[^n]");
});

test("unknown block constructs degrade to a single opaque atom, not the whole section", () => {
  const source =
    '@section .lede\n\nEditable paragraph.\n\n<div class="custom">raw</div>\n\nAnother editable one.\n\n@end-section\n';
  const { doc, stats } = buildGalleyDoc(schema, tokensOf(source), source);
  const wrap = doc.firstChild!;
  expect(wrap.type.name).toBe("markerWrap");
  const kinds: string[] = [];
  wrap.forEach((c) => kinds.push(c.type.name));
  expect(kinds).toEqual(["paragraph", "rawBlock", "paragraph"]);
  const out = serializeGalleyDoc(schema, doc);
  expect(out).toContain('<div class="custom">raw</div>');
  expect(out).toContain("@end-section");
  // html_block reaches rawBlock through its own handler, not escalation —
  // either way the atom is opaque and verbatim.
  expect(stats.blocks).toBeGreaterThan(stats.opaque);
});

test("@continue keeps its section chain: no @end-section is injected before a continuation", () => {
  const source =
    "@section .gp-columns-2\n\nFirst column prose.\n\n@continue\n\nContinued prose.\n\n@end-section\n\nAfter.\n";
  const { doc } = buildGalleyDoc(schema, tokensOf(source), source);
  const out = serializeGalleyDoc(schema, doc);
  // The continuation must follow its section DIRECTLY — an @end-section in
  // between would orphan it (continue_without_section) and delete the line
  // on the next cycle.
  expect(out).not.toMatch(/@end-section\s*\n+\s*@continue/);
  expect(out).toContain("@continue");
  expect(out.match(/@end-section/g)?.length).toBe(1);
  // And the round trip is stable + lossless.
  const { doc: doc2 } = buildGalleyDoc(schema, tokensOf(out), out);
  expect(serializeGalleyDoc(schema, doc2)).toBe(out);
  expect(serializeGalleyDoc(schema, doc2)).toContain("Continued prose.");
});

test("leaf-block attrs round-trip: quoted values and authored data-* survive, idempotently", () => {
  const source = [
    "A paragraph. {data-role=aside}",
    "",
    'Styled text. {style="color: red"}',
    "",
    "## Heading {#anchor .fancy}",
    "",
  ].join("\n");
  const { doc } = buildGalleyDoc(schema, tokensOf(source), source);
  const out = serializeGalleyDoc(schema, doc);
  expect(out).toContain("{data-role=aside}");
  expect(out).toContain('{style="color: red"}');
  expect(out).toContain("{#anchor .fancy}");
  const { doc: doc2 } = buildGalleyDoc(schema, tokensOf(out), out);
  const again = serializeGalleyDoc(schema, doc2);
  expect(again).toBe(out); // idempotent — nothing migrated or vanished
});

test("containers carrying authored braces refuse to opaque atoms — verbatim, idempotent", () => {
  // markdown-it-attrs' positional binding for containers (own-line after a
  // table is a ROW; end-of-item binds the <li>) cannot be regenerated
  // faithfully — Opus probes showed phantom table rows and {.x}→{.x .x}
  // accumulation. These shapes must round-trip as verbatim opaque atoms.
  const source = [
    "- alpha {.red}",
    "- beta",
    "",
    "| A | B |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "{.wide}",
    "",
  ].join("\n");
  const { doc } = buildGalleyDoc(schema, tokensOf(source), source);
  const kinds: string[] = [];
  doc.forEach((c) => kinds.push(c.type.name));
  // The attr-carrying list is opaque; the table stays richly editable when
  // its brace lands on a following paragraph shape instead of the table.
  expect(kinds[0]).toBe("rawBlock");
  const out = serializeGalleyDoc(schema, doc);
  expect(out).toContain("- alpha {.red}");
  const { doc: doc2 } = buildGalleyDoc(schema, tokensOf(out), out);
  const again = serializeGalleyDoc(schema, doc2);
  expect(again).toBe(out);
  // No class accumulation, ever.
  expect(again).not.toContain("{.red .red}");
});

test("braceDomAttrs parses the quoted form the serializer emits", async () => {
  const { braceDomAttrs } = await import("./extensions.ts");
  expect(braceDomAttrs('{#id .a .b style="color: red" width=200}')).toEqual({
    id: "id",
    class: "a b",
    style: "color: red",
    width: "200",
  });
});

test("unknown inline HTML stays inline and verbatim inside an editable paragraph", () => {
  const source = "Press <kbd>Ctrl</kbd> to act.\n";
  const { doc } = buildGalleyDoc(schema, tokensOf(source), source);
  expect(doc.firstChild!.type.name).toBe("paragraph");
  const out = serializeGalleyDoc(schema, doc);
  expect(out).toContain("<kbd>Ctrl</kbd>");
});

test("footnote definitions stay where the author wrote them (markdown-it hoists them)", () => {
  // markdown-it-footnote moves EVERY definition into a trailing footnote
  // block, so document order (which is RENDER order — the print pipeline puts
  // the notes section at the end too) is not source order. Serializing
  // document order rewrote the author's file with the definition moved to the
  // bottom on every save.
  const source = [
    "Intro paragraph before.",
    "",
    "Some text with a footnote[^a] here.",
    "",
    "[^a]: The footnote definition body.",
    "",
    "Trailing paragraph after.",
    "",
  ].join("\n");
  const { doc, srcMap } = buildGalleyDoc(schema, tokensOf(source), source);
  // The hoisting is real: the definition IS the document's last child.
  expect(doc.lastChild!.type.name).toBe("rawBlock");
  expect(String(doc.lastChild!.attrs.src)).toStartWith("[^a]:");
  // …and serialization must put it back.
  expect(serializeGalleyDoc(schema, doc, srcMap)).toBe(source);
});

test("multiple footnote definitions each return to their own source position", () => {
  const source = [
    "First[^one] and second[^two].",
    "",
    "[^one]: Note one.",
    "",
    "Middle paragraph between the definitions.",
    "",
    "[^two]: Note two.",
    "",
    "After both.",
    "",
  ].join("\n");
  const { doc, srcMap } = buildGalleyDoc(schema, tokensOf(source), source);
  expect(serializeGalleyDoc(schema, doc, srcMap)).toBe(source);
});

test("definitions already written at the end are not moved", () => {
  const source = ["Body text[^z].", "", "More body.", "", "[^z]: Trailing note.", ""].join("\n");
  const { doc, srcMap } = buildGalleyDoc(schema, tokensOf(source), source);
  expect(serializeGalleyDoc(schema, doc, srcMap)).toBe(source);
});

test("a paragraph between two definitions is not swallowed into the opaque slice", () => {
  // Regression: the hoisted definitions escalated as ONE run whose span
  // covered every line between the first and last definition, so this
  // paragraph was written twice — once as itself, once inside the slice.
  const source = [
    "First[^one] and second[^two].",
    "",
    "[^one]: Note one.",
    "",
    "Middle paragraph between the definitions.",
    "",
    "[^two]: Note two.",
    "",
    "After both.",
    "",
  ].join("\n");
  const { doc, srcMap } = buildGalleyDoc(schema, tokensOf(source), source);
  const out = serializeGalleyDoc(schema, doc, srcMap);
  expect(out).toBe(source);
  expect(out.match(/Middle paragraph/g)).toHaveLength(1);
});

test("multi-line definition bodies and definitions written above their reference survive", () => {
  for (const source of [
    ["Ref[^m] here.", "", "[^m]: First line of the note.", "    Continued on a second line.", "", "Tail.", ""].join("\n"),
    ["[^early]: Defined up top.", "", "Body that references[^early] it later.", ""].join("\n"),
  ]) {
    const { doc, srcMap } = buildGalleyDoc(schema, tokensOf(source), source);
    expect(serializeGalleyDoc(schema, doc, srcMap)).toBe(source);
  }
});
