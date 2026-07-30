/**
 * Publish-target registry behavior (ADR 0008): registry lookup, target-list
 * resolution, the preset+overlay merge that puts a target's policy BELOW the
 * manifest in the precedence chain (cli > manifest > target > preset), and
 * the strict-PDF fill-ins (ported from the deleted validation-profile.test.ts
 * — `applyDefaultPdfStrictChecks` moved here verbatim).
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

  test("every registered target's requiredChecks are enabled as errors by its own overlay", () => {
    // A target that requires a check to RUN but doesn't enable it in its own
    // overlay could still false-green when the preset disables that check.
    for (const target of Object.values(TARGETS)) {
      for (const id of target.requiredChecks) {
        expect(target.overlay.validate?.checks?.[id]).toEqual({
          enabled: true,
          severity: "error",
        });
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
    expect(overlaid.validate.checks["pdf.print.pdfx-markers"]).toEqual({
      enabled: true,
      severity: "error",
    });
    expect(overlaid.validate.assets.allowedColorSpaces).toEqual(
      DTRPG_PRESET.validate.assets.allowedColorSpaces
    );
    expect(overlaid.validate.pdf.forbidTransparency).toBe(true);
    // …but HOW the book is designed stays the preset's: same trim.
    expect(overlaid.page).toEqual(BOOK_PRESET.page);
  });

  test("itch overlay onto the dtrpg preset relaxes the print-only constraints", () => {
    const overlaid = overlayPreset(DTRPG_PRESET, publishTargetFor("itch"));

    expect(overlaid.validate.checks["pdf.print.pdfx-markers"]).toBe(false);
    expect(overlaid.validate.checks["pdf.print.pdfx-metadata"]).toBe(false);
    expect(overlaid.validate.checks["pdf.print.ink-coverage"]).toBe(false);
    expect(overlaid.validate.assets.allowedColorSpaces).toEqual([
      "RGB",
      "CMYK",
      "Grayscale",
    ]);
    expect(overlaid.validate.assets.allowAlpha).toBe(true);
    expect(overlaid.validate.pdf.forbidTransparency).toBe(false);
    // Digital release still demands a structurally sound PDF with fonts.
    expect(overlaid.validate.checks["pdf.structure.qpdf"]).toEqual({
      enabled: true,
      severity: "error",
    });
    expect(overlaid.validate.checks["pdf.print.embedded-fonts"]).toEqual({
      enabled: true,
      severity: "error",
    });
  });

  test("does not mutate the preset it overlays", () => {
    const before = structuredClone(BOOK_PRESET);
    overlayPreset(BOOK_PRESET, publishTargetFor("dtrpg"));
    expect(BOOK_PRESET).toEqual(before);
  });
});

describe("resolveConfigForTarget precedence (cli > manifest > target > preset)", () => {
  test("the author's explicit manifest value beats the target's overlay", () => {
    const config = resolveConfigForTarget(
      {},
      { preset: "book", ink: { maxTac: 300 } },
      "dtrpg"
    );

    // Manifest wins over the target's 240…
    expect(config.ink.maxTac).toBe(300);
    // …while everything the manifest left unset comes from the target.
    expect(config.validate.checks["pdf.print.pdfx-markers"]).toEqual({
      enabled: true,
      severity: "error",
    });
  });

  test("an explicit manifest check disable survives the target overlay", () => {
    const config = resolveConfigForTarget(
      {},
      {
        preset: "book",
        validate: { checks: { "pdf.print.pdfx-markers": false } },
      },
      "dtrpg"
    );

    // The author owns this choice — the target only supplies defaults.
    expect(config.validate.checks["pdf.print.pdfx-markers"]).toBe(false);
  });
});

// ── strict-PDF fill-ins (ported from validation-profile.test.ts) ─────────────

describe("applyDefaultPdfStrictChecks", () => {
  test("fills only undefined checks, without overwriting an explicit disable", () => {
    const base = resolveConfig(
      {},
      {
        validate: {
          checks: {
            "pdf.structure.qpdf": false,
          },
        },
      }
    );

    const next = applyDefaultPdfStrictChecks(base);

    // Explicitly disabled by the author — must survive.
    expect(next.validate.checks["pdf.structure.qpdf"]).toBe(false);
    // Left unset — filled in as an error.
    expect(next.validate.checks["pdf.print.pdfx-markers"]).toEqual({
      enabled: true,
      severity: "error",
    });
  });

  test("does not mutate the original config", () => {
    const base = resolveConfig({}, {});
    const next = applyDefaultPdfStrictChecks(base);

    expect(next).not.toBe(base);
    next.validate.checks["pdf.structure.qpdf"] = false;
    expect(base.validate.checks["pdf.structure.qpdf"]).not.toBe(false);
  });

  test("a config with a plugin entry survives structuredClone (options object deep-cloned too)", () => {
    const base = resolveConfig(
      {},
      { plugins: [{ name: "markdown-it-footnote", options: { includeSubsections: false } }] }
    );
    const next = applyDefaultPdfStrictChecks(base);

    expect(next.plugins[0]).not.toBe(base.plugins[0]);
    expect(next.plugins[0]!.options).not.toBe(base.plugins[0]!.options);
    expect(next.plugins[0]!.options).toEqual(base.plugins[0]!.options);
  });
});
