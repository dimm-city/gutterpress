import { test, expect, describe } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { UsageError } from "./cli-args";
import { resolveConfig } from "./manifest";
import { getAssetPath } from "./embedded-assets";
import { scaffoldProject } from "./project-scaffold";
import { BUILT_IN_TEMPLATE_IDS } from "./project-templates";
import { resolveBuildContext, renderBook } from "./build-runner";
import { renderChaptersToFile } from "./markdown/index";

import {
  BOOK_PRESET,
  DTRPG_PRESET,
  PRESETS,
  resolvePreset,
  warnOnce,
  resetWarnOnce,
} from "./presets";

// ── resolvePreset (UX finding M48) ──────────────────────────────────────────

test("resolvePreset defaults to dtrpg when no preset is set", () => {
  expect(resolvePreset(undefined)).toBe(DTRPG_PRESET);
});

test("resolvePreset returns the named preset for a known value", () => {
  expect(resolvePreset("dtrpg")).toBe(DTRPG_PRESET);
  expect(resolvePreset("book")).toBe(BOOK_PRESET);
});

test("resolvePreset throws a UsageError naming the known presets for an unknown value", () => {
  try {
    resolvePreset("a4");
    throw new Error("expected UsageError");
  } catch (err) {
    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).exitCode).toBe(2);
    expect((err as UsageError).message).toContain('"a4"');
    expect((err as UsageError).message).toContain("dtrpg");
    expect((err as UsageError).message).toContain("book");
  }
});

test("PRESETS catalog contains exactly dtrpg and book", () => {
  expect(Object.keys(PRESETS).sort()).toEqual(["book", "dtrpg"]);
});

// ── resolveConfig integration: unknown preset errors, never silently falls
// back to dtrpg (the bug this finding fixes) ────────────────────────────────

test("resolveConfig throws for an unknown manifest preset instead of silently using dtrpg", () => {
  expect(() => resolveConfig({}, { preset: "a4" as "dtrpg" })).toThrow(UsageError);
});

test("resolveConfig with no preset set still resolves to dtrpg geometry (unchanged default)", () => {
  const config = resolveConfig({}, {});
  expect(config.page.width).toBe(DTRPG_PRESET.page.width);
  expect(config.page.height).toBe(DTRPG_PRESET.page.height);
  expect(config.ink.maxTac).toBe(240);
});

// ── book preset geometry (UX finding M48) ───────────────────────────────────

test("book preset uses standard 6x9in trade geometry (432x648pt)", () => {
  expect(BOOK_PRESET.page.width).toBe(432);
  expect(BOOK_PRESET.page.height).toBe(648);
});

test("book preset has no vendor TAC cap (400% — the physical ceiling)", () => {
  expect(BOOK_PRESET.ink.maxTac).toBe(400);
});

test("book preset does not force PDF/X-specific checks", () => {
  expect(BOOK_PRESET.validate.checks["pdf.print.pdfx-markers"]).toBe(false);
  expect(BOOK_PRESET.validate.checks["pdf.print.pdfx-metadata"]).toBe(false);
  expect(BOOK_PRESET.validate.pdf.forbidTransparency).toBe(false);
});

test("book preset still enables generic, vendor-agnostic PDF health checks", () => {
  expect(BOOK_PRESET.validate.checks["pdf.structure.qpdf"]).toEqual({
    enabled: true,
    severity: "error",
  });
  expect(BOOK_PRESET.validate.checks["pdf.print.embedded-fonts"]).toEqual({
    enabled: true,
    severity: "error",
  });
});

test("resolveConfig with preset: book resolves the book preset's geometry", () => {
  const config = resolveConfig({}, { preset: "book" });
  expect(config.page.width).toBe(432);
  expect(config.page.height).toBe(648);
  expect(config.ink.maxTac).toBe(400);
});

test("book preset differs from dtrpg on the vendor-specific fields (sanity check they're not aliases)", () => {
  expect(BOOK_PRESET).not.toBe(DTRPG_PRESET);
  expect(BOOK_PRESET.page.width).not.toBe(DTRPG_PRESET.page.width);
  expect(BOOK_PRESET.ink.maxTac).not.toBe(DTRPG_PRESET.ink.maxTac);
});

// ── ARCH finding #2 — no more preset-level styles default ──────────────────

test("neither preset declares a `styles` default (resolveActiveStyles owns that fallback chain now)", () => {
  expect((DTRPG_PRESET as Record<string, unknown>).styles).toBeUndefined();
  expect((BOOK_PRESET as Record<string, unknown>).styles).toBeUndefined();
});

// ── ARCH finding #24 — warnOnce / resetWarnOnce replace raw module-level
// mutable booleans, so dedup state is both resettable (a "reset hook") and
// redirectable to a caller-supplied sink instead of `console.warn` ─────────

test("warnOnce fires the sink exactly once per id, even across repeated calls", () => {
  const seen: string[] = [];
  const id = `test-warn-${Math.random()}`;
  warnOnce(id, "first", (m) => seen.push(m));
  warnOnce(id, "second", (m) => seen.push(m));
  warnOnce(id, "third", (m) => seen.push(m));
  expect(seen).toEqual(["first"]);
});

test("different ids each get their own independent warn-once state", () => {
  const seen: string[] = [];
  const idA = `test-warn-a-${Math.random()}`;
  const idB = `test-warn-b-${Math.random()}`;
  warnOnce(idA, "a", (m) => seen.push(m));
  warnOnce(idB, "b", (m) => seen.push(m));
  expect(seen.sort()).toEqual(["a", "b"]);
});

test("resetWarnOnce clears dedup state so a warning can fire again (the reset hook)", () => {
  const seen: string[] = [];
  const id = `test-warn-reset-${Math.random()}`;
  warnOnce(id, "first", (m) => seen.push(m));
  warnOnce(id, "again-before-reset", (m) => seen.push(m));
  expect(seen).toEqual(["first"]);

  resetWarnOnce();
  warnOnce(id, "again-after-reset", (m) => seen.push(m));
  expect(seen).toEqual(["first", "again-after-reset"]);
});

test("resolvePreset's 'no preset set' notice respects resetWarnOnce (no leftover un-resettable module boolean)", () => {
  resetWarnOnce();
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = ((m: unknown) => { lines.push(String(m)); }) as typeof console.warn;
  try {
    resolvePreset(undefined);
    resolvePreset(undefined);
    expect(lines.length).toBe(1);

    resetWarnOnce();
    resolvePreset(undefined);
    expect(lines.length).toBe(2);
  } finally {
    console.warn = orig;
    resetWarnOnce();
  }
});

// ── Maintainer review (P4, presets.ts:236): every built-in template manifest
// must declare an explicit `preset` so a fresh `print-md new` project never
// silently falls through resolvePreset's undefined-preset path (which
// defaults to dtrpg's vendor geometry/TAC/PDF/X forcing) unless the template
// actually wants dtrpg — as `ttrpg` genuinely does (it IS the DriveThruRPG
// use case the dtrpg preset exists for). `book`/`technical`/`zine` get the
// neutral `book` preset.
describe("built-in template manifests declare an explicit preset (maintainer review, presets.ts:236)", () => {
  const EXPECTED_TEMPLATE_PRESET: Record<(typeof BUILT_IN_TEMPLATE_IDS)[number], string> = {
    book: "book",
    ttrpg: "dtrpg",
    technical: "book",
    zine: "book",
  };

  test("every shipped template id has an expected preset pinned in this test (no silent additions)", () => {
    expect(Object.keys(EXPECTED_TEMPLATE_PRESET).sort()).toEqual(
      [...BUILT_IN_TEMPLATE_IDS].sort()
    );
  });

  for (const id of BUILT_IN_TEMPLATE_IDS) {
    test(`template "${id}" manifest declares preset: ${EXPECTED_TEMPLATE_PRESET[id]}`, async () => {
      const manifestPath = await getAssetPath(`templates/${id}/manifest.yaml`);
      const raw = await readFile(manifestPath, "utf8");
      const manifest = parseYaml(raw) as { preset?: string };
      expect(manifest.preset).toBe(EXPECTED_TEMPLATE_PRESET[id]);
    });
  }

  test("resolveConfig for a freshly scaffolded project from each built-in template never hits the undefined-preset warn path", async () => {
    resetWarnOnce();
    const lines: string[] = [];
    const orig = console.warn;
    console.warn = ((m: unknown) => {
      lines.push(String(m));
    }) as typeof console.warn;
    const parent = await mkdtemp(path.join(tmpdir(), "pmd-preset-scaffold-"));
    try {
      for (const id of BUILT_IN_TEMPLATE_IDS) {
        const result = await scaffoldProject({
          name: `Preset Check ${id}`,
          parentDir: parent,
          template: id,
          versionHistory: "none",
        });
        const raw = await readFile(result.manifestPath, "utf8");
        const manifest = parseYaml(raw);
        resolveConfig({}, manifest);
      }
      const noPresetWarnings = lines.filter((l) => l.includes("No `preset` set"));
      expect(noPresetWarnings).toEqual([]);
    } finally {
      console.warn = orig;
      resetWarnOnce();
      await rm(parent, { recursive: true, force: true });
    }
  });
});

// ── Maintainer P1 (presets.ts:115) — BOOK_PRESET/DTRPG_PRESET.source.assets
// omitted "styles" and "assets", the two directories `print-md new` actually
// scaffolds (a starter `styles/book.css` theme + an `assets/` dir the user
// guide tells authors to put images in). Every built-in template's manifest
// references `styles/book.css` and resolves to one of these two presets, so a
// fresh project's theme CSS and any `assets/*` media were never copied into
// build output even though the rendered HTML/PDF references them.
/**
 * The guarantee this block protects has not changed, but its MECHANISM has.
 *
 * Historically a fresh project's `styles/book.css` and `assets/*` media were
 * referenced by the rendered HTML but never copied into the output, because
 * copying was driven by a hand-maintained `source.assets` list that did not
 * cover what `print-md new` actually scaffolds. The list is gone: CSS is now
 * inlined into `book.html` at render time and media is copied from what the
 * book actually references, so "scaffolded, therefore shipped" holds by
 * construction rather than by keeping two lists in sync.
 *
 * These tests assert the OUTCOME (a scaffolded project's theme reaches the
 * built book) so they keep protecting the same regression.
 */
describe("a scaffolded project's stylesheet reaches the build output (maintainer P1, presets.ts:115)", () => {
  test("neither preset carries an asset list or an output block any more", () => {
    for (const preset of [DTRPG_PRESET, BOOK_PRESET]) {
      expect(preset.source).toEqual({ files: null });
      expect((preset as Record<string, unknown>).output).toBeUndefined();
    }
  });

  test("the scaffolded styles/book.css is inlined into book.html with no asset list involved", async () => {
    const { dir, cleanup } = await makeTempProject();
    try {
      await mkdir(path.join(dir, "styles"), { recursive: true });
      await writeFile(
        path.join(dir, "styles", "book.css"),
        ":root { --scaffolded-token: 1; }",
        "utf8"
      );
      await writeFile(path.join(dir, "01.md"), "# Chapter One\n", "utf8");

      const config = resolveConfig({}, { preset: "book", title: "T" });
      const outDir = path.join(dir, "out");
      const htmlFile = await renderChaptersToFile(dir, outDir, {
        title: config.title,
        styles: config.styles,
        files: config.source.files,
      });

      const html = await readFile(htmlFile, "utf8");
      expect(html).toContain("--scaffolded-token");
      expect(html).not.toContain("<link rel=\"stylesheet\"");
    } finally {
      await cleanup();
    }
  });

  test("scaffolded media is copied because the book references it, not because a list named its folder", async () => {
    const { dir, cleanup } = await makeTempProject();
    try {
      await mkdir(path.join(dir, "assets"), { recursive: true });
      await writeFile(path.join(dir, "assets", "cover.svg"), "<svg/>", "utf8");
      await writeFile(path.join(dir, "01.md"), "# C\n\n![cover](assets/cover.svg)\n", "utf8");

      const refs: string[] = [];
      const outDir = path.join(dir, "out");
      await renderChaptersToFile(dir, outDir, {
        title: "T",
        files: ["01.md"],
        onImageRefs: (r) => refs.push(...r),
      });

      expect(refs).toContain("assets/cover.svg");
    } finally {
      await cleanup();
    }
  });
});

/** Temp project dir helper for the scaffold-reaches-output tests above. */
async function makeTempProject(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "pmd-preset-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
