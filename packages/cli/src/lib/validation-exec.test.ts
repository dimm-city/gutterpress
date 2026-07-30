/**
 * ARCH finding #49: `validation-exec.ts` (292 lines) previously had only its
 * pure `buildPdfSummaryLines` formatter tested (validation-exec-summary.test.ts)
 * and its `--phase` alias resolution tested against the REAL check registry
 * (validation-exec-phase.test.ts). This file covers the remaining execution
 * paths: manifest/input resolution, the `--pdf` existence guard, profile
 * handling (including the `withProfileRequiredCheckErrors` synthetic-error
 * injection, which had zero coverage), phase auto-detection, `htmlPath`
 * detection, and `executeAndReport`'s ok/format branching.
 *
 * `checkToolAvailability` (checks/tool-check) and `runChecks` (checks/runner)
 * are `spyOn`-stubbed so these tests are deterministic regardless of which
 * external tools (gs/qpdf) happen to be installed on the machine running them,
 * and don't depend on real check content — exactly the "stub the check
 * registry" instruction for this work package. `spyOn`/`mockRestore` (never
 * `mock.module`) so nothing leaks into the sibling `-phase`/`-summary` test
 * files, which rely on the REAL registry.
 */
import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeValidation, executeAndReport } from "./validation-exec";
import { UsageError } from "./cli-args";
import { resolveOutputDir } from "./output-paths";
import * as toolCheckMod from "../checks/tool-check";
import * as runnerMod from "../checks/runner";
import * as formatterMod from "../checks/formatter";
import { DTRPG_PRESET } from "./presets";
import { DTRPG_STRICT_PDF_CHECKS } from "./validation-profile";
import type { ToolCheckResult } from "../checks/tool-check";
import type { RunnerReport } from "../checks/runner";

// Check modules must be registered (self-registering side-effect imports) —
// mirrors validation-exec-phase.test.ts. Harmless to import repeatedly;
// registerCheck() is an idempotent Map.set.
import "../checks/pdf/index";
import "../checks/source/index";
import "../checks/asset/index";
import "../checks/heuristic/index";
import { collectImageFiles } from "./image-inspect";
import { ASSET_SCAN_IGNORE_GLOBS, FONT_EXTS } from "../checks/asset/extensions";

function emptyToolResult(overrides: Partial<ToolCheckResult> = {}): ToolCheckResult {
  return {
    available: [],
    missing: [],
    skippedChecks: [],
    toolToChecks: new Map(),
    ...overrides,
  };
}

function emptyReport(overrides: Partial<RunnerReport> = {}): RunnerReport {
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

let toolAvailSpy: ReturnType<typeof spyOn> | undefined;
let runChecksSpy: ReturnType<typeof spyOn> | undefined;
let reportMissingToolsSpy: ReturnType<typeof spyOn> | undefined;
let formatReportSpy: ReturnType<typeof spyOn> | undefined;

/** Stub the check-execution layer (NOT the registry lookups executeValidation
 * itself performs for the --phase/--category zero-match guard). */
function stubCheckExecution(opts?: {
  tools?: Partial<ToolCheckResult>;
  report?: Partial<RunnerReport>;
}): void {
  toolAvailSpy = spyOn(toolCheckMod, "checkToolAvailability").mockImplementation(
    (async () => emptyToolResult(opts?.tools)) as typeof toolCheckMod.checkToolAvailability
  );
  runChecksSpy = spyOn(runnerMod, "runChecks").mockImplementation(
    (async () => emptyReport(opts?.report)) as typeof runnerMod.runChecks
  );
}

afterEach(() => {
  toolAvailSpy?.mockRestore();
  runChecksSpy?.mockRestore();
  reportMissingToolsSpy?.mockRestore();
  formatReportSpy?.mockRestore();
  toolAvailSpy = undefined;
  runChecksSpy = undefined;
  reportMissingToolsSpy = undefined;
  formatReportSpy = undefined;
});

async function makeDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

// ── manifest / input resolution ─────────────────────────────────────────────

describe("executeValidation manifest resolution", () => {
  test("--manifest points at a specific (non-standard-named) manifest file", async () => {
    const dir = await makeDir("gutterpress-vexec-manifest-flag-");
    try {
      const manifestPath = path.join(dir, "custom-manifest.yaml");
      await writeFile(manifestPath, "title: From Manifest Flag\n", "utf-8");
      stubCheckExecution();

      const execution = await executeValidation({ manifest: manifestPath });

      expect(execution.config.title).toBe("From Manifest Flag");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("--input directory loads manifest.yaml from that directory when --manifest is absent", async () => {
    const dir = await makeDir("gutterpress-vexec-input-dir-");
    try {
      await writeFile(path.join(dir, "manifest.yaml"), "title: From Input Dir\n", "utf-8");
      stubCheckExecution();

      const execution = await executeValidation({ input: dir });

      expect(execution.config.title).toBe("From Input Dir");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an explicit missing --manifest used by validate/audit/preflight fails before checks run", async () => {
    const missing = path.join(tmpdir(), `gutterpress-vexec-missing-manifest-${Date.now()}.yaml`);
    stubCheckExecution();

    await expect(executeValidation({ manifest: missing })).rejects.toThrow(UsageError);
    await expect(executeValidation({ manifest: missing })).rejects.toThrow(
      `manifest not found: ${missing}`
    );
    expect(runChecksSpy).not.toHaveBeenCalled();
  });
});

// ── --pdf existence guard ────────────────────────────────────────────────────

describe("executeValidation --pdf existence guard", () => {
  test("throws 'File not found' for a --pdf path that doesn't exist, before running any checks", async () => {
    const missing = path.join(tmpdir(), "gutterpress-vexec-missing-" + Date.now() + ".pdf");
    stubCheckExecution();

    await expect(executeValidation({ pdf: missing })).rejects.toThrow(
      `File not found: ${path.resolve(missing)}`
    );
    expect(runChecksSpy).not.toHaveBeenCalled();
  });
});

// ── profile handling ─────────────────────────────────────────────────────────

describe("executeValidation profile handling", () => {
  test("an unsupported --profile value throws naming the supported list", async () => {
    stubCheckExecution();
    await expect(executeValidation({ profile: "bogus-profile" })).rejects.toThrow(
      'Unsupported profile: bogus-profile. Supported profiles: dtrpg'
    );
  });

  test("profile: dtrpg locks the DTRPG preset geometry/ink/PDF-X defaults onto config", async () => {
    const dir = await makeDir("gutterpress-vexec-dtrpg-");
    try {
      await writeFile(path.join(dir, "chapter-01.md"), "# Hi\n", "utf-8");
      stubCheckExecution();

      const execution = await executeValidation({ input: dir, profile: "dtrpg" });

      expect(execution.profile).toBe("dtrpg");
      expect(execution.config.pdfx.flavor).toBe(DTRPG_PRESET.pdfx.flavor);
      expect(execution.config.ink.maxTac).toBe(DTRPG_PRESET.ink.maxTac);
      for (const checkId of DTRPG_STRICT_PDF_CHECKS) {
        expect(execution.config.validate.checks[checkId]).toEqual({
          enabled: true,
          severity: "error",
        });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("profile: dtrpg synthesizes an error for each required check skipped due to missing tools", async () => {
    const dir = await makeDir("gutterpress-vexec-dtrpg-skip-");
    try {
      await writeFile(path.join(dir, "chapter-01.md"), "# Hi\n", "utf-8");
      const skippedId = DTRPG_STRICT_PDF_CHECKS[0];
      stubCheckExecution({
        tools: { missing: ["qpdf"], skippedChecks: [skippedId] },
        report: {
          summary: { total: 0, errors: 0, warnings: 0, infos: 0, passed: 0 },
        },
      });

      const execution = await executeValidation({ input: dir, profile: "dtrpg" });

      const synthetic = execution.report.errors.find((e) => e.checkId === skippedId);
      expect(synthetic).toBeDefined();
      expect(synthetic!.message).toContain(
        `Profile dtrpg requires check ${skippedId}, but it was skipped`
      );
      // The synthetic error must be reflected in the summary count too, or
      // executeAndReport's ok/exit-code decision would silently ignore it.
      expect(execution.report.summary.errors).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("without a profile, a skipped tool never synthesizes a required-check error", async () => {
    const dir = await makeDir("gutterpress-vexec-no-profile-skip-");
    try {
      await writeFile(path.join(dir, "chapter-01.md"), "# Hi\n", "utf-8");
      stubCheckExecution({
        tools: { missing: ["qpdf"], skippedChecks: ["pdf.structure.qpdf"] },
      });

      const execution = await executeValidation({ input: dir });

      expect(execution.report.errors).toEqual([]);
      expect(execution.report.summary.errors).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── phase auto-detection (no explicit --phase) ──────────────────────────────

describe("executeValidation phase auto-detection", () => {
  test("--pdf alone (no --input) auto-selects post-build", async () => {
    const dir = await makeDir("gutterpress-vexec-phase-pdf-");
    try {
      const pdfPath = path.join(dir, "book.pdf");
      await writeFile(pdfPath, "%PDF-1.4\n", "utf-8");
      stubCheckExecution();

      const execution = await executeValidation({ pdf: pdfPath });

      expect(execution.runnerOptions.phase).toBe("post-build");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("--input alone (no --pdf) auto-selects pre-build", async () => {
    const dir = await makeDir("gutterpress-vexec-phase-input-");
    try {
      await writeFile(path.join(dir, "chapter-01.md"), "# Hi\n", "utf-8");
      stubCheckExecution();

      const execution = await executeValidation({ input: dir });

      expect(execution.runnerOptions.phase).toBe("pre-build");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("neither --pdf nor --input and no explicit --phase leaves phase undefined (both phases run)", async () => {
    stubCheckExecution();

    const execution = await executeValidation({});

    expect(execution.runnerOptions.phase).toBeUndefined();
  });

  test("both --pdf and --input given leaves phase undefined (both phases run against both)", async () => {
    const dir = await makeDir("gutterpress-vexec-phase-both-");
    try {
      const pdfPath = path.join(dir, "book.pdf");
      await writeFile(pdfPath, "%PDF-1.4\n", "utf-8");
      await writeFile(path.join(dir, "chapter-01.md"), "# Hi\n", "utf-8");
      stubCheckExecution();

      const execution = await executeValidation({ input: dir, pdf: pdfPath });

      expect(execution.runnerOptions.phase).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── htmlPath / markdown-glob wiring from a real inputDir ────────────────────

describe("executeValidation context derived from --input", () => {
  test("detects book.html in the resolved output dir and includes it as context.htmlPath", async () => {
    const dir = await makeDir("gutterpress-vexec-html-in-");
    try {
      // No manifest — title defaults to "Document" (manifest.ts), so the
      // convention output dir (output-paths.ts) is `dist/document/`.
      await writeFile(path.join(dir, "chapter-01.md"), "# Hi\n", "utf-8");
      const outDir = resolveOutputDir(dir, "Document");
      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, "book.html"), "<html></html>", "utf-8");
      stubCheckExecution();

      const execution = await executeValidation({ input: dir });

      expect(execution.context.htmlPath).toBe(path.join(outDir, "book.html"));
      expect(execution.context.markdownFiles).toContain(
        path.join(dir, "chapter-01.md")
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("no book.html in the output dir leaves context.htmlPath undefined", async () => {
    const dir = await makeDir("gutterpress-vexec-no-html-in-");
    try {
      await writeFile(path.join(dir, "chapter-01.md"), "# Hi\n", "utf-8");
      stubCheckExecution();

      const execution = await executeValidation({ input: dir });

      expect(execution.context.htmlPath).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── file-set resolvers match the renderer's (2026-07-28 duplication audit) ─
//
// Before this, an inputDir run with no manifest `source.files`/`styles`
// globbed `**/*.md`/`**/*.css` across the WHOLE project — so validation/lint
// checked files the book never renders. These prove context.markdownFiles/
// cssFiles now match resolveActiveMarkdownFiles/resolveActiveStyles exactly
// (the same resolvers renderChapters/renderBook use), not an independent scan.

describe("executeValidation markdown/css file-set resolvers", () => {
  test("markdown fallback is the non-recursive root listing, not a recursive glob", async () => {
    const dir = await makeDir("gutterpress-vexec-md-nonrecursive-");
    try {
      await writeFile(path.join(dir, "chapter-01.md"), "# Hi\n", "utf-8");
      // A subdirectory's .md file must NOT be picked up when source.files is
      // unset — renderChapters' own fallback (lib/markdown/index.ts) only
      // reads the project root, exactly like resolveActiveMarkdownFiles.
      await mkdir(path.join(dir, "drafts"), { recursive: true });
      await writeFile(path.join(dir, "drafts", "unused.md"), "# Draft\n", "utf-8");
      stubCheckExecution();

      const execution = await executeValidation({ input: dir });

      expect(execution.context.markdownFiles).toEqual([
        path.join(dir, "chapter-01.md"),
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("manifest source.files (explicit order) is used verbatim, excluding unlisted root .md files", async () => {
    const dir = await makeDir("gutterpress-vexec-md-explicit-");
    try {
      await writeFile(path.join(dir, "chapter-01.md"), "# One\n", "utf-8");
      await writeFile(path.join(dir, "chapter-02.md"), "# Two\n", "utf-8");
      await writeFile(path.join(dir, "unlisted.md"), "# Unlisted\n", "utf-8");
      await writeFile(
        path.join(dir, "manifest.yaml"),
        "title: Ordered\nsource:\n  files:\n    - chapter-02.md\n    - chapter-01.md\n",
        "utf-8"
      );
      stubCheckExecution();

      const execution = await executeValidation({ input: dir });

      // Same order the manifest declares, and unlisted.md is excluded — this
      // is exactly what renderChapters would read and in what order.
      expect(execution.context.markdownFiles).toEqual([
        path.join(dir, "chapter-02.md"),
        path.join(dir, "chapter-01.md"),
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("css fallback resolves the SAME active stylesheet the renderer would link, not every .css in the project", async () => {
    const dir = await makeDir("gutterpress-vexec-css-active-only-");
    try {
      await writeFile(path.join(dir, "chapter-01.md"), "# Hi\n", "utf-8");
      // Conventional active stylesheet (style-resolver.ts FALLBACK_PRIORITY).
      await mkdir(path.join(dir, "styles"), { recursive: true });
      await writeFile(path.join(dir, "styles", "book.css"), "body { color: red; }", "utf-8");
      // An unreferenced theme sitting alongside it must NOT be validated —
      // the book never links it, so print-safety findings on it would be
      // findings on a file that doesn't ship.
      await mkdir(path.join(dir, "themes", "unused"), { recursive: true });
      await writeFile(
        path.join(dir, "themes", "unused", "theme.css"),
        "body { background: url(http://example.com/x.png); }",
        "utf-8"
      );
      stubCheckExecution();

      const execution = await executeValidation({ input: dir });

      expect(execution.context.cssFiles).toEqual([
        path.join(dir, "styles", "book.css"),
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("manifest styles: list is resolved verbatim (active set), excluding other project .css files", async () => {
    const dir = await makeDir("gutterpress-vexec-css-explicit-");
    try {
      await writeFile(path.join(dir, "chapter-01.md"), "# Hi\n", "utf-8");
      await mkdir(path.join(dir, "css"), { recursive: true });
      await writeFile(path.join(dir, "css", "main.css"), "body { color: blue; }", "utf-8");
      await writeFile(path.join(dir, "css", "unused.css"), "body { color: green; }", "utf-8");
      await writeFile(
        path.join(dir, "manifest.yaml"),
        "title: Explicit Styles\nstyles:\n  - css/main.css\n",
        "utf-8"
      );
      stubCheckExecution();

      const execution = await executeValidation({ input: dir });

      expect(execution.context.cssFiles).toEqual([path.join(dir, "css", "main.css")]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── 2026-07-29 audit: shared assets that SHIP must be scanned ────────────────
//
// `assetDirs = [inputDir]` scanned only the book folder, but a shared repo-root
// stylesheet's own `url()` closure is embedded into the built PDF (fonts always,
// images under the inline cap) — so shipped shared fonts and art were never
// checked for resolution, colour space, TAC, file size, alpha, or font licence.
// The book-local scan is the same either way; what is added is the directories
// the ACTIVE stylesheets' out-of-book asset closure actually lives in.

describe("executeValidation assetDirs covers the shared asset closure", () => {
  test("directories holding out-of-book CSS assets are scanned too", async () => {
    const repo = await makeDir("gutterpress-vexec-shared-repo-");
    try {
      const book = path.join(repo, "books", "field-guide");
      const sharedFonts = path.join(repo, "shared", "fonts");
      const sharedThemes = path.join(repo, "shared", "themes");
      await mkdir(book, { recursive: true });
      await mkdir(sharedFonts, { recursive: true });
      await mkdir(sharedThemes, { recursive: true });
      await writeFile(path.join(sharedFonts, "Publisher.woff2"), "fake", "utf-8");
      await writeFile(
        path.join(sharedThemes, "theme.css"),
        '@font-face { font-family: P; src: url("../fonts/Publisher.woff2"); }\n',
        "utf-8",
      );
      await writeFile(path.join(book, "chapter-01.md"), "# Hi\n", "utf-8");
      await writeFile(
        path.join(book, "manifest.yaml"),
        "title: Field Guide\nstyles:\n  - ../../shared/themes/theme.css\n",
        "utf-8",
      );
      stubCheckExecution();

      const execution = await executeValidation({ input: book });

      expect(execution.context.assetDirs).toContain(book);
      // The shared font's own directory — where the shipped asset lives.
      expect(execution.context.assetDirs).toContain(sharedFonts);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  test("a book with only in-book assets still scans exactly its own root", async () => {
    const dir = await makeDir("gutterpress-vexec-shared-none-");
    try {
      await writeFile(path.join(dir, "chapter-01.md"), "# Hi\n", "utf-8");
      await mkdir(path.join(dir, "styles"), { recursive: true });
      await writeFile(path.join(dir, "styles", "book.css"), "body{}\n", "utf-8");
      stubCheckExecution();

      const execution = await executeValidation({ input: dir });

      expect(execution.context.assetDirs).toEqual([dir]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── assetDirs derivation (no more `source.assets` config list) ─────────────

describe("executeValidation assetDirs derivation", () => {
  test("a clean project (no node_modules/.git/dist) scans the root wholesale", async () => {
    const dir = await makeDir("gutterpress-vexec-assets-clean-");
    try {
      await writeFile(path.join(dir, "chapter-01.md"), "# Hi\n", "utf-8");
      await mkdir(path.join(dir, "images"), { recursive: true });
      await writeFile(path.join(dir, "images", "cover.png"), "fake", "utf-8");
      stubCheckExecution();

      const execution = await executeValidation({ input: dir });

      expect(execution.context.assetDirs).toEqual([dir]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a project with node_modules/.git/dist STILL scans the root wholesale", async () => {
    // The directory list must never shrink: pruning happens at the glob level
    // (ASSET_SCAN_IGNORE_GLOBS), so root-level files stay covered after a build.
    const dir = await makeDir("gutterpress-vexec-assets-dirty-");
    try {
      await writeFile(path.join(dir, "chapter-01.md"), "# Hi\n", "utf-8");
      await writeFile(path.join(dir, "cover.png"), "fake", "utf-8");
      await mkdir(path.join(dir, "node_modules", "some-plugin"), { recursive: true });
      await mkdir(path.join(dir, "dist"), { recursive: true });
      stubCheckExecution();

      const execution = await executeValidation({ input: dir });

      expect(execution.context.assetDirs).toEqual([dir]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── category/only/skip CSV parsing wiring ───────────────────────────────────

describe("executeValidation category/only/skip parsing", () => {
  test("comma-separated --category/--only/--skip are trimmed into arrays on runnerOptions", async () => {
    const dir = await makeDir("gutterpress-vexec-csv-");
    try {
      await writeFile(path.join(dir, "chapter-01.md"), "# Hi\n", "utf-8");
      stubCheckExecution();

      const execution = await executeValidation({
        input: dir,
        category: "source, asset",
        only: "source.headings, source.toc",
        skip: "asset.image-extension",
      });

      expect(execution.runnerOptions.category).toEqual(["source", "asset"]);
      expect(execution.runnerOptions.only).toEqual(["source.headings", "source.toc"]);
      expect(execution.runnerOptions.skip).toEqual(["asset.image-extension"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── executeAndReport ─────────────────────────────────────────────────────────

describe("executeAndReport", () => {
  test("ok is true when the report has zero errors", async () => {
    stubCheckExecution();
    const { ok } = await executeAndReport({});
    expect(ok).toBe(true);
  });

  test("ok is false when the report has one or more errors", async () => {
    stubCheckExecution({
      report: {
        errors: [{ checkId: "x", severity: "error", message: "bad" }],
        summary: { total: 1, errors: 1, warnings: 0, infos: 0, passed: 0 },
      },
    });
    const { ok } = await executeAndReport({});
    expect(ok).toBe(false);
  });

  test("text format calls reportMissingTools; json format does not", async () => {
    stubCheckExecution({ tools: { missing: ["qpdf"] } });
    reportMissingToolsSpy = spyOn(toolCheckMod, "reportMissingTools").mockImplementation(
      (() => {}) as typeof toolCheckMod.reportMissingTools
    );

    await executeAndReport({}, "text");
    expect(reportMissingToolsSpy).toHaveBeenCalledTimes(1);

    reportMissingToolsSpy.mockClear();
    await executeAndReport({}, "json");
    expect(reportMissingToolsSpy).not.toHaveBeenCalled();
  });

  test("formatReport is always called, with the requested format", async () => {
    stubCheckExecution();
    formatReportSpy = spyOn(formatterMod, "formatReport").mockImplementation(
      (() => {}) as typeof formatterMod.formatReport
    );

    await executeAndReport({}, "json");

    expect(formatReportSpy).toHaveBeenCalledTimes(1);
    expect(formatReportSpy!.mock.calls[0]![1]).toBe("json");
  });
});

/**
 * Regression: asset scanning must not lose coverage once a build has run.
 *
 * A previous implementation swapped the project root for its subdirectories
 * whenever an ignored directory (`dist`, `node_modules`, `.git`) existed. That
 * silently dropped every file sitting AT the root, and for a project whose only
 * subdirectory was `dist` it produced an empty directory list — so asset
 * validation became a no-op the moment the author ran their first build. A
 * too-low-DPI cover would then sail through to the print shop unreported.
 *
 * Exclusion now happens at the glob level, so the directory list never shrinks.
 */
describe("asset scan coverage survives a build (root files + dist present)", () => {
  test("a root-level image is still scanned when dist/ exists", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-assetscan-"));
    try {
      await mkdir(path.join(dir, "dist"), { recursive: true });
      await writeFile(path.join(dir, "cover.png"), "x");
      await writeFile(path.join(dir, "dist", "built.png"), "x");

      const found = await collectImageFiles([dir], ["png", "jpg"]);

      expect(found.some((f) => f.endsWith("cover.png"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the build's own copies under dist/ are NOT reported as author assets", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-assetscan-dist-"));
    try {
      await mkdir(path.join(dir, "dist"), { recursive: true });
      await writeFile(path.join(dir, "dist", "built.png"), "x");

      const found = await collectImageFiles([dir], ["png", "jpg"]);

      expect(found).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("node_modules and .git are excluded but sibling project dirs are kept", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-assetscan-ig-"));
    try {
      await mkdir(path.join(dir, "node_modules", "pkg"), { recursive: true });
      await mkdir(path.join(dir, ".git"), { recursive: true });
      await mkdir(path.join(dir, "images"), { recursive: true });
      await writeFile(path.join(dir, "node_modules", "pkg", "dep.png"), "x");
      await writeFile(path.join(dir, ".git", "hook.png"), "x");
      await writeFile(path.join(dir, "images", "real.png"), "x");

      const found = await collectImageFiles([dir], ["png", "jpg"]);

      expect(found.map((f) => f.split("/").pop())).toEqual(["real.png"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a root-level FONT is still scanned when dist/ exists", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-assetscan-font-"));
    try {
      await mkdir(path.join(dir, "dist"), { recursive: true });
      await writeFile(path.join(dir, "body.woff2"), "x");
      await writeFile(path.join(dir, "dist", "copied.woff2"), "x");

      const { glob } = await import("glob");
      const found = await glob(`**/*.{${FONT_EXTS.join(",")}}`, {
        cwd: dir,
        absolute: true,
        ignore: [...ASSET_SCAN_IGNORE_GLOBS],
      });

      expect(found.some((f) => f.endsWith("body.woff2"))).toBe(true);
      expect(found.some((f) => f.includes("/dist/"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
