/**
 * Tests for the print-md check/validation system.
 *
 * Covers: registry, runner, formatter, manifest integration,
 * and individual check modules (unit-level, no external tools required).
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { resolveConfig } from "../lib/manifest";
import type { ResolvedConfig } from "../schema/manifest.types";
import type { CheckContext, CheckResult, Check } from "./types";
import { registerCheck, getChecks, getCheckById, getAllCheckIds } from "./registry";
import { runChecks } from "./runner";
import { formatReport } from "./formatter";
import { checkToolAvailability, reportMissingTools } from "./tool-check";
import type { RunnerReport } from "./runner";

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

function makeCtx(partial: Partial<CheckContext> = {}): CheckContext {
  return {
    config: makeConfig(),
    inputDir: "/tmp/test-input",
    outputDir: "/tmp/test-output",
    ...partial,
  };
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
    expect(sourceIds).toContain("source.callout-validation");
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
    const all = getAllCheckIds();
    // 15 pdf + 4 source + 8 asset + 4 heuristic = 31
    expect(all.length).toBe(31);
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

  test("skip filter excludes checks", async () => {
    const ctx = makeCtx();
    const allReport = await runChecks(ctx, { category: ["heuristic"] });
    const skipReport = await runChecks(ctx, {
      category: ["heuristic"],
      skip: ["heuristic.whitespace.text-density"],
    });
    expect(skipReport.summary.total).toBe(allReport.summary.total - 1);
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
});

// ---------------------------------------------------------------------------
// Manifest / Config integration
// ---------------------------------------------------------------------------

describe("Manifest validate section", () => {
  test("resolveConfig includes validate defaults", () => {
    const config = resolveConfig({}, {});
    expect(config.validate).toBeDefined();
    expect(config.validate.enabled).toBe(true);
    expect(config.validate.checks).toEqual({});
    expect(config.validate.source.allowedCallouts).toContain("sidebar");
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
    expect(config.validate.source.allowedCallouts).toEqual([
      "note",
      "warning",
    ]);
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

describe("Callout validation check", () => {
  test("returns empty when no markdownFiles", async () => {
    const check = getCheckById("source.callout-validation")!;
    const ctx = makeCtx({ markdownFiles: [] });
    const results = await check.run(ctx);
    expect(results).toHaveLength(0);
  });

  test("returns empty when allowedCallouts is empty", async () => {
    const config = makeConfig();
    config.validate.source.allowedCallouts = [];
    const check = getCheckById("source.callout-validation")!;
    const ctx = makeCtx({ config, markdownFiles: ["/tmp/test.md"] });
    const results = await check.run(ctx);
    expect(results).toHaveLength(0);
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
});

// ---------------------------------------------------------------------------
// Tool Check
// ---------------------------------------------------------------------------

describe("Tool Check", () => {
  test("all checks that use external tools declare requiredTools", () => {
    // These checks are known to NOT need external tools
    const noToolChecks = new Set([
      "source.callout-validation",
      "asset.image.file-size",
      "asset.font.approved-files",
      "asset.font.missing-refs",
      "asset.font.license",
      "heuristic.chunking.section-density",
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
    config.validate.checks["pdf.structure.qpdf"] = false;

    const result = await checkToolAvailability(config, {
      only: ["pdf.structure.qpdf"],
    });

    // Check is disabled, so its tool shouldn't be probed
    expect(result.skippedChecks).not.toContain("pdf.structure.qpdf");
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
    toolToChecks.set("qpdf", ["pdf.structure.qpdf"]);

    reportMissingTools({
      available: [],
      missing: ["qpdf"],
      skippedChecks: ["pdf.structure.qpdf"],
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
