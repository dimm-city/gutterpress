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
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeValidation, executeAndReport } from "./validation-exec";
import { UsageError } from "./cli-args";
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
    const dir = await makeDir("pmd-vexec-manifest-flag-");
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
    const dir = await makeDir("pmd-vexec-input-dir-");
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
    const missing = path.join(tmpdir(), `pmd-vexec-missing-manifest-${Date.now()}.yaml`);
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
    const missing = path.join(tmpdir(), "pmd-vexec-missing-" + Date.now() + ".pdf");
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
    const dir = await makeDir("pmd-vexec-dtrpg-");
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
    const dir = await makeDir("pmd-vexec-dtrpg-skip-");
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
    const dir = await makeDir("pmd-vexec-no-profile-skip-");
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
    const dir = await makeDir("pmd-vexec-phase-pdf-");
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
    const dir = await makeDir("pmd-vexec-phase-input-");
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
    const dir = await makeDir("pmd-vexec-phase-both-");
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
    const dir = await makeDir("pmd-vexec-html-in-");
    const outDir = await makeDir("pmd-vexec-html-out-");
    try {
      // Absolute output.dir sidesteps any cwd-relative ambiguity in resolve().
      await writeFile(
        path.join(dir, "manifest.yaml"),
        `output:\n  dir: "${outDir.replace(/\\/g, "\\\\")}"\n`,
        "utf-8"
      );
      await writeFile(path.join(dir, "chapter-01.md"), "# Hi\n", "utf-8");
      await writeFile(path.join(outDir, "book.html"), "<html></html>", "utf-8");
      stubCheckExecution();

      const execution = await executeValidation({ input: dir });

      expect(execution.context.htmlPath).toBe(path.join(outDir, "book.html"));
      expect(execution.context.markdownFiles).toContain(
        path.join(dir, "chapter-01.md")
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outDir, { recursive: true, force: true });
    }
  });

  test("no book.html in the output dir leaves context.htmlPath undefined", async () => {
    const dir = await makeDir("pmd-vexec-no-html-in-");
    const outDir = await makeDir("pmd-vexec-no-html-out-");
    try {
      await writeFile(
        path.join(dir, "manifest.yaml"),
        `output:\n  dir: "${outDir.replace(/\\/g, "\\\\")}"\n`,
        "utf-8"
      );
      await writeFile(path.join(dir, "chapter-01.md"), "# Hi\n", "utf-8");
      stubCheckExecution();

      const execution = await executeValidation({ input: dir });

      expect(execution.context.htmlPath).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

// ── category/only/skip CSV parsing wiring ───────────────────────────────────

describe("executeValidation category/only/skip parsing", () => {
  test("comma-separated --category/--only/--skip are trimmed into arrays on runnerOptions", async () => {
    const dir = await makeDir("pmd-vexec-csv-");
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
