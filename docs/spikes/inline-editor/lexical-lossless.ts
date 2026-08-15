/**
 * SPIKE C, control arm — the SAME corpus and the SAME content-loss metric,
 * through Lexical instead of ProseMirror.
 *
 * The point is not "which editor is nicer". It is whether the content-loss
 * problem has a LIBRARY-level answer. Lexical's markdown layer is a
 * line-oriented regex transformer list (@lexical/markdown/src/MarkdownImport.ts),
 * independent of markdown-it, and a line no transformer claims is kept as a
 * literal-text paragraph. So loss should show up not as dropped words but as
 * markdown SYNTAX demoted to prose — which is worse than dropping it, because
 * nothing signals that it happened.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHeadlessEditor } from "@lexical/headless";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
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

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/gi) ?? [];

function minus(a: string, b: string): string[] {
  const pool = new Map<string, number>();
  for (const w of words(b)) pool.set(w, (pool.get(w) ?? 0) + 1);
  const diff: string[] = [];
  for (const w of words(a)) {
    const n = pool.get(w) ?? 0;
    if (n === 0) diff.push(w);
    else pool.set(w, n - 1);
  }
  return diff;
}

const editor = createHeadlessEditor({
  namespace: "spike",
  nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, CodeNode, CodeHighlightNode],
  onError: (e) => {
    throw e;
  },
});

function roundtrip(src: string): string {
  let out = "";
  editor.update(
    () => {
      $convertFromMarkdownString(src, TRANSFORMERS);
      out = $convertToMarkdownString(TRANSFORMERS);
    },
    { discrete: true },
  );
  return out;
}

/**
 * Constructs whose SYNTAX must survive. If the syntax is gone but the words
 * remain, the construct was silently demoted to prose — a table becomes
 * pipe-soup, a `@section` becomes a paragraph reading "@section".
 */
const CONSTRUCTS: Array<[string, RegExp]> = [
  ["marker lines (@chapter/@section/@page)", /^\s*@(?:chapter|section|page|spread|end)\b/gm],
  ["pipe tables", /^\s*\|.*\|\s*$/gm],
  ["attr braces {#id .class}", /\{[#.][-\w]+[^}]*\}/g],
  ["raw HTML blocks", /^\s*<[a-z][\s\S]*?>/gim],
];

let files = 0;
let preserved = 0;
let wordsLost = 0;
const constructLoss = new Map<string, [number, number]>();
const samples: string[] = [];

for (const book of BOOKS) {
  const dir = join(REPO, book);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    files++;
    const src = readFileSync(join(dir, file), "utf8").replace(/\r\n?/g, "\n");
    let out: string;
    try {
      out = roundtrip(src);
    } catch (e) {
      samples.push(`${book}/${file}: THREW — ${String(e).slice(0, 70)}`);
      continue;
    }
    const lost = minus(src, out);
    if (lost.length === 0) preserved++;
    else wordsLost += lost.length;
    for (const [name, re] of CONSTRUCTS) {
      const before = (src.match(re) ?? []).length;
      const after = (out.match(re) ?? []).length;
      if (!before) continue;
      const cur = constructLoss.get(name) ?? [0, 0];
      constructLoss.set(name, [cur[0] + before, cur[1] + after]);
    }
  }
}

console.log(`\n── Lexical (@lexical/markdown TRANSFORMERS) — same corpus, same metric ──`);
console.log(`  CONTENT preserved   : ${preserved}/${files} files, ${wordsLost} words lost`);
console.log(`  SYNTAX survival (occurrences before -> after round-trip):`);
for (const [name, [before, after]] of constructLoss) {
  const verdict = after === before ? "ok" : after === 0 ? "ALL LOST" : "partial";
  console.log(`    ${name.padEnd(40)} ${String(before).padStart(4)} -> ${String(after).padStart(4)}  ${verdict}`);
}
for (const s of samples.slice(0, 5)) console.log(`    ${s}`);
