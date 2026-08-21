/**
 * Edit-cycle proof for a REAL plugin book: simulate what an author actually
 * does — open a chapter richly, type into it, save — and require the save to
 * be EXACTLY the edit.
 *
 * For every chapter this measures, against the chapter's normal form (what
 * is on disk after the product's one-time tidy; the harness also reports how
 * many chapters are already byte-identical to their normal form):
 *
 *   1. LOCALITY — inserting a marker word into the middle of a paragraph via
 *      a real ProseMirror transaction changes EXACTLY ONE line of the saved
 *      bytes, and that line differs only by the insertion. Nothing else in
 *      the file moves.
 *   2. WRAPPER SAFETY — where the chapter holds a phase-2 styled wrapper
 *      (`gp_plugin_block`), the same edit INSIDE the wrapper keeps both
 *      authored marker lines byte-identical.
 *   3. STABILITY — the edited bytes are their own normal form (a save does
 *      not queue up a second rewrite).
 *
 * Run from packages/desktop:
 *   bun tests/editor/plugin-book-edit-cycle.manual.ts <book-dir> [plugin.js]
 */
import { readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { EditorState } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import {
  createDocParser,
  createEditorRenderer,
  normalize,
  serializeDoc,
} from "../../src/lib/editor/markdown-doc";

const BOOK = process.argv[2];
if (!BOOK) {
  console.error("usage: bun tests/editor/plugin-book-edit-cycle.manual.ts <book-dir> [plugin.js]");
  process.exit(2);
}
const pluginArg = process.argv[3];
const pluginPath = pluginArg
  ? isAbsolute(pluginArg)
    ? pluginArg
    : resolve(pluginArg)
  : join(resolve(BOOK), "..", "dc-design-guide", "plugins", "dimm-city-plugin.js");

const mod = await import(pluginPath);
const md = createEditorRenderer([
  { name: "book-plugin", plugin: mod.default, options: {}, css: mod.css },
]);

const MARK = "PROOFWORD";

/** First text position ≥ `min` chars into a paragraph under `root` (which is
 *  the doc, or a gp_plugin_block for the wrapper-interior case). */
function editablePos(doc: PMNode, insideBlock: boolean): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name !== "paragraph" || node.textContent.length < 24) return true;
    if (insideBlock) {
      const $pos = doc.resolve(pos);
      let inBlock = false;
      for (let d = $pos.depth; d > 0; d--) {
        if ($pos.node(d).type.name === "gp_plugin_block") inBlock = true;
      }
      if (!inBlock) return true;
    }
    // After the first word boundary past the 10th character — mid-line,
    // never at a line edge, so locality is tested where it is hardest.
    const text = node.textContent;
    const space = text.indexOf(" ", 10);
    if (space === -1) return true;
    found = pos + 1 + space + 1;
    return false;
  });
  return found;
}

function lineDiff(a: string, b: string): { changed: number; aLine?: string; bLine?: string } {
  const al = a.split("\n");
  const bl = b.split("\n");
  if (al.length !== bl.length) return { changed: -1 };
  let changed = 0;
  let aLine: string | undefined;
  let bLine: string | undefined;
  for (let i = 0; i < al.length; i++) {
    if (al[i] !== bl[i]) {
      changed++;
      aLine = al[i];
      bLine = bl[i];
    }
  }
  return { changed, aLine, bLine };
}

function runEdit(base: string, insideBlock: boolean): string {
  const doc = createDocParser(md).parse(base);
  const pos = editablePos(doc, insideBlock);
  if (pos === null) return insideBlock ? "no-wrapper" : "no-paragraph";
  const state = EditorState.create({ doc });
  const edited = state.apply(state.tr.insertText(`${MARK} `, pos)).doc;
  const out = serializeDoc(edited);

  const d = lineDiff(base, out);
  if (d.changed === -1) return "FAIL: line count changed";
  if (d.changed !== 1) return `FAIL: ${d.changed} lines changed`;
  if (!d.bLine!.includes(MARK)) return "FAIL: changed line lacks the insertion";
  if (d.bLine!.replace(`${MARK} `, "") !== d.aLine) return "FAIL: changed line differs beyond the insertion";
  if (insideBlock) {
    // Both wrapper marker lines must be untouched — they are authored bytes.
    const markers = base.split("\n").filter((l) => /^@(?!page|section|chapter|spread)/.test(l.trim()) && l.trim().startsWith("@"));
    for (const m of markers) if (!out.includes(m)) return `FAIL: marker line lost: ${m}`;
  }
  if (normalize(md, out) !== out) return "FAIL: edited bytes are not their own normal form";
  return "ok";
}

const files = readdirSync(BOOK).filter((f) => f.endsWith(".md")).sort();
let alreadyNormal = 0;
let localityOk = 0;
let localityRan = 0;
let wrapperOk = 0;
let wrapperRan = 0;
const problems: string[] = [];

for (const f of files) {
  const text = readFileSync(join(BOOK, f), "utf8");
  const base = normalize(md, text);
  if (base === text) alreadyNormal++;

  const r1 = runEdit(base, false);
  if (r1 === "ok") {
    localityOk++;
    localityRan++;
  } else if (r1 === "no-paragraph") {
    // nothing editable of size — skip silently
  } else {
    localityRan++;
    problems.push(`LOCALITY ${f}: ${r1}`);
  }

  const r2 = runEdit(base, true);
  if (r2 === "ok") {
    wrapperOk++;
    wrapperRan++;
  } else if (r2 !== "no-wrapper") {
    wrapperRan++;
    problems.push(`WRAPPER  ${f}: ${r2}`);
  }
}

console.log(`book: ${resolve(BOOK)}`);
console.log(`  files:                     ${files.length}`);
console.log(`  already in normal form:    ${alreadyNormal}/${files.length}`);
console.log(`  edit locality (1 line):    ${localityOk}/${localityRan}`);
console.log(`  edit inside styled block:  ${wrapperOk}/${wrapperRan}`);
for (const p of problems) console.log(`  ${p}`);
process.exit(problems.length === 0 ? 0 : 1);
