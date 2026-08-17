import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { canEditRichly, createEditorRenderer, isFixpoint } from "../../src/lib/editor/markdown-doc";

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
