import { test, expect, afterEach, describe } from "bun:test";
import { mkdtemp, writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveConfig } from "../manifest";
import {
  renderChapters,
  renderChaptersToFile,
  resolveActiveMarkdownFiles,
  type LayoutWarning,
} from "./index";

/**
 * ARCH finding #2 — integration test REQUIRED by the work package: a manifest
 * with no `styles:` plus `styles/book.css` on disk must link `book.css` in a
 * real build, exercising the EXACT call chain `renderBook()` in
 * build-runner.ts uses (`resolveConfig` -> `renderChaptersToFile` ->
 * `renderChapters` -> `resolveActiveStyles` -> `assembleBookHtml`'s `<link>`
 * emission) — no puppeteer/Chromium needed since this is the HTML-assembly
 * stage, not pagination/PDF.
 *
 * Before the fix, `DTRPG_PRESET.styles` (`["css/print.css"]`) made
 * `resolveConfig` return a non-empty `styles` array for EVERY styles:-less
 * manifest, so `resolveActiveStyles`'s fallback chain (styles/book.css ->
 * discovered CSS -> []) was dead code on this path — the book always linked
 * the phantom `css/print.css`, whether or not it existed on disk.
 */

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-styles-integration-"));
  dirs.push(dir);
  return dir;
}

test("styles:-less manifest + styles/book.css on disk inlines book.css in a real build (not the phantom css/print.css)", async () => {
  const dir = await makeProject();
  // No `styles:` key at all — the exact "hand-written manifest" / "adopted
  // folder" shape the finding calls out.
  await writeFile(join(dir, "manifest.yaml"), "title: No Styles Key\n", "utf8");
  await mkdir(join(dir, "styles"), { recursive: true });
  await writeFile(join(dir, "styles", "book.css"), ":root { --x: 1; }\n", "utf8");
  await writeFile(join(dir, "01.md"), "# Chapter One\n", "utf8");

  // The SAME two calls build-runner.ts's renderBook() makes: resolveConfig
  // to get the merged config, then renderChaptersToFile with config.styles.
  const manifest = { title: "No Styles Key" };
  const config = resolveConfig({}, manifest);
  const outDir = join(dir, "dist");
  const htmlFile = await renderChaptersToFile(dir, outDir, {
    title: config.title,
    styles: config.styles,
    files: config.source.files,
  });

  const html = await readFile(htmlFile, "utf8");
  // The conventional fallback is what gets INLINED (no <link> is emitted at all).
  expect(html).toContain("--x: 1");
  expect(html).not.toContain("css/print.css");
});

test("styles:-less manifest with NO conventional stylesheet on disk emits no phantom <link> at all", async () => {
  const dir = await makeProject();
  await writeFile(join(dir, "manifest.yaml"), "title: No Styles At All\n", "utf8");
  await writeFile(join(dir, "01.md"), "# Chapter One\n", "utf8");

  const config = resolveConfig({}, { title: "No Styles At All" });
  const outDir = join(dir, "dist");
  const htmlFile = await renderChaptersToFile(dir, outDir, {
    title: config.title,
    styles: config.styles,
    files: config.source.files,
  });

  const html = await readFile(htmlFile, "utf8");
  // Nothing is ever <link>ed now — CSS is inlined — and an absent conventional
  // stylesheet must not conjure a phantom reference to one either.
  expect(html).not.toContain("<link rel=\"stylesheet\"");
  expect(html).not.toContain("css/print.css");
});

test("an explicit manifest `styles:` list still wins over styles/book.css", async () => {
  const dir = await makeProject();
  await writeFile(
    join(dir, "manifest.yaml"),
    "title: Explicit\nstyles:\n  - my/custom.css\n",
    "utf8",
  );
  await mkdir(join(dir, "styles"), { recursive: true });
  await writeFile(join(dir, "styles", "book.css"), ":root{--from-book-css:1}", "utf8");
  await mkdir(join(dir, "my"), { recursive: true });
  await writeFile(join(dir, "my", "custom.css"), ":root{--from-custom:1}", "utf8");
  await writeFile(join(dir, "01.md"), "# Chapter One\n", "utf8");

  const config = resolveConfig({}, { title: "Explicit", styles: ["my/custom.css"] });
  const outDir = join(dir, "dist");
  const htmlFile = await renderChaptersToFile(dir, outDir, {
    title: config.title,
    styles: config.styles,
    files: config.source.files,
  });

  const html = await readFile(htmlFile, "utf8");
  // The explicit list is what gets INLINED; the conventional fallback is not.
  expect(html).toContain("--from-custom");
  expect(html).not.toContain("--from-book-css");
});

// #238 — plugin `styles` files enter the SAME asset-inline pipeline a
// manifest `styles:` entry does, not just string concatenation. These
// characterize renderChapters's new `pluginStylePaths` option directly
// (build-runner.ts / preview/file-watcher.ts are the only real callers, both
// thin wrappers around this).
describe("renderChapters plugin styles (#238)", () => {
  test("a plugin stylesheet's url() font is embedded as a data: URI, exactly like a project stylesheet's", async () => {
    const dir = await makeProject();
    await writeFile(join(dir, "01.md"), "# Chapter One\n", "utf8");

    const pluginDir = join(dir, "plugin");
    await mkdir(join(pluginDir, "fonts"), { recursive: true });
    // Real bytes don't matter — inlineStyles base64-encodes whatever is there.
    await writeFile(join(pluginDir, "fonts", "custom.woff2"), Buffer.from("not-a-real-font"));
    await writeFile(
      join(pluginDir, "plugin.css"),
      `@font-face { font-family: "Plugin Font"; src: url("fonts/custom.woff2") format("woff2"); }`,
      "utf8",
    );

    const html = await renderChapters(dir, {
      files: ["01.md"],
      pluginStylePaths: [join(pluginDir, "plugin.css")],
    });

    // Resolved + embedded (asset-inline.ts), not left as a bare relative path
    // an opaque string would have no way to resolve.
    expect(html).toContain("data:font/woff2;base64,");
    expect(html).not.toContain('url("fonts/custom.woff2")');
  });

  test("plugin file styles cascade BEFORE the project's own stylesheet, same slot the legacy css string held", async () => {
    const dir = await makeProject();
    await writeFile(join(dir, "01.md"), "# Chapter One\n", "utf8");
    await mkdir(join(dir, "styles"), { recursive: true });
    await writeFile(join(dir, "styles", "book.css"), ".from-project {}", "utf8");
    const pluginDir = join(dir, "plugin");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "plugin.css"), ".from-plugin-file {}", "utf8");

    const html = await renderChapters(dir, {
      files: ["01.md"],
      styles: ["styles/book.css"],
      pluginCss: ".from-plugin-string {}",
      pluginStylePaths: [join(pluginDir, "plugin.css")],
    });

    const fileIdx = html.indexOf(".from-plugin-file");
    const stringIdx = html.indexOf(".from-plugin-string");
    const projectIdx = html.indexOf(".from-project");
    expect(fileIdx).toBeGreaterThan(-1);
    expect(stringIdx).toBeGreaterThan(-1);
    expect(projectIdx).toBeGreaterThan(-1);
    expect(fileIdx).toBeLessThan(projectIdx);
    expect(stringIdx).toBeLessThan(projectIdx);
  });

  test("omitting pluginStylePaths (every pre-existing caller) is a byte-identical no-op", async () => {
    const dir = await makeProject();
    await writeFile(join(dir, "01.md"), "# Chapter One\n", "utf8");

    const withoutOption = await renderChapters(dir, {
      files: ["01.md"],
      pluginCss: ".legacy-string-plugin {}",
    });
    const withEmptyArray = await renderChapters(dir, {
      files: ["01.md"],
      pluginCss: ".legacy-string-plugin {}",
      pluginStylePaths: [],
    });

    expect(withEmptyArray).toBe(withoutOption);
    expect(withoutOption).toContain(".legacy-string-plugin {}");
  });

  test("onCssAssets and onStyleWarnings surface plugin-sourced entries too", async () => {
    const dir = await makeProject();
    await writeFile(join(dir, "01.md"), "# Chapter One\n", "utf8");
    const pluginDir = join(dir, "plugin");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.css"),
      `.remote { background: url("https://example.com/x.png"); }`,
      "utf8",
    );

    const warnings: string[] = [];
    await renderChapters(dir, {
      files: ["01.md"],
      pluginStylePaths: [join(pluginDir, "plugin.css")],
      onStyleWarnings: (w) => warnings.push(...w),
    });

    expect(warnings.some((w) => w.includes("example.com/x.png"))).toBe(true);
  });
});

/**
 * resolveActiveMarkdownFiles (2026-07-28 duplication audit) — extracted out of
 * renderChapters's own inline fallback so validation-exec.ts and
 * lint-runner.ts can resolve "the book's markdown files" with the exact same
 * logic renderChapters uses, instead of a separately-maintained recursive
 * glob. These pin down the two branches directly.
 */
test("resolveActiveMarkdownFiles: no configured files falls back to root .md files, alphabetically, non-recursive", async () => {
  const dir = await makeProject();
  await writeFile(join(dir, "b.md"), "# B\n", "utf8");
  await writeFile(join(dir, "a.md"), "# A\n", "utf8");
  await mkdir(join(dir, "drafts"), { recursive: true });
  await writeFile(join(dir, "drafts", "c.md"), "# C\n", "utf8");

  const files = await resolveActiveMarkdownFiles(dir);

  // Alphabetical, and drafts/c.md (one level down) is excluded — the same
  // root-only listing renderChapters' own fallback performs.
  expect(files).toEqual(["a.md", "b.md"]);
});

test("resolveActiveMarkdownFiles: a keep-both `.online` sibling is never rendered as a chapter", async () => {
  const dir = await makeProject();
  await writeFile(join(dir, "chapter-04.md"), "# Four\n", "utf8");
  // What a converge merge writes when two writers each created chapter-04.md
  // offline: ours stays, theirs lands beside it. It sorts immediately after
  // the real chapter, so a bare `.endsWith(".md")` glob would render the
  // online copy as a duplicate chapter and print it.
  await writeFile(join(dir, "chapter-04.online.md"), "# Four (online)\n", "utf8");

  const files = await resolveActiveMarkdownFiles(dir);

  expect(files).toEqual(["chapter-04.md"]);
});

test("resolveActiveMarkdownFiles: configured files are returned verbatim, in the given order", async () => {
  const dir = await makeProject();
  await writeFile(join(dir, "a.md"), "# A\n", "utf8");
  await writeFile(join(dir, "b.md"), "# B\n", "utf8");

  const files = await resolveActiveMarkdownFiles(dir, ["b.md", "a.md"]);

  expect(files).toEqual(["b.md", "a.md"]);
});

test("resolveActiveMarkdownFiles: an empty configured-files array still falls back (matches renderChapters' opts.files.length > 0 guard)", async () => {
  const dir = await makeProject();
  await writeFile(join(dir, "only.md"), "# Only\n", "utf8");

  const files = await resolveActiveMarkdownFiles(dir, []);

  expect(files).toEqual(["only.md"]);
});

/**
 * ARCH finding #4 — `assemble.ts`'s render loop previously called
 * `md.render(content)` with NO env, so every `env.layoutWarnings`
 * the marker plugin computed (8 typed, line-numbered author-mistake classes —
 * see markers.js's header) landed in markdown-it's own throwaway
 * internal env and was discarded before `renderChapters` ever returned.
 * Before this fix there was NO way for a `renderChapters` caller to observe a
 * marker mistake at all. `onChapterWarnings` is the fix: it must fire, keyed
 * by the exact chapter file, with the line number and message intact.
 */
test("renderChapters surfaces marker layout warnings via onChapterWarnings (ARCH #4)", async () => {
  const dir = await makeProject();
  // A deliberate marker mistake: @continue with no open @section.
  await writeFile(
    join(dir, "01.md"),
    "# Chapter One\n\n@continue\n\nOrphaned continuation text.\n",
    "utf8",
  );

  const captured: { file: string; warnings: LayoutWarning[] }[] = [];
  await renderChapters(dir, {
    files: ["01.md"],
    onChapterWarnings: (file, warnings) => captured.push({ file, warnings }),
  });

  expect(captured).toHaveLength(1);
  expect(captured[0]?.file).toBe("01.md");
  expect(captured[0]?.warnings).toHaveLength(1);
  expect(captured[0]?.warnings[0]).toMatchObject({
    line: 3,
    type: "continue_without_section",
    message: "@continue used without an open @section; ignoring marker.",
  });
});

test("renderChaptersToFile forwards onChapterWarnings through to renderChapters (ARCH #4)", async () => {
  const dir = await makeProject();
  await writeFile(join(dir, "01.md"), "@continue\nHi\n", "utf8");

  const captured: { file: string; warnings: LayoutWarning[] }[] = [];
  const outDir = join(dir, "dist");
  await renderChaptersToFile(dir, outDir, {
    files: ["01.md"],
    onChapterWarnings: (file, warnings) => captured.push({ file, warnings }),
  });

  expect(captured).toHaveLength(1);
  expect(captured[0]?.warnings[0]?.type).toBe("continue_without_section");
});

/**
 * A chapter with NO marker mistakes must never invoke the callback — the
 * warning surface stays silent for the common case (no noise for well-formed
 * documents).
 */
test("renderChapters does not invoke onChapterWarnings for a chapter with no marker mistakes", async () => {
  const dir = await makeProject();
  await writeFile(join(dir, "01.md"), "# Chapter One\n\nJust prose.\n", "utf8");

  const captured: unknown[] = [];
  await renderChapters(dir, {
    files: ["01.md"],
    onChapterWarnings: (file, warnings) => captured.push({ file, warnings }),
  });

  expect(captured).toHaveLength(0);
});
