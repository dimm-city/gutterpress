import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  inlineStyles,
  planImageCopies,
  collectStyleDependencies,
  decodeRef,
  IMAGE_INLINE_MAX_BYTES,
} from "./asset-inline";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "gutterpress-inline-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Write a file (creating parents) and return its absolute path. */
async function put(rel: string, contents: string | Buffer): Promise<string> {
  const abs = path.join(dir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, contents);
  return abs;
}

describe("inlineStyles", () => {
  test("inlines stylesheets in manifest order so later entries win the cascade", async () => {
    await put("themes/night/theme.css", "h1 { color: red; }");
    await put("override.css", "h1 { color: blue; }");

    const { css } = await inlineStyles(dir, ["themes/night/theme.css", "override.css"]);

    expect(css.indexOf("red")).toBeLessThan(css.indexOf("blue"));
  });

  test("embeds a font as a data: URI, resolved relative to the stylesheet", async () => {
    // The real shared-design-system shape: CSS in styles/, font in a SIBLING
    // fonts/ dir, referenced as ../fonts/x.ttf.
    await put("shared/fonts/body.ttf", Buffer.from("FONTBYTES"));
    await put(
      "shared/styles/guide.css",
      '@font-face { font-family: B; src: url("../fonts/body.ttf") format("truetype"); }'
    );

    const { css, copies } = await inlineStyles(dir, ["shared/styles/guide.css"]);

    expect(css).toContain(`data:font/ttf;base64,${Buffer.from("FONTBYTES").toString("base64")}`);
    // A font is never shipped as a separate file — it must be IN the document.
    expect(copies).toHaveLength(0);
  });

  test("a stylesheet outside the project inlines normally (no copying, no flattening)", async () => {
    await put("shared/theme.css", "body { margin: 0; }");
    await mkdir(path.join(dir, "book"), { recursive: true });

    const { css } = await inlineStyles(path.join(dir, "book"), ["../shared/theme.css"]);

    expect(css).toContain("margin: 0");
  });

  test("a missing stylesheet is a build error naming the file", async () => {
    await expect(inlineStyles(dir, ["styles/nope.css"])).rejects.toThrow(/nope\.css/);
  });

  test("a missing font is a build error naming the font and the referencing sheet", async () => {
    await put("styles/book.css", '@font-face { font-family: B; src: url("../fonts/gone.woff2"); }');

    // The old regex-based check silently passed this and let the PDF ship with a
    // substituted system face; embedding forces it to be a hard failure.
    await expect(inlineStyles(dir, ["styles/book.css"])).rejects.toThrow(/gone\.woff2/);
  });

  test("query strings and fragments are stripped before resolving (bulletproof @font-face)", async () => {
    await put("fonts/b.woff2", Buffer.from("W"));
    await put("styles/book.css", '@font-face { font-family: B; src: url("../fonts/b.woff2?v=2#iefix"); }');

    const { css } = await inlineStyles(dir, ["styles/book.css"]);
    expect(css).toContain("data:font/woff2;base64,");
  });

  test("percent-encoded filenames resolve to the real file", async () => {
    await put("fonts/my font.woff2", Buffer.from("W"));
    await put("styles/book.css", '@font-face { font-family: B; src: url("../fonts/my%20font.woff2"); }');

    const { css } = await inlineStyles(dir, ["styles/book.css"]);
    expect(css).toContain("data:font/woff2;base64,");
  });

  test("checks EVERY src: in a multi-src @font-face, not just the last", async () => {
    // The deleted missing-font-refs check backtracked to the last `src:` and so
    // never validated the first declaration of this standard pattern.
    await put("fonts/b.woff2", Buffer.from("W"));
    await put(
      "styles/book.css",
      '@font-face { font-family: B; src: url("../fonts/absent.eot"); src: url("../fonts/b.woff2") format("woff2"); }'
    );

    await expect(inlineStyles(dir, ["styles/book.css"])).rejects.toThrow(/absent\.eot/);
  });

  test("a small image inlines; nothing is copied", async () => {
    await put("images/icon.png", Buffer.alloc(16, 7));
    await put("styles/book.css", 'h1 { background-image: url("../images/icon.png"); }');

    const { css, copies } = await inlineStyles(dir, ["styles/book.css"]);
    expect(css).toContain("data:image/png;base64,");
    expect(copies).toHaveLength(0);
  });

  test("a large in-project image keeps its project-relative path (so markdown and CSS share one copy)", async () => {
    await put("art/bg.png", Buffer.alloc(IMAGE_INLINE_MAX_BYTES + 1, 3));
    await put("styles/book.css", 'h1 { background-image: url("../art/bg.png"); }');

    const { css, copies } = await inlineStyles(dir, ["styles/book.css"]);
    expect(css).toContain("art/bg.png");
    expect(css).not.toContain("base64");
    expect(copies).toEqual([
      { from: path.join(dir, "art/bg.png"), to: "art/bg.png" },
    ]);
  });

  test("a large image OUTSIDE the project is content-addressed", async () => {
    await put("shared/art/bg.png", Buffer.alloc(IMAGE_INLINE_MAX_BYTES + 1, 4));
    await put("book/styles/book.css", 'h1 { background-image: url("../../shared/art/bg.png"); }');

    const { copies } = await inlineStyles(path.join(dir, "book"), ["styles/book.css"]);
    expect(copies).toHaveLength(1);
    expect(copies[0]!.to).toMatch(/^assets\/[a-f0-9]{16}\.png$/);
  });

  test("follows local @import and preserves its position in the cascade", async () => {
    await put("styles/base.css", "body { color: red; }");
    await put("styles/book.css", '@import "base.css";\nbody { color: blue; }');

    const { css } = await inlineStyles(dir, ["styles/book.css"]);
    expect(css).toContain("red");
    expect(css.indexOf("red")).toBeLessThan(css.indexOf("blue"));
  });

  test("an @import cycle terminates instead of recursing forever", async () => {
    await put("styles/a.css", '@import "b.css";\n.a{}');
    await put("styles/b.css", '@import "a.css";\n.b{}');

    const { css } = await inlineStyles(dir, ["styles/a.css"]);
    expect(css).toContain(".a");
    expect(css).toContain(".b");
  });

  test("remote and data: urls are left untouched, and remote ones are reported", async () => {
    await put(
      "styles/book.css",
      'h1 { background: url("https://cdn.example.com/x.png"); }\n' +
        'h2 { background: url("data:image/gif;base64,AAAA"); }'
    );

    const { css, warnings } = await inlineStyles(dir, ["styles/book.css"]);
    expect(css).toContain("https://cdn.example.com/x.png");
    expect(css).toContain("data:image/gif;base64,AAAA");
    expect(warnings.join(" ")).toContain("cdn.example.com");
  });
});

describe("planImageCopies", () => {
  test("keeps the author's relative path as the output path", async () => {
    const { copies, errors } = await planImageCopies(dir, ["images/cover.png"]);
    expect(errors).toHaveLength(0);
    expect(copies).toEqual([
      { from: path.join(dir, "images/cover.png"), to: "images/cover.png" },
    ]);
  });

  test("dedupes repeated references to one file", async () => {
    const { copies } = await planImageCopies(dir, ["images/a.png", "images/a.png"]);
    expect(copies).toHaveLength(1);
  });

  test("skips remote and data: references", async () => {
    const { copies, errors } = await planImageCopies(dir, [
      "https://example.com/a.png",
      "data:image/gif;base64,AAAA",
    ]);
    expect(copies).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  test("rejects a reference that escapes the project, with actionable advice", async () => {
    const { errors } = await planImageCopies(dir, ["../outside/a.png"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("outside the project");
  });

  test("rejects an absolute reference", async () => {
    const { errors } = await planImageCopies(dir, ["/etc/passwd"]);
    expect(errors).toHaveLength(1);
  });

  test("percent-encoded names resolve to the real file on disk", async () => {
    const { copies } = await planImageCopies(dir, ["images/my%20photo.png"]);
    expect(copies[0]!.to).toBe("images/my photo.png");
  });
});

describe("decodeRef", () => {
  test("decodes valid escapes and passes through invalid ones", () => {
    expect(decodeRef("a%20b.png")).toBe("a b.png");
    expect(decodeRef("100%.png")).toBe("100%.png");
  });
});

describe("inlineStyles — @import correctness", () => {
  test("an imported sheet's urls resolve against ITS OWN directory, not the importer's", async () => {
    // Regression: imports used to be expanded BEFORE the url() walk, so the
    // parent re-resolved the child's already-rewritten path and aborted with a
    // bogus missing-asset error.
    await put("images/bg.png", Buffer.alloc(IMAGE_INLINE_MAX_BYTES + 1, 1));
    await put("styles/parts/page.css", 'body { background-image: url("../../images/bg.png"); }');
    await put("styles/book.css", '@import "parts/page.css";\nh1 { color: red; }');

    const { css, copies } = await inlineStyles(dir, ["styles/book.css"]);
    expect(copies).toEqual([{ from: path.join(dir, "images/bg.png"), to: "images/bg.png" }]);
    expect(css).toContain('url("images/bg.png")');
  });

  test("an @import's media condition is preserved, not silently dropped", async () => {
    // Otherwise screen-only rules would leak into the printed book.
    await put("styles/screen.css", "body { color: lime; }");
    await put("styles/book.css", '@import "screen.css" screen;');

    const { css } = await inlineStyles(dir, ["styles/book.css"]);
    expect(css).toMatch(/@media\s+screen/);
    expect(css).toContain("lime");
  });

  test("an @import's layer() is preserved", async () => {
    await put("styles/theme.css", "body { color: teal; }");
    await put("styles/book.css", '@import "theme.css" layer(theme);');

    const { css } = await inlineStyles(dir, ["styles/book.css"]);
    expect(css).toMatch(/@layer\s+theme/);
  });
});

describe("inlineStyles — url() parsing", () => {
  test("a quoted filename containing ) is resolved", async () => {
    await put("images/Figure (1).png", Buffer.alloc(8, 1));
    await put("styles/book.css", 'h1 { background-image: url("../images/Figure (1).png"); }');

    const { css } = await inlineStyles(dir, ["styles/book.css"]);
    expect(css).toContain("data:image/png;base64,");
  });

  test("a double-quoted filename containing an apostrophe is resolved", async () => {
    await put("images/author's-photo.png", Buffer.alloc(8, 2));
    await put("styles/book.css", `h1 { background-image: url("../images/author's-photo.png"); }`);

    const { css } = await inlineStyles(dir, ["styles/book.css"]);
    expect(css).toContain("data:image/png;base64,");
  });
});

describe("collectStyleDependencies", () => {
  test("reports the stylesheet, its @import closure, and its url() targets", async () => {
    await put("fonts/body.woff2", "font");
    await put("images/ornament.png", "png");
    await put("styles/palette.css", ":root { --accent: red }");
    await put(
      "styles/book.css",
      `@import "./palette.css";
       @font-face { font-family: B; src: url("../fonts/body.woff2") }
       .rule { background: url('../images/ornament.png') }`,
    );

    const deps = await collectStyleDependencies(dir, ["styles/book.css"]);

    expect(deps.sort()).toEqual(
      [
        path.join(dir, "styles/book.css"),
        path.join(dir, "styles/palette.css"),
        path.join(dir, "fonts/body.woff2"),
        path.join(dir, "images/ornament.png"),
      ].sort(),
    );
  });

  test("resolves each url() against its OWN stylesheet, not the project root", async () => {
    // The same trap inlineOne guards: an imported sheet's relative refs are
    // relative to the importer's directory, not the entry stylesheet's.
    await put("shared/fonts/x.woff2", "font");
    await put("shared/css/theme.css", '@font-face{src:url("../fonts/x.woff2")}');
    await put("styles/book.css", '@import "../shared/css/theme.css";');

    const deps = await collectStyleDependencies(dir, ["styles/book.css"]);

    expect(deps).toContain(path.join(dir, "shared/fonts/x.woff2"));
  });

  test("ignores remote and data: references", async () => {
    await put(
      "styles/book.css",
      `@import url("https://cdn.example.com/reset.css");
       .a { background: url(https://cdn.example.com/bg.png) }
       .b { background: url(data:image/png;base64,AAAA) }`,
    );

    expect(await collectStyleDependencies(dir, ["styles/book.css"])).toEqual([
      path.join(dir, "styles/book.css"),
    ]);
  });

  test("survives a missing, unreadable, or unparseable stylesheet", async () => {
    await put("styles/broken.css", "body { color: ");
    // Never throws — a watcher that throws stops watching everything.
    expect(await collectStyleDependencies(dir, ["styles/missing.css"])).toEqual([
      path.join(dir, "styles/missing.css"),
    ]);
    expect(await collectStyleDependencies(dir, ["styles/broken.css"])).toEqual([
      path.join(dir, "styles/broken.css"),
    ]);
  });

  test("terminates on a self-importing stylesheet", async () => {
    await put("styles/loop.css", '@import "./loop.css";');
    expect(await collectStyleDependencies(dir, ["styles/loop.css"])).toEqual([
      path.join(dir, "styles/loop.css"),
    ]);
  });

  test("records a reference whose target does not exist", async () => {
    // The path is still worth watching: creating the file is the fix, and the
    // watcher should notice when it appears.
    await put("styles/book.css", '@font-face{src:url("../fonts/absent.woff2")}');
    const deps = await collectStyleDependencies(dir, ["styles/book.css"]);
    expect(deps).toContain(path.join(dir, "fonts/absent.woff2"));
  });
});

// ── 2026-07-29 audit: a bare startsWith("..") over-rejects ───────────────────
//
// The escape test was `path.relative(projectDir, abs).startsWith("..")`, which
// also matches a legitimate project-root file whose NAME begins with two dots
// (`..cover.png` — unusual, but a valid filename on every platform this ships
// on). The rejection told the author to "copy the file into your project
// folder" for a file already sitting in it.

test("planImageCopies accepts a root file whose name starts with two dots", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-dotdot-name-"));
  try {
    await writeFile(path.join(dir, "..cover.png"), "fake");
    const { copies, errors } = await planImageCopies(dir, ["..cover.png"]);
    expect(errors).toEqual([]);
    expect(copies.map((c) => c.to)).toEqual(["..cover.png"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("planImageCopies still rejects a real parent-directory escape", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "gutterpress-dotdot-escape-"));
  try {
    const book = path.join(base, "book");
    await mkdir(book, { recursive: true });
    await writeFile(path.join(base, "outside.png"), "fake");
    const { copies, errors } = await planImageCopies(book, ["../outside.png"]);
    expect(copies).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("outside the project");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
