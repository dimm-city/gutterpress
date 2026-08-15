import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createMarkdownRenderer } from "../../../packages/cli/src/lib/markdown/renderer.ts";
const REPO = new URL("../../../", import.meta.url).pathname;
const BOOKS = ["examples/gutterpress-user-guide","examples/gutterwire-zine","examples/with-validation",
  "examples/with-design-guide/book-01","examples/with-design-guide/book-02",
  "examples/with-design-guide/design-guide","docs/fixtures/css-authoring-spike/book"];
const md = createMarkdownRenderer();
// what stock prosemirror-markdown handles out of the box:
const STOCK = new Set(["blockquote_open","blockquote_close","paragraph_open","paragraph_close",
 "list_item_open","list_item_close","bullet_list_open","bullet_list_close","ordered_list_open",
 "ordered_list_close","heading_open","heading_close","code_block","fence","hr","image","hardbreak",
 "em_open","em_close","strong_open","strong_close","link_open","link_close","code_inline",
 "inline","text","softbreak"]);
const unknown = new Map<string, number>();
const withAttrs = new Map<string, number>();
let files=0;
const walk = (toks: any[]) => { for (const t of toks) {
  if (!STOCK.has(t.type)) unknown.set(t.type, (unknown.get(t.type) ?? 0) + 1);
  // markdown-it-attrs braces land as token attrs (class/id/etc) on ordinary tokens
  const authored = (t.attrs ?? []).filter(([n]: [string]) => !n.startsWith("data-"));
  if (authored.length) for (const [n] of authored) withAttrs.set(`${t.type}[${n}]`, (withAttrs.get(`${t.type}[${n}]`) ?? 0)+1);
  if (t.children) walk(t.children);
} };
for (const b of BOOKS) { const d = join(REPO,b);
  for (const f of readdirSync(d).filter(f=>f.endsWith(".md"))) { files++;
    walk(md.parse(readFileSync(join(d,f),"utf8").replace(/\r\n?/g,"\n"), {})); } }
console.log(`\nTOKEN CENSUS across ${files} corpus files — what a PM schema must cover\n`);
console.log("  NOT handled by stock prosemirror-markdown:");
for (const [k,v] of [...unknown].sort((a,b)=>b[1]-a[1])) console.log(`    ${String(v).padStart(4)}× ${k}`);
console.log("\n  authored attributes riding on tokens (markdown-it-attrs / markers):");
for (const [k,v] of [...withAttrs].sort((a,b)=>b[1]-a[1]).slice(0,12)) console.log(`    ${String(v).padStart(4)}× ${k}`);
