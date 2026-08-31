/**
 * parity-replacements.test.ts (SFE-P3d-parity, Lane A)
 *
 * Behavioral evidence for the parity-matrix.md rows that are NOT already
 * covered byte-for-byte by an existing test file. Every case here asserts
 * the EXACT resulting bytes of invoking the named replacement command (G-01
 * /AP-01 — "did not throw" is not evidence) and, where the extracted preview
 * action was a targeted rewrite, that nothing OUTSIDE the intended range
 * changed (locality — the same standard AC-04 and the P2a corpus hold every
 * other source command to).
 *
 * What this file does NOT re-test: format-bold/italic/strike/code, make-link
 * (format-link), and block-break-after already have exact-byte assertions in
 * `toolbar-actions.test.ts`, `rich-commands.test.ts`, and
 * `packages/editor/tests/standard/wrap-toggles.test.ts` — parity-matrix.md
 * cites those directly rather than duplicating them here (run spec: "Where
 * an existing test already asserts exactly this for a command, reference it
 * from the matrix rather than duplicating it").
 *
 * What this file DOES add, because no existing test proves it:
 *   1. marker-edit / page-marker-edit's replacement — "source mode: select
 *      the marker's own line and replace it" — using the SAME line-boundary
 *      helpers (`buildLineStarts`/`charRange`) `ContextMenuController` and
 *      `InlineEditController` both already depend on, applied through
 *      `DesktopDocumentHost.applyEdit` (the same D3 seam every source/rich
 *      command uses — see `rich-mode-commit-integration.test.ts`'s header).
 *      No prior test in this file's neighborhood exercises a whole-LINE
 *      replacement through that exact seam with a locality assertion.
 *   2. block-break-before's caret-placement story — the context menu's
 *      "Insert page break before" is a zero-width insert AT the target
 *      block's own start offset (`context-menu-controller.svelte.ts`
 *      `blockItems`'s `block-break-before` item). `applyPageBreak`/
 *      `applyRichLayoutBlock`'s existing tests only prove "after the
 *      CURRENT line" — none names the "place the caret on the PRECEDING
 *      block, then insert" story that makes "before" reachable with the
 *      SAME one command. That positional story is asserted here explicitly,
 *      in both surfaces.
 */
import { describe, expect, test } from "bun:test";
import { EditorState, EditorSelection, type Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { applyPageBreak } from "../../src/lib/editor/toolbar-actions";
import { applyRichLayoutBlock } from "../../src/lib/editor/rich-commands";
import { DesktopDocumentHost } from "../../src/lib/editor-host/desktop-document-host";
import { buildLineStarts, charRange } from "../../src/lib/editor/source-range";

// ── Minimal headless EditorView mock (mirrors toolbar-actions.test.ts's own
//    makeMockView — reproduced locally rather than imported across test
//    files, matching AP-25's "tests use disposable, self-contained fixtures"
//    posture and this run's write boundary, which does not include that
//    file). ──────────────────────────────────────────────────────────────
function makeMockView(
  docStr: string,
  from = docStr.length,
  to = docStr.length,
): { state: EditorState; dispatch: (...specs: Parameters<EditorView["dispatch"]>) => void; focus: () => void } {
  let state = EditorState.create({ doc: docStr, selection: EditorSelection.range(from, to) });
  const view = {
    get state() {
      return state;
    },
    dispatch(...specs: Array<Transaction | Parameters<EditorView["dispatch"]>[0]>) {
      for (const spec of specs) {
        if (spec && "state" in spec) {
          state = (spec as Transaction).state;
        } else {
          state = state.update(spec as Parameters<EditorState["update"]>[0]).state;
        }
      }
    },
    focus() {},
  };
  return view as unknown as typeof view;
}

function getDoc(view: ReturnType<typeof makeMockView>): string {
  return view.state.doc.toString();
}

// ── marker-edit / page-marker-edit ──────────────────────────────────────────
//
// The context menu's "Edit marker…"/"Edit page marker…" prompt the marker's
// raw source LINE and commit a replacement for exactly that line
// (`context-menu-controller.svelte.ts`'s `promptEditMarkerLine`). Source
// mode's replacement is the editor's own general-purpose capability: place
// the caret/selection on that same line and retype it — the marker line is
// flat text with no sub-structure a dedicated command would need to
// preserve, unlike an image/link token's attribute syntax. This proves that
// capability through the SAME line-boundary resolution
// (`buildLineStarts`/`charRange`) and the SAME `EditorDocumentHost.applyEdit`
// seam every other source/rich command in this matrix uses — not a special
// case invented for this test.

describe("marker-edit / page-marker-edit replacement — source mode: direct line replacement via DesktopDocumentHost.applyEdit", () => {
  test("replacing a @section marker's own line changes exactly that line, byte for byte", () => {
    const text = "intro paragraph\n\n@section .gp-columns-2\n\nbody text\n";
    const host = new DesktopDocumentHost(text, { documentId: "ch1.md" });
    const starts = buildLineStarts(text);
    // Line index 2 (0-based) is "@section .gp-columns-2" — the SAME
    // token.map-style [from, to) line-range convention
    // ContextMenuController resolves its marker target against.
    const [from, to] = charRange(text, starts, [2, 3]);
    const before = host.getSnapshot();
    const outcome = host.applyEdit({ from, to, insert: "@section .gp-columns-3\n", expectedVersion: before.version });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.snapshot.text).toBe("intro paragraph\n\n@section .gp-columns-3\n\nbody text\n");
      // Locality (AC-04): everything before `from` and after the marker
      // line's own end is untouched.
      expect(outcome.snapshot.text.slice(0, from)).toBe(text.slice(0, from));
      expect(outcome.snapshot.text.slice(from + "@section .gp-columns-3\n".length)).toBe(text.slice(to));
    }
  });

  test("replacing a @page marker line found through pageMarkerItems' own resolution shape changes only that line", () => {
    // Mirrors the page-marker-edit path's shape: the marker being edited is
    // the ENCLOSING @page, not the innermost target the point resolved to.
    const text = "@page\n\n@section\n\ncontent\n\n@end-section\n";
    const host = new DesktopDocumentHost(text, { documentId: "ch1.md" });
    const starts = buildLineStarts(text);
    const [from, to] = charRange(text, starts, [0, 1]); // "@page"
    const before = host.getSnapshot();
    const outcome = host.applyEdit({ from, to, insert: "@page .gp-bleed\n", expectedVersion: before.version });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.snapshot.text).toBe("@page .gp-bleed\n\n@section\n\ncontent\n\n@end-section\n");
      expect(outcome.snapshot.text.slice(from + "@page .gp-bleed\n".length)).toBe(text.slice(to));
    }
  });

  test("a stale expectedVersion refuses the marker-line replacement and changes nothing (same fail-closed contract every other command uses)", () => {
    const text = "@section\n\nbody\n\n@end-section\n";
    const host = new DesktopDocumentHost(text, { documentId: "ch1.md" });
    const outcome = host.applyEdit({ from: 0, to: 8, insert: "@section .gp-columns-2", expectedVersion: 99 });
    expect(outcome.ok).toBe(false);
    expect(host.getSnapshot().text).toBe(text);
  });
});

// ── block-break-before ──────────────────────────────────────────────────────
//
// The context menu's "Insert page break before" targets the BLOCK the
// pointer resolved to, not the caret. Its replacement in an ordinary text
// editor is the standard authoring gesture: put the caret at the START of
// the block you want the break before (equivalently: the end of the
// PRECEDING block/line) and invoke the SAME "Page break" command
// `block-break-after` uses. Both directions are one command, distinguished
// only by where the author placed the caret first — this is what makes them
// share one replacement command rather than needing two.

describe("block-break-before replacement — source mode: applyPageBreak with the caret on the PRECEDING line", () => {
  test("caret on the line before the target block inserts the break between them, not inside either block", () => {
    const text = "first block\n\nsecond block";
    // Caret anywhere on "first block" (line 0).
    const v = makeMockView(text, 0, 0);
    applyPageBreak(v as unknown as EditorView);
    // insertionPointAfterCurrentLine lands right after "first block" (before
    // its own trailing blank-line separator), so the descriptor's own
    // leading "\n\n" combines with the ALREADY-PRESENT separator rather than
    // replacing it — four newlines, not two. Exact bytes, not aesthetics.
    expect(getDoc(v)).toBe("first block\n\n@page-break\n\n\n\nsecond block");
  });
});

describe("block-break-before replacement — rich mode: applyRichLayoutBlock('page-break') with the live caret at the start of the target block", () => {
  test("caret at the start of the second block inserts the break immediately before it", () => {
    const text = "first block\n\nsecond block";
    const host = new DesktopDocumentHost(text, { documentId: "ch1.md" });
    const at = text.indexOf("second block");
    const outcome = applyRichLayoutBlock(host, "page-break", { from: at, to: at });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      // The caret sits right at "second block"'s own start, immediately
      // after the existing blank-line separator — the descriptor's leading
      // "\n\n" is inserted THERE, ahead of that separator.
      expect(outcome.snapshot.text).toBe("first block\n\n\n\n@page-break\n\nsecond block");
    }
  });
});

// ── block-edit ───────────────────────────────────────────────────────────────
//
// `InlineEditController`'s free-form block edit has no per-token
// vocabulary to preserve — it replaces an arbitrary source range with
// author-typed text. `rich-mode-commit-integration.test.ts` already proves
// this exact mechanism (`DesktopDocumentHost.applyEdit`, an explicit
// `[from, to)` range replacement, exact resulting bytes, locality against
// the rest of the document) end-to-end for a real commit path; this is
// cited directly from the matrix rather than duplicated. This block adds
// only the one case that file's own scenario does not: a MULTI-line block
// replacement (the shape `InlineEditController.commit()` actually applies
// — a whole block's text, not a single word).
describe("block-edit replacement — direct range replacement via DesktopDocumentHost.applyEdit (multi-line block body)", () => {
  test("replacing a whole paragraph block's text changes exactly that block and nothing else", () => {
    const text = "before\n\nold line one\nold line two\n\nafter\n";
    const host = new DesktopDocumentHost(text, { documentId: "ch1.md" });
    const from = text.indexOf("old line one");
    const to = from + "old line one\nold line two\n".length;
    const before = host.getSnapshot();
    const outcome = host.applyEdit({
      from,
      to,
      insert: "new line one\nnew line two\nnew line three\n",
      expectedVersion: before.version,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.snapshot.text).toBe("before\n\nnew line one\nnew line two\nnew line three\n\nafter\n");
      expect(outcome.snapshot.text.slice(0, from)).toBe(text.slice(0, from));
      expect(outcome.snapshot.text.slice(from + "new line one\nnew line two\nnew line three\n".length)).toBe(
        text.slice(to),
      );
    }
  });
});
