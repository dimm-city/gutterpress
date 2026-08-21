import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { DOMSerializer } from "prosemirror-model";
import {
  createDocParser,
  createEditorRenderer,
  gutterpressSchema,
  serializeDoc,
} from "../../src/lib/editor/markdown-doc";

/**
 * The author's `{…}` braces must reach the EDITING DOM, not just survive the
 * save — and land on the same element the print pipeline puts them on.
 *
 * Found by the real-app parity tool (`tools/editor-parity.mjs`) against the
 * field guide: `# Contents {.dc-chevron}` painted as a bare `h1` in the rich
 * editor while the preview and the PDF painted the branded chevron rule.
 * Bytes round-tripped perfectly the whole time, so every byte-level gate was
 * green — this is the class of defect only a rendered comparison finds.
 *
 * Each case asserts the editor's DOM carries the same attributes on the same
 * element as `md.render()` — the print path — for that construct, and that
 * the authored bytes still round-trip.
 */
const md = createEditorRenderer();

/** The editing DOM for `src`, as one HTML string. */
function editorHtml(src: string): string {
  const doc = createDocParser(md).parse(src);
  const win = new Window();
  const document = win.document as unknown as Document;
  const frag = DOMSerializer.fromSchema(gutterpressSchema).serializeFragment(doc.content, {
    document,
  });
  const holder = document.createElement("div");
  holder.appendChild(frag);
  return holder.innerHTML;
}

describe("authored braces render in the editing view", () => {
  const cases: Array<{ name: string; src: string; element: RegExp }> = [
    // The field guide's three chapter-00 headings — the measured defect.
    { name: "heading class", src: "# Contents {.dc-chevron}\n", element: /<h1[^>]*class="dc-chevron"/ },
    { name: "heading id", src: "## Gear {#ch-gear}\n", element: /<h2[^>]*id="ch-gear"/ },
    { name: "image class", src: "![Art](a.png){.gp-bleed}\n", element: /<img[^>]*class="gp-bleed"/ },
    { name: "paragraph class", src: "Some text {.lead}\n", element: /<p[^>]*class="lead"/ },
    { name: "rule class", src: "---{.column-break}\n", element: /<hr[^>]*class="column-break"/ },
  ];

  for (const c of cases) {
    test(`${c.name} reaches the editing DOM`, () => {
      expect(editorHtml(c.src)).toMatch(c.element);
      // …and the file is unchanged by a save.
      expect(serializeDoc(createDocParser(md).parse(c.src))).toBe(c.src);
    });
  }

  test("a fence keeps its language class AND the author's", () => {
    // markdown-it puts both on the inner `<code>`; so must the editor, or a
    // highlighter styled on `language-js` stops matching mid-edit.
    const html = editorHtml("```js {.line-numbers}\ncode\n```\n");
    const code = /<code[^>]*class="([^"]*)"/.exec(html);
    expect(code).not.toBeNull();
    expect(code![1]!.split(/\s+/).sort()).toEqual(["language-js", "line-numbers"]);
    expect(html).toMatch(/<pre[^>]*><code/);
  });

  test("a node with no braces is untouched", () => {
    expect(editorHtml("# Plain\n")).toBe("<h1>Plain</h1>");
  });
});
