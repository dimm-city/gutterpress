/**
 * Tests for the print-md check/validation system.
 *
 * Covers: registry, runner, formatter, manifest integration,
 * and individual check modules (unit-level, no external tools required).
 */

import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "../lib/manifest";
import type { ResolvedConfig } from "../schema/manifest.types";
import type { CheckResult, Check } from "./types";
import {
  registerCheck,
  getChecks,
  getCheckById,
  getAllCheckIds,
  resolveCheckSelectors,
} from "./registry";
import { runChecks } from "./runner";
import { formatReport } from "./formatter";
import { checkToolAvailability, reportMissingTools } from "./tool-check";
import type { RunnerReport } from "./runner";
import { makeCtx } from "../test-helpers/testkit";

// Import all check modules so they self-register
import "./pdf/index";
import "./source/index";
import "./asset/index";
import "./heuristic/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return resolveConfig({}, { ...overrides } as any);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe("Check Registry", () => {
  test("all expected PDF checks are registered", () => {
    const ids = getAllCheckIds();
    const pdfIds = ids.filter((id) => id.startsWith("pdf."));
    expect(pdfIds).toContain("pdf.structure.qpdf");
    expect(pdfIds).toContain("pdf.print.page-size");
    expect(pdfIds).toContain("pdf.print.pdfx-markers");
    expect(pdfIds).toContain("pdf.print.color-spaces");
    expect(pdfIds).toContain("pdf.print.embedded-fonts");
    expect(pdfIds).toContain("pdf.print.ink-coverage");
    expect(pdfIds).toContain("pdf.print.rasterized-pages");
    expect(pdfIds).toContain("pdf.nav.bookmarks");
    expect(pdfIds).toContain("pdf.nav.toc-links");
    expect(pdfIds).toContain("pdf.nav.cross-refs");
    expect(pdfIds).toContain("pdf.nav.page-labels");
    expect(pdfIds).toContain("pdf.print.image-resolution");
    expect(pdfIds).toContain("pdf.print.transparency");
    expect(pdfIds).toContain("pdf.print.bleed");
    expect(pdfIds).toContain("pdf.print.pdfx-metadata");
  });

  test("all expected source checks are registered", () => {
    const ids = getAllCheckIds();
    const sourceIds = ids.filter((id) => id.startsWith("source."));
    expect(sourceIds).toContain("source.markdownlint");
    expect(sourceIds).toContain("source.htmlhint");
    expect(sourceIds).toContain("source.stylelint");
    expect(sourceIds).toContain("source.links.local-refs");
    expect(sourceIds).toContain("source.accessibility.alt-text");
    expect(sourceIds).toContain("source.accessibility.heading-order");
  });

  test("all expected asset checks are registered", () => {
    const ids = getAllCheckIds();
    const assetIds = ids.filter((id) => id.startsWith("asset."));
    expect(assetIds).toContain("asset.image.file-size");
    expect(assetIds).toContain("asset.image.resolution");
    expect(assetIds).toContain("asset.image.color-space");
    expect(assetIds).toContain("asset.image.alpha-channel");
    expect(assetIds).toContain("asset.image.tac-raster");
    expect(assetIds).toContain("asset.font.approved-files");
    expect(assetIds).toContain("asset.font.missing-refs");
    expect(assetIds).toContain("asset.font.license");
  });

  test("all expected heuristic checks are registered", () => {
    const ids = getAllCheckIds();
    const hIds = ids.filter((id) => id.startsWith("heuristic."));
    expect(hIds).toContain("heuristic.whitespace.text-density");
    expect(hIds).toContain("heuristic.chunking.section-density");
    expect(hIds).toContain("heuristic.decoration.layer-count");
    expect(hIds).toContain("heuristic.layout.placement-variance");
  });

  test("getCheckById returns the correct check", () => {
    const check = getCheckById("pdf.structure.qpdf");
    expect(check).toBeDefined();
    expect(check!.id).toBe("pdf.structure.qpdf");
    expect(check!.category).toBe("pdf");
    expect(check!.phase).toBe("post-build");
  });

  test("getCheckById returns undefined for unknown id", () => {
    expect(getCheckById("nonexistent.check")).toBeUndefined();
  });

  test("getChecks filters by category", () => {
    const pdfChecks = getChecks({ category: "pdf" });
    expect(pdfChecks.length).toBeGreaterThan(0);
    expect(pdfChecks.every((c) => c.category === "pdf")).toBe(true);
  });

  test("getChecks filters by phase", () => {
    const preBuild = getChecks({ phase: "pre-build" });
    expect(preBuild.length).toBeGreaterThan(0);
    expect(preBuild.every((c) => c.phase === "pre-build")).toBe(true);

    const postBuild = getChecks({ phase: "post-build" });
    expect(postBuild.length).toBeGreaterThan(0);
    expect(postBuild.every((c) => c.phase === "post-build")).toBe(true);
  });

  test("getChecks filters by multiple categories", () => {
    const checks = getChecks({ category: ["source", "asset"] });
    expect(checks.length).toBeGreaterThan(0);
    expect(
      checks.every((c) => c.category === "source" || c.category === "asset")
    ).toBe(true);
  });

  test("getChecks filters by explicit IDs", () => {
    const checks = getChecks({
      ids: ["pdf.structure.qpdf", "pdf.print.page-size"],
    });
    expect(checks).toHaveLength(2);
    expect(checks.map((c) => c.id).sort()).toEqual([
      "pdf.print.page-size",
      "pdf.structure.qpdf",
    ]);
  });

  test("check modules have required fields", () => {
    const all = getChecks();
    for (const check of all) {
      expect(check.id).toBeTruthy();
      expect(check.name).toBeTruthy();
      expect(check.description).toBeTruthy();
      expect(["source", "pdf", "asset", "heuristic"]).toContain(check.category);
      expect(["pre-build", "post-build"]).toContain(check.phase);
      expect(typeof check.run).toBe("function");
    }
  });

  test("total registered check count", () => {
    // Count built-in checks only. `bun test` runs the CLI test files in one
    // shared process (no --isolate), so other files that register throwaway
    // `test.*` checks into the module-level registry can be present here
    // depending on file execution order (this surfaced as a CI-only failure
    // when the pdf-inspect fixture tests ran and shifted ordering). Built-in
    // checks are namespaced by category (pdf/source/asset/heuristic) and never
    // start with `test.`, so excluding those makes the count deterministic.
    const all = getAllCheckIds().filter((id) => !id.startsWith("test."));
    // 15 pdf + 6 source + 8 asset + 4 heuristic = 33
    // (source.callout-validation removed with ::: container syntax, 2026-05-17)
    expect(all.length).toBe(33);
  });
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

describe("Check Runner", () => {
  test("returns empty report when validation is disabled", async () => {
    const config = makeConfig();
    config.validate.enabled = false;
    const ctx = makeCtx({ config });
    const report = await runChecks(ctx);
    expect(report.summary.total).toBe(0);
    expect(report.results).toHaveLength(0);
  });

  test("filters by phase", async () => {
    // post-build without a pdfPath: every post-build check should
    // return [] because they early-return when pdfPath is missing
    const ctx = makeCtx({ pdfPath: undefined });
    const report = await runChecks(ctx, { phase: "post-build" });
    expect(report.summary.total).toBeGreaterThan(0);
    // all should pass because they skip when no pdf
    expect(report.summary.errors).toBe(0);
  });

  test("filters by category", async () => {
    const ctx = makeCtx();
    const report = await runChecks(ctx, { category: ["heuristic"] });
    expect(report.summary.total).toBeGreaterThan(0);
  });

  test("only filter selects specific checks", async () => {
    const ctx = makeCtx();
    const report = await runChecks(ctx, {
      only: ["pdf.structure.qpdf"],
    });
    // Should only run one check
    expect(report.summary.total).toBe(1);
  });

  test("only filter supports wildcard selectors", async () => {
    const ctx = makeCtx();
    const report = await runChecks(ctx, {
      only: ["source.accessibility.*"],
    });
    expect(report.summary.total).toBe(2);
    expect(report.passed.slice().sort()).toEqual([
      "source.accessibility.alt-text",
      "source.accessibility.heading-order",
    ]);
  });

  test("skip filter excludes checks", async () => {
    const ctx = makeCtx();
    const allReport = await runChecks(ctx, { category: ["heuristic"] });
    const skipReport = await runChecks(ctx, {
      category: ["heuristic"],
      skip: ["heuristic.whitespace.text-density"],
    });
    expect(skipReport.summary.total).toBe(allReport.summary.total - 1);
  });

  test("skip filter supports wildcard selectors", async () => {
    const ctx = makeCtx();
    const allReport = await runChecks(ctx, { category: ["source"] });
    const skipReport = await runChecks(ctx, {
      category: ["source"],
      skip: ["source.accessibility.*"],
    });
    expect(skipReport.summary.total).toBe(allReport.summary.total - 2);
  });

  test("manifest check disable works", async () => {
    const config = makeConfig();
    config.validate.checks["pdf.structure.qpdf"] = false;
    const ctx = makeCtx({ config });
    const report = await runChecks(ctx, {
      only: ["pdf.structure.qpdf"],
    });
    // The check should be filtered out by the manifest disable
    expect(report.summary.total).toBe(0);
  });

  test("manifest check object-style disable works", async () => {
    const config = makeConfig();
    config.validate.checks["pdf.print.page-size"] = {
      enabled: false,
    };
    const ctx = makeCtx({ config });
    const report = await runChecks(ctx, {
      only: ["pdf.print.page-size"],
    });
    expect(report.summary.total).toBe(0);
  });

  test("severity override from manifest", async () => {
    const config = makeConfig();
    config.validate.checks["heuristic.whitespace.text-density"] = {
      severity: "info",
    };
    // text-density check skips when no pdfPath, so it "passes"
    // but the override would apply if it returned results
    const ctx = makeCtx({ config });
    const report = await runChecks(ctx, {
      only: ["heuristic.whitespace.text-density"],
    });
    expect(report.summary.total).toBe(1);
  });

  test("check that throws is caught and reported as error", async () => {
    // Register a temporary check that throws
    const throwingCheck: Check = {
      id: "test.throwing-check",
      name: "Throwing Check",
      description: "Intentionally throws for testing",
      category: "pdf",
      phase: "post-build",
      async run(): Promise<CheckResult[]> {
        throw new Error("intentional test error");
      },
    };
    registerCheck(throwingCheck);

    const ctx = makeCtx();
    const report = await runChecks(ctx, {
      only: ["test.throwing-check"],
    });
    expect(report.summary.errors).toBe(1);
    expect(report.errors[0]!.message).toContain("intentional test error");
  });
});

// ---------------------------------------------------------------------------
// Selector resolution — a mistyped --only/--skip selector must NOT silently
// resolve to nothing and produce a false "PASSED" (regression guard).
// ---------------------------------------------------------------------------

describe("resolveCheckSelectors reports unmatched selectors", () => {
  test("valid selector resolves and reports no unmatched", () => {
    const { resolved, unmatched } = resolveCheckSelectors([
      "pdf.structure.qpdf",
    ]);
    expect(resolved).toEqual(["pdf.structure.qpdf"]);
    expect(unmatched).toEqual([]);
  });

  test("wildcard selector resolves and reports no unmatched", () => {
    const { resolved, unmatched } = resolveCheckSelectors([
      "source.accessibility.*",
    ]);
    expect(resolved.slice().sort()).toEqual([
      "source.accessibility.alt-text",
      "source.accessibility.heading-order",
    ]);
    expect(unmatched).toEqual([]);
  });

  test("unknown selector is surfaced as unmatched", () => {
    const { resolved, unmatched } = resolveCheckSelectors([
      "pdf.print.typo",
    ]);
    expect(resolved).toEqual([]);
    expect(unmatched).toEqual(["pdf.print.typo"]);
  });

  test("mix of valid and typo selectors keeps them separate", () => {
    const { resolved, unmatched } = resolveCheckSelectors([
      "pdf.structure.qpdf",
      "does.not.exist",
    ]);
    expect(resolved).toEqual(["pdf.structure.qpdf"]);
    expect(unmatched).toEqual(["does.not.exist"]);
  });
});

describe("Runner surfaces unknown selectors instead of silent PASS", () => {
  test("unknown --only selector produces an error, not a false green", async () => {
    const ctx = makeCtx();
    const report = await runChecks(ctx, { only: ["pdf.print.typo"] });
    // Must NOT be a silent green: zero checks ran but the run must signal error.
    expect(report.summary.errors).toBeGreaterThan(0);
    expect(
      report.errors.some((r) => r.message.includes("pdf.print.typo"))
    ).toBe(true);
  });

  test("valid --only selector stays clean (happy path unchanged)", async () => {
    const ctx = makeCtx();
    const report = await runChecks(ctx, { only: ["pdf.structure.qpdf"] });
    expect(report.summary.total).toBe(1);
    expect(report.summary.errors).toBe(0);
  });

  test("unknown --skip selector is surfaced as an error", async () => {
    const ctx = makeCtx();
    const report = await runChecks(ctx, {
      category: ["heuristic"],
      skip: ["heuristic.whitespace.typo"],
    });
    expect(
      report.errors.some((r) => r.message.includes("heuristic.whitespace.typo"))
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

describe("Check Formatter", () => {
  function makeReport(overrides: Partial<RunnerReport> = {}): RunnerReport {
    return {
      results: [],
      errors: [],
      warnings: [],
      infos: [],
      passed: [],
      summary: { total: 0, errors: 0, warnings: 0, infos: 0, passed: 0 },
      ...overrides,
    };
  }

  test("formatReport text mode outputs to console without throwing", () => {
    const report = makeReport({
      warnings: [
        { checkId: "test", severity: "warning", message: "warn msg" },
      ],
      errors: [
        { checkId: "test", severity: "error", message: "err msg" },
      ],
      summary: { total: 2, errors: 1, warnings: 1, infos: 0, passed: 0 },
    });
    // Should not throw
    expect(() => formatReport(report, "text")).not.toThrow();
  });

  test("formatReport json mode outputs valid JSON", () => {
    const report = makeReport({
      results: [
        {
          checkId: "pdf.structure.qpdf",
          severity: "warning",
          message: "structural issue",
          file: "/tmp/test.pdf",
        },
      ],
      summary: { total: 1, errors: 0, warnings: 1, infos: 0, passed: 0 },
    });

    // Capture console.log output
    const originalLog = console.log;
    let jsonOutput = "";
    console.log = (msg: string) => {
      jsonOutput += msg;
    };

    formatReport(report, "json");
    console.log = originalLog;

    const parsed = JSON.parse(jsonOutput);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].checkId).toBe("pdf.structure.qpdf");
    expect(parsed.summary.warnings).toBe(1);
  });

  test("formatReport text mode shows PASSED for clean report", () => {
    const report = makeReport({
      passed: ["pdf.structure.qpdf"],
      summary: { total: 1, errors: 0, warnings: 0, infos: 0, passed: 1 },
    });
    expect(() => formatReport(report, "text")).not.toThrow();
  });

  test("formatReport text mode orders results by ascending severity (infos, warnings, errors, summary)", () => {
    // Errors must land directly above the verdict line — not sandwiched
    // between warnings and infos (issue #87).
    const report = makeReport({
      infos: [{ checkId: "test", severity: "info", message: "info msg" }],
      warnings: [{ checkId: "test", severity: "warning", message: "warn msg" }],
      errors: [{ checkId: "test", severity: "error", message: "err msg" }],
      summary: { total: 3, errors: 1, warnings: 1, infos: 1, passed: 0 },
    });

    const lines: string[] = [];
    const capture = (msg: string) => { lines.push(String(msg)); };
    const orig = { log: console.log, warn: console.warn, error: console.error };
    console.log = capture as typeof console.log;
    console.warn = capture as typeof console.warn;
    console.error = capture as typeof console.error;
    try {
      formatReport(report, "text");
    } finally {
      console.log = orig.log;
      console.warn = orig.warn;
      console.error = orig.error;
    }

    const indexOf = (needle: string) => lines.findIndex((l) => l.includes(needle));
    expect(indexOf("info msg")).toBeGreaterThanOrEqual(0);
    expect(indexOf("info msg")).toBeLessThan(indexOf("warn msg"));
    expect(indexOf("warn msg")).toBeLessThan(indexOf("err msg"));
    expect(indexOf("err msg")).toBeLessThan(indexOf("VALIDATION FAILED"));
  });
});

// ---------------------------------------------------------------------------
// Manifest / Config integration
// ---------------------------------------------------------------------------

describe("Manifest validate section", () => {
  test("resolveConfig includes validate defaults", () => {
    const config = resolveConfig({}, {});
    expect(config.validate).toBeDefined();
    expect(config.validate.enabled).toBe(true);
    expect(config.validate.checks["pdf.structure.qpdf"]).toEqual({
      enabled: true,
      severity: "error",
    });
    expect(config.validate.checks["pdf.print.pdfx-markers"]).toEqual({
      enabled: true,
      severity: "error",
    });
    // ARCH #24: allowedCallouts was deprecated-and-ignored (::: syntax
    // removed 2026-05-17) yet still fully resolved into ResolvedConfig — it
    // has since been deleted from ResolvedConfig/preset/validation-profile
    // entirely; the manifest field still parses (for backward compat) but no
    // longer appears on the resolved config at all.
    expect((config.validate.source as Record<string, unknown>).allowedCallouts).toBeUndefined();
    expect(config.validate.assets.maxImageSize).toBe(10_000_000);
    expect(config.validate.pdf.forbidTransparency).toBe(true);
    expect(config.validate.heuristics.textDensityRange.min).toBe(200);
  });

  test("manifest overrides preset defaults", () => {
    const config = resolveConfig(
      {},
      {
        validate: {
          enabled: false,
          assets: { maxImageSize: 5_000_000 },
          source: { allowedCallouts: ["note", "warning"] },
        },
      }
    );
    expect(config.validate.enabled).toBe(false);
    expect(config.validate.assets.maxImageSize).toBe(5_000_000);
    // ARCH #24: a manifest-set allowedCallouts still parses (deprecated field
    // kept on PrintMdManifest for backward compat) but is dropped, not
    // resolved — it no longer appears anywhere on ResolvedConfig.
    expect((config.validate.source as Record<string, unknown>).allowedCallouts).toBeUndefined();
    // Other defaults preserved
    expect(config.validate.assets.minImageDpi).toBe(300);
  });

  test("check-level overrides merge correctly", () => {
    const config = resolveConfig(
      {},
      {
        validate: {
          checks: {
            "pdf.structure.qpdf": false,
            "heuristic.whitespace.text-density": {
              severity: "info",
            },
          },
        },
      }
    );
    expect(config.validate.checks["pdf.structure.qpdf"]).toBe(false);
    const td = config.validate.checks["heuristic.whitespace.text-density"];
    expect(typeof td).toBe("object");
    expect((td as any).severity).toBe("info");
  });

  test("source tool config resolves false correctly", () => {
    const config = resolveConfig(
      {},
      {
        validate: {
          source: { markdownlint: false, htmlhint: false },
        },
      }
    );
    expect(config.validate.source.markdownlint).toBe(false);
    expect(config.validate.source.htmlhint).toBe(false);
  });

  test("source tool config resolves string path", () => {
    const config = resolveConfig(
      {},
      {
        validate: {
          source: { markdownlint: ".markdownlint.yaml" },
        },
      }
    );
    expect(config.validate.source.markdownlint).toBe(".markdownlint.yaml");
  });

  test("heuristics textDensityRange partial override", () => {
    const config = resolveConfig(
      {},
      {
        validate: {
          heuristics: { textDensityRange: { min: 500 } },
        },
      }
    );
    expect(config.validate.heuristics.textDensityRange.min).toBe(500);
    // max should still be the preset default
    expect(config.validate.heuristics.textDensityRange.max).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// Individual check unit tests (no external tools needed)
// ---------------------------------------------------------------------------

describe("Local markdown refs check", () => {
  test("reports missing local link and image refs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "print-md-local-refs-"));
    const mainFile = join(dir, "main.md");
    await writeFile(join(dir, "ok.md"), "# ok\n");
    await writeFile(
      mainFile,
      [
        "[ok](./ok.md)",
        "[missing](./missing.md)",
        "![img](./missing.png)",
        "[ref]: ./also-missing.md",
        "[external](https://example.com)",
      ].join("\n")
    );

    const check = getCheckById("source.links.local-refs")!;
    const ctx = makeCtx({ markdownFiles: [mainFile] });
    const results = await check.run(ctx);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.severity === "error")).toBe(true);
  });
});

describe("Source accessibility checks", () => {
  test("alt-text reports empty image alt text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "print-md-alt-text-"));
    const mainFile = join(dir, "main.md");
    await writeFile(
      mainFile,
      [
        "![ ](./image.png)",
        "![ok](./image.png)",
      ].join("\n")
    );

    const check = getCheckById("source.accessibility.alt-text")!;
    const ctx = makeCtx({ markdownFiles: [mainFile] });
    const results = await check.run(ctx);

    expect(results).toHaveLength(1);
    expect(results[0]!.severity).toBe("warning");
  });

  test("heading-order reports heading level jumps", async () => {
    const dir = await mkdtemp(join(tmpdir(), "print-md-heading-order-"));
    const mainFile = join(dir, "main.md");
    await writeFile(
      mainFile,
      [
        "# H1",
        "### H3 jump",
        "## H2",
      ].join("\n")
    );

    const check = getCheckById("source.accessibility.heading-order")!;
    const ctx = makeCtx({ markdownFiles: [mainFile] });
    const results = await check.run(ctx);

    expect(results).toHaveLength(1);
    expect(results[0]!.severity).toBe("warning");
  });
});

describe("Missing font refs check", () => {
  test("returns empty when no cssFiles", async () => {
    const check = getCheckById("asset.font.missing-refs")!;
    const ctx = makeCtx({ cssFiles: [] });
    const results = await check.run(ctx);
    expect(results).toHaveLength(0);
  });
});

describe("Image file size check", () => {
  test("returns empty when maxImageSize is 0", async () => {
    const config = makeConfig();
    config.validate.assets.maxImageSize = 0;
    const check = getCheckById("asset.image.file-size")!;
    const ctx = makeCtx({ config });
    const results = await check.run(ctx);
    expect(results).toHaveLength(0);
  });
});

describe("PDF checks skip when no pdfPath", () => {
  const pdfCheckIds = [
    "pdf.structure.qpdf",
    "pdf.print.page-size",
    "pdf.print.pdfx-markers",
    "pdf.print.color-spaces",
    "pdf.print.embedded-fonts",
    "pdf.print.ink-coverage",
    "pdf.print.rasterized-pages",
    "pdf.nav.bookmarks",
    "pdf.nav.toc-links",
    "pdf.nav.cross-refs",
    "pdf.nav.page-labels",
    "pdf.print.image-resolution",
    "pdf.print.transparency",
    "pdf.print.bleed",
    "pdf.print.pdfx-metadata",
  ];

  for (const id of pdfCheckIds) {
    test(`${id} returns [] when no pdfPath`, async () => {
      const check = getCheckById(id)!;
      expect(check).toBeDefined();
      const ctx = makeCtx({ pdfPath: undefined });
      const results = await check.run(ctx);
      expect(results).toHaveLength(0);
    });
  }
});

describe("Heuristic checks skip when no pdfPath", () => {
  test("text-density returns [] when no pdfPath", async () => {
    const check = getCheckById("heuristic.whitespace.text-density")!;
    const ctx = makeCtx({ pdfPath: undefined });
    const results = await check.run(ctx);
    expect(results).toHaveLength(0);
  });

  test("layer-count returns [] when no pdfPath", async () => {
    const check = getCheckById("heuristic.decoration.layer-count")!;
    const ctx = makeCtx({ pdfPath: undefined });
    const results = await check.run(ctx);
    expect(results).toHaveLength(0);
  });

  test("placement-variance returns [] when no pdfPath", async () => {
    const check = getCheckById("heuristic.layout.placement-variance")!;
    const ctx = makeCtx({ pdfPath: undefined });
    const results = await check.run(ctx);
    expect(results).toHaveLength(0);
  });
});

describe("Conditional checks respect config", () => {
  test("bookmarks check skips when requireBookmarks=false", async () => {
    const config = makeConfig();
    config.validate.pdf.requireBookmarks = false;
    const check = getCheckById("pdf.nav.bookmarks")!;
    const ctx = makeCtx({ config, pdfPath: "/tmp/test.pdf" });
    const results = await check.run(ctx);
    expect(results).toHaveLength(0);
  });

  test("toc-links check skips when requireTocLinks=false", async () => {
    const config = makeConfig();
    config.validate.pdf.requireTocLinks = false;
    const check = getCheckById("pdf.nav.toc-links")!;
    const ctx = makeCtx({ config, pdfPath: "/tmp/test.pdf" });
    const results = await check.run(ctx);
    expect(results).toHaveLength(0);
  });

  test("transparency check skips when forbidTransparency=false", async () => {
    const config = makeConfig();
    config.validate.pdf.forbidTransparency = false;
    const check = getCheckById("pdf.print.transparency")!;
    const ctx = makeCtx({ config, pdfPath: "/tmp/test.pdf" });
    const results = await check.run(ctx);
    expect(results).toHaveLength(0);
  });

  test("bleed check skips when requireBleed=false", async () => {
    const config = makeConfig();
    config.validate.pdf.requireBleed = false;
    const check = getCheckById("pdf.print.bleed")!;
    const ctx = makeCtx({ config, pdfPath: "/tmp/test.pdf" });
    const results = await check.run(ctx);
    expect(results).toHaveLength(0);
  });

  test("image-resolution check skips when minImageResolution=0", async () => {
    const config = makeConfig();
    config.validate.pdf.minImageResolution = 0;
    const check = getCheckById("pdf.print.image-resolution")!;
    const ctx = makeCtx({ config, pdfPath: "/tmp/test.pdf" });
    const results = await check.run(ctx);
    expect(results).toHaveLength(0);
  });

  test("alpha-channel check skips when allowAlpha=true", async () => {
    const config = makeConfig();
    config.validate.assets.allowAlpha = true;
    const check = getCheckById("asset.image.alpha-channel")!;
    const ctx = makeCtx({ config });
    const results = await check.run(ctx);
    expect(results).toHaveLength(0);
  });

  test("font-license check skips when requireFontLicense=false", async () => {
    const config = makeConfig();
    config.validate.assets.requireFontLicense = false;
    const check = getCheckById("asset.font.license")!;
    const ctx = makeCtx({ config });
    const results = await check.run(ctx);
    expect(results).toHaveLength(0);
  });
});

describe("Source checks skip when tool is disabled", () => {
  test("markdownlint skips when set to false", async () => {
    const config = makeConfig();
    (config.validate.source.markdownlint as any) = false;
    const check = getCheckById("source.markdownlint")!;
    const ctx = makeCtx({ config, markdownFiles: ["/tmp/test.md"] });
    const results = await check.run(ctx);
    expect(results).toHaveLength(0);
  });

  test("htmlhint skips when set to false", async () => {
    const config = makeConfig();
    (config.validate.source.htmlhint as any) = false;
    const check = getCheckById("source.htmlhint")!;
    const ctx = makeCtx({ config, htmlPath: "/tmp/test.html" });
    const results = await check.run(ctx);
    expect(results).toHaveLength(0);
  });

  test("stylelint skips when set to false", async () => {
    const config = makeConfig();
    (config.validate.source.stylelint as any) = false;
    const check = getCheckById("source.stylelint")!;
    const ctx = makeCtx({ config, cssFiles: ["/tmp/test.css"] });
    const results = await check.run(ctx);
    expect(results).toHaveLength(0);
  });

  test("flags remote url() as error and risky print effects as warning", async () => {
    const dir = await mkdtemp(join(tmpdir(), "print-md-stylelint-"));

    try {
      const cssFile = join(dir, "test.css");
      await writeFile(
        cssFile,
        ".a { background: url(https://evil.example/img.png); }\n" +
          ".b { filter: blur(2px); }\n"
      );

      const check = getCheckById("source.stylelint")!;
      const ctx = makeCtx({ inputDir: dir, cssFiles: [cssFile] });
      const results = await check.run(ctx);

      const remote = results.find((r) => r.message.includes("no-remote-urls"));
      const risky = results.find((r) =>
        r.message.includes("no-risky-print-effects")
      );
      expect(remote).toBeDefined();
      expect(remote!.severity).toBe("error");
      expect(remote!.file).toBe(cssFile);
      expect(risky).toBeDefined();
      expect(risky!.severity).toBe("warning");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("stylelint flags selectors that will be skipped by Paged.js", async () => {
    const dir = await mkdtemp(join(tmpdir(), "print-md-stylelint-"));

    try {
      const cssFile = join(dir, "test.css");

      // Both :nth-of-type+sibling and :is()+sibling are flagged — they fail
      // DocumentFragment.querySelectorAll and are silently skipped by Paged.js.
      await writeFile(
        cssFile,
        ".page.rolling-die > .wrapper:first-of-type ul + p { margin-top: 0; }\n" +
        ":is(h2, h3) + p { break-before: avoid; }\n"
      );

      const check = getCheckById("source.stylelint")!;
      const ctx = makeCtx({ inputDir: dir, cssFiles: [cssFile] });
      const results = await check.run(ctx);

      expect(results).toHaveLength(2);
      expect(results[0]!.checkId).toBe("source.stylelint");
      expect(results[0]!.message).toContain("printsafe/no-pagedjs-crash-selectors");
      expect(results[0]!.message).toContain("skipped by Paged.js");
      expect(results[1]!.message).toContain("printsafe/no-pagedjs-crash-selectors");
      expect(results[0]!.file).toBe(cssFile);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Tool Check
// ---------------------------------------------------------------------------

describe("Tool Check", () => {
  test("all checks that use external tools declare requiredTools", () => {
    // These checks are known to NOT need external tools — including everything
    // migrated to in-process libs in Phases 1 & 2 (grep/markdownlint/htmlhint →
    // pure JS; Poppler + general qpdf inspection → PDF.js via unpdf).
    const noToolChecks = new Set([
      "source.links.local-refs",
      "source.accessibility.alt-text",
      "source.accessibility.heading-order",
      "asset.image.file-size",
      "asset.font.approved-files",
      "asset.font.missing-refs",
      "asset.font.license",
      "heuristic.chunking.section-density",
      // Phase 1 — pure JS
      "source.markdownlint",
      "source.htmlhint",
      "source.stylelint",
      "pdf.print.transparency",
      "pdf.print.color-spaces",
      // Phase 2 — PDF.js (unpdf)
      "pdf.nav.bookmarks",
      "pdf.nav.toc-links",
      "pdf.nav.cross-refs",
      "pdf.nav.page-labels",
      "pdf.structure.qpdf",
      "pdf.print.page-size",
      "pdf.print.bleed",
      "pdf.print.embedded-fonts",
      "pdf.print.image-resolution",
      "pdf.print.rasterized-pages",
      "heuristic.whitespace.text-density",
      "heuristic.decoration.layer-count",
      "heuristic.layout.placement-variance",
      // Phase 3 — pure-JS image header reader (replaced ImageMagick identify)
      "asset.image.alpha-channel",
      "asset.image.color-space",
      "asset.image.resolution",
    ]);

    const allChecks = getChecks();
    for (const check of allChecks) {
      if (noToolChecks.has(check.id)) {
        // These should NOT have requiredTools
        expect(check.requiredTools ?? []).toHaveLength(0);
      }
    }
  });

  test("checks with requiredTools have non-empty arrays", () => {
    const allChecks = getChecks();
    for (const check of allChecks) {
      if (check.requiredTools) {
        expect(check.requiredTools.length).toBeGreaterThan(0);
        for (const tool of check.requiredTools) {
          expect(typeof tool).toBe("string");
          expect(tool.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("checkToolAvailability returns empty for disabled checks", async () => {
    const config = makeConfig();
    // Disable htmlhint via source config
    (config.validate.source.htmlhint as any) = false;

    const result = await checkToolAvailability(config, {
      only: ["source.htmlhint"],
    });

    // htmlhint check is filtered out entirely since it's disabled
    expect(result.skippedChecks).not.toContain("source.htmlhint");
  });

  test("checkToolAvailability returns empty for manifest-disabled checks", async () => {
    const config = makeConfig();
    // pdf.print.pdfx-markers still requires qpdf (PDF/X-only check).
    config.validate.checks["pdf.print.pdfx-markers"] = false;

    const result = await checkToolAvailability(config, {
      only: ["pdf.print.pdfx-markers"],
    });

    // Check is disabled, so its tool shouldn't be probed
    expect(result.skippedChecks).not.toContain("pdf.print.pdfx-markers");
  });

  test("checkToolAvailability detects missing fictitious tool", async () => {
    // Register a temporary check with a tool that definitely doesn't exist
    const fakeCheck: Check = {
      id: "test.fake-tool-check",
      name: "Fake Tool Check",
      description: "Test check with missing tool",
      category: "source",
      phase: "pre-build",
      requiredTools: ["__print_md_nonexistent_tool_xyz__"],
      async run() { return []; },
    };
    registerCheck(fakeCheck);

    const config = makeConfig();
    const result = await checkToolAvailability(config, {
      only: ["test.fake-tool-check"],
    });

    expect(result.missing).toContain("__print_md_nonexistent_tool_xyz__");
    expect(result.skippedChecks).toContain("test.fake-tool-check");
  });

  test("reportMissingTools does not throw when no tools missing", () => {
    reportMissingTools({
      available: ["qpdf"],
      missing: [],
      skippedChecks: [],
      toolToChecks: new Map(),
    });
  });

  test("reportMissingTools does not throw when tools are missing", () => {
    const toolToChecks = new Map<string, string[]>();
    toolToChecks.set("qpdf", ["pdf.print.pdfx-markers"]);

    reportMissingTools({
      available: [],
      missing: ["qpdf"],
      skippedChecks: ["pdf.print.pdfx-markers"],
      toolToChecks,
    });
  });
});

describe("Runner skips checks with missing tools", () => {
  test("skipMissingTools filters checks from execution", async () => {
    const dummyCheck: Check = {
      id: "test.tool-skip-check",
      name: "Tool Skip Test",
      description: "Should be skipped",
      category: "source",
      phase: "pre-build",
      requiredTools: ["nonexistent"],
      async run() {
        return [{
          checkId: "test.tool-skip-check",
          severity: "error" as const,
          message: "This should not run",
        }];
      },
    };
    registerCheck(dummyCheck);

    const ctx = makeCtx();
    const report = await runChecks(ctx, {
      only: ["test.tool-skip-check"],
      skipMissingTools: ["test.tool-skip-check"],
    });

    // Check was skipped — no results, no passed (it wasn't even run)
    expect(report.results).toHaveLength(0);
    expect(report.passed).toHaveLength(0);
    expect(report.summary.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// In-process replacements for grep / markdownlint-cli2 / htmlhint (Phase 1).
// These run with NO external tools — previously they required tools on PATH and
// silently skipped. See docs/phase-1-os-dependency-removal-plan.md.
// ---------------------------------------------------------------------------

describe("In-process source/PDF checks (no external tools)", () => {
  test("markdownlint detects violations via auto-detected YAML config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "print-md-mdlint-"));
    try {
      await writeFile(join(dir, ".markdownlint.yaml"), "default: true\nMD013: false\n");
      const mdFile = join(dir, "doc.md");
      await writeFile(mdFile, "#Heading\n\nsome text\n"); // MD018: no space after hash
      const check = getCheckById("source.markdownlint")!;
      const ctx = makeCtx({ inputDir: dir, markdownFiles: [mdFile] });
      const results = await check.run(ctx);
      const md018 = results.find((r) => r.message.includes("MD018"));
      expect(md018).toBeDefined();
      expect(md018!.severity).toBe("warning");
      expect(md018!.file).toBe(mdFile);
      expect(md018!.line).toBe(1);
      // message mirrors cli2 text format: "rule/alias description"
      expect(md018!.message).toContain("no-missing-space-atx");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("markdownlint returns [] for clean markdown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "print-md-mdlint-"));
    try {
      await writeFile(join(dir, ".markdownlint.yaml"), "default: true\n");
      const mdFile = join(dir, "doc.md");
      await writeFile(mdFile, "# Title\n\nA paragraph of text.\n");
      const check = getCheckById("source.markdownlint")!;
      const ctx = makeCtx({ inputDir: dir, markdownFiles: [mdFile] });
      const results = await check.run(ctx);
      expect(results).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("markdownlint skips silently when no config is present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "print-md-mdlint-"));
    try {
      const mdFile = join(dir, "doc.md");
      await writeFile(mdFile, "#bad\n");
      const check = getCheckById("source.markdownlint")!;
      const ctx = makeCtx({ inputDir: dir, markdownFiles: [mdFile] });
      const results = await check.run(ctx);
      expect(results).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("htmlhint detects violations using a .htmlhintrc config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "print-md-htmlhint-"));
    try {
      await writeFile(join(dir, ".htmlhintrc"), JSON.stringify({ "tagname-lowercase": true }));
      const htmlFile = join(dir, "page.html");
      await writeFile(htmlFile, "<DIV></DIV>");
      const check = getCheckById("source.htmlhint")!;
      const ctx = makeCtx({ inputDir: dir, htmlPath: htmlFile });
      const results = await check.run(ctx);
      const lc = results.find((r) => r.message.includes("tagname-lowercase"));
      expect(lc).toBeDefined();
      expect(lc!.file).toBe(htmlFile);
      expect(lc!.line).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("htmlhint uses built-in defaults when config path is set but missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "print-md-htmlhint-"));
    try {
      const htmlFile = join(dir, "page.html");
      await writeFile(htmlFile, "<DIV></DIV>");
      const config = makeConfig();
      (config.validate.source.htmlhint as any) = ".htmlhintrc"; // explicit but absent
      const check = getCheckById("source.htmlhint")!;
      const ctx = makeCtx({ config, inputDir: dir, htmlPath: htmlFile });
      const results = await check.run(ctx);
      // default ruleset includes tagname-lowercase — never disabled by an empty {}
      expect(results.some((r) => r.message.includes("tagname-lowercase"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("transparency detects markers via raw byte scan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "print-md-pdf-"));
    try {
      const pdfFile = join(dir, "t.pdf");
      await writeFile(pdfFile, "%PDF-1.7\n<< /Type /Group /S /Transparency >>\n/SMask 5 0 R\n");
      const config = makeConfig();
      config.validate.pdf.forbidTransparency = true;
      const check = getCheckById("pdf.print.transparency")!;
      const ctx = makeCtx({ config, pdfPath: pdfFile });
      const results = await check.run(ctx);
      expect(results).toHaveLength(1);
      expect(results[0]!.message).toContain("Transparency group");
      expect(results[0]!.message).toContain("Soft mask");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("color-spaces flags DeviceRGB; /Lab\\b does not match /Label", async () => {
    const dir = await mkdtemp(join(tmpdir(), "print-md-pdf-"));
    try {
      const pdfFile = join(dir, "c.pdf");
      // Contains /DeviceRGB and /Label — /Label must NOT trip the /Lab rule.
      await writeFile(pdfFile, "%PDF-1.7\n/ColorSpace /DeviceRGB\n/Label (foo)\n");
      const check = getCheckById("pdf.print.color-spaces")!;
      const ctx = makeCtx({ pdfPath: pdfFile });
      const results = await check.run(ctx);
      expect(results.some((r) => r.message.includes("DeviceRGB"))).toBe(true);
      expect(results.some((r) => r.message.includes("Lab color space"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("color-spaces matches a genuine /Lab color space", async () => {
    const dir = await mkdtemp(join(tmpdir(), "print-md-pdf-"));
    try {
      const pdfFile = join(dir, "lab.pdf");
      await writeFile(pdfFile, "%PDF-1.7\n[/Lab << /WhitePoint [1 1 1] >>]\n");
      const check = getCheckById("pdf.print.color-spaces")!;
      const ctx = makeCtx({ pdfPath: pdfFile });
      const results = await check.run(ctx);
      expect(results.some((r) => r.message.includes("Lab color space"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Asset image checks via the in-process header reader (Phase 3). Builds tiny
// PNGs in-test so no ImageMagick / committed binaries are needed.
// ---------------------------------------------------------------------------

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
}
function buildPng(colorType: number, ppm?: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(10, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const parts = [sig, pngChunk("IHDR", ihdr)];
  if (ppm) {
    const phys = Buffer.alloc(9);
    phys.writeUInt32BE(ppm, 0);
    phys.writeUInt32BE(ppm, 4);
    phys[8] = 1;
    parts.push(pngChunk("pHYs", phys));
  }
  parts.push(pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

describe("Asset image checks (in-process reader)", () => {
  test("alpha-channel flags an RGBA PNG when allowAlpha=false", async () => {
    const dir = await mkdtemp(join(tmpdir(), "print-md-asset-"));
    try {
      await writeFile(join(dir, "rgba.png"), buildPng(6)); // colorType 6 = RGBA
      const config = makeConfig();
      config.validate.assets.allowAlpha = false;
      const check = getCheckById("asset.image.alpha-channel")!;
      const results = await check.run(makeCtx({ config, inputDir: dir, assetDirs: [dir] }));
      expect(results).toHaveLength(1);
      expect(results[0]!.message).toContain("alpha channel");
      expect(results[0]!.file).toContain("rgba.png");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("alpha-channel passes an opaque RGB PNG", async () => {
    const dir = await mkdtemp(join(tmpdir(), "print-md-asset-"));
    try {
      await writeFile(join(dir, "rgb.png"), buildPng(2)); // colorType 2 = RGB
      const config = makeConfig();
      config.validate.assets.allowAlpha = false;
      const check = getCheckById("asset.image.alpha-channel")!;
      const results = await check.run(makeCtx({ config, inputDir: dir, assetDirs: [dir] }));
      expect(results).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("color-space flags an sRGB PNG when only CMYK/Gray allowed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "print-md-asset-"));
    try {
      await writeFile(join(dir, "rgb.png"), buildPng(2)); // sRGB
      const config = makeConfig();
      config.validate.assets.allowedColorSpaces = ["CMYK", "Gray"];
      const check = getCheckById("asset.image.color-space")!;
      const results = await check.run(makeCtx({ config, inputDir: dir, assetDirs: [dir] }));
      expect(results).toHaveLength(1);
      expect(results[0]!.message).toContain("sRGB");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("resolution flags a low-DPI image and passes a 300-DPI one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "print-md-asset-"));
    try {
      await writeFile(join(dir, "low.png"), buildPng(2)); // no pHYs → 72 DPI
      await writeFile(join(dir, "hi.png"), buildPng(2, 11811)); // 300 DPI
      const config = makeConfig();
      config.validate.assets.minImageDpi = 300;
      const check = getCheckById("asset.image.resolution")!;
      const results = await check.run(makeCtx({ config, inputDir: dir, assetDirs: [dir] }));
      expect(results).toHaveLength(1);
      expect(results[0]!.file).toContain("low.png");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
