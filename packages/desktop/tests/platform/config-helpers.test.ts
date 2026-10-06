import { test, expect } from "bun:test";
import {
  describeSegments,
  extensionSourceLabel,
  extensionStatus,
  orderAfterMove,
  sampleSrcdoc,
  hoverPreviewSrcdoc,
} from "../../src/lib/components/config/config-helpers";
import type { ProjectExtensionEntry, ExtensionValidationResult } from "../../src/lib/api";

const NONE = { markdown: false, styles: false, snippets: false, components: false };

function entry(overrides: Partial<ProjectExtensionEntry> = {}): ProjectExtensionEntry {
  return {
    use: "markdown-it-mark",
    kind: "bundled",
    name: "markdown-it-mark",
    enabled: true,
    label: "Highlight",
    carries: { ...NONE, markdown: true },
    ...overrides,
  };
}

// ── #106: hover preview renders a fixed 2-page sample, never the document ──────

test("hoverPreviewSrcdoc inlines the look's CSS into a fixed two-page spread", () => {
  const css = ":root { --accent: #036; }";
  const doc = hoverPreviewSrcdoc(css);
  expect(doc).toContain(css);
  expect((doc.match(/pm-sample-page/g) ?? []).length).toBeGreaterThanOrEqual(2);
  expect(doc).toContain("Chapter One");
});

test("hoverPreviewSrcdoc is a superset sample of the thumbnail (both self-contained docs)", () => {
  const css = "h1 { color: red; }";
  expect(sampleSrcdoc(css).startsWith("<!DOCTYPE html>")).toBe(true);
  expect(hoverPreviewSrcdoc(css).startsWith("<!DOCTYPE html>")).toBe(true);
});

// ── extensionSourceLabel: where a row comes from, in one caption ───────────

test("extensionSourceLabel names the three sources", () => {
  expect(extensionSourceLabel(entry())).toBe("built in");
  expect(extensionSourceLabel(entry({ kind: "npm", use: "markdown-it-emoji@3.0.0", name: "markdown-it-emoji", version: "3.0.0" }))).toBe("npm 3.0.0");
  expect(extensionSourceLabel(entry({ kind: "npm", use: "markdown-it-emoji", name: "markdown-it-emoji" }))).toBe("npm");
  expect(extensionSourceLabel(entry({ kind: "path", use: "./extensions/clean-book", name: "./extensions/clean-book" }))).toBe("extensions/clean-book");
  expect(extensionSourceLabel(entry({ kind: "path", use: "../shared/house", name: "../shared/house" }))).toBe("../shared/house");
});

// ── describeSegments (#309): "what to type" spans set in code type ─────────

test("describeSegments marks the backtick spans of a feature description as code", () => {
  expect(describeSegments("Lower text below the line, like the 2 in `H~2~O`.")).toEqual([
    { text: "Lower text below the line, like the 2 in ", code: false },
    { text: "H~2~O", code: true },
    { text: ".", code: false },
  ]);
  // Two spans in one line, as the Callouts feature writes it.
  expect(describeSegments("Start a quote with `> [!NOTE]` (or `TIP`).")).toEqual([
    { text: "Start a quote with ", code: false },
    { text: "> [!NOTE]", code: true },
    { text: " (or ", code: false },
    { text: "TIP", code: true },
    { text: ").", code: false },
  ]);
});

test("describeSegments leaves plain text alone, drops empty pieces, and never returns the backticks", () => {
  expect(describeSegments("Nothing to type here.")).toEqual([{ text: "Nothing to type here.", code: false }]);
  expect(describeSegments("`only code`")).toEqual([{ text: "only code", code: true }]);
  expect(describeSegments("")).toEqual([]);
  // An unbalanced trailing backtick still shows no stray backtick.
  expect(describeSegments("Type `oops").map((s) => s.text).join("")).toBe("Type oops");
});

// ── orderAfterMove: a move inside one view, expressed as the full order ────

const LOOK_A = entry({ use: "./extensions/a", kind: "path", carries: { ...NONE, styles: true } });
const FEAT = entry({ use: "markdown-it-mark" });
const LOOK_B = entry({ use: "./extensions/b", kind: "path", carries: { ...NONE, styles: true } });
const ALL = [LOOK_A, FEAT, LOOK_B];
const LOOKS = [LOOK_A, LOOK_B];

test("orderAfterMove moves an entry past its neighbour IN THE VIEW, keeping outsiders in place", () => {
  expect(orderAfterMove(ALL, LOOKS, LOOK_B, -1)).toEqual(["./extensions/b", "./extensions/a", "markdown-it-mark"]);
  expect(orderAfterMove(ALL, LOOKS, LOOK_A, 1)).toEqual(["markdown-it-mark", "./extensions/b", "./extensions/a"]);
});

test("orderAfterMove lists every configured entry exactly once (what reorderExtensions insists on)", () => {
  const order = orderAfterMove(ALL, LOOKS, LOOK_B, -1)!;
  expect([...order].sort()).toEqual(ALL.map((e) => e.use).sort());
});

test("orderAfterMove returns null at the view's edge or for an entry outside the view", () => {
  expect(orderAfterMove(ALL, LOOKS, LOOK_A, -1)).toBeNull();
  expect(orderAfterMove(ALL, LOOKS, LOOK_B, 1)).toBeNull();
  expect(orderAfterMove(ALL, LOOKS, FEAT, 1)).toBeNull();
});

// ── extensionStatus: tri-state + the one warning class with an in-app fix ──

test("extensionStatus: disabled entry always reads Disabled, regardless of anything else", () => {
  const st = extensionStatus(entry({ enabled: false, warnings: ["Not installed — run x"] }), {}, true);
  expect(st).toEqual({ label: "Disabled", kind: "disabled" });
});

test("extensionStatus: in-flight validation with no result yet reads Checking…", () => {
  const st = extensionStatus(entry(), {}, /* validating */ true);
  expect(st.kind).toBe("checking");
  expect(st.label).toBe("Checking…");
});

test("extensionStatus: NOT validating and no result is a distinct 'check failed' state, not stuck Checking…", () => {
  const st = extensionStatus(entry(), {}, /* validating */ false);
  expect(st.kind).toBe("stale");
  expect(st.label).toMatch(/check failed/i);
  expect(st.label).toMatch(/re-check/i);
});

test("extensionStatus: ok result reads Loads OK", () => {
  const validation: Record<string, ExtensionValidationResult> = {
    "markdown-it-mark": { use: "markdown-it-mark", kind: "bundled", enabled: true, ok: true },
  };
  expect(extensionStatus(entry(), validation, false)).toEqual({ label: "Loads OK", kind: "ok" });
});

test("extensionStatus: an npm entry the lib flagged as not installed / not pinned points to the in-app installer, ahead of any load-test result", () => {
  for (const warning of [
    "Not installed — run `gutterpress ext add markdown-it-footnote@4.0.0`.",
    "Not pinned — run `gutterpress ext add markdown-it-footnote` to install it and pin an exact version.",
  ]) {
    const e = entry({ use: "markdown-it-footnote@4.0.0", kind: "npm", name: "markdown-it-footnote", version: "4.0.0", warnings: [warning] });
    const validation: Record<string, ExtensionValidationResult> = {
      [e.use]: { use: e.use, kind: "npm", enabled: true, ok: false, error: "Plugin not found" },
    };
    const st = extensionStatus(e, validation, false);
    expect(st.label).toBe("Needs install");
    expect(st.kind).toBe("error");
    // Install from npm lives behind the Features tab's Advanced disclosure (#309).
    expect(st.detail).toContain("Advanced");
    expect(st.detail).toContain("Install from npm");
    expect(st.detail).toContain("markdown-it-footnote@4.0.0");
    expect(st.raw).toBe(warning);
  }
});

test("extensionStatus: a failed load on a path entry remains a generic load error with the loader's message", () => {
  const e = entry({ use: "./plugins/broken.js", kind: "path", name: "./plugins/broken.js" });
  const validation: Record<string, ExtensionValidationResult> = {
    "./plugins/broken.js": { use: "./plugins/broken.js", kind: "path", enabled: true, ok: false, error: "SyntaxError: unexpected token" },
  };
  const st = extensionStatus(e, validation, false);
  expect(st.label).toBe("Error");
  expect(st.detail).toContain("couldn't load");
  expect(st.raw).toBe("SyntaxError: unexpected token");
});

test("extensionStatus: a failed load on an installed npm entry says to reinstall", () => {
  const e = entry({ use: "markdown-it-x@1.0.0", kind: "npm", name: "markdown-it-x", version: "1.0.0" });
  const validation: Record<string, ExtensionValidationResult> = {
    "markdown-it-x@1.0.0": { use: "markdown-it-x@1.0.0", kind: "npm", enabled: true, ok: false },
  };
  const st = extensionStatus(e, validation, false);
  expect(st.label).toBe("Error");
  expect(st.detail).toContain("reinstall");
  expect(st.raw).toBe("Unknown load error");
});
