import { test, expect, describe, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MANIFEST_FILENAMES,
  resolveConfig,
  loadManifestWithPath,
} from "./manifest";
import { UsageError } from "./cli-args";
import { DTRPG_PRESET, BOOK_PRESET, resetWarnOnce } from "./presets";

// #265 — `extensions:` takes bare specifiers whose FORM says what they are
// (extension-specifier.ts): `./`, `../`, `/` and a drive letter are paths;
// the five bundled names are bundled; anything else is npm, `name@version`
// pinned. There is no `path:`/`name:` wrapper and no `priority` — list order
// is load order. These tests pin that contract through resolveConfig.

function extensionsOf(entries: (string | { use: string })[]) {
  return resolveConfig({}, { extensions: entries }).extensions;
}

test("./ and ../ prefixes are paths; a bare name is npm; a bundled name is bundled", () => {
  const [a, b, c, d] = extensionsOf([
    "./plugins/my-plugin.js",
    "../shared/plugin.mjs",
    "markdown-it-emoji",
    "markdown-it-mark",
  ]);
  expect(a).toMatchObject({ use: "./plugins/my-plugin.js", path: "./plugins/my-plugin.js" });
  expect(a!.name).toBeUndefined();
  expect(b!.path).toBe("../shared/plugin.mjs");
  expect(c).toMatchObject({ use: "markdown-it-emoji", name: "markdown-it-emoji" });
  expect(c!.path).toBeUndefined();
  expect(d).toMatchObject({ name: "markdown-it-mark" });
  expect(d!.version).toBeUndefined();
});

test("absolute POSIX and Windows paths are paths", () => {
  const [posix, win] = extensionsOf(["/abs/plugins/my-plugin.js", "C:\\plugins\\my-plugin.js"]);
  expect(posix!.path).toBe("/abs/plugins/my-plugin.js");
  expect(win!.path).toBe("C:\\plugins\\my-plugin.js");
});

test("a bare relative path without ./ is refused, with the spelling to use", () => {
  expect(() => extensionsOf(["plugins/my-plugin.js"])).toThrow(
    /write it as "\.\/plugins\/my-plugin\.js"/,
  );
});

test("a scoped npm name (has a separator, no ./) is still a package name", () => {
  const [a] = extensionsOf(["@my-org/gutterpress-plugin"]);
  expect(a!.name).toBe("@my-org/gutterpress-plugin");
  expect(a!.path).toBeUndefined();
});

test("name@version pins an npm extension; export and options ride on the object form", () => {
  const [pinned, obj] = resolveConfig({}, {
    extensions: [
      "markdown-it-emoji@3.0.0",
      { use: "markdown-it-attrs", export: "full", options: { leftDelimiter: "[" } },
    ],
  }).extensions;
  expect(pinned).toMatchObject({ use: "markdown-it-emoji@3.0.0", name: "markdown-it-emoji", version: "3.0.0" });
  expect(obj).toMatchObject({
    use: "markdown-it-attrs",
    name: "markdown-it-attrs",
    export: "full",
    options: { leftDelimiter: "[" },
  });
});

test("a bundled name cannot be pinned — it always resolves to the bundled copy", () => {
  expect(() => extensionsOf(["markdown-it-mark@1.0.0"])).toThrow(/bundled with Gutterpress/);
});

test("list order is kept — nothing re-sorts extensions", () => {
  expect(extensionsOf(["b-ext", "a-ext", "./c.js"]).map((e) => e.use)).toEqual([
    "b-ext",
    "a-ext",
    "./c.js",
  ]);
});

test("enabled: false skips an entry without disturbing the others' order", () => {
  const entries = ["a-ext", { use: "b-ext", enabled: false } as { use: string }, "c-ext"];
  expect(extensionsOf(entries).map((e) => e.use)).toEqual(["a-ext", "c-ext"]);
});

describe("removed manifest shapes fail with the rewrite spelled out (#265)", () => {
  test("`plugins:` is rejected with the author's own entries rewritten, in their old load order", () => {
    const stale = {
      plugins: [
        "markdown-it-footnote",
        { path: "plugins/dc.js", priority: 100 },
        { name: "markdown-it-attrs", options: { x: 1 }, priority: 200 },
      ],
    } as unknown as Parameters<typeof resolveConfig>[1];
    let message = "";
    try {
      resolveConfig({}, stale);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("`plugins` was replaced by `extensions`");
    expect(message).toContain(
      "extensions:\n  - use: markdown-it-attrs\n    options: {\"x\":1}\n  - markdown-it-footnote\n  - ./plugins/dc.js",
    );
  });

  test("`priority` on an entry is rejected, naming list order", () => {
    const entry = { use: "some-ext", priority: 1 } as unknown as { use: string };
    expect(() => resolveConfig({}, { extensions: [entry] })).toThrow(
      /`priority` was removed — the `extensions:` list order is the load order/,
    );
  });

  test("`path:`/`name:` inside an entry is rejected, naming `use:`", () => {
    const entry = { path: "./x.js" } as unknown as { use: string };
    expect(() => resolveConfig({}, { extensions: [entry] })).toThrow(/write `use: \.\/x\.js`/);
  });
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
describe("resolveConfig — the removed `engine` and `engineStyles` fields fail, naming the replacement (#266)", () => {
  // Stale manifests are the input here, so the fixtures deliberately carry
  // fields the type no longer declares.
  const stale = (fields: Record<string, unknown>) =>
    fields as Parameters<typeof resolveConfig>[1];

  test("`engine:` is rejected whatever its value — there is nothing to select", () => {
    for (const engine of ["native", "paged"]) {
      expect(() => resolveConfig({}, stale({ engine }))).toThrow(
        /`engine` was removed — delete it/,
      );
    }
  });

  test("`engineStyles:` is rejected and told where its entries go", () => {
    expect(() =>
      resolveConfig({}, stale({ styles: ["a.css"], engineStyles: { native: ["c.css"] } })),
    ).toThrow(/`engineStyles` was removed — move its entries to the END of `styles:`/);
  });

  test("the same sheets at the end of `styles:` resolve in that order — all the field ever expressed", () => {
    expect(resolveConfig({}, { styles: ["a.css", "c.css"] }).styles).toEqual(["a.css", "c.css"]);
  });
});

describe("resolveConfig characterization — merge precedence (finding #24 refactor safety net)", () => {
  test("all-preset (no cli, no manifest overrides) reproduces the dtrpg preset verbatim", () => {
    const config = resolveConfig({}, {});
    expect(config.page).toEqual(DTRPG_PRESET.page!);
    expect(config.pdfx).toEqual(DTRPG_PRESET.pdfx);
    expect(config.ink).toEqual(DTRPG_PRESET.ink);
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
    expect(config.extensions).toEqual([]);
  });

  test("preset: book selects BOOK_PRESET's geometry/ink/validate wholesale", () => {
    const config = resolveConfig({}, { preset: "book" });
    expect(config.page).toEqual(BOOK_PRESET.page!);
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
    expect(config.page.height).toBe(DTRPG_PRESET.page!.height);
    expect(config.page.tolerance).toBe(DTRPG_PRESET.page!.tolerance);
  });

  test("one-level-deep object (page): cli width wins over manifest width, manifest height wins over preset", () => {
    const config = resolveConfig(
      { page: { width: 999 } },
      { page: { width: 500, height: 700 } },
    );
    expect(config.page.width).toBe(999);
    expect(config.page.height).toBe(700);
    expect(config.page.tolerance).toBe(DTRPG_PRESET.page!.tolerance);
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

  test("a manifest carrying the removed `source.assets` fails loudly instead of building wrong", () => {
    // Assets are derived from what the book references now (lib/asset-inline.ts).
    // A stale list must not be silently ignored: doing so would build an artifact
    // the author did not ask for, which is the exact silent class this replaced.
    expect(() =>
      resolveConfig({}, { source: { assets: ["css", "images"] } } as never),
    ).toThrow(/source\.assets/);
  });

  test("a manifest carrying the removed `output` block fails loudly", () => {
    expect(() => resolveConfig({}, { output: { dir: "build" } } as never)).toThrow(
      /`output`/,
    );
  });

  test("the removal error tells the author what to do instead", () => {
    try {
      resolveConfig({}, { output: { dir: "build" } } as never);
      throw new Error("expected a throw");
    } catch (err) {
      const msg = String(err);
      expect(msg).toContain("dist/<title-slug>/");
      expect(msg).toContain("--out");
    }
  });

  test("resolveConfig output is not aliased to the preset's own nested objects (independent per call)", () => {
    const a = resolveConfig({}, {});
    const b = resolveConfig({}, {});
    expect(a.page).not.toBe(b.page);
    expect(a.validate.checks).not.toBe(b.validate.checks);
    expect(a.validate.checks).not.toBe(DTRPG_PRESET.validate.checks);
  });

  test("allowedCallouts is deprecated, ignored, and absent from the resolved validate.source object", () => {
    const config = resolveConfig({}, { validate: { source: { allowedCallouts: ["note"] } } });
    expect(Object.keys(config.validate.source).sort()).toEqual([
      "cssOwnership",
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
      resolveConfig({}, { validate: { source: { allowedCallouts: ["a"] } } });
      resolveConfig({}, { validate: { source: { allowedCallouts: ["b"] } } });
      const hits = lines.filter((l) => l.includes("allowedCallouts"));
      expect(hits.length).toBe(1);
    } finally {
      console.warn = orig;
      resetWarnOnce();
    }
  });
});

// ── ARCH finding #12 (PR #98, maintainer HIGH) — an EXPLICIT --manifest path
// that doesn't exist is a user error (typo) and must fail loudly, unlike the
// legitimate "no --manifest given, scan the project dir" case, which remains
// available to tolerant callers such as live preview ─────────────────────────
describe("loadManifestWithPath explicit-path behavior (finding #12)", () => {
  const dirsToClean: string[] = [];

  afterEach(async () => {
    for (const d of dirsToClean.splice(0)) {
      await rm(d, { recursive: true, force: true });
    }
  });

  test("explicit: true + nonexistent path throws UsageError naming the path (typo repro)", async () => {
    const missing = join(tmpdir(), "gutterpress-typo-manifest-does-not-exist.yaml");

    await expect(
      loadManifestWithPath(missing, { explicit: true })
    ).rejects.toThrow(UsageError);
    await expect(
      loadManifestWithPath(missing, { explicit: true })
    ).rejects.toThrow(`manifest not found: ${missing}`);
  });

  test("explicit: false (or omitted) + nonexistent path silently falls back to an empty manifest (legacy/default-discovery behavior preserved)", async () => {
    const missing = join(tmpdir(), "gutterpress-no-such-project-dir-xyz");

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
    const dir = await mkdtemp(join(tmpdir(), "gutterpress-manifest-explicit-ok-"));
    dirsToClean.push(dir);
    const manifestPath = join(dir, "manifest.yaml");
    await Bun.write(manifestPath, "title: Explicit And Present\n");

    const { manifest, manifestDir, manifestPath: loadedPath } = await loadManifestWithPath(manifestPath, {
      explicit: true,
    });
    expect(manifest.title).toBe("Explicit And Present");
    expect(manifestDir).toBe(dir);
    expect(loadedPath).toBe(manifestPath);
  });

  test("malformed YAML throws a clean UsageError naming the manifest and parser position", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gutterpress-manifest-invalid-yaml-"));
    dirsToClean.push(dir);
    const manifestPath = join(dir, "manifest.yaml");
    await Bun.write(manifestPath, "title: Broken\nsource:\n\tfiles:\n");

    await expect(loadManifestWithPath(dir)).rejects.toThrow(UsageError);
    await expect(loadManifestWithPath(dir)).rejects.toThrow(
      `Invalid YAML in "${manifestPath}" at line 3, column 1: Tabs are not allowed as indentation`
    );
  });

  test("automatic discovery uses only the canonical manifest filename", async () => {
    expect([...MANIFEST_FILENAMES]).toEqual(["manifest.yaml"]);
  });
});
