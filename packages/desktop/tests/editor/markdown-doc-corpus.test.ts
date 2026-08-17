import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { canEditRichly, createEditorRenderer, isFixpoint, normalize } from "../../src/lib/editor/markdown-doc";

/**
 * The corpus gate.
 *
 * Two properties, over every markdown file in every example book. Neither has
 * a threshold, a `.trim()` or an allowlist — the postmortem's
 * `BYTE_IDENTICAL_MIN = 0.8` existed to hide known lossiness and is exactly
 * the shape being avoided here.
 *
 * 1. FAIL CLOSED. A file either parses into the document model or it does not.
 *    A file that does not is reported, not silently degraded — it opens in
 *    source mode in the app.
 *
 * 2. FIXPOINT. For every file that DOES parse, normalizing an
 *    already-normalized document must return it unchanged. This compares
 *    SOURCE to SOURCE. It deliberately does not compare rendered HTML:
 *    markdown-it applies `typographer` and `linkify` before the ProseMirror
 *    document exists, so an HTML comparison would pass no matter how lossy
 *    the serializer is.
 */
const REPO = resolve(import.meta.dir, "..", "..", "..", "..");

const BOOKS = [
  "examples/gutterpress-user-guide",
  "examples/with-design-guide/design-guide",
  "examples/with-design-guide/book-01",
  "examples/with-design-guide/book-02",
  "examples/gutterwire-zine",
  "examples/with-validation",
  "docs/fixtures/css-authoring-spike/book",
  "docs/fixtures/gp-image-positioning/book",
];

function chaptersOf(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".md"))
      .map((n) => join(dir, n))
      .filter((p) => statSync(p).isFile())
      .sort();
  } catch {
    return [];
  }
}

const files = BOOKS.flatMap((b) => chaptersOf(join(REPO, b)));

describe("corpus", () => {
  test("the corpus is actually present — this gate must not pass vacuously", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  const editable: string[] = [];
  const refused: Array<{ file: string; reason: string }> = [];

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const verdict = canEditRichly(createEditorRenderer(), text);
    if (verdict.ok) editable.push(file);
    else refused.push({ file: file.slice(REPO.length + 1), reason: verdict.reason });
  }

  test("every refusal names its cause (so the UI can explain source mode)", () => {
    for (const r of refused) expect(r.reason.length).toBeGreaterThan(0);
  });

  test("REPORT: rich-edit coverage across the corpus", () => {
    const pct = ((editable.length / files.length) * 100).toFixed(1);
    const causes = new Map<string, number>();
    for (const r of refused) {
      const m = /Token type `([^`]+)`/.exec(r.reason);
      const key = m ? m[1]! : r.reason.slice(0, 60);
      causes.set(key, (causes.get(key) ?? 0) + 1);
    }
    // Printed, not asserted on: this is the number that decides whether the
    // approach is worth building UI on, and it must be visible rather than
    // inferred from a pass/fail.
    console.log(`\n  rich-editable: ${editable.length}/${files.length} files (${pct}%)`);
    for (const [cause, n] of [...causes].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(3)} refused by: ${cause}`);
    }
    expect(files.length).toBeGreaterThan(0);
  });

  /**
   * THE GATE THAT ACTUALLY CATCHES CONTENT LOSS.
   *
   * The fixpoint test below is necessary but NOT sufficient, and shipping
   * proved it: `markdown-it-attrs` braces were being dropped —
   * `![Art](art.jpg){.gp-bleed}` came back as `![Art](art.jpg)`, and every
   * `# Heading {#custom-id}` lost its anchor — while the fixpoint test stayed
   * green, because an attribute lost on the FIRST normalization is perfectly
   * stable on the second.
   *
   * This compares what the two texts MEAN: render both through the print
   * pipeline and require identical HTML. That is exactly the comparison
   * rejected earlier as a REPLACEMENT for the fixpoint (it cannot see text
   * normalization, because typographer and linkify run before the ProseMirror
   * document exists) — but as an ADDITION it is the only thing here that can
   * see a dropped attribute, a dropped node, or reordered content.
   *
   * Two gates, two different blindnesses, and neither covers the other.
   */
  /**
   * Drop the two attributes that encode SOURCE COORDINATES rather than
   * content: `data-source-range` (ADR 0009's editor↔preview mapping) and
   * `data-source-line`. Normalization legitimately moves line numbers — that
   * is what reformatting IS — so comparing them would flag every reflowed
   * paragraph as content loss and the gate would have to be thrown away.
   *
   * Exactly these two, nothing else. Every other attribute, including the
   * `class` and `id` that regressed, stays in the comparison.
   */
  const semanticHtml = (html: string) =>
    html
      .replace(/ data-source-(range|line)="[^"]*"/g, "")
      // Same class of thing: `data-gp-source-token` / `-occurrence` are the
      // preview↔source mapping the preview interface reads to find which
      // token produced an element. They appear on an authored `[a](b)` but not
      // on a bare domain that `linkify` turned into a link, so normalizing
      // `itch.io` to `[itch.io](http://itch.io)` adds them. The href and the
      // link text — the parts that reach the PDF — are unchanged.
      .replace(/ data-gp-source-(token|occurrence)="[^"]*"/g, "")
      // A soft line break inside a paragraph renders as a literal newline;
      // unwrapping turns it into a space. HTML collapses both identically, so
      // this is the accepted reformatting, not lost content.
      //
      // Collapsed everywhere EXCEPT inside `<pre>`, where whitespace is
      // significant and a real difference would be a genuine defect — so the
      // gate keeps its teeth on code blocks.
      .split(/(<pre[\s\S]*?<\/pre>)/)
      .map((part, i) => (i % 2 === 1 ? part : part.replace(/\s+/g, " ")))
      .join("");

  test("normalizing NEVER changes what the document means", () => {
    const lost: Array<{ file: string; detail: string }> = [];
    for (const file of editable) {
      const text = readFileSync(file, "utf8");
      const md = createEditorRenderer();
      const before = semanticHtml(md.render(text, {}));
      const after = semanticHtml(md.render(normalize(createEditorRenderer(), text), {}));
      if (before !== after) {
        const a = before.split("\n");
        const b = after.split("\n");
        const at = a.findIndex((l, i) => l !== b[i]);
        lost.push({
          file: file.slice(REPO.length + 1),
          detail: `line ${at}:\n        was: ${JSON.stringify(a[at]?.slice(0, 160))}\n        got: ${JSON.stringify(b[at]?.slice(0, 160))}`,
        });
      }
    }
    if (lost.length) {
      console.log(`\n  ${lost.length} file(s) lose meaning when normalized:`);
      for (const l of lost.slice(0, 8)) console.log(`    ${l.file}\n      ${l.detail}`);
    }
    expect(lost).toEqual([]);
  });

  test("EVERY rich-editable file is a fixpoint — no threshold, no allowlist", () => {
    const drifted: Array<{ file: string; diff: string }> = [];
    for (const file of editable) {
      const text = readFileSync(file, "utf8");
      const r = isFixpoint(createEditorRenderer(), text);
      if (!r.ok) {
        const a = r.normalized.split("\n");
        const b = r.second.split("\n");
        const at = a.findIndex((l, i) => l !== b[i]);
        drifted.push({
          file: file.slice(REPO.length + 1),
          diff: `line ${at}: ${JSON.stringify(a[at])} -> ${JSON.stringify(b[at])}`,
        });
      }
    }
    if (drifted.length) {
      console.log(`\n  ${drifted.length} file(s) drift on a second save:`);
      for (const d of drifted.slice(0, 10)) console.log(`    ${d.file}\n      ${d.diff}`);
    }
    expect(drifted).toEqual([]);
  });
});
