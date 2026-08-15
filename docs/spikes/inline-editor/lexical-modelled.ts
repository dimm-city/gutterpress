/**
 * The metric that actually decides the UX question.
 *
 * Lexical round-trips this corpus with zero word loss — but a no-op is also
 * lossless. What matters for a WYSIWYG surface is how much of the document the
 * editor MODELS. A line no transformer claims becomes a paragraph whose text is
 * the literal markdown, so the author sees `| Type | Color |` and `@section
 * .lede` as prose in what is supposed to be a rendered page.
 *
 * Counts top-level blocks, and how many of them still carry raw markdown
 * syntax in their text after import.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHeadlessEditor } from "@lexical/headless";
import { $convertFromMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import { $getRoot } from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { CodeNode, CodeHighlightNode } from "@lexical/code";

const REPO = new URL("../../../", import.meta.url).pathname;
const BOOKS = [
  "examples/gutterpress-user-guide",
  "examples/gutterwire-zine",
  "examples/with-validation",
  "examples/with-design-guide/book-01",
  "examples/with-design-guide/book-02",
  "examples/with-design-guide/design-guide",
  "docs/fixtures/css-authoring-spike/book",
];

/** Raw markdown that must NOT be visible as prose in a WYSIWYG surface. */
const LEAKS: Array<[string, RegExp]> = [
  ["marker line shown as prose", /^\s*@(?:chapter|section|page|spread|end)\b/m],
  ["table row shown as prose", /^\s*\|.*\|\s*$/m],
  ["attr braces shown as prose", /\{[#.][-\w]+[^}]*\}/],
  ["raw HTML shown as prose", /<\/?[a-z][-\w]*(?:\s[^>]*)?>/i],
];

const editor = createHeadlessEditor({
  namespace: "spike",
  nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, CodeNode, CodeHighlightNode],
  onError: (e) => {
    throw e;
  },
});

let blocks = 0;
let leaked = 0;
const byType = new Map<string, number>();
const byLeak = new Map<string, number>();

for (const book of BOOKS) {
  const dir = join(REPO, book);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const src = readFileSync(join(dir, file), "utf8").replace(/\r\n?/g, "\n");
    editor.update(
      () => {
        $convertFromMarkdownString(src, TRANSFORMERS);
        for (const node of $getRoot().getChildren()) {
          blocks++;
          const type = node.getType();
          byType.set(type, (byType.get(type) ?? 0) + 1);
          const text = node.getTextContent();
          // Code blocks legitimately contain markdown-looking text.
          if (type === "code") continue;
          for (const [name, re] of LEAKS) {
            if (re.test(text)) {
              byLeak.set(name, (byLeak.get(name) ?? 0) + 1);
              leaked++;
              break;
            }
          }
        }
      },
      { discrete: true },
    );
  }
}

const pct = (n: number) => `${((n / Math.max(1, blocks)) * 100).toFixed(1)}%`;
console.log(`\n── Lexical: what does the editor actually MODEL? ──`);
console.log(`  top-level blocks    : ${blocks}`);
console.log(`    modelled          : ${blocks - leaked} (${pct(blocks - leaked)})`);
console.log(`    raw syntax as prose: ${leaked} (${pct(leaked)})   <- the WYSIWYG failure`);
console.log(`  block node types produced:`);
for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${t.padEnd(14)} ${n}`);
console.log(`  leak causes:`);
for (const [t, n] of [...byLeak.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${t.padEnd(30)} ${n}`);
