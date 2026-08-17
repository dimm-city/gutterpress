import { describe, expect, test } from "bun:test";
import {
  canEditRichly,
  createEditorRenderer,
  createDocParser,
  isFixpoint,
  normalize,
  serializeDoc,
} from "../../src/lib/editor/markdown-doc";

/** A fresh instance per call, same configuration the print path uses. */
const md = () => createEditorRenderer();

function roundTrip(src: string): string {
  return serializeDoc(createDocParser(md()).parse(src));
}

describe("parse -> serialize round trip", () => {
  const cases: Record<string, string> = {
    paragraph: "Hello world.\n",
    heading: "# Title\n",
    "nested heading": "### Third level\n",
    emphasis: "Some **bold** and _em_ text.\n",
    "inline code": "Call `render()` now.\n",
    link: "See [docs](https://example.com) for more.\n",
    image: "![alt text](img.png)\n",
    blockquote: "> quoted line\n",
    "bullet list": "* one\n* two\n",
    "ordered list": "1. one\n2. two\n",
    fence: "```js\nconst x = 1;\n```\n",
    hr: "---\n",
    "two paragraphs": "First para.\n\nSecond para.\n",
  };

  for (const [name, src] of Object.entries(cases)) {
    test(`${name} is a fixpoint`, () => {
      const once = roundTrip(src);
      const twice = roundTrip(once);
      expect(twice).toBe(once);
    });
  }
});

describe("Gutterpress layout markers", () => {
  const markers: Record<string, string> = {
    "@chapter": "@chapter C.01 #ch-one .fancy\n\nBody text.\n",
    "@page": "@page #pg-one .opener\n\nBody text.\n",
    "@spread": "@spread\n\nBody text.\n",
    "@section with end": "@section .two-column\n\nBody text.\n\n@end-section\n",
    "@page-break": "Before.\n\n@page-break\n\nAfter.\n",
    "@column-break": "@section\n\nA\n\n@column-break\n\nB\n\n@end-section\n",
  };

  for (const [name, src] of Object.entries(markers)) {
    test(`${name} survives verbatim`, () => {
      const out = roundTrip(src);
      // The AUTHORED marker line must reappear exactly — its attributes are
      // not invertible (a @page inherits data-chapter-label from its chapter),
      // which is why the node carries the source line.
      const markerLine = src.split("\n").find((l) => l.startsWith("@"))!;
      expect(out).toContain(markerLine);
    });

    test(`${name} is a fixpoint`, () => {
      const once = roundTrip(src);
      expect(roundTrip(once)).toBe(once);
    });
  }
});

describe("tables", () => {
  const src = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";

  test("round-trips to a table", () => {
    const out = roundTrip(src);
    expect(out).toContain("| A | B |");
    expect(out).toContain("| 1 | 2 |");
  });

  test("is a fixpoint", () => {
    const once = roundTrip(src);
    expect(roundTrip(once)).toBe(once);
  });

  test("a pipe inside a cell is escaped so the row stays a row", () => {
    const out = roundTrip("| A | B |\n| --- | --- |\n| a \\| b | 2 |\n");
    expect(out.split("\n").find((l) => l.includes("a "))!.match(/(?<!\\)\|/g)!.length).toBe(3);
  });
});

describe("raw HTML is carried verbatim", () => {
  test("html_block", () => {
    const out = roundTrip('<div class="lede">Intro</div>\n');
    expect(out).toContain('<div class="lede">Intro</div>');
  });

  test("html_block is a fixpoint", () => {
    const once = roundTrip('<div class="lede">Intro</div>\n');
    expect(roundTrip(once)).toBe(once);
  });

  test("html_inline", () => {
    const out = roundTrip("text with <br> inside\n");
    expect(out).toContain("<br>");
  });
});

describe("fail closed", () => {
  test("footnotes are refused, not mis-serialized", () => {
    const verdict = canEditRichly(md(), "Text[^a]\n\n[^a]: A note.\n");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("not supported");
  });

  test("definition lists are refused", () => {
    const verdict = canEditRichly(md(), "Term\n: definition\n");
    expect(verdict.ok).toBe(false);
  });

  test("ordinary prose is accepted", () => {
    expect(canEditRichly(md(), "Just a paragraph.\n").ok).toBe(true);
  });

  test("a refusal names the construct so the UI can explain it", () => {
    const verdict = canEditRichly(md(), "Text[^a]\n\n[^a]: A note.\n");
    if (!verdict.ok) expect(verdict.reason.length).toBeGreaterThan(0);
  });
});

describe("normalization is accepted, but must be stable", () => {
  test("normalize is idempotent on a mixed document", () => {
    const src = [
      "@chapter C.01 #ch",
      "",
      "# Heading",
      "",
      "Text with **bold**, _em_, `code` and a [link](x).",
      "",
      "- item one",
      "- item two",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "> quote",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
    ].join("\n");
    const r = isFixpoint(md(), src);
    expect(r.ok).toBe(true);
  });

  test("normalize returns a trailing newline and no trailing blank run", () => {
    const out = normalize(md(), "Text.\n\n\n\n");
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
