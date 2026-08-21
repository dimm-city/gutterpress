import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { listProjectStyles, resolveActiveStyles, resolveProjectCss } from "./style-resolver";
import { resolveConfig } from "./manifest";

const TMP_ROOT = join(process.cwd(), ".tmp", `style-resolver-tests-${Date.now()}`);

let counter = 0;
function projectDir(): string {
  const dir = join(TMP_ROOT, `proj-${counter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function write(dir: string, rel: string, body = ""): void {
  const full = join(dir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body, "utf8");
}

describe("listProjectStyles", () => {
  beforeEach(() => {
    mkdirSync(TMP_ROOT, { recursive: true });
  });
  afterEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  test("manifest styles[] entry is returned active, in manifest order", async () => {
    const dir = projectDir();
    write(dir, "themes/dark/theme.css", "/* dark */");
    write(dir, "style.css", "/* root */");
    write(
      dir,
      "manifest.yaml",
      "title: T\nstyles:\n  - themes/dark/theme.css\n",
    );

    const styles = await listProjectStyles(dir);
    const active = styles.filter((s) => s.active);
    expect(active.length).toBe(1);
    expect(active[0]!.path).toBe(join(dir, "themes/dark/theme.css"));
    expect(active[0]!.active).toBe(true);
  });

  test("active manifest styles are sorted first", async () => {
    const dir = projectDir();
    write(dir, "themes/dark/theme.css", "");
    write(dir, "a-style.css", "");
    write(dir, "z-style.css", "");
    write(dir, "manifest.yaml", "styles:\n  - themes/dark/theme.css\n");

    const styles = await listProjectStyles(dir);
    expect(styles[0]!.path).toBe(join(dir, "themes/dark/theme.css"));
    expect(styles[0]!.active).toBe(true);
  });

  test("discovers root, styles/ and themes/*/theme.css CSS files", async () => {
    const dir = projectDir();
    write(dir, "style.css", "");
    write(dir, "styles/print.css", "");
    write(dir, "styles/screen.css", "");
    write(dir, "themes/dark/theme.css", "");
    write(dir, "manifest.yaml", "styles:\n  - style.css\n");

    const styles = await listProjectStyles(dir);
    const paths = styles.map((s) => s.path).sort();
    expect(paths).toContain(join(dir, "style.css"));
    expect(paths).toContain(join(dir, "styles/print.css"));
    expect(paths).toContain(join(dir, "styles/screen.css"));
    expect(paths).toContain(join(dir, "themes/dark/theme.css"));
    // each entry has a displayName
    for (const s of styles) {
      expect(typeof s.displayName).toBe("string");
      expect(s.displayName.length).toBeGreaterThan(0);
    }
  });

  test("multiple manifest styles[] all marked active in order", async () => {
    const dir = projectDir();
    write(dir, "base.css", "");
    write(dir, "overrides.css", "");
    write(dir, "manifest.yaml", "styles:\n  - base.css\n  - overrides.css\n");

    const styles = await listProjectStyles(dir);
    expect(styles[0]!.path).toBe(join(dir, "base.css"));
    expect(styles[0]!.active).toBe(true);
    expect(styles[1]!.path).toBe(join(dir, "overrides.css"));
    expect(styles[1]!.active).toBe(true);
  });

  test("no manifest styles → first discovered is ACTIVE (matches the renderer)", async () => {
    const dir = projectDir();
    write(dir, "z.css", "");
    write(dir, "a.css", "");
    write(dir, "manifest.yaml", "title: NoStyles\n");

    const styles = await listProjectStyles(dir);
    expect(styles.length).toBe(2);
    // The first discovered (alphabetical) is the one the preview renders, so it
    // is active; the rest are switchable but not active.
    expect(styles[0]!.path).toBe(join(dir, "a.css"));
    expect(styles[0]!.active).toBe(true);
    expect(styles[1]!.path).toBe(join(dir, "z.css"));
    expect(styles[1]!.active).toBe(false);
  });

  test("no manifest at all → the single discovered file is ACTIVE", async () => {
    const dir = projectDir();
    write(dir, "main.css", "");
    const styles = await listProjectStyles(dir);
    expect(styles.length).toBe(1);
    expect(styles[0]!.active).toBe(true);
    expect(styles[0]!.path).toBe(join(dir, "main.css"));
  });

  test("no manifest styles → styles/book.css preferred over other discovered", async () => {
    const dir = projectDir();
    write(dir, "a.css", "");
    write(dir, "styles/book.css", ":root{}");
    const styles = await listProjectStyles(dir);
    const active = styles.find((s) => s.active);
    expect(active!.path).toBe(join(dir, "styles/book.css"));
  });

  test("empty project → empty array", async () => {
    const dir = projectDir();
    const styles = await listProjectStyles(dir);
    expect(styles).toEqual([]);
  });

  test("manifest styles[] entry whose file is missing is still listed active", async () => {
    const dir = projectDir();
    write(dir, "manifest.yaml", "styles:\n  - themes/ghost/theme.css\n");
    const styles = await listProjectStyles(dir);
    expect(styles.length).toBe(1);
    expect(styles[0]!.active).toBe(true);
    expect(styles[0]!.path).toBe(join(dir, "themes/ghost/theme.css"));
  });

  test("no duplicate entries when a manifest style is also discovered", async () => {
    const dir = projectDir();
    write(dir, "style.css", "");
    write(dir, "manifest.yaml", "styles:\n  - style.css\n");
    const styles = await listProjectStyles(dir);
    const matches = styles.filter((s) => s.path === join(dir, "style.css"));
    expect(matches.length).toBe(1);
    expect(matches[0]!.active).toBe(true);
  });
});

describe("resolveActiveStyles (the one resolver the renderer + editor share)", () => {
  beforeEach(() => { mkdirSync(TMP_ROOT, { recursive: true }); });
  afterEach(() => { rmSync(TMP_ROOT, { recursive: true, force: true }); });

  test("returns the manifest styles verbatim when present", async () => {
    const dir = projectDir();
    expect(await resolveActiveStyles(dir, ["themes/x/theme.css"])).toEqual(["themes/x/theme.css"]);
  });

  test("no manifest → prefers styles/book.css, then css/print.css, then css/index.css", async () => {
    const dir = projectDir();
    write(dir, "css/index.css", "");
    expect(await resolveActiveStyles(dir, [])).toEqual(["css/index.css"]);
    write(dir, "css/print.css", "");
    expect(await resolveActiveStyles(dir, [])).toEqual(["css/print.css"]);
    write(dir, "styles/book.css", "");
    expect(await resolveActiveStyles(dir, [])).toEqual(["styles/book.css"]);
  });

  test("no manifest, no conventional file → first discovered .css", async () => {
    const dir = projectDir();
    write(dir, "weird-name.css", "");
    expect(await resolveActiveStyles(dir, [])).toEqual(["weird-name.css"]);
  });

  test("no stylesheet at all → [] (never a phantom css/print.css link)", async () => {
    const dir = projectDir();
    expect(await resolveActiveStyles(dir, [])).toEqual([]);
  });

  test("the editor's ACTIVE set === resolveActiveStyles (renderer/editor agree)", async () => {
    const dir = projectDir();
    write(dir, "styles/book.css", ":root{}");
    write(dir, "other.css", "");
    const active = (await listProjectStyles(dir)).filter((s) => s.active).map((s) => s.displayName);
    expect(active).toEqual(await resolveActiveStyles(dir, undefined));
  });

  // ARCH finding #2 — the actual reported bug, reconciled end-to-end: a
  // styles:-less manifest used to resolve (via resolveConfig -> the DTRPG
  // preset's `styles: ["css/print.css"]` default) to a stylesheet the CSS
  // editor's listProjectStyles (reading the raw, unresolved manifest) never
  // agreed with — the editor showed `styles/book.css` as active while the
  // renderer would link `css/print.css`. Now that the preset has no `styles`
  // default, resolveConfig's output feeds resolveActiveStyles the same
  // "nothing configured" signal listProjectStyles already used, so both
  // agree on styles/book.css.
  test("resolveConfig's resolved styles agree with the editor's active set for a styles:-less project (the reported bug)", async () => {
    const dir = projectDir();
    write(dir, "styles/book.css", ":root{}");

    const config = resolveConfig({}, {});
    const rendererStyles = await resolveActiveStyles(dir, config.styles);

    const editorActive = (await listProjectStyles(dir))
      .filter((s) => s.active)
      .map((s) => s.displayName);

    expect(rendererStyles).toEqual(["styles/book.css"]);
    expect(rendererStyles).toEqual(editorActive);
  });
});

// ── 2026-07-29 audit: shared stylesheets must stay listable ──────────────────
//
// Discovery scanned only inside the book, so a `../../shared/...` entry appeared
// in the desktop Styles picker ONLY while it was in the manifest. Unchecking it
// removed the manifest entry, and the next listing dropped it entirely: no way
// to re-enable it — or to add one — from the UI, which is the surface
// non-technical authors have. Hand-editing manifest.yaml was the only way back.
//
// Given the enclosing repo root, the repo's conventional shared locations are
// discovered too, as INACTIVE options named exactly the way the manifest stores
// them (project-relative), so toggling one on writes the right entry.

describe("listProjectStyles with a repo root (multi-book shared styles)", () => {
  beforeEach(() => {
    mkdirSync(TMP_ROOT, { recursive: true });
  });
  afterEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  function repoWithBook(): { repoRoot: string; book: string } {
    const repoRoot = join(TMP_ROOT, `repo-${counter++}`);
    const book = join(repoRoot, "books", "field-guide");
    mkdirSync(book, { recursive: true });
    return { repoRoot, book };
  }

  test("a repo-root shared stylesheet is listed even when NOT in the manifest", async () => {
    const { repoRoot, book } = repoWithBook();
    write(repoRoot, "shared/styles/components.css", "/* shared */");
    write(book, "styles/book.css", "/* book */");
    write(book, "manifest.yaml", "title: T\nstyles:\n  - styles/book.css\n");

    const styles = await listProjectStyles(book, { repoRoot });

    const names = styles.map((s) => s.displayName);
    expect(names).toContain("styles/book.css");
    expect(names).toContain("../../shared/styles/components.css");
    const shared = styles.find((s) => s.displayName === "../../shared/styles/components.css")!;
    expect(shared.active).toBe(false);
  });

  test("a shared stylesheet already in the manifest is listed ONCE, active", async () => {
    const { repoRoot, book } = repoWithBook();
    write(repoRoot, "shared/styles/components.css", "/* shared */");
    write(book, "manifest.yaml", "title: T\nstyles:\n  - ../../shared/styles/components.css\n");

    const styles = await listProjectStyles(book, { repoRoot });

    const matches = styles.filter((s) => s.path.endsWith("components.css"));
    expect(matches).toHaveLength(1);
    expect(matches[0]!.active).toBe(true);
  });

  test("a shared theme's theme.css is discovered", async () => {
    const { repoRoot, book } = repoWithBook();
    write(repoRoot, "shared/themes/publisher/theme.css", "/* theme */");
    write(book, "manifest.yaml", "title: T\n");

    const styles = await listProjectStyles(book, { repoRoot });

    expect(styles.map((s) => s.displayName)).toContain(
      "../../shared/themes/publisher/theme.css",
    );
  });

  test("no repoRoot behaves exactly as before (book-only discovery)", async () => {
    const { repoRoot, book } = repoWithBook();
    write(repoRoot, "shared/styles/components.css", "/* shared */");
    write(book, "styles/book.css", "/* book */");
    write(book, "manifest.yaml", "title: T\n");

    const styles = await listProjectStyles(book);

    expect(styles.map((s) => s.displayName)).toEqual(["styles/book.css"]);
  });

  test("a repoRoot equal to the book adds nothing new", async () => {
    const dir = projectDir();
    write(dir, "styles/book.css", "/* book */");
    write(dir, "manifest.yaml", "title: T\n");

    const withRoot = await listProjectStyles(dir, { repoRoot: dir });
    const without = await listProjectStyles(dir);

    expect(withRoot).toEqual(without);
  });
});

/**
 * `resolveProjectCss` feeds the rich editor, and the editor derives its
 * pagination from the break declarations it can SEE. It returned only the
 * author's own stylesheet at first, so a book that marks pages with `@page`
 * and writes no `break-*` CSS of its own gave the editor nothing to paginate
 * on — every deliberate page break silently ignored, and every marker and
 * utility class unstyled.
 */
describe("resolveProjectCss", () => {
  beforeEach(() => {
    mkdirSync(TMP_ROOT, { recursive: true });
  });
  afterEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  test("composes all four layers, in the order assembleBookHtml uses", async () => {
    const dir = projectDir();
    write(dir, "manifest.yaml", "title: T\nstyles:\n  - styles/book.css\n");
    write(dir, "styles/book.css", ".mine { color: red }");

    const { css } = await resolveProjectCss(dir);

    expect(css).toContain("/* gutterpress markers */");
    expect(css).toContain("/* gutterpress */");
    expect(css).toContain("/* project css */");
    // Author last, so project rules win at equal specificity.
    expect(css.indexOf("/* gutterpress markers */")).toBeLessThan(css.indexOf("/* gutterpress */"));
    expect(css.indexOf("/* gutterpress */")).toBeLessThan(css.indexOf("/* project css */"));
    expect(css).toContain(".mine { color: red }");
  });

  test("carries the break declarations the editor paginates on", async () => {
    // The concrete regression: `.page`/`.spread`/`.gp-page-break` get their
    // `break-before` from MARKER_CSS, nowhere else.
    const dir = projectDir();
    write(dir, "manifest.yaml", "title: T\n");

    const { css } = await resolveProjectCss(dir);

    expect(css).toContain(".page { break-before: page; }");
    expect(css).toContain(".spread { break-before: page; }");
    expect(css).toContain(".gp-page-break { break-before: page; }");
  });

  test("carries the gp-* author utility vocabulary", async () => {
    const dir = projectDir();
    write(dir, "manifest.yaml", "title: T\n");

    const { css } = await resolveProjectCss(dir);

    for (const cls of [".gp-columns-2", ".gp-bleed", ".gp-pin", ".gp-shape"]) {
      expect(css).toContain(cls);
    }
  });

  test("a book with no stylesheet still gets the core layers", async () => {
    const dir = projectDir();
    write(dir, "manifest.yaml", "title: T\n");

    const { css, styles } = await resolveProjectCss(dir);

    expect(styles).toEqual([]);
    expect(css).toContain("/* gutterpress markers */");
    expect(css).not.toContain("/* project css */");
  });

  test("includes engineStyles.native — the layer that paints the page", async () => {
    // The editor read `manifest.styles` directly while build and preview read
    // `resolveConfig`, so the engine layer reached the PDF and the preview but
    // never the editing surface. On the Dimm City field guide that layer is
    // `native-furniture.css`, which is where the page background lives — the
    // editor showed blank white paper for a book whose every page is a brick
    // wall.
    const dir = projectDir();
    write(
      dir,
      "manifest.yaml",
      "title: T\nstyles:\n  - styles/book.css\nengineStyles:\n  native:\n    - styles/furniture.css\n",
    );
    write(dir, "styles/book.css", ".mine { color: red }");
    write(dir, "styles/furniture.css", "html { background: #402030 }");

    const { css, styles } = await resolveProjectCss(dir);

    expect(styles).toEqual(["styles/book.css", "styles/furniture.css"]);
    expect(css).toContain(".mine { color: red }");
    expect(css).toContain("html { background: #402030 }");
    // Appended AFTER the author's own sheets, so furniture wins — the same
    // order `resolveConfig` gives the build.
    expect(css.indexOf(".mine")).toBeLessThan(css.indexOf("html { background: #402030 }"));
  });

  test("an explicit style list still wins over the manifest's", async () => {
    // `manifestStyles` is the caller saying which sheets to use (the Design
    // surface previewing an unsaved selection); resolving the config must not
    // quietly append to it.
    const dir = projectDir();
    write(
      dir,
      "manifest.yaml",
      "title: T\nstyles:\n  - styles/book.css\nengineStyles:\n  native:\n    - styles/furniture.css\n",
    );
    write(dir, "styles/book.css", ".mine { color: red }");
    write(dir, "styles/furniture.css", "html { background: #402030 }");
    write(dir, "styles/other.css", ".other { color: blue }");

    const { css, styles } = await resolveProjectCss(dir, ["styles/other.css"]);

    expect(styles).toEqual(["styles/other.css"]);
    expect(css).toContain(".other { color: blue }");
    expect(css).not.toContain("#402030");
  });
});
