/**
 * real-book-locality.test.ts (SFE-P3d-parity, Lane B)
 *
 * Parity-gate condition 3, DELIVERABLE 2 — "Real user-guide and plugin-book
 * chapters can be edited without byte drift": the EXPLICIT-EDIT half. Run
 * spec (docs/plans/source-first-editor/runs/SFE-P3d-parity.md) behavior
 * table, "Real-book explicit edits" row: "A representative edit in each
 * real chapter changes exactly its own range and nothing else, asserted
 * against an independent oracle (the P2a locality oracle, reused, not
 * re-derived)."
 *
 * ## The reused oracle (AC-03/AC-04, and the run spec's own instruction:
 * "REUSE the independent-bound locality oracle SFE-P2a built ... do not
 * re-derive a second oracle; a second oracle that agrees with the
 * implementation because it shares its assumptions proves nothing")
 *
 * `packages/editor/tests/corpus/support/independent-bound.ts`'s
 * `assertEditWithinIndependentBound` is SFE-P2a's own, hand-written,
 * NOT-imported-from-the-implementation line scanner — its own header
 * documents why the FIRST version of that corpus's locality check was
 * vacuous ("the independent-splice oracle IS the host's own splice
 * expression") and how this replacement fixes that (per-command-family
 * bounds computed independently of `src/web/standard/*`). This file imports
 * that exact function and `selectionVariants` (also P2a's own, unmodified)
 * rather than writing a second bound-checker — the run spec's explicit
 * instruction. `command-harness.ts`'s `CORPUS_COMMAND_CASES`,
 * `computeAgainstHost`, and `spliceIndependently` are reused the same way:
 * they are plain data/harness plumbing, not a second oracle (the oracle is
 * `assertEditWithinIndependentBound` alone).
 *
 * ## What is NEW here versus P2a's own corpus
 *
 * P2a's `locality.test.ts` proves this against synthetic fixtures and
 * `MemoryDocumentHost`. This file proves the SAME oracle against:
 *
 *   - REAL book chapters (the exact 25-file corpus
 *     `real-book-byte-identity.test.ts` defines and documents — see that
 *     file's header for the corpus's provenance and the honest "no example
 *     book declares an actual plugin" finding);
 *   - the REAL desktop session class, `DesktopDocumentHost` — not the
 *     in-memory test host — so this exercises the actual
 *     `DocumentSession`/`applyEditPure`/notification wiring
 *     `+page.svelte`'s `richDocHost` runs in production;
 *   - the REAL desktop rich-mode command router,
 *     `applyRichCommand` (`../../src/lib/editor/rich-commands.ts`) — the
 *     literal function `+page.svelte`'s toolbar/keyboard handlers call —
 *     for a representative case per chapter (second describe block below),
 *     cross-checked against the same oracle-bound edit `applyCommand`
 *     computes for the identical selection/command pair.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DesktopDocumentHost } from "../../src/lib/editor-host/desktop-document-host";
import { applyRichCommand } from "../../src/lib/editor/rich-commands";
import { DIAGNOSTIC_CATEGORIES } from "@dimm-city/gutterpress-editor/core";
import {
  CORPUS_COMMAND_CASES,
  computeAgainstHost,
  spliceIndependently,
  wholeDocumentSelection,
  type CorpusCommandCase,
} from "../../../editor/tests/corpus/support/command-harness.ts";
import {
  assertEditWithinIndependentBound,
  selectionVariants,
} from "../../../editor/tests/corpus/support/independent-bound.ts";

const EXAMPLES_ROOT = path.resolve(import.meta.dir, "../../../../examples");

interface RealBookFile {
  readonly id: string;
  readonly corpus: string;
  readonly path: string;
}

function chaptersOf(corpus: string, dir: string, files: readonly string[]): RealBookFile[] {
  return files.map((f) => ({ id: `${corpus}/${f}`, corpus, path: path.join(EXAMPLES_ROOT, dir, f) }));
}

/** The same 25-file corpus `real-book-byte-identity.test.ts` defines — duplicated here (not imported: this lane's write ownership is `real-book-*.test.ts` files only, each self-contained) rather than factored into a shared support module. */
const REAL_BOOK_FILES: readonly RealBookFile[] = [
  ...chaptersOf("gutterpress-user-guide", "gutterpress-user-guide", [
    "00-cover.md",
    "00-toc.md",
    "01-getting-started.md",
    "02-writing-content.md",
    "03-visual-elements.md",
    "04-styling-theming.md",
    "05-plugins.md",
    "06-validation.md",
    "07-system-setup.md",
    "08-publishing.md",
    "README.md",
  ]),
  ...chaptersOf("with-design-guide/design-guide", "with-design-guide/design-guide", [
    "00-toc.md",
    "00-overview.md",
    "01-typography.md",
    "02-palette.md",
    "03-components.md",
    "04-page-templates.md",
    "05-layout.md",
    "06-markdown-reference.md",
    "101-publishing.md",
  ]),
  ...chaptersOf("with-design-guide/book-01", "with-design-guide/book-01", ["chapter-01.md"]),
  ...chaptersOf("with-design-guide/book-02", "with-design-guide/book-02", ["chapter-01.md"]),
  ...chaptersOf("with-validation", "with-validation", ["README.md", "chapter-01.md", "chapter-02.md"]),
];

const LOADED = REAL_BOOK_FILES.map((f) => ({ ...f, text: readFileSync(f.path, "utf8") }));

let acceptedCount = 0;
let refusedCount = 0;

describe("real-book explicit-edit locality against the REUSED P2a independent bound", () => {
  for (const file of LOADED) {
    for (const commandCase of CORPUS_COMMAND_CASES) {
      for (const { label: selectionLabel, selection } of selectionVariants(file.text)) {
        test(`${file.id} / ${commandCase.label} / ${selectionLabel} — edit fits its command's independent bound`, () => {
          // The REAL desktop session class, freshly constructed per case
          // (AP-25: no fixture or host reused/mutated across cases).
          const host = new DesktopDocumentHost(file.text, { documentId: file.id });
          const result = computeAgainstHost(host, selection, commandCase.command);

          if ("refused" in result) {
            expect(DIAGNOSTIC_CATEGORIES).toContain(result.refused.category);
            expect(host.getSnapshot().text).toBe(file.text);
            refusedCount++;
            return;
          }
          acceptedCount++;
          // The independent oracle — SFE-P2a's own, reused verbatim.
          assertEditWithinIndependentBound(commandCase.command, file.text, selection, result.edit);
        });
      }
    }
  }

  test("liveness (AP-21): the real-book x command x selection-variant sweep was not universally refused", () => {
    const total = acceptedCount + refusedCount;
    expect(total).toBeGreaterThan(0);
    expect(acceptedCount).toBeGreaterThan(0);
  });
});

describe("explicit edit touches ONLY its own range — direct prefix/suffix proof on real chapters", () => {
  // A smaller, representative cross-product (whole-document selection, one
  // case per command kind) proving the STRONGER "prefix/suffix untouched"
  // check (mirrors P2a's own byte-identity/locality.test.ts) directly on
  // real book bytes, not just the abstract bound.
  for (const file of LOADED) {
    for (const commandCase of CORPUS_COMMAND_CASES) {
      test(`${file.id} / ${commandCase.label} (whole-document selection) — bytes outside [from,to) are untouched`, () => {
        const host = new DesktopDocumentHost(file.text, { documentId: file.id });
        const selection = wholeDocumentSelection(file.text);
        const result = computeAgainstHost(host, selection, commandCase.command);
        if ("refused" in result) {
          expect(host.getSnapshot().text).toBe(file.text);
          return;
        }
        const { edit } = result;
        const originalPrefix = file.text.slice(0, edit.from);
        const originalSuffix = file.text.slice(edit.to);
        const actual = host.getSnapshot().text;

        const expected = spliceIndependently(file.text, edit.from, edit.to, edit.insert);
        expect(actual).toBe(expected);
        expect(actual.startsWith(originalPrefix)).toBe(true);
        expect(actual.endsWith(originalSuffix)).toBe(true);
        expect(actual.slice(0, edit.from)).toBe(originalPrefix);
        expect(actual.slice(actual.length - originalSuffix.length)).toBe(originalSuffix);
      });
    }
  }
});

/**
 * The literal desktop production entry point, `applyRichCommand`
 * (`rich-commands.ts`) — what `+page.svelte`'s toolbar/keyboard handlers
 * actually call in rich mode. It wraps `applyCommand` with two small,
 * range-preserving resolutions (`resolveHeadingToggle`,
 * `resolveLinkOverride` — see that file's header) that change WHAT is
 * inserted for `set-heading`/`insert-link`, never the computed `[from,to)`
 * range, so a representative NON-heading, NON-link command (`toggle-bold`)
 * lets this block prove `applyRichCommand`'s real output agrees, byte for
 * byte, with the independently oracle-bound edit `applyCommand` computes
 * for the identical (snapshot, selection, command) triple.
 */
const REPRESENTATIVE_CASE: CorpusCommandCase = CORPUS_COMMAND_CASES.find((c) => c.label === "toggle-bold")!;

describe("the actual desktop entry point (applyRichCommand) agrees with the oracle-bound edit", () => {
  for (const file of LOADED) {
    test(`${file.id} — applyRichCommand(toggle-bold) at a mid-document caret produces exactly the oracle-bound splice`, () => {
      const { selection } =
        selectionVariants(file.text).find((v) => v.label === "caret mid-document") ??
        selectionVariants(file.text)[0]!;
      const live = { from: selection.start, to: selection.endExclusive };

      // Independently compute the expected edit via the shared command
      // layer directly (not through rich-commands.ts) on a throwaway host.
      const oracleHost = new DesktopDocumentHost(file.text, { documentId: `${file.id}#oracle` });
      const oracleResult = computeAgainstHost(oracleHost, selection, REPRESENTATIVE_CASE.command);

      // The real production entry point, on its OWN independent host.
      const realHost = new DesktopDocumentHost(file.text, { documentId: `${file.id}#real` });
      const outcome = applyRichCommand(realHost, REPRESENTATIVE_CASE.command, live);

      if ("refused" in oracleResult) {
        expect(outcome.ok).toBe(false);
        expect(realHost.getSnapshot().text).toBe(file.text);
        return;
      }
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      assertEditWithinIndependentBound(REPRESENTATIVE_CASE.command, file.text, selection, oracleResult.edit);
      const expected = spliceIndependently(
        file.text,
        oracleResult.edit.from,
        oracleResult.edit.to,
        oracleResult.edit.insert,
      );
      expect(outcome.snapshot.text).toBe(expected);
    });
  }
});
