/**
 * Manual acceptance harness for docs/editor-core-rule-provenance-plan.md §7.
 *
 * Measures, for every top-level .md in a REAL plugin book, the three
 * properties the rich editor must hold: rich-editable (canEditRichly), byte
 * fixpoint (isFixpoint — stability of the normal form), and meaning
 * preservation (identical semantic HTML before/after normalize). Loads the
 * book's plugin the way the app does (createEditorRenderer), with the plugin
 * path resolved relative to the book unless given explicitly.
 *
 * Not a bun test (the .manual.ts name keeps it out of `bun test`): it points
 * at content outside this repo. Run from packages/desktop:
 *
 *   bun tests/editor/plugin-book-roundtrip.manual.ts <book-dir> [plugin.js]
 *
 * e.g. for the Dimm City field guide, plugin defaults to
 * ../dc-design-guide/plugins/dimm-city-plugin.js next to the book.
 *
 * Determinism is checked first on the opening file — a stateful plugin
 * would fake both failures, and a run that is not deterministic is not a
 * measurement.
 */
import { readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  canEditRichly,
  createEditorRenderer,
  isFixpoint,
  normalize,
} from "../../src/lib/editor/markdown-doc";
import { semanticHtml } from "../support/semantic-html";

const BOOK = process.argv[2];
if (!BOOK) {
  console.error(
    "usage: bun tests/editor/plugin-book-roundtrip.manual.ts <book-dir> [plugin.js]",
  );
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

const files = readdirSync(BOOK)
  .filter((f) => f.endsWith(".md"))
  .sort();
if (files.length === 0) {
  console.error(`no .md files in ${BOOK}`);
  process.exit(2);
}

// Determinism gate — see header.
{
  const text = readFileSync(join(BOOK, files[0]!), "utf8");
  const deterministic =
    semanticHtml(md.render(text, {})) === semanticHtml(md.render(text, {})) &&
    normalize(md, text) === normalize(md, text);
  if (!deterministic) {
    console.error("NOT DETERMINISTIC — plugin keeps render state; measurement invalid.");
    process.exit(3);
  }
}

let rich = 0;
let fixpoint = 0;
let meaning = 0;
const problems: string[] = [];

for (const f of files) {
  const text = readFileSync(join(BOOK, f), "utf8");
  const verdict = canEditRichly(md, text);
  if (!verdict.ok) {
    problems.push(`SOURCE-MODE   ${f}: ${verdict.reason}`);
    continue;
  }
  rich++;
  if (isFixpoint(md, text).ok) fixpoint++;
  else problems.push(`NOT-FIXPOINT  ${f}`);
  const before = semanticHtml(md.render(text, {}));
  const after = semanticHtml(md.render(normalize(md, text), {}));
  if (before === after) meaning++;
  else problems.push(`MEANING-DRIFT ${f}`);
}

console.log(`book: ${resolve(BOOK)}`);
console.log(`plugin: ${pluginPath}`);
console.log(`  files:             ${files.length}`);
console.log(`  rich-editable:     ${rich}/${files.length}`);
console.log(`  byte fixpoint:     ${fixpoint}/${rich}`);
console.log(`  meaning preserved: ${meaning}/${rich}`);
for (const p of problems) console.log(`  ${p}`);
process.exit(problems.length === 0 ? 0 : 1);
