import { describe, expect, test } from "bun:test";
import { resolveConfig } from "./manifest";
import {
  applyDefaultPdfStrictChecks,
  applyValidationProfile,
} from "./validation-profile";

describe("validation profile behavior", () => {
  test("default strict pdf checks are injected only when absent", () => {
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

    expect(next.validate.checks["pdf.structure.qpdf"]).toBe(false);
    expect(next.validate.checks["pdf.print.pdfx-markers"]).toEqual({
      enabled: true,
      severity: "error",
    });
  });

  test("dtrpg profile lock forces strict checks and tac threshold", () => {
    const base = resolveConfig(
      {},
      {
        ink: { maxTac: 300 },
        pdfx: { flavor: "x3" },
        validate: {
          checks: {
            "pdf.structure.qpdf": false,
          },
        },
      }
    );

    const locked = applyValidationProfile(base, "dtrpg");

    expect(locked.ink.maxTac).toBe(240);
    expect(locked.pdfx.flavor).toBe("x1a");
    expect(locked.validate.checks["pdf.structure.qpdf"]).toEqual({
      enabled: true,
      severity: "error",
    });
  });
});

// ARCH finding #21: the dtrpg-branded name was misleading since
// executeValidation applies this to every PDF validation, not just dtrpg
// (the old applyDtrpgPdfDefaults alias was removed for 0.9.0).
describe("applyDefaultPdfStrictChecks (finding #21)", () => {
  test("applyDefaultPdfStrictChecks fills only undefined checks, without overwriting an explicit disable", () => {
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

    // Explicitly disabled by the author — must survive (overwrite=false).
    expect(next.validate.checks["pdf.structure.qpdf"]).toBe(false);
    // Left unset — filled in.
    expect(next.validate.checks["pdf.print.pdfx-markers"]).toEqual({
      enabled: true,
      severity: "error",
    });
  });

  test("applyValidationProfile('dtrpg') overwrites an explicit disable (overwrite=true, the profile-lock behavior)", () => {
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

    const locked = applyValidationProfile(base, "dtrpg");

    // Profile lock forces every strict check on, even one the author
    // explicitly disabled — this is what distinguishes overwrite=true from
    // applyDefaultPdfStrictChecks's overwrite=false.
    expect(locked.validate.checks["pdf.structure.qpdf"]).toEqual({
      enabled: true,
      severity: "error",
    });
  });
});

// ARCH finding #21: structuredClone(config) replaces the 40-line hand clone —
// verify it actually produces a deep, non-aliased copy.
describe("structuredClone deep-copy equivalence (finding #21)", () => {
  test("applyDefaultPdfStrictChecks does not mutate the original config", () => {
    const base = resolveConfig({}, {});
    const next = applyDefaultPdfStrictChecks(base);

    expect(next).not.toBe(base);
    next.validate.checks["pdf.structure.qpdf"] = false;
    expect(base.validate.checks["pdf.structure.qpdf"]).not.toBe(false);
  });

  test("applyValidationProfile deep-clones nested arrays/objects (no shared references with the original)", () => {
    // Explicit `styles:` so `base.styles` is a real array to clone — ARCH #2
    // removed the preset default, so a styles:-less resolveConfig() now
    // leaves `styles` undefined (nothing to clone-and-compare by reference).
    const base = resolveConfig({}, { styles: ["styles/book.css"] });
    const locked = applyValidationProfile(base, "dtrpg");

    // Every nested array/object the old hand-rolled cloneConfig enumerated
    // must be a genuinely separate reference, not aliased to `base`'s.
    expect(locked.authors).not.toBe(base.authors);
    expect(locked.styles).not.toBe(base.styles);
    expect(locked.styles).toEqual(base.styles);
    expect(locked.plugins).not.toBe(base.plugins);
    expect(locked.source).not.toBe(base.source);
    expect(locked.pdfx).not.toBe(base.pdfx);
    expect(locked.page).not.toBe(base.page);
    expect(locked.ink).not.toBe(base.ink);
    expect(locked.lint).not.toBe(base.lint);
    expect(locked.validate).not.toBe(base.validate);
    expect(locked.validate.checks).not.toBe(base.validate.checks);
    expect(locked.validate.source).not.toBe(base.validate.source);
    expect(locked.validate.assets).not.toBe(base.validate.assets);
    expect(locked.validate.assets.allowedColorSpaces).not.toBe(
      base.validate.assets.allowedColorSpaces
    );
    expect(locked.validate.assets.approvedFontFiles).not.toBe(
      base.validate.assets.approvedFontFiles
    );
    expect(locked.validate.pdf).not.toBe(base.validate.pdf);
    expect(locked.validate.heuristics).not.toBe(base.validate.heuristics);
    expect(locked.validate.heuristics.textDensityRange).not.toBe(
      base.validate.heuristics.textDensityRange
    );

    // Mutating the clone's nested array must never leak back to base.
    locked.validate.assets.allowedColorSpaces.push("SPOT");
    expect(base.validate.assets.allowedColorSpaces).not.toContain("SPOT");
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
