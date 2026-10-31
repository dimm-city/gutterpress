import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { readOldSpellings, rewriteOldThresholds, type OldSpellings } from "./manifest-old-spellings";
import { loadManifestWithPath, resolveConfig } from "./manifest";
import { UsageError } from "./cli-args";
import { resetWarnOnce } from "./presets";
import type { GutterpressManifest } from "../schema/manifest.types";

// #443 — the manifest spellings 0.11.23 replaced are read for one release:
// translated to `chapters` / `checks` (a threshold to its check's option,
// #483), or dropped, and named in one notice.

let warn: ReturnType<typeof spyOn>;
beforeEach(() => {
  resetWarnOnce();
  warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  resetWarnOnce();
});

const read = (m: GutterpressManifest & OldSpellings) => readOldSpellings(m);
const notices = () => warn.mock.calls.map((c: unknown[]) => String(c[0]));

describe("readOldSpellings", () => {
  test("a manifest with no old keys comes back as the same object, with no notice", () => {
    const m: GutterpressManifest = { title: "T", chapters: ["a.md"], checks: { "pdf.print.bleed": "on" } };
    expect(read(m)).toBe(m);
    expect(warn).not.toHaveBeenCalled();
  });

  test("source.files becomes chapters; chapters wins when both are written", () => {
    expect(read({ source: { files: ["a.md", "b.md"] } })).toEqual({ chapters: ["a.md", "b.md"] });
    expect(read({ source: { files: null } })).toEqual({ chapters: null });
    expect(read({ chapters: ["new.md"], source: { files: ["old.md"] } })).toEqual({ chapters: ["new.md"] });
  });

  test("source.assets is refused with what to do instead", () => {
    expect(() => read({ source: { assets: ["css", "images"] } })).toThrow(UsageError);
    expect(() => read({ source: { assets: ["css"] } })).toThrow(/`source\.assets` is no longer supported/);
  });

  test("validate.checks entries become levels", () => {
    const out = read({
      validate: {
        checks: {
          a: false,
          b: { enabled: false, severity: "error" },
          c: { severity: "info" },
          d: true,
          e: { enabled: true },
          f: { enabled: true, severity: "warning" },
        },
      },
    });
    expect(out.checks).toEqual({ a: "off", b: "off", c: "info", d: "on", e: "on", f: "warning" });
  });

  test("lint.rules entries are copied into checks as they are", () => {
    const out = read({ lint: { enabled: true, rules: { "printsafe/no-remote-urls": "warn", "md/x": "off" } } });
    expect(out.checks).toEqual({ "printsafe/no-remote-urls": "warn", "md/x": "off" });
  });

  test("validate.source.<tool>: false switches that check off; a path is dropped", () => {
    const out = read({
      validate: {
        source: {
          markdownlint: false,
          htmlhint: false,
          stylelint: false,
          cssOwnership: false,
        },
      },
    });
    expect(out.checks).toEqual({
      "source.markdownlint": "off",
      "source.htmlhint": "off",
      "source.stylelint": "off",
      "source.css-ownership": "off",
    });
    expect(read({ validate: { source: { markdownlint: "../.markdownlint.jsonc" } } })).toEqual({});
  });

  test("a severity set beside an on/off flag keeps its severity (#483)", () => {
    // 0.11.22 ran a flag-gated check at the severity validate.checks gave it.
    const out = read({
      validate: {
        checks: { "pdf.nav.bookmarks": { enabled: true, severity: "error" }, "pdf.print.bleed": { severity: "error" } },
        pdf: { requireBookmarks: true, requireBleed: true },
      },
    });
    expect(out.checks).toEqual({ "pdf.nav.bookmarks": "error", "pdf.print.bleed": "error" });
    expect(notices().join("\n")).toContain("validate.pdf.requireBookmarks: true -> checks: { pdf.nav.bookmarks: error }");
    expect(resolveConfig({}, out).checks["pdf.nav.bookmarks"]).toBe("error");
    // A lint.rules level is kept the same way; a flag set off still wins, as
    // the check then found nothing whatever its level.
    expect(read({ lint: { rules: { "pdf.nav.toc-links": "warn" } }, validate: { pdf: { requireTocLinks: true } } }).checks)
      .toEqual({ "pdf.nav.toc-links": "warn" });
    expect(read({ validate: { checks: { "pdf.nav.bookmarks": { severity: "error" } }, pdf: { requireBookmarks: false } } }).checks)
      .toEqual({ "pdf.nav.bookmarks": "off" });
  });

  test("the six on/off flags become the levels of the checks they switched", () => {
    const out = read({
      validate: {
        assets: { allowAlpha: true, requireFontLicense: true },
        pdf: { requireBookmarks: false, requireTocLinks: true, requireBleed: false, forbidTransparency: false },
      },
    });
    expect(out.checks).toEqual({
      "asset.image.alpha-channel": "off",
      "asset.font.license": "on",
      "pdf.nav.bookmarks": "off",
      "pdf.nav.toc-links": "on",
      "pdf.print.bleed": "off",
      "pdf.print.transparency": "off",
    });
    expect(read({ validate: { assets: { allowAlpha: false } } }).checks).toEqual({
      "asset.image.alpha-channel": "on",
    });
  });

  test("lint.enabled: false switches the CSS check off; lint.enabled: true is dropped", () => {
    expect(read({ lint: { enabled: false } }).checks).toEqual({ "source.stylelint": "off" });
    expect(read({ lint: { enabled: true } })).toEqual({});
    expect(notices().join("\n")).toContain("lint.enabled: false -> checks: { source.stylelint: off }");
    // A rule level written alongside keeps its own entry.
    expect(read({ lint: { enabled: false, rules: { "printsafe/no-remote-urls": "error" } } }).checks).toEqual({
      "printsafe/no-remote-urls": "error",
      "source.stylelint": "off",
    });
  });

  test("every threshold becomes an option of its check, and the notice names the new spelling (#483)", () => {
    const out = read({
      title: "T",
      ink: { maxTac: 300, tacTolerance: 2 },
      validate: {
        assets: { maxImageSize: 1, approvedFontFiles: ["fonts/*.otf"] },
        pdf: { minImageResolution: 72, bleedSize: 12 },
        heuristics: { maxDecorativeLayers: 2, textDensityRange: { min: 10, max: 20 }, maxParagraphsPerSection: 3 },
      },
    });
    expect(out).toEqual({
      title: "T",
      checks: {
        "pdf.print.ink-coverage": { maxTac: 300, tacTolerance: 2 },
        "asset.image.file-size": { maxImageSize: 1 },
        "asset.font.approved-files": { approvedFontFiles: ["fonts/*.otf"] },
        "pdf.print.image-resolution": { minImageResolution: 72 },
        "pdf.print.bleed": { bleedSize: 12 },
        "heuristic.decoration.layer-count": { maxDecorativeLayers: 2 },
        "heuristic.whitespace.text-density": { textDensityRange: { min: 10, max: 20 } },
        "heuristic.chunking.section-density": { maxParagraphsPerSection: 3 },
      },
    });
    const notice = notices().join("\n");
    expect(notice).toContain("ink.maxTac -> checks: { pdf.print.ink-coverage: { maxTac: 300 } }");
    expect(notice).toContain(
      'validate.assets.approvedFontFiles -> checks: { asset.font.approved-files: { approvedFontFiles: ["fonts/*.otf"] } }',
    );
    expect(notice).not.toContain("the preset");
    // They reach the numbers the checks (and the PDF/X conversion) read.
    const config = resolveConfig({}, { ...out, preset: "book" });
    expect(config.ink).toEqual({ maxTac: 300, tacTolerance: 2 });
    expect(config.validate).toEqual({
      assets: { maxImageSize: 1, approvedFontFiles: ["fonts/*.otf"] },
      pdf: { minImageResolution: 72, bleedSize: 12 },
      heuristics: { maxDecorativeLayers: 2, textDensityRange: { min: 10, max: 20 }, maxParagraphsPerSection: 3 },
    });
  });

  test("a threshold and a level for the same check make one entry; a requireBleed flag is kept with its bleedSize", () => {
    expect(read({ validate: { pdf: { requireBleed: true, bleedSize: 12 } } }).checks).toEqual({
      "pdf.print.bleed": { level: "on", bleedSize: 12 },
    });
    expect(read({ validate: { checks: { "pdf.print.ink-coverage": { severity: "error" } } }, ink: { maxTac: 300 } }).checks).toEqual({
      "pdf.print.ink-coverage": { level: "error", maxTac: 300 },
    });
  });

  test("an old value nothing could use is named and ignored, never an error: a 0.11.22 book still builds (#488)", () => {
    const old = (): GutterpressManifest & OldSpellings => ({
      preset: "book",
      validate: {
        heuristics: { maxDecorativeLayers: "many", mysteryLimit: 3, textDensityRange: { min: 10, most: 99 } },
        checks: { "pdf.nav.bookmarks": { severity: "critical" } },
      },
      lint: { rules: { "printsafe/no-remote-urls": "loud" as never } },
      ink: { maxTac: -5 },
    });
    const out = read(old());
    // Only what 0.11.22 could use is carried over: the range's min, and the
    // bookmarks check, on at its own severity.
    expect(out.checks).toEqual({
      "pdf.nav.bookmarks": "on",
      "heuristic.whitespace.text-density": { textDensityRange: { min: 10 } },
    });
    const config = resolveConfig({}, out);
    expect(config.validate.heuristics).toEqual({
      maxDecorativeLayers: 5,
      textDensityRange: { min: 10, max: 5000 },
      maxParagraphsPerSection: 10,
    });
    expect(config.ink.maxTac).toBe(400);
    expect(config.checks["printsafe/no-remote-urls"]).toBeUndefined();
    const notice = notices().join("\n");
    for (const line of [
      'validate.heuristics.maxDecorativeLayers: "many" is not a number, 0 or more — ignored',
      "validate.heuristics.mysteryLimit — no longer a setting, ignored",
      'validate.heuristics.textDensityRange: {"min":10,"most":99} is not `{ min, max }` (numbers, 0 or more) — kept min, ignored the rest',
      'validate.checks.pdf.nav.bookmarks.severity: "critical" is not off, on, info, warn or error — ignored',
      'lint.rules.printsafe/no-remote-urls: "loud" is not off, on, info, warn or error — ignored',
      "ink.maxTac: -5 is not a number, 0 or more — ignored",
    ]) {
      expect(notice).toContain(line);
    }
    // The same values in the new spelling, written directly, are still refused.
    expect(() =>
      resolveConfig({}, { checks: { "heuristic.decoration.layer-count": { maxDecorativeLayers: "many" as never } } }),
    ).toThrow("`checks.heuristic.decoration.layer-count.maxDecorativeLayers` must be a number, 0 or more");
    expect(() => resolveConfig({}, { checks: { "heuristic.decoration.layer-count": { mysteryLimit: 3 } as never } })).toThrow(
      "has no option `mysteryLimit`",
    );
  });

  test("ink keys that are no thresholds, validate.enabled and lint.configPath are dropped", () => {
    const out = read({
      title: "T",
      ink: { mystery: 1 },
      lint: { enabled: true, configPath: ".stylelintrc" },
      validate: { enabled: false, assets: { minImageDpi: 200 } },
    });
    expect(out).toEqual({ title: "T" });
    const notice = notices().join("\n");
    expect(notice).toContain("ink.mystery — no longer a setting, ignored");
    expect(notice).toContain("validate.assets.minImageDpi — no longer a setting, ignored");
  });

  test("page.tolerance becomes the page-size check's option and the rest of page stays (#483)", () => {
    const out = read({ title: "T", page: { width: 612, height: 792, tolerance: 2 } as GutterpressManifest["page"] });
    expect(out).toEqual({
      title: "T",
      page: { width: 612, height: 792 },
      checks: { "pdf.print.page-size": { tolerance: 2 } },
    });
    expect(notices().join("\n")).toContain("page.tolerance -> checks: { pdf.print.page-size: { tolerance: 2 } }");
    expect(resolveConfig({}, { ...out, preset: "custom" }).page.tolerance).toBe(2);
  });

  test("the manifest's own checks win over translated old entries, field by field", () => {
    const out = read({
      checks: { "pdf.print.bleed": "error" },
      validate: { pdf: { requireBleed: false }, checks: { "pdf.structure.qpdf": false } },
    });
    expect(out.checks).toEqual({ "pdf.print.bleed": "error", "pdf.structure.qpdf": "off" });
    // An old threshold joins the new entry's level; the new entry's option wins.
    expect(read({ checks: { "pdf.print.ink-coverage": "warn" }, ink: { maxTac: 300 } }).checks).toEqual({
      "pdf.print.ink-coverage": { level: "warn", maxTac: 300 },
    });
    expect(read({ checks: { "pdf.print.ink-coverage": { maxTac: 260 } }, ink: { maxTac: 300, tacTolerance: 2 } }).checks).toEqual({
      "pdf.print.ink-coverage": { maxTac: 260, tacTolerance: 2 },
    });
  });

  test("one notice names every old key; reading the same manifest again adds none", () => {
    const m = (): GutterpressManifest & OldSpellings => ({
      source: { files: ["a.md"] },
      validate: {
        enabled: true,
        checks: { "pdf.structure.qpdf": false },
        source: {
          markdownlint: "../.markdownlint.jsonc",
          stylelint: ".stylelintrc",
          allowedCallouts: ["note"],
        },
        pdf: { forbidTransparency: true },
      },
      lint: { rules: { "printsafe/no-remote-urls": "off" } },
      ink: { maxTac: 300 },
    });
    read(m());
    read(m());
    expect(notices()).toHaveLength(1);
    const notice = notices()[0]!;
    expect(notice).toStartWith("[gutterpress] manifest.yaml uses spellings 0.11.23 replaced.");
    for (const line of [
      "source.files -> chapters",
      "validate.checks -> checks",
      "lint.rules -> checks",
      "validate.pdf.forbidTransparency: true -> checks: { pdf.print.transparency: on }",
      "validate.source.markdownlint (the config file is found by its usual name",
      "validate.source.allowedCallouts — no longer a setting, ignored",
      // stylelint never read a config file, so there is none to look for.
      "validate.source.stylelint — no longer a setting, ignored",
      "validate.enabled (`gutterpress build --skip-pre-validate --skip-post-validate` skips validation for one build)",
      "ink.maxTac -> checks: { pdf.print.ink-coverage: { maxTac: 300 } }",
    ]) {
      expect(notice).toContain(line);
    }
  });
});

describe("loadManifestWithPath reads a 0.11.22 manifest", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  test("the old spellings resolve to the same chapters and check levels as the new ones", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gutterpress-old-spellings-"));
    dirs.push(dir);
    await writeFile(
      join(dir, "manifest.yaml"),
      [
        "title: Old Book",
        "preset: book",
        "source:",
        "  files:",
        "    - 01-intro.md",
        "    - 02-body.md",
        "validate:",
        "  source:",
        "    markdownlint: ../.markdownlint.jsonc",
        "    htmlhint: false",
        "  checks:",
        "    pdf.structure.qpdf:",
        "      severity: warning",
        "  pdf:",
        "    requireBookmarks: true",
        "    minImageResolution: 1",
        "lint:",
        "  rules:",
        "    printsafe/no-risky-print-effects: off",
        "",
      ].join("\n"),
    );
    const { manifest } = await loadManifestWithPath(dir);
    expect(manifest).toEqual({
      title: "Old Book",
      preset: "book",
      chapters: ["01-intro.md", "02-body.md"],
      checks: {
        "source.htmlhint": "off",
        "pdf.structure.qpdf": "warning",
        "pdf.nav.bookmarks": "on",
        "printsafe/no-risky-print-effects": "off",
        "pdf.print.image-resolution": { minImageResolution: 1 },
      },
    });
    const config = resolveConfig({}, manifest);
    expect(config.chapters).toEqual(["01-intro.md", "02-body.md"]);
    expect(config.checks["pdf.structure.qpdf"]).toBe("warning");
    expect(config.checks["pdf.nav.bookmarks"]).toBe("on");
    expect(config.checks["source.htmlhint"]).toBe("off");
    // The book's threshold, as in 0.11.22.
    expect(config.validate.pdf.minImageResolution).toBe(1);
    expect(notices()).toHaveLength(1);
  });
});

describe("rewriteOldThresholds (Book setup's save, #483)", () => {
  const rewrite = (yaml: string) => {
    const doc = parseDocument(yaml);
    rewriteOldThresholds(doc);
    return doc.toString();
  };

  test("moves each threshold to its check's option, keeps every other key and comment, and drops emptied blocks", () => {
    const out = rewrite(
      [
        "# my book",
        "title: T",
        "page:",
        "  width: 612",
        "  tolerance: 2",
        "ink:",
        "  maxTac: 300",
        "validate:",
        "  pdf:",
        "    requireBookmarks: true # keep me",
        "    minImageResolution: 150",
        "  heuristics:",
        "    textDensityRange: { min: 10, max: 20 }",
        "checks:",
        "  pdf.print.ink-coverage: warn",
        "",
      ].join("\n"),
    );
    expect(out).toBe(
      [
        "# my book",
        "title: T",
        "page:",
        "  width: 612",
        "validate:",
        "  pdf:",
        "    requireBookmarks: true # keep me",
        "checks:",
        "  pdf.print.ink-coverage:",
        "    level: warn",
        "    maxTac: 300",
        "  pdf.print.page-size:",
        "    tolerance: 2",
        "  pdf.print.image-resolution:",
        "    minImageResolution: 150",
        "  heuristic.whitespace.text-density:",
        "    textDensityRange: { min: 10, max: 20 }",
        "",
      ].join("\n"),
    );
    // What the rewritten manifest resolves to is what the old one did.
    expect(resolveConfig({}, parseDocument(out).toJS()).validate.pdf.minImageResolution).toBe(150);
  });

  test("a value its option cannot take stays where it is, so the save never makes the book fail to load (#488)", () => {
    const yaml = "validate:\n  heuristics:\n    maxDecorativeLayers: many\n    maxParagraphsPerSection: 3\n";
    const out = rewrite(yaml);
    expect(out).toBe(
      "validate:\n  heuristics:\n    maxDecorativeLayers: many\nchecks:\n  heuristic.chunking.section-density:\n    maxParagraphsPerSection: 3\n",
    );
    expect(() => resolveConfig({}, readOldSpellings(parseDocument(out).toJS()))).not.toThrow();
  });

  test("an option the new spelling already sets keeps its value; a manifest without old keys is untouched", () => {
    expect(rewrite("ink:\n  maxTac: 300\nchecks:\n  pdf.print.ink-coverage: { maxTac: 260 }\n")).toBe(
      "checks:\n  pdf.print.ink-coverage: { maxTac: 260 }\n",
    );
    const plain = "title: T\npage:\n  width: 612\n";
    expect(rewrite(plain)).toBe(plain);
  });
});
