import { test, expect, describe, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig, loadManifestWithPath } from "./manifest";
import { UsageError } from "./cli-args";
import { DTRPG_PRESET, BOOK_PRESET, resetWarnOnce } from "./presets";

// ARCH finding #57: isFilePath's own doc comment promises "File paths start
// with ./, ../, /, or contain path separators with extensions" but the
// implementation only checked the prefixes — so a bare relative path like
// `plugins/my-plugin.js` (a very natural thing for a non-technical author to
// write, omitting the `./`) was silently treated as an npm package name,
// producing a "bun add plugins/my-plugin.js" dead-end that can never
// resolve. These tests pin isFilePath's behavior (exercised indirectly via
// resolveConfig's plugin-string normalization, since isFilePath itself is
// private) against its own documented contract.

function pluginsOf(strings: string[]) {
  return resolveConfig({}, { plugins: strings }).plugins;
}

test("explicit ./ and ../ prefixes are file paths", () => {
  const [a, b] = pluginsOf(["./plugins/my-plugin.js", "../shared/plugin.mjs"]);
  expect(a!.path).toBe("./plugins/my-plugin.js");
  expect(a!.name).toBeUndefined();
  expect(b!.path).toBe("../shared/plugin.mjs");
});

test("absolute POSIX and Windows paths are file paths", () => {
  const [posix, win] = pluginsOf([
    "/abs/plugins/my-plugin.js",
    "C:\\plugins\\my-plugin.js",
  ]);
  expect(posix!.path).toBe("/abs/plugins/my-plugin.js");
  expect(win!.path).toBe("C:\\plugins\\my-plugin.js");
});

test("a bare relative path with a separator and a JS extension is a file path, even without ./ (finding #57)", () => {
  const [a, b] = pluginsOf(["plugins/my-plugin.js", "sub/dir/plugin.mjs"]);
  expect(a!.path).toBe("plugins/my-plugin.js");
  expect(a!.name).toBeUndefined();
  expect(b!.path).toBe("sub/dir/plugin.mjs");
});

test("a bare npm package name (no separator) is still treated as a package name", () => {
  const [a] = pluginsOf(["markdown-it-emoji"]);
  expect(a!.name).toBe("markdown-it-emoji");
  expect(a!.path).toBeUndefined();
});

test("a scoped npm package name (has a separator but no JS-extension suffix) is still a package name", () => {
  const [a] = pluginsOf(["@my-org/print-md-plugin"]);
  expect(a!.name).toBe("@my-org/print-md-plugin");
  expect(a!.path).toBeUndefined();
});

test(".cjs extension with a separator is also recognized as a file path", () => {
  const [a] = pluginsOf(["plugins/legacy-plugin.cjs"]);
  expect(a!.path).toBe("plugins/legacy-plugin.cjs");
});

// ── ARCH finding #24 — characterization tests for resolveConfig's three-way
// merge (cli > manifest > preset), written BEFORE collapsing the ~40
// hand-written `c.x ?? m.x ?? preset.x` lines into a small typed deep-merge.
// These pin the MERGE PRECEDENCE at every nesting depth resolveConfig
// supports today (top-level scalar, one level deep, two levels deep, and the
// `validate.checks` dictionary) so the refactor is provably
// behavior-preserving. Fields that finding #2/#24 deliberately CHANGE
// (`styles`'s preset default, `allowedCallouts`) are characterized
// separately, below, as "before" (bug) / "after" (fix) pairs — not locked in
// here.
describe("resolveConfig characterization — merge precedence (finding #24 refactor safety net)", () => {
  test("all-preset (no cli, no manifest overrides) reproduces the dtrpg preset verbatim", () => {
    const config = resolveConfig({}, {});
    expect(config.page).toEqual(DTRPG_PRESET.page);
    expect(config.pdfx).toEqual(DTRPG_PRESET.pdfx);
    expect(config.ink).toEqual(DTRPG_PRESET.ink);
    expect(config.output).toEqual(DTRPG_PRESET.output);
    expect(config.lint).toEqual(DTRPG_PRESET.lint);
    expect(config.validate.enabled).toBe(DTRPG_PRESET.validate.enabled);
    expect(config.validate.checks).toEqual(DTRPG_PRESET.validate.checks);
    expect(config.validate.assets).toEqual(DTRPG_PRESET.validate.assets);
    expect(config.validate.pdf).toEqual(DTRPG_PRESET.validate.pdf);
    expect(config.validate.heuristics).toEqual(DTRPG_PRESET.validate.heuristics);
    expect(config.validate.source.markdownlint).toBe(DTRPG_PRESET.validate.source.markdownlint);
    expect(config.validate.source.htmlhint).toBe(DTRPG_PRESET.validate.source.htmlhint);
    expect(config.validate.source.stylelint).toBe(DTRPG_PRESET.validate.source.stylelint);
    expect(config.title).toBe("Document");
    expect(config.authors).toEqual([]);
    expect(config.plugins).toEqual([]);
  });

  test("preset: book selects BOOK_PRESET's geometry/ink/validate wholesale", () => {
    const config = resolveConfig({}, { preset: "book" });
    expect(config.page).toEqual(BOOK_PRESET.page);
    expect(config.ink).toEqual(BOOK_PRESET.ink);
    expect(config.validate.checks).toEqual(BOOK_PRESET.validate.checks);
    expect(config.validate.pdf.forbidTransparency).toBe(false);
  });

  test("manifest overrides a top-level scalar leaf (title) over the preset", () => {
    const config = resolveConfig({}, { title: "Manifest Title" });
    expect(config.title).toBe("Manifest Title");
  });

  test("cli overrides win over manifest for the same top-level scalar leaf", () => {
    const config = resolveConfig({ title: "CLI Title" }, { title: "Manifest Title" });
    expect(config.title).toBe("CLI Title");
  });

  test("one-level-deep object (page): manifest sets width only, height/tolerance keep the preset default", () => {
    const config = resolveConfig({}, { page: { width: 500 } });
    expect(config.page.width).toBe(500);
    expect(config.page.height).toBe(DTRPG_PRESET.page.height);
    expect(config.page.tolerance).toBe(DTRPG_PRESET.page.tolerance);
  });

  test("one-level-deep object (page): cli width wins over manifest width, manifest height wins over preset", () => {
    const config = resolveConfig(
      { page: { width: 999 } },
      { page: { width: 500, height: 700 } },
    );
    expect(config.page.width).toBe(999);
    expect(config.page.height).toBe(700);
    expect(config.page.tolerance).toBe(DTRPG_PRESET.page.tolerance);
  });

  test("one-level-deep object (pdfx): manifest overrides flavor only, icc/stripAnnotations keep preset defaults", () => {
    const config = resolveConfig({}, { pdfx: { flavor: "x3" } });
    expect(config.pdfx.flavor).toBe("x3");
    expect(config.pdfx.icc).toBe(DTRPG_PRESET.pdfx.icc);
    expect(config.pdfx.stripAnnotations).toBe(DTRPG_PRESET.pdfx.stripAnnotations);
  });

  test("one-level-deep object (lint): manifest configPath explicit null is honoured, not treated as unset", () => {
    const config = resolveConfig({}, { lint: { configPath: null, enabled: false } });
    expect(config.lint.configPath).toBeNull();
    expect(config.lint.enabled).toBe(false);
  });

  test("validate.source string|false leaves: manifest false wins over preset null, cli false wins over manifest string", () => {
    const withManifestFalse = resolveConfig({}, { validate: { source: { markdownlint: false } } });
    expect(withManifestFalse.validate.source.markdownlint).toBe(false);

    const withCliOverride = resolveConfig(
      { validate: { source: { markdownlint: false } } },
      { validate: { source: { markdownlint: ".markdownlint.yaml" } } },
    );
    expect(withCliOverride.validate.source.markdownlint).toBe(false);
  });

  test("two-levels-deep object (validate.heuristics.textDensityRange): manifest sets min only, max keeps the preset default", () => {
    const config = resolveConfig({}, { validate: { heuristics: { textDensityRange: { min: 500 } } } });
    expect(config.validate.heuristics.textDensityRange.min).toBe(500);
    expect(config.validate.heuristics.textDensityRange.max).toBe(DTRPG_PRESET.validate.heuristics.textDensityRange.max);
    expect(config.validate.heuristics.maxDecorativeLayers).toBe(DTRPG_PRESET.validate.heuristics.maxDecorativeLayers);
  });

  test("validate.checks dictionary: manifest sets one id to a boolean, another to a NEW partial object; unset preset ids survive untouched", () => {
    const config = resolveConfig(
      {},
      {
        validate: {
          checks: {
            "pdf.structure.qpdf": false,
            "heuristic.custom.new-check": { severity: "info" },
          },
        },
      },
    );
    expect(config.validate.checks["pdf.structure.qpdf"]).toBe(false);
    expect(config.validate.checks["heuristic.custom.new-check"]).toEqual({ severity: "info" });
    // Untouched preset entries survive verbatim.
    expect(config.validate.checks["pdf.print.pdfx-markers"]).toEqual(
      DTRPG_PRESET.validate.checks["pdf.print.pdfx-markers"],
    );
  });

  test("validate.checks dictionary: cli checks win over manifest checks per-id", () => {
    const config = resolveConfig(
      { validate: { checks: { "pdf.structure.qpdf": { enabled: true, severity: "warning" } } } },
      { validate: { checks: { "pdf.structure.qpdf": false } } },
    );
    expect(config.validate.checks["pdf.structure.qpdf"]).toEqual({
      enabled: true,
      severity: "warning",
    });
  });

  test("array leaf (validate.assets.allowedColorSpaces): manifest array replaces the preset array wholesale (no element merge)", () => {
    const config = resolveConfig({}, { validate: { assets: { allowedColorSpaces: ["RGB"] } } });
    expect(config.validate.assets.allowedColorSpaces).toEqual(["RGB"]);
  });

  test("source.assets array leaf: cli replaces manifest replaces preset, wholesale", () => {
    const config = resolveConfig(
      { source: { assets: ["fonts"] } },
      { source: { assets: ["css", "images"] } },
    );
    expect(config.source.assets).toEqual(["fonts"]);
  });

  test("resolveConfig output is not aliased to the preset's own nested objects (independent per call)", () => {
    const a = resolveConfig({}, {});
    const b = resolveConfig({}, {});
    expect(a.page).not.toBe(b.page);
    expect(a.validate.checks).not.toBe(b.validate.checks);
    expect(a.validate.checks).not.toBe(DTRPG_PRESET.validate.checks);
  });

  // mergeShape's "keys always come from preset's own shape" rule (finding #24):
  // a deprecated key the manifest TYPE carries (`output.html`) but `preset`/
  // `ResolvedConfig` do not declare must never leak into the resolved object —
  // only `dir`/`filename` are copied.
  test("a deprecated key absent from the preset's shape (output.html) never leaks into the resolved output object", () => {
    const config = resolveConfig({}, { output: { html: "custom.html", filename: "book.pdf" } });
    expect(config.output.filename).toBe("book.pdf");
    expect(Object.keys(config.output).sort()).toEqual(["dir", "filename"]);
    expect((config.output as Record<string, unknown>).html).toBeUndefined();
  });

  test("allowedCallouts is deprecated, ignored, and absent from the resolved validate.source object", () => {
    const config = resolveConfig({}, { validate: { source: { allowedCallouts: ["note"] } } });
    expect(Object.keys(config.validate.source).sort()).toEqual([
      "htmlhint",
      "markdownlint",
      "stylelint",
    ]);
  });
});

// ── ARCH finding #24 — deprecated-field warnings fire once per process and
// don't affect the resolved config's shape ──────────────────────────────────
describe("resolveConfig deprecation warnings (finding #24)", () => {
  test("a manifest `output.html` triggers exactly one warning across repeated resolveConfig calls", () => {
    // The warn-once registry (presets.ts) is process-wide (module state
    // shared across every test file bun runs in one process), so start from
    // a known-clean slate via the reset hook instead of assuming no earlier
    // test already tripped this specific warning id.
    resetWarnOnce();
    const lines: string[] = [];
    const orig = console.warn;
    console.warn = ((m: unknown) => { lines.push(String(m)); }) as typeof console.warn;
    try {
      resolveConfig({}, { output: { html: "x.html" } });
      resolveConfig({}, { output: { html: "y.html" } });
      const hits = lines.filter((l) => l.includes("output.html"));
      expect(hits.length).toBe(1);
    } finally {
      console.warn = orig;
      resetWarnOnce();
    }
  });
});

// ── ARCH finding #12 (PR #98, maintainer HIGH) — an EXPLICIT --manifest path
// that doesn't exist is a user error (typo) and must fail loudly, unlike the
// legitimate "no --manifest given, scan the project dir" case, which must
// keep silently falling back to defaults ─────────────────────────────────────
describe("loadManifestWithPath explicit-path behavior (finding #12)", () => {
  const dirsToClean: string[] = [];

  afterEach(async () => {
    for (const d of dirsToClean.splice(0)) {
      await rm(d, { recursive: true, force: true });
    }
  });

  test("explicit: true + nonexistent path throws UsageError naming the path (typo repro)", async () => {
    const missing = join(tmpdir(), "print-md-typo-manifest-does-not-exist.yaml");

    await expect(
      loadManifestWithPath(missing, { explicit: true })
    ).rejects.toThrow(UsageError);
    await expect(
      loadManifestWithPath(missing, { explicit: true })
    ).rejects.toThrow(`manifest not found: ${missing}`);
  });

  test("explicit: false (or omitted) + nonexistent path silently falls back to an empty manifest (legacy/default-discovery behavior preserved)", async () => {
    const missing = join(tmpdir(), "print-md-no-such-project-dir-xyz");

    const { manifest, manifestDir } = await loadManifestWithPath(missing);
    expect(manifest).toEqual({});
    expect(manifestDir).toBe(missing);

    // Passing `explicit: false` explicitly must behave identically.
    const explicitFalse = await loadManifestWithPath(missing, { explicit: false });
    expect(explicitFalse.manifest).toEqual({});
  });

  test("no pathOrDir at all (no --manifest, cwd scan) never throws, regardless of explicit", async () => {
    const { manifest } = await loadManifestWithPath(undefined, { explicit: true });
    // explicit is irrelevant when there's no path to be explicit ABOUT.
    expect(manifest).toBeDefined();
  });

  test("explicit: true + a path that DOES resolve to a real manifest still loads it normally", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pmd-manifest-explicit-ok-"));
    dirsToClean.push(dir);
    const manifestPath = join(dir, "manifest.yaml");
    await Bun.write(manifestPath, "title: Explicit And Present\n");

    const { manifest, manifestDir } = await loadManifestWithPath(manifestPath, {
      explicit: true,
    });
    expect(manifest.title).toBe("Explicit And Present");
    expect(manifestDir).toBe(dir);
  });
});
