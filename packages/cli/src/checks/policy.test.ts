/**
 * Tests for the shared check-enable/disable seam and the unified
 * parse/tool-failure policy (P1 / check-enable-and-policy).
 *
 * These lock two invariants:
 *   1. A SINGLE `isCheckEnabled(check, config)` decides enablement for BOTH the
 *      runner (execution) and tool-check (tool probing) — including a check's
 *      declarative `enabledWhen(config)` gate (replacing the old inline
 *      `source.stylelint === false` special case in tool-check).
 *   2. Inspection / tool failures ("couldn't parse/inspect") are ALWAYS a single
 *      `warning` tagged `code: "inspect-failed"` — never a hard `error`, never
 *      silently dropped. Genuine content violations keep their configured
 *      severity.
 */

import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "../lib/manifest";
import type { ResolvedConfig } from "../schema/manifest.types";
import type { Check } from "./types";
import {
  isCheckEnabled,
  finding,
  inspectionFailed,
  INSPECT_FAILED_CODE,
} from "./policy";
import { getChecks, getCheckById, registerCheck } from "./registry";
import { checkToolAvailability } from "./tool-check";
import { runChecks } from "./runner";
import { makeCtx } from "../test-helpers/testkit";

// self-register all checks
import "./pdf/index";
import "./source/index";
import "./asset/index";
import "./heuristic/index";

function makeConfig(): ResolvedConfig {
  return resolveConfig({}, {});
}

function fakeCheck(overrides: Partial<Check> = {}): Check {
  return {
    id: "test.fake",
    name: "Fake",
    description: "fake",
    category: "pdf",
    phase: "post-build",
    async run() {
      return [];
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared isCheckEnabled
// ---------------------------------------------------------------------------

describe("isCheckEnabled — single source for enable/disable", () => {
  test("enabled by default", () => {
    expect(isCheckEnabled(fakeCheck(), makeConfig())).toBe(true);
  });

  test("manifest boolean false disables", () => {
    const config = makeConfig();
    config.validate.checks["test.fake"] = false;
    expect(isCheckEnabled(fakeCheck(), config)).toBe(false);
  });

  test("manifest object {enabled:false} disables", () => {
    const config = makeConfig();
    config.validate.checks["test.fake"] = { enabled: false };
    expect(isCheckEnabled(fakeCheck(), config)).toBe(false);
  });

  test("declarative enabledWhen(config) gate disables", () => {
    const check = fakeCheck({ enabledWhen: () => false });
    expect(isCheckEnabled(check, makeConfig())).toBe(false);
  });

  test("enabledWhen(config) that returns true keeps the check enabled", () => {
    const check = fakeCheck({ enabledWhen: () => true });
    expect(isCheckEnabled(check, makeConfig())).toBe(true);
  });

  test("stylelint check carries the enabledWhen gate for source.stylelint=false", () => {
    const check = getCheckById("source.stylelint")!;
    const config = makeConfig();
    expect(isCheckEnabled(check, config)).toBe(true);
    (config.validate.source.stylelint as unknown) = false;
    expect(isCheckEnabled(check, config)).toBe(false);
  });
});

describe("tool-check consumes the shared enable logic (enabledWhen included)", () => {
  test("a tool check gated off by enabledWhen is NOT probed", async () => {
    const gated: Check = fakeCheck({
      id: "test.gated-tool-check",
      category: "source",
      phase: "pre-build",
      requiredTools: ["__print_md_nonexistent_tool_gated__"],
      enabledWhen: () => false,
    });
    registerCheck(gated);

    const result = await checkToolAvailability(makeConfig(), {
      only: ["test.gated-tool-check"],
    });
    // enabledWhen=false → filtered out before probing → tool never inspected.
    expect(result.missing).not.toContain(
      "__print_md_nonexistent_tool_gated__"
    );
    expect(result.skippedChecks).not.toContain("test.gated-tool-check");
  });

  test("the same check, enabled, IS probed", async () => {
    const active: Check = fakeCheck({
      id: "test.active-tool-check",
      category: "source",
      phase: "pre-build",
      requiredTools: ["__print_md_nonexistent_tool_active__"],
    });
    registerCheck(active);

    const result = await checkToolAvailability(makeConfig(), {
      only: ["test.active-tool-check"],
    });
    expect(result.missing).toContain("__print_md_nonexistent_tool_active__");
    expect(result.skippedChecks).toContain("test.active-tool-check");
  });
});

// ---------------------------------------------------------------------------
// Result-builder helpers
// ---------------------------------------------------------------------------

describe("result-builder helpers inject checkId", () => {
  test("finding() injects checkId, preserves the configured severity", () => {
    const r = finding("x.y", { severity: "error", message: "bad" });
    expect(r).toEqual({ checkId: "x.y", severity: "error", message: "bad" });
  });

  test("inspectionFailed() is always a warning tagged inspect-failed", () => {
    const r = inspectionFailed("x.y", "could not parse", { file: "/a.pdf" });
    expect(r.checkId).toBe("x.y");
    expect(r.severity).toBe("warning");
    expect(r.code).toBe(INSPECT_FAILED_CODE);
    expect(r.file).toBe("/a.pdf");
  });
});

// ---------------------------------------------------------------------------
// Failure policy applied to real checks
// ---------------------------------------------------------------------------

describe("parse/tool-failure policy — inspection failure is a warning", () => {
  test("page-size: unparseable PDF => warning inspect-failed (was error)", async () => {
    const check = getCheckById("pdf.print.page-size")!;
    const results = await check.run(
      makeCtx({ pdfPath: "/tmp/does-not-exist-xyz.pdf" })
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.severity).toBe("warning");
    expect(results[0]!.code).toBe(INSPECT_FAILED_CODE);
  });

  test("pdfx-markers: qpdf failure => warning inspect-failed (was error)", async () => {
    const check = getCheckById("pdf.print.pdfx-markers")!;
    // Whether qpdf is absent (throw) or present-but-erroring on a bad path
    // (non-zero exit / unparseable JSON), the outcome must be one inspect
    // warning — never a hard error that conflates tool-absent with
    // non-conformant.
    const results = await check.run(
      makeCtx({ pdfPath: "/tmp/does-not-exist-xyz.pdf" })
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.severity).toBe("warning");
    expect(results[0]!.code).toBe(INSPECT_FAILED_CODE);
  });

  test("pdfx-metadata: qpdf failure => warning inspect-failed (was error)", async () => {
    const check = getCheckById("pdf.print.pdfx-metadata")!;
    const results = await check.run(
      makeCtx({ pdfPath: "/tmp/does-not-exist-xyz.pdf" })
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.severity).toBe("warning");
    expect(results[0]!.code).toBe(INSPECT_FAILED_CODE);
  });

  test("local-refs: an unreadable source file => warning inspect-failed (was invisible)", async () => {
    const check = getCheckById("source.links.local-refs")!;
    const results = await check.run(
      makeCtx({ markdownFiles: ["/tmp/does-not-exist-xyz.md"] })
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.severity).toBe("warning");
    expect(results[0]!.code).toBe(INSPECT_FAILED_CODE);
  });

  test("genuine local-ref violations still keep their configured error severity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "print-md-policy-refs-"));
    try {
      const mainFile = join(dir, "main.md");
      await writeFile(mainFile, "[missing](./missing.md)\n");
      const check = getCheckById("source.links.local-refs")!;
      const results = await check.run(makeCtx({ markdownFiles: [mainFile] }));
      expect(results).toHaveLength(1);
      expect(results[0]!.severity).toBe("error");
      expect(results[0]!.code).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
