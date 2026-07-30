/**
 * `$lib/publish-targets` mirrors the lib's target registry (ADR 0008) because
 * the SPA may not value-import `gutterpress` (§8). A mirror can drift, so
 * this test reads the REAL registry source and pins the two together: every
 * id the UI offers exists, none is missing, and each one's declared tool
 * needs match what the lib says that destination requires.
 *
 * Source-text parsing (not an import) keeps this PWA-clean and dependency
 * free, in the same spirit as the other pin tests in this directory.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  PUBLISH_TARGET_CHOICES,
  PRINT_TOOL_IDS,
  missingToolsForTargets,
  toolGapMessage,
} from "../../src/lib/publish-targets";

const TARGETS_SRC = path.resolve(
  __dirname,
  "../../../cli/src/lib/targets.ts",
);

/** `{ dtrpg: ["qpdf","gs"], itch: [] }` parsed from the lib's registry. */
function libTargets(): Record<string, string[]> {
  const src = fs.readFileSync(TARGETS_SRC, "utf-8");
  const out: Record<string, string[]> = {};
  // Each target literal: id, then (further down) its requiredTools array.
  const blocks = src.split(/const \w+_TARGET: PublishTarget = \{/).slice(1);
  for (const block of blocks) {
    const id = /^\s*id: "([^"]+)"/m.exec(block)?.[1];
    const tools = /requiredTools: \[([^\]]*)\]/.exec(block)?.[1] ?? "";
    if (!id) continue;
    out[id] = [...tools.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  }
  return out;
}

describe("publish-targets mirrors the lib registry", () => {
  const lib = libTargets();

  test("the parse actually found the registry (guards a silently-empty pin)", () => {
    expect(Object.keys(lib).length).toBeGreaterThan(0);
    expect(lib.dtrpg).toBeDefined();
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
    expect(toolGapMessage(missingToolsForTargets(["dtrpg"], []))).toBeNull();
    expect(toolGapMessage(missingToolsForTargets([], ["qpdf", "gs"]))).toBeNull();
  });

  test("only the tools a SELECTED destination needs count", () => {
    expect(missingToolsForTargets(["dtrpg"], ["qpdf"])).toEqual(["qpdf"]);
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
