/**
 * Publish-target registry behavior (ADR 0008): registry lookup, target-list
 * resolution, the preset+overlay merge that puts a target's policy BELOW the
 * manifest in the precedence chain (cli > manifest > target > preset), and
 * the strict-PDF fill-ins (`applyDefaultPdfStrictChecks`).
 */
import { describe, expect, test } from "bun:test";
import { resolveConfig, resolveConfigForTarget } from "./manifest";
import { BOOK_PRESET, DTRPG_PRESET } from "./presets";
import {
  TARGETS,
  TARGET_IDS,
  applyDefaultPdfStrictChecks,
  overlayPreset,
  publishTargetFor,
  resolveTargets,
} from "./targets";
import { getCheckById } from "../checks/registry";
import "../checks/register-builtins";

describe("target registry", () => {
  test("registers exactly dtrpg and itch", () => {
    expect(Object.keys(TARGETS).sort()).toEqual(["dtrpg", "itch"]);
    expect(TARGET_IDS).toEqual(Object.keys(TARGETS));
  });

  test("publishTargetFor throws a usage error naming the registry for unknown ids", () => {
    expect(() => publishTargetFor("lulu")).toThrow(
      'Unknown publish target "lulu". Known targets: dtrpg, itch.'
    );
  });

  test("every target's requiredTools covers its required checks' external tools", () => {
    // A target that requires a check whose tool it doesn't declare would let
    // creation-time tool warnings under-report what validation later demands.
    for (const target of Object.values(TARGETS)) {
      for (const id of target.requiredChecks) {
        const check = getCheckById(id);
        expect(check).toBeDefined();
        for (const tool of check?.requiredTools ?? []) {
          expect(target.requiredTools).toContain(tool);
        }
      }
    }
  });

  test("itch needs no external tools — a digital release validates in-process", () => {
    expect(publishTargetFor("itch").requiredTools).toEqual([]);
  });

  test("every registered target's requiredChecks are enabled as errors by its own overlay", () => {
    // A target that requires a check to RUN but doesn't enable it in its own
    // overlay could still false-green when the preset disables that check.
    for (const target of Object.values(TARGETS)) {
      for (const id of target.requiredChecks) {
        expect(target.overlay.checks?.[id]).toBe("error");
      }
    }
  });
});

describe("resolveTargets", () => {
  test("falls back to the preset's defaults when nothing is requested", () => {
    expect(resolveTargets(undefined, ["dtrpg"])).toEqual(["dtrpg"]);
  });

  test("an explicit empty list opts out of the fallback", () => {
    expect(resolveTargets([], ["dtrpg"])).toEqual([]);
  });

  test("dedupes while preserving first-seen order", () => {
    expect(resolveTargets(["itch", "dtrpg", "itch"], [])).toEqual(["itch", "dtrpg"]);
  });

  test("validates every id, including duplicates of an unknown one", () => {
    expect(() => resolveTargets(["dtrpg", "lulu"], [])).toThrow(
      'Unknown publish target "lulu"'
    );
  });
});

describe("overlayPreset", () => {
  test("dtrpg overlay onto the book preset flips policy but never geometry", () => {
    const overlaid = overlayPreset(BOOK_PRESET, publishTargetFor("dtrpg"));

    // Policy comes from the destination…
    expect(overlaid.ink.maxTac).toBe(DTRPG_PRESET.ink.maxTac);
    expect(overlaid.checks["pdf.print.pdfx-markers"]).toBe("error");
    expect(overlaid.checks["pdf.print.safe-margins"]).toBe("error");
    // The book preset switches the transparency check off; DriveThruRPG's
    // PDF/X-1a forbids transparency, so its overlay switches it back on.
    expect(BOOK_PRESET.checks["pdf.print.transparency"]).toBe("off");
    expect(overlaid.checks["pdf.print.transparency"]).toBe("on");
    // …but HOW the book is designed stays the preset's: same trim.
    expect(overlaid.page).toEqual(BOOK_PRESET.page);
  });

  test("itch overlay onto the dtrpg preset relaxes the print-only constraints", () => {
    const overlaid = overlayPreset(DTRPG_PRESET, publishTargetFor("itch"));

    expect(overlaid.checks["pdf.print.pdfx-markers"]).toBe("off");
    expect(overlaid.checks["pdf.print.pdfx-metadata"]).toBe("off");
    expect(overlaid.checks["pdf.print.ink-coverage"]).toBe("off");
    expect(overlaid.checks["pdf.print.safe-margins"]).toBe("off");
    expect(overlaid.checks["asset.image.alpha-channel"]).toBe("off");
    expect(overlaid.checks["pdf.print.transparency"]).toBe("off");
    expect(overlaid.checks["pdf.print.bleed"]).toBe("off");
    // Print image limits do not apply to a screen PDF.
    expect(overlaid.validate.assets.maxImageSize).toBe(0);
    expect(overlaid.validate.pdf.minImageResolution).toBe(0);
    // Digital release still demands a structurally sound PDF with fonts.
    expect(overlaid.checks["pdf.structure.qpdf"]).toBe("error");
    expect(overlaid.checks["pdf.print.embedded-fonts"]).toBe("error");
  });

  test("does not mutate the preset it overlays", () => {
    const before = structuredClone(BOOK_PRESET);
    overlayPreset(BOOK_PRESET, publishTargetFor("dtrpg"));
    expect(BOOK_PRESET).toEqual(before);
  });
});

describe("resolveConfigForTarget precedence (cli > manifest > target > preset)", () => {
  test("the author's explicit check level beats the target's overlay", () => {
    const config = resolveConfigForTarget(
      {},
      { preset: "book", checks: { "pdf.print.safe-margins": "warn" } },
      "dtrpg"
    );

    // Manifest wins over the target's error…
    expect(config.checks["pdf.print.safe-margins"]).toBe("warning");
    // …while everything the manifest left unset comes from the target,
    // thresholds included (they are not a manifest setting at all).
    expect(config.checks["pdf.print.pdfx-markers"]).toBe("error");
    expect(config.ink.maxTac).toBe(DTRPG_PRESET.ink.maxTac);
  });

  test("an explicit manifest check disable survives the target overlay", () => {
    const config = resolveConfigForTarget(
      {},
      {
        preset: "book",
        checks: { "pdf.print.pdfx-markers": "off" },
      },
      "dtrpg"
    );

    // The author owns this choice — the target only supplies defaults.
    expect(config.checks["pdf.print.pdfx-markers"]).toBe("off");
  });
});

// ── strict-PDF fill-ins ──────────────────────────────────────────────────────

describe("applyDefaultPdfStrictChecks", () => {
  test("fills only undefined checks, without overwriting an explicit disable", () => {
    const base = resolveConfig(
      {},
      {
        checks: {
          "pdf.structure.qpdf": "off",
          "pdf.print.embedded-fonts": "on",
        },
      }
    );
    delete base.checks["pdf.print.pdfx-markers"];

    const next = applyDefaultPdfStrictChecks(base);

    // Explicitly disabled by the author — must survive.
    expect(next.checks["pdf.structure.qpdf"]).toBe("off");
    // Explicitly on (at the check's own severity) — left as written.
    expect(next.checks["pdf.print.embedded-fonts"]).toBe("on");
    // Left unset — filled in as an error.
    expect(next.checks["pdf.print.pdfx-markers"]).toBe("error");
  });

  test("does not mutate the original config", () => {
    const base = resolveConfig({}, {});
    const next = applyDefaultPdfStrictChecks(base);

    expect(next).not.toBe(base);
    next.checks["pdf.structure.qpdf"] = "off";
    expect(base.checks["pdf.structure.qpdf"]).not.toBe("off");
  });

  test("a config with an extension entry survives structuredClone (options object deep-cloned too)", () => {
    const base = resolveConfig(
      {},
      { extensions: [{ use: "markdown-it-footnote", options: { includeSubsections: false } }] }
    );
    const next = applyDefaultPdfStrictChecks(base);

    expect(next.extensions[0]).not.toBe(base.extensions[0]);
    expect(next.extensions[0]!.options).not.toBe(base.extensions[0]!.options);
    expect(next.extensions[0]!.options).toEqual(base.extensions[0]!.options);
  });
});
