/**
 * serialize.test.ts — round-trip soundness tests for the block serializer.
 *
 * The core property (ADR 0010): for every block the serializer accepts,
 * substituting its canonical serialization back into the source and
 * re-rendering must produce a model-equal block — and must not perturb any
 * OTHER block in the file. Blocks outside the closed set must REFUSE, never
 * emit.
 *
 * These tests run the REAL renderer (`createMarkdownRenderer`) on markdown
 * fixtures and feed its actual HTML output to the extractor through a small
 * test-only parser (bun has no DOM; the renderer's output is disciplined
 * well-formed HTML, which is all this parser accepts).
 */
import { describe, expect, test } from "bun:test";
import { createMarkdownRenderer, BUILTIN_OPTIONAL_PLUGINS } from "./renderer";
import {
  canonicalizeBlock,
  extractBlockModel,
  modelsEqual,
  serializeBlock,
  type ElementLike,
  type SerializeOptions,
  type TextLike,
} from "./serialize";
import { SOURCE_RANGE_ATTR } from "./source-range";

// ────────────────────────────────────────────────────────────────────────────
// Test-only HTML parser (renderer output only: well-formed, double-quoted)
// ────────────────────────────────────────────────────────────────────────────

const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link"]);

interface TestElement extends ElementLike {
  tagName: string;
  attrs: Map<string, string>;
  childNodes: Array<TestElement | TextLike>;
  parent: TestElement | null;
}

function makeElement(tag: string, parent: TestElement | null): TestElement {
  const attrs = new Map<string, string>();
  const el: TestElement = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    attrs,
    childNodes: [],
    parent,
    getAttribute: (name) => attrs.get(name.toLowerCase()) ?? null,
    getAttributeNames: () => [...attrs.keys()],
  };
  return el;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Parse renderer-emitted HTML into a synthetic root ElementLike. */
export function parseHtml(html: string): TestElement {
  const root = makeElement("root", null);
  let current = root;
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const text = html.slice(last, m.index);
    if (text) current.childNodes.push({ nodeType: 3, data: decodeEntities(text) });
    last = m.index + m[0].length;

    const [, close, rawTag, rawAttrs, selfClose] = m;
    const tag = rawTag!.toLowerCase();
    if (close) {
      if (current.tagName.toLowerCase() !== tag) {
        throw new Error(`test parser: </${tag}> closes <${current.tagName.toLowerCase()}>`);
      }
      current = current.parent!;
      continue;
    }
    const el = makeElement(tag, current);
    const attrRe = /([^\s=]+)(?:="([^"]*)")?/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(rawAttrs ?? ""))) {
      el.attrs.set(a[1]!.toLowerCase(), decodeEntities(a[2] ?? ""));
    }
    current.childNodes.push(el);
    if (!selfClose && !VOID_TAGS.has(tag)) current = el;
  }
  const trailing = html.slice(last);
  if (trailing) current.childNodes.push({ nodeType: 3, data: decodeEntities(trailing) });
  if (current !== root) throw new Error(`test parser: unclosed <${current.tagName}>`);
  return root;
}

// ────────────────────────────────────────────────────────────────────────────
// Round-trip harness
// ────────────────────────────────────────────────────────────────────────────

const FEATURE_PLUGINS = ["markdown-it-mark", "markdown-it-sub", "markdown-it-sup", "markdown-it-abbr"];

function makeMd(withFeatures: boolean) {
  return createMarkdownRenderer(
    withFeatures
      ? FEATURE_PLUGINS.map((name) => ({
          name,
          plugin: BUILTIN_OPTIONAL_PLUGINS[name]!,
          options: {},
        }))
      : undefined,
  );
}

const ALL_FEATURES: SerializeOptions = {
  features: { sup: true, sub: true, mark: true, abbr: true },
};

function isTestElement(n: TestElement | TextLike): n is TestElement {
  return n.nodeType === 1;
}

/** A block's range attribute — fences carry it on the inner <code>. */
function rangeAttrOf(el: TestElement): string | null {
  const own = el.getAttribute(SOURCE_RANGE_ATTR);
  if (own != null) return own;
  if (el.tagName === "PRE") {
    const code = el.childNodes.find(
      (c): c is TestElement => isTestElement(c) && c.tagName === "CODE",
    );
    return code?.getAttribute(SOURCE_RANGE_ATTR) ?? null;
  }
  return null;
}

/** Top-level annotated blocks, diving into the footnote section's items. */
function annotatedBlocks(root: TestElement): TestElement[] {
  const out: TestElement[] = [];
  for (const child of root.childNodes) {
    if (!isTestElement(child)) continue;
    if (rangeAttrOf(child) != null) {
      out.push(child);
      continue;
    }
    // section.footnotes > ol > li > (annotated blocks)
    if (child.tagName === "SECTION") {
      for (const ol of child.childNodes) {
        if (!isTestElement(ol)) continue;
        for (const li of ol.childNodes) {
          if (!isTestElement(li)) continue;
          for (const block of li.childNodes) {
            if (isTestElement(block) && block.getAttribute(SOURCE_RANGE_ATTR) != null) {
              out.push(block);
            }
          }
        }
      }
    }
  }
  return out;
}

function sliceLines(src: string, range: [number, number]): string {
  return src.split("\n").slice(range[0], range[1]).join("\n");
}

function substitute(src: string, range: [number, number], text: string): string {
  const lines = src.split("\n");
  return [...lines.slice(0, range[0]), ...text.split("\n"), ...lines.slice(range[1])].join("\n");
}

function rangeOf(el: TestElement): [number, number] {
  const raw = rangeAttrOf(el)!;
  const [a, b] = raw.split(":").map(Number);
  return [a!, b!];
}

/** Extraction that reports refusal as null instead of throwing. */
function tryExtract(el: TestElement, opts: SerializeOptions) {
  try {
    return extractBlockModel(el, opts);
  } catch {
    return null;
  }
}

interface RoundtripResult {
  replacements: number;
  refusals: Array<{ index: number; reason: string }>;
}

/**
 * For every annotated top-level block of `src`: canonicalize → substitute →
 * re-render → assert the target block is model-equal AND every other block's
 * model is untouched. Returns refusal stats for coverage assertions.
 */
function roundtrip(src: string, opts: SerializeOptions = {}, withFeatures = false): RoundtripResult {
  const md = makeMd(withFeatures);
  const html1 = md.render(src, {});
  const blocks1 = annotatedBlocks(parseHtml(html1));
  const models1 = blocks1.map((b) => tryExtract(b, opts));
  const result: RoundtripResult = { replacements: 0, refusals: [] };

  blocks1.forEach((block, i) => {
    const range = rangeOf(block);
    const res = canonicalizeBlock(block, sliceLines(src, range), opts);
    if (res.kind === "refused") {
      result.refusals.push({ index: i, reason: res.reason });
      return;
    }
    expect(res.kind).toBe("replacement");
    if (res.kind !== "replacement") return;
    result.replacements++;

    const src2 = substitute(src, range, res.text);
    const html2 = md.render(src2, {});
    const blocks2 = annotatedBlocks(parseHtml(html2));
    expect(blocks2.length).toBe(blocks1.length);
    blocks2.forEach((b2, j) => {
      if (models1[j] === null) return; // refused block elsewhere in the doc
      const m2 = tryExtract(b2, opts);
      if (!modelsEqual(m2, models1[j])) {
        throw new Error(
          `block ${j} drifted after canonicalizing block ${i}\n` +
            `--- source ---\n${src}\n--- replacement for ${i} ---\n${res.text}\n` +
            `--- re-rendered source ---\n${src2}\n` +
            `--- expected model ---\n${JSON.stringify(models1[j], null, 1)}\n` +
            `--- got model ---\n${JSON.stringify(m2, null, 1)}`,
        );
      }
    });
  });
  return result;
}

/** Assert every block in `src` round-trips (zero refusals). */
function roundtripsClean(src: string, opts: SerializeOptions = {}, withFeatures = false): void {
  const r = roundtrip(src, opts, withFeatures);
  expect(r.refusals).toEqual([]);
  expect(r.replacements).toBeGreaterThan(0);
}

// ────────────────────────────────────────────────────────────────────────────
// Round-trip fixtures — the closed set
// ────────────────────────────────────────────────────────────────────────────

describe("round-trip: paragraphs and inline marks", () => {
  test("plain and formatted text", () => {
    roundtripsClean(`Hello *world* with **bold**, \`code\`, and ~~strike~~.`);
  });

  test("typographer output survives verbatim", () => {
    roundtripsClean(`"Quoted" -- and --- with (c) it's... fine!`);
  });

  test("escapes: literal markdown characters", () => {
    roundtripsClean(`literal \\*star\\* and \\[bracket\\] and 5 < 6 & AT&T {not-attrs}`);
  });

  test("hardbreak and soft wrap", () => {
    roundtripsClean(`line one  \nline two`);
    roundtripsClean(`wrapped\nline`);
  });

  test("attrs braces on paragraph and heading", () => {
    roundtripsClean(`A styled para. {.gp-columns-2 #intro key=val}`);
    roundtripsClean(`## Section title {.fancy}`);
  });

  test("nested emphasis", () => {
    roundtripsClean(`a **bold *and italic* run** and *em with \`code\`*`);
  });

  test("text that resembles block syntax at line start", () => {
    roundtripsClean(`# real heading\n\nplain para`);
  });
});

describe("round-trip: links and images", () => {
  test("explicit link with title", () => {
    roundtripsClean(`See [docs](https://example.dev "The docs") now.`);
  });

  test("bare linkified URL and autolink", () => {
    roundtripsClean(`Visit https://bare.example.com now.`);
    roundtripsClean(`Visit <https://angle.example.com> now.`);
  });

  test("image with attrs, gp-shape, and title", () => {
    roundtripsClean(`![Alt text](images/pic.png "Title"){.gp-shape width=40%}`);
  });

  test("image inside a link", () => {
    roundtripsClean(`[![badge](img/b.svg)](https://ci.example.com)`);
  });

  test("link destination needing angle form", () => {
    roundtripsClean(`[docs](<my docs/page one.html>)`);
  });
});

describe("round-trip: container blocks", () => {
  test("tight and loose lists", () => {
    roundtripsClean(`- one\n- two *em*\n- three`);
    roundtripsClean(`- one\n\n- two`);
    roundtripsClean(`3. third\n4. fourth`);
  });

  test("nested list under tight item", () => {
    roundtripsClean(`- top\n  - nested a\n  - nested b\n- next`);
  });

  test("blockquote with multiple blocks", () => {
    roundtripsClean(`> quoted *text*\n> second line\n>\n> second para`);
  });

  test("table with alignments and pipes", () => {
    roundtripsClean(`| a | b \\| c |\n|:--|--:|\n| 1 | 2 |\n| *em* | \`code\` |`);
  });

  test("fence with language, attrs, and inner backticks", () => {
    roundtripsClean("```js {.small}\nconst x = 1 < 2;\n```");
    roundtripsClean("````\ncode with ``` inside\n````");
    roundtripsClean("~~~\ntilde fence\n~~~");
  });

  test("hr and deflist", () => {
    roundtripsClean(`---`);
    roundtripsClean(`Term\n: definition one\n: definition two\nTerm 2\n: other`);
  });
});

describe("round-trip: footnotes", () => {
  test("reference and single-paragraph definition", () => {
    roundtripsClean(`Uses a note.[^n] And another.[^m]\n\n[^n]: The note body.\n\n[^m]: Second note.`);
  });
});

describe("round-trip: optional plugin marks", () => {
  test("mark/sub/sup/abbr with features enabled", () => {
    roundtripsClean(
      `Water is H~2~O at 10^2^ kPa, ==marked== well.\n\n*[HTML]: HyperText Markup Language\n\nThe HTML spec.`,
      ALL_FEATURES,
      true,
    );
  });
});

describe("round-trip: multi-block documents stay unperturbed", () => {
  test("editing one block never drifts its neighbors", () => {
    roundtripsClean(
      `# Title {#top}\n\nFirst para with [a link](https://x.dev).\n\n- item one\n- item two\n\n` +
        `> A quote\n\nLast para.`,
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Refusals — outside the closed set
// ────────────────────────────────────────────────────────────────────────────

describe("refusals", () => {
  test("raw HTML block never reaches the serializer (no source range)", () => {
    const md = makeMd(false);
    const html = md.render(`<div class="custom">raw</div>`, {});
    // html_block output carries no data-source-range → not an annotated block.
    expect(annotatedBlocks(parseHtml(html)).length).toBe(0);
  });

  test("inline raw HTML refuses", () => {
    const r = roundtrip(`Text with <kbd>keys</kbd> inside.`);
    expect(r.refusals.length).toBe(1);
    expect(r.refusals[0]!.reason).toContain("kbd");
  });

  test("plugin tags refuse when features are off", () => {
    const r = roundtrip(`Raw <sup>html sup</sup> here.`);
    expect(r.refusals.length).toBe(1);
  });

  test("reference-style link refuses via slice scan", () => {
    const r = roundtrip(`Uses [a ref][id] link.\n\n[id]: https://x.dev`);
    expect(r.refusals.some((x) => x.reason.includes("reference-style"))).toBe(true);
  });

  test("span with attributes refuses", () => {
    const root = parseHtml(`<p data-source-range="0:1"><span style="color:red">x</span></p>`);
    const p = root.childNodes[0] as TestElement;
    const res = serializeBlock({ edited: p, originalSlice: "x", pristineModel: null });
    expect(res.kind).toBe("refused");
  });

  test("empty block refuses rather than deleting", () => {
    const root = parseHtml(`<p data-source-range="0:1"></p>`);
    const res = serializeBlock({
      edited: root.childNodes[0] as TestElement,
      originalSlice: "old text",
      pristineModel: null,
    });
    expect(res.kind).toBe("refused");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Edited-DOM behaviors (simulated contenteditable output)
// ────────────────────────────────────────────────────────────────────────────

describe("edited DOM", () => {
  test("unchanged fast path via pristine model", () => {
    const md = makeMd(false);
    const src = `Hello *world*.`;
    const block = annotatedBlocks(parseHtml(md.render(src, {})))[0]!;
    const pristine = extractBlockModel(block);
    const res = serializeBlock({ edited: block, pristineModel: pristine, originalSlice: src });
    expect(res.kind).toBe("unchanged");
  });

  test("text edit produces a sound replacement", () => {
    const md = makeMd(false);
    const src = `Hello *world* out there.`;
    const block = annotatedBlocks(parseHtml(md.render(src, {})))[0]!;
    // Simulate typing: mutate the trailing text node.
    const lastText = block.childNodes[block.childNodes.length - 1] as TextLike & { data: string };
    (lastText as { data: string }).data = " out there, edited!";
    const res = serializeBlock({ edited: block, originalSlice: src, pristineModel: null });
    expect(res.kind).toBe("replacement");
    if (res.kind !== "replacement") return;
    const html2 = md.render(res.text, {});
    const model2 = extractBlockModel(annotatedBlocks(parseHtml(html2))[0]!);
    expect(modelsEqual(model2, extractBlockModel(block))).toBe(true);
  });

  test("b/i normalize to strong/em; attribute-free spans unwrap", () => {
    const root = parseHtml(
      `<p data-source-range="0:1">a <b>bold</b> and <i>ital</i> <span>plain</span></p>`,
    );
    const res = serializeBlock({
      edited: root.childNodes[0] as TestElement,
      originalSlice: "a bold and ital plain",
      pristineModel: null,
    });
    expect(res.kind).toBe("replacement");
    if (res.kind !== "replacement") return;
    expect(res.text).toBe("a **bold** and *ital* plain");
  });

  test("NBSP from double-space typing normalizes to a plain space", () => {
    const root = parseHtml(`<p data-source-range="0:1">a b</p>`);
    const res = serializeBlock({
      edited: root.childNodes[0] as TestElement,
      originalSlice: "a b",
      pristineModel: null,
    });
    expect(res.kind).toBe("replacement");
    if (res.kind !== "replacement") return;
    expect(res.text).toBe("a b");
  });

  test("footnote ref count change refuses", () => {
    const md = makeMd(false);
    const src = `Uses a note.[^n]\n\n[^n]: Body.`;
    const block = annotatedBlocks(parseHtml(md.render(src, {})))[0]!;
    // Simulate the user deleting text such that the sup marker was removed:
    (block as TestElement).childNodes.length = 1; // keep only the text node
    const res = serializeBlock({
      edited: block,
      originalSlice: sliceLines(src, rangeOf(block)),
      pristineModel: null,
    });
    expect(res.kind).toBe("refused");
    if (res.kind !== "refused") return;
    expect(res.reason).toContain("footnote");
  });
});
