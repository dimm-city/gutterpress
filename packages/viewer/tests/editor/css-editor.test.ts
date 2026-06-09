import { test, expect, beforeEach, afterEach } from "bun:test";
import {
  languageForPath,
  toCssDiagnostic,
  cssDiagnosticsSource,
  pagedMediaCompletions,
  pagedMediaCompletionSource,
} from "../../src/lib/editor/css-editor";
import { __resetPlatform } from "../../src/lib/platform/index";
import { checkCss, type PrintSafeWarning } from "@dimm-city/print-md-lib";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";

// cssDiagnosticsSource now runs the lint via getPlatform().checkCss (IPC) so the
// SPA never bundles postcss. In tests (node, not the browser) we install a fake
// bridge whose checkCss calls the REAL lib checkCss — exercising the same
// warning→diagnostic mapping the app uses, end to end.
beforeEach(() => {
  __resetPlatform();
  // @ts-expect-error test global
  globalThis.window = {
    electron: { checkCss: (css: string, from?: string) => Promise.resolve(checkCss(css, from)) },
  };
});
afterEach(() => {
  // @ts-expect-error test global
  globalThis.window = undefined;
  __resetPlatform();
});

// ── languageForPath ──────────────────────────────────────────────────────────

test("languageForPath maps extensions to language modes", () => {
  expect(languageForPath("styles/print.css")).toBe("css");
  expect(languageForPath("CHAPTER.CSS")).toBe("css");
  expect(languageForPath("intro.md")).toBe("markdown");
  expect(languageForPath("intro.markdown")).toBe("markdown");
  expect(languageForPath("manifest.yaml")).toBe("plain");
  expect(languageForPath("notes.txt")).toBe("plain");
  expect(languageForPath(null)).toBe("plain");
});

// ── toCssDiagnostic ──────────────────────────────────────────────────────────

test("toCssDiagnostic converts 1-based line/column to offsets", () => {
  // Document: line 1 starts at 0 with length 10, line 2 starts at 11 length 8.
  const starts: Record<number, number> = { 1: 0, 2: 11 };
  const lengths: Record<number, number> = { 1: 10, 2: 8 };
  const warning: PrintSafeWarning = {
    rule: "printsafe/no-remote-urls",
    severity: "error",
    message: "boom",
    line: 2,
    column: 3,
  };
  const d = toCssDiagnostic(
    warning,
    (l) => starts[l] ?? 0,
    (l) => lengths[l] ?? 0,
  );
  // column 3 (1-based) → offset 2 into line 2 (start 11) → 13
  expect(d.from).toBe(13);
  expect(d.to).toBe(11 + 8); // to end of line
  expect(d.severity).toBe("error");
  expect(d.source).toBe("printsafe/no-remote-urls");
  expect(d.message).toBe("boom");
});

test("toCssDiagnostic falls back to whole line when no column", () => {
  const d = toCssDiagnostic(
    { rule: "x", severity: "warning", message: "m", line: 1, column: 0 },
    () => 5,
    () => 12,
  );
  expect(d.from).toBe(5);
  expect(d.to).toBe(17);
});

// ── cssDiagnosticsSource (real checkCss integration) ─────────────────────────

test("cssDiagnosticsSource flags a remote url() as an error", async () => {
  const doc = "h1 {\n  background: url(https://example.com/x.png);\n}\n";
  const state = EditorState.create({ doc });
  const diags = await cssDiagnosticsSource(state);
  expect(diags.length).toBeGreaterThan(0);
  const remote = diags.find((d) => d.source === "printsafe/no-remote-urls");
  expect(remote).toBeDefined();
  expect(remote?.severity).toBe("error");
  // Offsets must fall within the document.
  for (const d of diags) {
    expect(d.from).toBeGreaterThanOrEqual(0);
    expect(d.to).toBeLessThanOrEqual(doc.length);
    expect(d.to).toBeGreaterThanOrEqual(d.from);
  }
});

test("cssDiagnosticsSource reports a syntax error", async () => {
  const doc = "h1 { color: red"; // unterminated block
  const state = EditorState.create({ doc });
  const diags = await cssDiagnosticsSource(state);
  const syntax = diags.find((d) => d.source === "printsafe/syntax-error");
  expect(syntax).toBeDefined();
  expect(syntax?.severity).toBe("error");
});

test("cssDiagnosticsSource returns nothing for clean print-safe CSS", async () => {
  const doc = "@page {\n  size: A4 portrait;\n  margin: 20mm;\n}\n";
  const state = EditorState.create({ doc });
  expect(await cssDiagnosticsSource(state)).toEqual([]);
});

// ── pagedMediaCompletions / completion source ────────────────────────────────

test("pagedMediaCompletions covers the key Paged Media constructs", () => {
  const labels = pagedMediaCompletions.map((c) => c.label);
  expect(labels).toContain("@page");
  expect(labels).toContain("@top-center");
  expect(labels).toContain("@bottom-right");
  expect(labels).toContain("@left-middle");
  expect(labels).toContain("size");
  expect(labels).toContain("margin");
  expect(labels).toContain("bleed");
  expect(labels).toContain("marks");
  // size has multiple value-hint variants.
  const sizeApplies = pagedMediaCompletions
    .filter((c) => c.label === "size")
    .map((c) => c.apply);
  expect(sizeApplies).toContain("size: A4 portrait;");
  expect(sizeApplies).toContain("size: letter landscape;");
});

test("pagedMediaCompletionSource offers @page when typing '@pa'", () => {
  const doc = "@pa";
  const state = EditorState.create({ doc });
  const ctx = new CompletionContext(state, doc.length, false);
  const result = pagedMediaCompletionSource(ctx);
  expect(result).not.toBeNull();
  // The match anchors at the '@' so users can complete the at-rule.
  expect(result?.from).toBe(0);
  const labels = result?.options.map((o) => o.label) ?? [];
  expect(labels).toContain("@page");
});

test("pagedMediaCompletionSource returns null on an empty, non-explicit context", () => {
  const doc = "h1 { } ";
  const state = EditorState.create({ doc });
  // Position right after a space: matchBefore yields an empty range.
  const ctx = new CompletionContext(state, doc.length, false);
  const result = pagedMediaCompletionSource(ctx);
  expect(result).toBeNull();
});
