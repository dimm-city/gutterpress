/**
 * marker-completions.test.ts (UX M26)
 *
 * Unit tests for the CodeMirror completion source over print-md's CORE
 * `@marker` family (markdown-it-paged.js's parseMarkerLine whitelist:
 * chapter/spread/page/section/continue/page-break/column-break/end-section).
 * Written test-first, mirroring css-editor.test.ts's pattern for
 * pagedMediaCompletionSource and toolbar-actions.test.ts's headless
 * EditorView mock for the template-insertion "apply" functions.
 */
import { test, expect } from "bun:test";
import { EditorState, EditorSelection, type Transaction } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { createMarkdownRenderer } from "@dimm-city/print-md/render";
import {
  markerCompletions,
  markerCompletionSource,
} from "../../src/lib/editor/marker-completions";

// ── Minimal headless EditorView mock (same shape as toolbar-actions.test.ts) ─

function makeMockView(docStr: string, from = docStr.length, to = docStr.length): EditorView {
  let state = EditorState.create({
    doc: docStr,
    selection: EditorSelection.range(from, to),
  });

  const view = {
    get state() { return state; },
    dispatch(...specs: Array<Transaction | Parameters<EditorView["dispatch"]>[0]>) {
      for (const spec of specs) {
        if (spec && typeof spec === "object" && "state" in spec) {
          state = (spec as Transaction).state;
        } else {
          state = state.update(spec as Parameters<EditorState["update"]>[0]).state;
        }
      }
    },
    focus() {},
  };

  return view as unknown as EditorView;
}

function getDoc(view: EditorView): string {
  return view.state.doc.toString();
}

function getSel(view: EditorView): { from: number; to: number } {
  const m = view.state.selection.main;
  return { from: m.from, to: m.to };
}

// ── markerCompletions data table ─────────────────────────────────────────────

test("markerCompletions covers exactly the core marker whitelist (markdown-it-paged.js parseMarkerLine)", () => {
  const labels = markerCompletions.map((c) => c.label).sort();
  expect(labels).toEqual(
    [
      "@chapter",
      "@column-break",
      "@continue",
      "@end-section",
      "@page",
      "@page-break",
      "@section",
      "@spread",
    ].sort(),
  );
});

test("markerCompletions never lists project-plugin markers (CLAUDE.md §5 — @sidebar/@callout are not core)", () => {
  const labels = markerCompletions.map((c) => c.label);
  expect(labels).not.toContain("@sidebar");
  expect(labels).not.toContain("@callout");
});

test("markerCompletions gives every marker a non-empty one-line info string", () => {
  for (const c of markerCompletions) {
    expect(c.detail.length).toBeGreaterThan(0);
    expect(c.detail).not.toContain("\n");
  }
});

// ── markerCompletionSource: trigger conditions ───────────────────────────────

test("markerCompletionSource offers the marker family right after typing '@' at line start", () => {
  const doc = "@";
  const state = EditorState.create({ doc });
  const ctx = new CompletionContext(state, doc.length, false);
  const result = markerCompletionSource(ctx);
  expect(result).not.toBeNull();
  expect(result?.from).toBe(0);
  const labels = result?.options.map((o) => o.label) ?? [];
  expect(labels).toContain("@chapter");
  expect(labels).toContain("@section");
});

test("markerCompletionSource keeps filtering as more marker characters are typed", () => {
  const doc = "@ch";
  const state = EditorState.create({ doc });
  const ctx = new CompletionContext(state, doc.length, false);
  const result = markerCompletionSource(ctx);
  expect(result).not.toBeNull();
  // Anchors at the '@' so CodeMirror's own fuzzy match narrows the list.
  expect(result?.from).toBe(0);
});

test("markerCompletionSource triggers on line 2 after a preceding line", () => {
  const doc = "Some prose.\n@sec";
  const state = EditorState.create({ doc });
  const ctx = new CompletionContext(state, doc.length, false);
  const result = markerCompletionSource(ctx);
  expect(result).not.toBeNull();
  // '@' sits right after the newline, at offset 12.
  expect(result?.from).toBe(12);
});

test("markerCompletionSource tolerates leading whitespace before '@' (parseMarkerLine trims the line)", () => {
  const doc = "  @pa";
  const state = EditorState.create({ doc });
  const ctx = new CompletionContext(state, doc.length, false);
  const result = markerCompletionSource(ctx);
  expect(result).not.toBeNull();
  expect(result?.from).toBe(2);
});

test("markerCompletionSource returns null when '@' is not at line start (mid-sentence)", () => {
  const doc = "email me @page-break please";
  const state = EditorState.create({ doc });
  const ctx = new CompletionContext(state, doc.length, false);
  const result = markerCompletionSource(ctx);
  expect(result).toBeNull();
});

test("markerCompletionSource returns null on an empty, non-explicit line-start context", () => {
  const doc = "\n";
  const state = EditorState.create({ doc });
  const ctx = new CompletionContext(state, doc.length, false);
  const result = markerCompletionSource(ctx);
  expect(result).toBeNull();
});

test("markerCompletionSource offers the family on explicit invoke (Ctrl+Space) even before '@' is typed", () => {
  const doc = "\n";
  const state = EditorState.create({ doc });
  const ctx = new CompletionContext(state, doc.length, true);
  const result = markerCompletionSource(ctx);
  expect(result).not.toBeNull();
  expect(result?.from).toBe(doc.length);
});

test("markerCompletionSource returns null on explicit invoke mid-sentence (not at line start)", () => {
  const doc = "some text ";
  const state = EditorState.create({ doc });
  const ctx = new CompletionContext(state, doc.length, true);
  const result = markerCompletionSource(ctx);
  expect(result).toBeNull();
});

// ── Template insertion: @chapter gets a title placeholder ───────────────────

test("@chapter completion apply inserts a QUOTED, selected title placeholder", () => {
  const view = makeMockView("");
  const entry = markerCompletions.find((c) => c.label === "@chapter");
  expect(entry).toBeDefined();
  expect(typeof entry?.apply).toBe("function");
  const apply = entry?.apply as (
    v: EditorView,
    completion: typeof entry,
    from: number,
    to: number,
  ) => void;
  apply(view, entry as never, 0, 0);
  // Quoting is load-bearing, not cosmetic — see applyChapterCompletion's doc
  // comment and the round-trip test below. An unquoted multi-word label
  // silently loses data-chapter-label / .chapter-opener.
  expect(getDoc(view)).toBe('@chapter "Chapter Title"');
  const sel = getSel(view);
  // "Chapter Title" (without the surrounding quotes) is selected so typing
  // immediately replaces the placeholder and keeps the quotes intact.
  expect(view.state.sliceDoc(sel.from, sel.to)).toBe("Chapter Title");
});

test("@chapter completion apply replaces a partially-typed marker (from/to mid-word)", () => {
  const view = makeMockView("@ch");
  const entry = markerCompletions.find((c) => c.label === "@chapter");
  const apply = entry?.apply as (
    v: EditorView,
    completion: typeof entry,
    from: number,
    to: number,
  ) => void;
  apply(view, entry as never, 0, 3);
  expect(getDoc(view)).toBe('@chapter "Chapter Title"');
});

// ── Round-trip: the produced @chapter line must actually render a label +
// chapter-opener through the REAL markdown-it-paged plugin ──────────────────
//
// This is the guard against the exact class of bug FIX ROUND 1 caught: a
// template that "looks right" as a string but silently mis-parses. Rendered
// through @dimm-city/print-md/render's createMarkdownRenderer (the pure,
// node-free render core — safe to value-import from a test file).

test("@chapter completion's produced marker line renders data-chapter-label + .chapter-opener", () => {
  const view = makeMockView("");
  const entry = markerCompletions.find((c) => c.label === "@chapter");
  const apply = entry?.apply as (
    v: EditorView,
    completion: typeof entry,
    from: number,
    to: number,
  ) => void;
  apply(view, entry as never, 0, 0);
  const chapterLine = getDoc(view);

  const md = createMarkdownRenderer();
  // A nested @page is required for the .chapter-opener structural element
  // (it's injected as the first @page's first child); data-chapter-label on
  // the outer .chapter wrapper does not require it, but we exercise the full
  // realistic shape (chapter + a page) here.
  const html = md.render(`${chapterLine}\n\n@page\n\nSome text.\n`);

  expect(html).toContain('data-chapter-label="Chapter Title"');
  expect(html).toContain('class="chapter-opener"');
  // Must NOT regress to the broken junk-class form.
  expect(html).not.toContain('class="chapter Chapter Title"');
});

test("sanity check: the UNQUOTED broken form does NOT produce a label or opener (documents the bug this fix prevents)", () => {
  const md = createMarkdownRenderer();
  const html = md.render('@chapter Chapter Title\n\n@page\n\nSome text.\n');

  expect(html).not.toContain("data-chapter-label");
  expect(html).not.toContain("chapter-opener");
  expect(html).toContain('class="chapter Chapter Title"');
});

// ── Template insertion: @section … @end-section pair ────────────────────────

test("@section completion apply inserts the @section/@end-section pair with cursor between", () => {
  const view = makeMockView("");
  const entry = markerCompletions.find((c) => c.label === "@section");
  expect(entry).toBeDefined();
  expect(typeof entry?.apply).toBe("function");
  const apply = entry?.apply as (
    v: EditorView,
    completion: typeof entry,
    from: number,
    to: number,
  ) => void;
  apply(view, entry as never, 0, 0);
  expect(getDoc(view)).toBe("@section\n\n@end-section");
  const sel = getSel(view);
  // Cursor collapsed on the blank interior line, ready for content.
  expect(sel.from).toBe(sel.to);
  expect(view.state.doc.lineAt(sel.from).text).toBe("");
});

// ── Bare markers use plain string apply (CodeMirror's default replace) ──────

test("simple markers (page, spread, continue, page-break, column-break, end-section) apply as their bare literal token", () => {
  const bare = ["@spread", "@page", "@continue", "@page-break", "@column-break", "@end-section"];
  for (const label of bare) {
    const entry = markerCompletions.find((c) => c.label === label);
    expect(entry).toBeDefined();
    expect(entry?.apply).toBe(label);
  }
});
