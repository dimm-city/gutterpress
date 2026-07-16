import { test, expect } from "bun:test";
import {
  toPreflightRow,
  shapePreflight,
  worstSeverity,
  preflightHeaderLevel,
  preflightCounts,
  groupPreflight,
  categoryLabel,
  type PreflightRawResult,
  type PreflightRow,
} from "../../src/lib/preflight";

const raw = (over: Partial<PreflightRawResult>): PreflightRawResult => ({
  checkId: "source.markdownlint",
  category: "source",
  severity: "warning",
  message: "msg",
  ...over,
});

const row = (over: Partial<PreflightRow>): PreflightRow => ({
  id: "source.markdownlint",
  category: "source",
  severity: "warning",
  label: "Markdown style",
  message: "msg",
  code: null,
  fixable: "none",
  ...over,
});

// ── label mapping (reuses problems.ts, no second table) ───────────────────────

test("toPreflightRow labels via friendlySource for both source and asset checks", () => {
  expect(toPreflightRow(raw({ checkId: "source.links.local-refs" })).label).toBe(
    "Broken link",
  );
  expect(
    toPreflightRow(raw({ checkId: "asset.image.file-size", category: "asset" })).label,
  ).toBe("Image file size");
  // Unknown ids fall back to the raw id (never hidden).
  expect(toPreflightRow(raw({ checkId: "some.future.check" })).label).toBe(
    "some.future.check",
  );
});

test("toPreflightRow demotes a trailing rule code out of the message", () => {
  const r = toPreflightRow(raw({ message: "Line length limit exceeded (MD013/line-length)" }));
  expect(r.message).toBe("Line length limit exceeded");
  expect(r.code).toBe("MD013/line-length");
});

// ── fixable derivation from editable source locations ─────────────────────────

test("fixable = navigate only for editable source files", () => {
  const withLoc = toPreflightRow(
    raw({ filePath: "/proj/a.md", file: "a.md", line: 12 }),
  );
  expect(withLoc.fixable).toBe("navigate");
  expect(withLoc.location).toEqual({
    filePath: "/proj/a.md",
    file: "a.md",
    line: 12,
    column: undefined,
  });

  const noLoc = toPreflightRow(raw({}));
  expect(noLoc.fixable).toBe("none");
  expect(noLoc.location).toBeUndefined();

  for (const filePath of ["/proj/image.png", "/proj/fonts/book.woff2", "/proj/assets"]) {
    const asset = toPreflightRow(raw({ category: "asset", filePath }));
    expect(asset.fixable).toBe("none");
    expect(asset.location?.filePath).toBe(filePath);
  }

  expect(toPreflightRow(raw({ filePath: "/proj/theme.CSS" })).fixable).toBe("navigate");
  expect(toPreflightRow(raw({ filePath: "/proj/chapter.markdown" })).fixable).toBe("navigate");
  expect(toPreflightRow(raw({ filePath: "/proj/manifest.yaml" })).fixable).toBe("navigate");
  expect(toPreflightRow(raw({ filePath: "/proj/notes.txt" })).fixable).toBe("navigate");
});

test("provider is carried through only when set", () => {
  expect(toPreflightRow(raw({})).provider).toBeUndefined();
  expect(toPreflightRow(raw({ provider: "kdp" })).provider).toBe("kdp");
});

test("shapePreflight maps a list", () => {
  const rows = shapePreflight([raw({ severity: "error" }), raw({ severity: "info" })]);
  expect(rows.map((r) => r.severity)).toEqual(["error", "info"]);
});

// ── severity ranking / header ─────────────────────────────────────────────────

test("worstSeverity returns the most severe present, null when empty", () => {
  expect(worstSeverity([])).toBeNull();
  expect(worstSeverity([row({ severity: "info" }), row({ severity: "warning" })])).toBe(
    "warning",
  );
  expect(
    worstSeverity([row({ severity: "warning" }), row({ severity: "error" }), row({ severity: "info" })]),
  ).toBe("error");
});

test("preflightHeaderLevel: red on error, amber on warning, green otherwise", () => {
  expect(preflightHeaderLevel([])).toBe("ok");
  expect(preflightHeaderLevel([row({ severity: "info" })])).toBe("ok");
  expect(preflightHeaderLevel([row({ severity: "warning" }), row({ severity: "info" })])).toBe(
    "warning",
  );
  expect(preflightHeaderLevel([row({ severity: "warning" }), row({ severity: "error" })])).toBe(
    "error",
  );
});

test("preflightCounts", () => {
  const rows = [
    row({ severity: "error" }),
    row({ severity: "error" }),
    row({ severity: "warning" }),
    row({ severity: "info" }),
  ];
  expect(preflightCounts(rows)).toEqual({ errors: 2, warnings: 1, infos: 1 });
});

// ── grouping ──────────────────────────────────────────────────────────────────

test("groupPreflight orders source before asset, then errors before warnings within a group", () => {
  const groups = groupPreflight([
    row({ category: "asset", id: "asset.image.file-size", label: "Image file size", severity: "warning" }),
    row({ category: "source", id: "source.markdownlint", label: "Markdown style", severity: "warning" }),
    row({ category: "source", id: "source.links.local-refs", label: "Broken link", severity: "error" }),
  ]);
  expect(groups.map((g) => g.category)).toEqual(["source", "asset"]);
  // Within source: the error sorts ahead of the warning.
  expect(groups[0]!.rows.map((r) => r.severity)).toEqual(["error", "warning"]);
});

test("groupPreflight puts unknown categories after the known ones", () => {
  const groups = groupPreflight([
    row({ category: "zzz" }),
    row({ category: "asset" }),
    row({ category: "source" }),
  ]);
  expect(groups.map((g) => g.category)).toEqual(["source", "asset", "zzz"]);
});

test("categoryLabel gives plain language, falls back to the raw category", () => {
  expect(categoryLabel("source")).toBe("Content & styles");
  expect(categoryLabel("asset")).toBe("Images & fonts");
  expect(categoryLabel("mystery")).toBe("mystery");
});

// ── label coverage: every registered ASSET check has a friendly label ─────────
// Mirrors the source-coverage test in problems.test.ts (M32), extended to the
// asset category preflight adds. Keyed to the live registry, not a copied list.
test("preflight labels cover every registered asset-category CLI check", async () => {
  const { getChecks } = await import("@dimm-city/print-md");
  const assetChecks = getChecks({ category: "asset" });
  expect(assetChecks.length).toBeGreaterThan(0);
  for (const check of assetChecks) {
    const label = toPreflightRow(raw({ checkId: check.id, category: "asset" })).label;
    expect(label).not.toBe(check.id);
  }
});
