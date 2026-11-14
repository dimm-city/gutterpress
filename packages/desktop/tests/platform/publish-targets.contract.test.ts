/**
 * `#lib/publish-targets` mirrors the lib's target registry (ADR 0008) because
 * the SPA may not value-import `gutterpress` (§8). A mirror can drift, so
 * this test reads the REAL registry and pins the two together: every id the
 * UI offers exists, none is missing, and each one's declared tool needs match
 * what the lib says that destination requires. (A test may import the lib;
 * the SPA may not.)
 */
import { describe, test, expect } from "bun:test";
import { TARGETS, hasOwnRules } from "../../../cli/src/lib/targets";
import {
  PUBLISH_TARGET_CHOICES,
  PRINT_TOOL_IDS,
  missingToolsForTargets,
  toolGapMessage,
} from "../../src/lib/publish-targets";

/**
 * `{ "drivethrurpg-print": ["qpdf","gs"], itch: [], … }`: the registry's
 * targets that hold a file to rules of their own — the ones a book is checked
 * against, which is what these choices offer.
 */
function libTargets(): Record<string, string[]> {
  return Object.fromEntries(
    Object.values(TARGETS)
      .filter(hasOwnRules)
      .map((target) => [target.id, [...target.requiredTools]]),
  );
}

describe("publish-targets mirrors the lib registry", () => {
  const lib = libTargets();

  test("the parse actually found the registry (guards a silently-empty pin)", () => {
    expect(Object.keys(lib).length).toBeGreaterThan(0);
    expect(lib["drivethrurpg-print"]).toBeDefined();
  });

  test("the UI offers exactly the registered target ids", () => {
    expect(PUBLISH_TARGET_CHOICES.map((c) => c.id).sort()).toEqual(
      Object.keys(lib).sort(),
    );
  });

  test("each choice declares the same required tools as the registry", () => {
    for (const choice of PUBLISH_TARGET_CHOICES) {
      expect([...choice.tools].sort()).toEqual([...(lib[choice.id] ?? [])].sort());
    }
  });

  test("PRINT_TOOL_IDS covers every tool any target needs", () => {
    const needed = new Set(Object.values(lib).flat());
    for (const tool of needed) expect(PRINT_TOOL_IDS).toContain(tool);
  });
});

describe("tool-gap messaging", () => {
  test("no message when a selected destination needs nothing missing", () => {
    expect(toolGapMessage(missingToolsForTargets(["itch"], ["qpdf", "gs"]))).toBeNull();
    expect(toolGapMessage(missingToolsForTargets(["drivethrurpg-print"], []))).toBeNull();
    expect(toolGapMessage(missingToolsForTargets([], ["qpdf", "gs"]))).toBeNull();
  });

  test("only the tools a SELECTED destination needs count", () => {
    expect(missingToolsForTargets(["drivethrurpg-print"], ["qpdf"])).toEqual(["qpdf"]);
    expect(missingToolsForTargets(["itch"], ["qpdf"])).toEqual([]);
  });

  test("the message names the tools and offers both ways out", () => {
    const msg = toolGapMessage(["qpdf", "gs"]);
    expect(msg).toContain("qpdf and Ghostscript");
    expect(msg).toContain("aren't installed");
    expect(msg).toContain("can't be built or verified");
    expect(msg).toContain("uncheck it for now");
  });

  test("a single missing tool reads in the singular", () => {
    const msg = toolGapMessage(["gs"]);
    expect(msg).toContain("Ghostscript isn't installed");
    expect(msg).toContain("until it is");
  });
});
