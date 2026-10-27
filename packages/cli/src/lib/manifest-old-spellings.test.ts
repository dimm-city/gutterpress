import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOldSpellings, type OldSpellings } from "./manifest-old-spellings";
import { loadManifestWithPath, resolveConfig } from "./manifest";
import { UsageError } from "./cli-args";
import { BOOK_PRESET, resetWarnOnce } from "./presets";
import type { GutterpressManifest } from "../schema/manifest.types";

// #443 — the manifest spellings 0.11.23 replaced are read for one release:
// translated to `chapters` / `checks`, or dropped, and named in one notice.

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

  test("thresholds, ink and the on/off switch for all validation are dropped", () => {
    const out = read({
      title: "T",
      ink: { maxTac: 300 },
      lint: { enabled: true, configPath: ".stylelintrc" },
      validate: {
        enabled: false,
        assets: { maxImageSize: 1 },
        pdf: { minImageResolution: 72, bleedSize: 9 },
        heuristics: { maxDecorativeLayers: 1 },
      },
    });
    expect(out).toEqual({ title: "T" });
  });

  test("the manifest's own checks win over translated old entries", () => {
    const out = read({
      checks: { "pdf.print.bleed": "error" },
      validate: { pdf: { requireBleed: false }, checks: { "pdf.structure.qpdf": false } },
    });
    expect(out.checks).toEqual({ "pdf.print.bleed": "error", "pdf.structure.qpdf": "off" });
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
      "ink (the preset and the publish target set it)",
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
      },
    });
    const config = resolveConfig({}, manifest);
    expect(config.chapters).toEqual(["01-intro.md", "02-body.md"]);
    expect(config.checks["pdf.structure.qpdf"]).toBe("warning");
    expect(config.checks["pdf.nav.bookmarks"]).toBe("on");
    expect(config.checks["source.htmlhint"]).toBe("off");
    // The threshold stays the preset's.
    expect(config.validate.pdf.minImageResolution).toBe(BOOK_PRESET.validate.pdf.minImageResolution);
    expect(notices()).toHaveLength(1);
  });
});
