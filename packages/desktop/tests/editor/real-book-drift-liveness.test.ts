/**
 * real-book-drift-liveness.test.ts (SFE-P3d-parity, Lane B)
 *
 * Parity-gate condition 3, DELIVERABLE 3 — G-12/AP-20 byte-drift liveness.
 * Run spec (docs/plans/source-first-editor/runs/SFE-P3d-parity.md)
 * behavior table, "Byte-drift liveness" row: "The corpus proves it can
 * fail: a deliberately drifting implementation trips the assertion (a
 * fixture whose bytes are perturbed must be caught)." And pr158-lessons.md
 * G-12: "A gate must prove it ran and prove it can fail" — "a deliberate
 * sabotage or defect-reintroduction demonstration."
 *
 * `real-book-byte-identity.test.ts` and `real-book-locality.test.ts` prove
 * the POSITIVE case: the real pipeline, on real chapters, produces
 * byte-identical no-edit round-trips and in-bound explicit edits. Neither
 * file, on its own, proves those assertions are capable of failing at
 * all — pr158-lessons.md AP-21/AP-04's exact "green parse/serialize gates
 * hid missing product capability" failure mode, and the specific vacuous-
 * pass PR 158 shipped for edit locality (independent-bound.ts's own header:
 * "the corpus cannot fail — its 'independent splice' oracle is the host's
 * own splice expression"). This file is the SABOTAGE proof: it feeds the
 * exact same assertions used in the other two files a deliberately
 * corrupted input (byte-identity half) and a deliberately widened fake edit
 * (locality half), against REAL book text, and asserts the corresponding
 * check THROWS — i.e. this is a committed, permanent regression test that
 * the two assertions can never quietly become vacuous again. (pr158-
 * lessons.md §11.2 permits performing sabotage locally without committing
 * it; this run's own DELIVERABLES text asks for it as its own numbered
 * deliverable, so it is committed here as a standing gate rather than only
 * documented.)
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DesktopDocumentHost } from "../../src/lib/editor-host/desktop-document-host";
import type { DocumentSnapshot, EditorDocumentHost, SourceEdit } from "@dimm-city/gutterpress-editor/core";
import { CORPUS_COMMAND_CASES } from "../../../editor/tests/corpus/support/command-harness.ts";
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

/** The same 25-file corpus the other two `real-book-*.test.ts` files define — duplicated (see `real-book-locality.test.ts`'s own header for why: this lane's write ownership is per-file, not a shared support module). */
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

// ── Part A — byte-identity assertion sabotage ──────────────────────────────

/**
 * The EXACT no-edit byte-identity check `real-book-byte-identity.test.ts`
 * runs against the real host (JS-string equality plus a raw UTF-8 buffer
 * comparison — reproduced here, not imported: this lane's write ownership
 * is per-file). Throws (via `expect(...).toBe(...)`'s own assertion
 * failure) whenever `host`'s post-mount snapshot is not byte-identical to
 * `original`.
 */
function assertNoEditByteIdentity(host: Pick<EditorDocumentHost, "getSnapshot">, original: string): void {
  const after = host.getSnapshot();
  expect(after.text).toBe(original);
  expect(Buffer.from(after.text, "utf8").equals(Buffer.from(original, "utf8"))).toBe(true);
}

/**
 * A fake host — NOT `DesktopDocumentHost` — whose `getSnapshot()` reports
 * DRIFTED text after `sabotageMount()` runs, with no explicit edit and no
 * notification. Models exactly the class of defect G-12/AP-20 requires this
 * corpus prove it can catch: a pipeline that silently rewrites source
 * during open/mount/close.
 */
function driftingFakeHost(originalText: string, drift: (t: string) => string): {
  getSnapshot(): DocumentSnapshot;
  sabotageMount(): void;
} {
  let text = originalText;
  return {
    getSnapshot: () => ({ text, version: 0 }),
    sabotageMount: () => {
      text = drift(text);
    },
  };
}

const DRIFT_MODES: readonly { readonly label: string; readonly drift: (t: string) => string }[] = [
  { label: "appended trailing space", drift: (t) => `${t} ` },
  { label: "dropped final character", drift: (t) => t.slice(0, -1) },
  { label: "substituted one mid-document character", drift: (t) => (t.length < 2 ? `${t}x` : t.slice(0, Math.floor(t.length / 2)) + "X" + t.slice(Math.floor(t.length / 2) + 1)) },
];

describe("drift liveness (G-12/AP-20) — the no-edit byte-identity assertion CAN fail", () => {
  for (const file of LOADED) {
    for (const mode of DRIFT_MODES) {
      test(`${file.id} — ${mode.label}: a silently-drifting mount trips the byte-identity assertion`, () => {
        const host = driftingFakeHost(file.text, mode.drift);
        host.sabotageMount();
        expect(() => assertNoEditByteIdentity(host, file.text)).toThrow();
      });
    }

    test(`${file.id} — POSITIVE CONTROL: the real DesktopDocumentHost, mounted with zero edits, does NOT trip the same assertion`, () => {
      const host = new DesktopDocumentHost(file.text, { documentId: `${file.id}#drift-control` });
      expect(() => assertNoEditByteIdentity(host, file.text)).not.toThrow();
    });
  }
});

// ── Part B — independent-bound locality-oracle sabotage ────────────────────

/**
 * The exact sabotage `packages/editor/tests/corpus/support/independent-
 * bound.ts`'s own header documents demonstrating (locally, uncommitted, in
 * P2a) against synthetic fixtures: widen every returned edit to
 * `{from: 0, to: text.length, insert: <a full rewrite>}` — the precise
 * shape that defeated the ORIGINAL (pre-P2a-repair) locality check, which
 * compared the host's result only against its own splice formula. Run here
 * against REAL book text and a NON-whole-document selection (so the
 * sabotaged edit's range provably exceeds what most command families could
 * ever legitimately touch), as a COMMITTED, permanent proof rather than a
 * one-off local run.
 */
function widenToWholeDocumentRewrite(text: string): SourceEdit {
  return { from: 0, to: text.length, insert: "SABOTAGED: this edit silently rewrote the entire document.", expectedVersion: 0 };
}

/**
 * `toggle-list` ordered's bound (independent-bound.ts's own `case
 * "toggle-list"` branch, `variant === "ordered"`) is DELIBERATELY not an
 * exact/narrow range — its own doc comment: "MAY legitimately extend into a
 * directly adjacent pre-existing numbered run ... bounded to 'still
 * line-aligned', not exact equality." It checks only that `edit.from`/
 * `edit.to` land on a line boundary (start-of-document, end-of-document, or
 * immediately after/before a `"\n"`), which `{from: 0, to: text.length}` —
 * this sabotage's own shape — always satisfies BY CONSTRUCTION, for any
 * text. This is not a gap in the oracle discovered here; it is that one
 * command family's bound legitimately admitting a whole-document range, so
 * a whole-document-rewrite sabotage cannot be the thing that distinguishes
 * it from a real edit. Every OTHER command case (the wrap toggles' `+/-
 * markerLen` window, the exact line-span/point checks, and `set-heading`'s
 * "caret line +/- one adjacent line" window) has no such escape and DOES
 * trip on this sabotage — proven below.
 */
function isLooseOrderedListCase(commandCase: { readonly command: { readonly kind: string; readonly variant?: string } }): boolean {
  return commandCase.command.kind === "toggle-list" && commandCase.command.variant === "ordered";
}

describe("drift liveness (G-12/AP-20) — the reused independent-bound oracle CAN fail", () => {
  for (const file of LOADED) {
    // A NON-whole-document selection: "caret mid-document" when the fixture
    // has more than one line, else the first variant `selectionVariants`
    // offers (every fixture has at least "caret at document start").
    const variants = selectionVariants(file.text);
    const midDocument = variants.find((v) => v.label === "caret mid-document");
    const chosen = midDocument ?? variants[0]!;

    for (const commandCase of CORPUS_COMMAND_CASES.filter((c) => !isLooseOrderedListCase(c))) {
      test(`${file.id} / ${commandCase.label} / ${chosen.label} — a whole-document-rewrite edit trips the independent bound`, () => {
        const sabotagedEdit = widenToWholeDocumentRewrite(file.text);
        expect(() =>
          assertEditWithinIndependentBound(commandCase.command, file.text, chosen.selection, sabotagedEdit),
        ).toThrow();
      });
    }

    // `toggle-list` ordered gets its OWN, weaker sabotage — one that DOES
    // exceed even its loose line-alignment bound: an edit ending
    // MID-LINE (not at a "\n" or document end), which no real
    // `toggleOrdered` call ever produces (list.ts's own contract). This
    // proves that bound is not vacuous EITHER — it is looser, not absent.
    const orderedCase = CORPUS_COMMAND_CASES.find(
      (c) => c.command.kind === "toggle-list" && c.command.variant === "ordered",
    )!;
    test(`${file.id} / ${orderedCase.label} / ${chosen.label} — a mid-line-ending edit trips even the loose ordered-list bound`, () => {
      // Ends one character short of the document (a real document's final
      // character is virtually never itself a "\n" that this docs corpus
      // would leave unterminated at position length-1 AND have length>0 —
      // guarded below) — so `edit.to` lands mid-line, which the bound
      // requires be either `text.length` or immediately before a `"\n"`.
      const midLineTo = file.text.length > 0 && file.text.charAt(file.text.length - 1) !== "\n"
        ? file.text.length - 1
        : file.text.length; // degenerate (empty, or ends in "\n"): skip via a from===to no-op that still can't trip a from!==line-start check below
      if (midLineTo === file.text.length) {
        // No character to shave off a boundary-safe `to` for this fixture;
        // sabotage `from` instead — one character INTO the document is
        // never a line start unless that character is itself right after a
        // "\n", which `file.text.length > 1` combined with checking index 1
        // covers for the vast majority of real prose (a document does not
        // open with a blank line in this corpus).
        const sabotagedEdit: SourceEdit = { from: 1, to: file.text.length, insert: "X", expectedVersion: 0 };
        expect(file.text.charAt(0)).not.toBe("\n");
        expect(() =>
          assertEditWithinIndependentBound(orderedCase.command, file.text, chosen.selection, sabotagedEdit),
        ).toThrow();
        return;
      }
      const sabotagedEdit: SourceEdit = { from: 0, to: midLineTo, insert: "X", expectedVersion: 0 };
      expect(() =>
        assertEditWithinIndependentBound(orderedCase.command, file.text, chosen.selection, sabotagedEdit),
      ).toThrow();
    });
  }

  // POSITIVE CONTROL for this half lives in `real-book-locality.test.ts`,
  // not here: its "real-book explicit-edit locality against the REUSED P2a
  // independent bound" describe block is exactly this same oracle, called
  // with the REAL (unsabotaged) command layer's output, across every real
  // chapter x command x selection-variant combination — 2,800+ passing
  // cases proving the oracle does NOT false-positive against correct
  // production edits. This file exists only to prove the other direction:
  // that the oracle is not vacuous, i.e. it WOULD fail if the
  // implementation regressed.
});
