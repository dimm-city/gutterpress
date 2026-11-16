/**
 * Publish-target registry behavior (ADR 0008, ADR 0012): registry lookup, the
 * file each target receives, the old names, target-list
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
  bookTargets,
  canonicalTargetId,
  isOldPublishForm,
  hasOwnRules,
  targetFormat,
  overlayPreset,
  publishTargetFor,
  resolveTargets,
  ruleTargets,
} from "./targets";
import { getCheckById } from "../checks/registry";
import "../checks/register-builtins";

describe("target registry", () => {
  test("registers every place a book can go, in the order pickers offer them", () => {
    expect(TARGET_IDS).toEqual([
      "local",
      "itch",
      "drivethrurpg-print",
      "drivethrurpg-digital",
      "kdp",
      "azure-swa",
      "shopify",
      "gdrive",
    ]);
    expect(TARGET_IDS).toEqual(Object.keys(TARGETS));
    for (const id of TARGET_IDS) expect(TARGETS[id]!.id).toBe(id);
  });

  test("publishTargetFor throws a usage error naming the registry for unknown ids", () => {
    expect(() => publishTargetFor("lulu")).toThrow(
      `Unknown publish target "lulu". Known targets: ${TARGET_IDS.join(", ")}.`
    );
  });

  test("the names older books use still resolve, to DriveThruRPG print", () => {
    // `dtrpg` was the check-against id, `drivethrurpg` the send-to id: one place, two names.
    expect(canonicalTargetId("dtrpg")).toBe("drivethrurpg-print");
    expect(canonicalTargetId("drivethrurpg")).toBe("drivethrurpg-print");
    expect(canonicalTargetId("itch")).toBe("itch");
    expect(publishTargetFor("dtrpg")).toBe(TARGETS["drivethrurpg-print"]!);
  });

  test("a target that defines its file says which; the rest offer a pick, PDF first", () => {
    const file = (id: string) => {
      const t = publishTargetFor(id);
      return t.formats ? { pick: [...t.formats], first: t.format } : { fixed: t.format };
    };
    expect(file("drivethrurpg-print")).toEqual({ fixed: "pdfx" });
    expect(file("drivethrurpg-digital")).toEqual({ pick: ["pdf", "pdf-screen"], first: "pdf" });
    expect(file("itch")).toEqual({ pick: ["pdf", "pdf-screen"], first: "pdf" });
    expect(file("azure-swa")).toEqual({ fixed: "html" });
    // KDP is print: no PDF for screens.
    expect(file("kdp")).toEqual({ pick: ["pdf", "pdfx"], first: "pdf" });
    expect(file("shopify")).toEqual({ pick: ["pdf", "pdf-screen", "pdfx"], first: "pdf" });
    expect(file("local")).toEqual({ pick: ["pdf", "pdf-screen", "pdfx", "html"], first: "pdf" });
    expect(file("gdrive")).toEqual({ pick: ["pdf", "pdf-screen", "pdfx", "html"], first: "pdf" });
  });

  test("targetFormat honours a saved pick the target offers, and nothing else", () => {
    expect(targetFormat(publishTargetFor("gdrive"), "pdfx")).toBe("pdfx");
    expect(targetFormat(publishTargetFor("gdrive"), undefined)).toBe("pdf");
    expect(targetFormat(publishTargetFor("gdrive"), "docx")).toBe("pdf");
    expect(targetFormat(publishTargetFor("kdp"), "html")).toBe("pdf"); // not on offer
    // A target that defines its file is not open to a pick.
    expect(targetFormat(publishTargetFor("drivethrurpg-print"), "pdf")).toBe("pdfx");
  });

  test("DriveThruRPG digital is held to the digital rules itch.io is", () => {
    const digital = publishTargetFor("drivethrurpg-digital");
    const itch = publishTargetFor("itch");
    expect(digital.overlay).toEqual(itch.overlay);
    expect(digital.requiredChecks).toEqual(itch.requiredChecks);
    expect(digital.requiredTools).toEqual([]);
  });

  test("a target with no rules of its own adds none: its file is checked against the book's", () => {
    for (const id of ["local", "gdrive", "kdp", "shopify", "azure-swa"]) {
      const t = publishTargetFor(id);
      expect(hasOwnRules(t)).toBe(false);
      expect(t.overlay).toEqual({});
      expect(t.requiredChecks).toEqual([]);
    }
    expect(hasOwnRules(publishTargetFor("drivethrurpg-print"))).toBe(true);
    expect(hasOwnRules(publishTargetFor("itch"))).toBe(true);
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
    expect(resolveTargets(undefined, ["drivethrurpg-print"])).toEqual(["drivethrurpg-print"]);
  });

  test("an explicit empty list opts out of the fallback", () => {
    expect(resolveTargets([], ["drivethrurpg-print"])).toEqual([]);
  });

  test("dedupes while preserving first-seen order", () => {
    expect(resolveTargets(["itch", "drivethrurpg-print", "itch"], [])).toEqual(["itch", "drivethrurpg-print"]);
  });

  test("an old name and its new one are the same target, listed once under the new name", () => {
    expect(resolveTargets(["dtrpg", "itch", "drivethrurpg-print", "drivethrurpg"], [])).toEqual([
      "drivethrurpg-print",
      "itch",
    ]);
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

describe("bookTargets: the targets a manifest names (ADR 0012)", () => {
  const PRESET = ["drivethrurpg-print"];

  test("`publish:` is the list: a target is on because it is there", () => {
    const manifest = {
      publish: {
        "drivethrurpg-print": null,
        "drivethrurpg-digital": null,
        itch: { target: "toddward/field-guide" },
        gdrive: { format: "pdfx", folder: "Gutterpress" },
      },
    };
    expect(bookTargets(manifest, PRESET)).toEqual(["drivethrurpg-print", "drivethrurpg-digital", "itch", "gdrive"]);
    expect(isOldPublishForm(manifest)).toBe(false);
  });

  test("no `publish:` key means the preset's targets; an empty one means none", () => {
    expect(bookTargets({}, PRESET)).toEqual(["drivethrurpg-print"]);
    expect(bookTargets({ publish: {} }, PRESET)).toEqual([]);
    expect(bookTargets({ publish: null }, PRESET)).toEqual([]);
  });

  test("an old name in `publish:` is the same target under its new name", () => {
    expect(bookTargets({ publish: { drivethrurpg: { productUrl: "https://x" } } }, [])).toEqual(["drivethrurpg-print"]);
  });

  test("a name the registry does not know is an extension's target, kept as written", () => {
    expect(bookTargets({ publish: { "@studio/gp-lulu": { shop: "x" }, itch: null } }, [])).toEqual([
      "@studio/gp-lulu",
      "itch",
    ]);
  });

  test("an older book reads with its old meaning: the `targets:` list plus the sections marked enabled", () => {
    const fieldGuide = {
      targets: ["dtrpg", "itch"],
      publish: { gdrive: { folderId: "1fq1", folder: "Gutterpress", enabled: true } },
    };
    expect(isOldPublishForm(fieldGuide)).toBe(true);
    expect(bookTargets(fieldGuide, PRESET)).toEqual(["drivethrurpg-print", "itch", "gdrive"]);
  });

  test("in an older book a section that was set up but not ticked is not a target", () => {
    const manifest = {
      targets: ["itch"],
      publish: { itch: { target: "me/book" }, shopify: { shop: "x.myshopify.com" }, gdrive: { enabled: true } },
    };
    expect(bookTargets(manifest, [])).toEqual(["itch", "gdrive"]);
  });

  test("an older book with ticks but no `targets:` key still checks against its preset's targets", () => {
    const manifest = { publish: { gdrive: { enabled: true }, itch: { enabled: false } } };
    expect(isOldPublishForm(manifest)).toBe(true);
    expect(bookTargets(manifest, PRESET)).toEqual(["drivethrurpg-print", "gdrive"]);
  });

  test("an older book's explicit `targets: []` opts out of the preset's, and its ticks still count", () => {
    expect(bookTargets({ targets: [], publish: { gdrive: { enabled: true } } }, PRESET)).toEqual(["gdrive"]);
  });

  test("an unknown name in an older book's `targets:` list is still a usage error", () => {
    expect(() => bookTargets({ targets: ["lulu"] }, [])).toThrow('Unknown publish target "lulu"');
  });
});

describe("ruleTargets: which of a book's targets hold a file to rules of their own", () => {
  test("targets with rules stay, in order; the rest add none", () => {
    expect(ruleTargets(["gdrive", "drivethrurpg-print", "local", "itch"])).toEqual(["drivethrurpg-print", "itch"]);
    expect(ruleTargets(["gdrive", "local"])).toEqual([]);
  });

  test("an extension's target has no rules in this registry", () => {
    expect(ruleTargets(["@studio/gp-lulu", "itch"])).toEqual(["itch"]);
  });
});
