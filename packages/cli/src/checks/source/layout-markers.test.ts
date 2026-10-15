/**
 * The layout-marker check is the ONLY path by which `env.layoutWarnings`
 * reaches the desktop Problems panel: the panel is filled by
 * `executeValidation({ category: "source", phase: "pre-build" })` via
 * `/api/lint/project`, and before this check every marker warning died in a
 * build-log line the desktop user never saw.
 */
import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCheckById } from "../registry";
import { makeCtx } from "../../test-helpers/testkit";

import "./layout-markers";

async function runOn(markdown: string) {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-markers-check-"));
  try {
    const mdFile = join(dir, "ch1.md");
    await writeFile(mdFile, markdown);
    const check = getCheckById("source.markdown.layout-markers")!;
    return await check.run(makeCtx({ inputDir: dir, markdownFiles: [mdFile] }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("source.markdown.layout-markers", () => {
  test("reports marker mistakes as line-numbered warnings the panel can render", async () => {
    const results = await runOn(
      "@page\n\ntext\n\n@page My Cover Page\n\ntext\n\n@secton .gp-columns-2\n\ntext\n"
    );

    expect(results.map((r) => r.code).sort()).toEqual([
      "extra_bare_marker_token",
      "unknown_marker",
    ]);
    for (const r of results) {
      expect(r.checkId).toBe("source.markdown.layout-markers");
      // Warnings only — a marker mistake renders SOMETHING, so it must never
      // set ok=false and abort a build (runner.ts keys ok off `error`).
      expect(r.severity).toBe("warning");
      expect(r.file).toContain("ch1.md");
      expect(r.line).toBeGreaterThan(0);
    }
    expect(results.find((r) => r.code === "extra_bare_marker_token")!.line).toBe(5);
    expect(results.find((r) => r.code === "unknown_marker")!.line).toBe(9);
  });

  test("a pinned image with .gp-flush is a warning on its line: the escape hatch, said out loud", async () => {
    const results = await runOn("@page\n\ntext\n\n![Wall](wall.png){.gp-pin .gp-bottom .gp-flush}\n");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ code: "flush_art", severity: "warning", line: 5 });
    expect(results[0]!.message).toContain("past the printer's safe area");
  });

  test("a document with well-formed markers produces no findings", async () => {
    expect(await runOn("@page cover .gp-left #id\n\ntext\n\n@section {.gp-columns-2}\n\ntext\n")).toEqual([]);
  });

  describe("classes no stylesheet mentions (unknown_class)", () => {
    /** Run the check over `markdown` in a project that has `css` as its one stylesheet. */
    async function runWithCss(markdown: string, css: Record<string, string>, imports = false) {
      const dir = await mkdtemp(join(tmpdir(), "gutterpress-markers-check-"));
      try {
        const mdFile = join(dir, "ch1.md");
        await writeFile(mdFile, markdown);
        const cssFiles: string[] = [];
        for (const [name, text] of Object.entries(css)) {
          await writeFile(join(dir, name), text);
          if (!imports || cssFiles.length === 0) cssFiles.push(join(dir, name));
        }
        const check = getCheckById("source.markdown.layout-markers")!;
        return await check.run(makeCtx({ inputDir: dir, markdownFiles: [mdFile], cssFiles }));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    const unknown = (rs: Awaited<ReturnType<typeof runOn>>) => rs.filter((r) => r.code === "unknown_class");

    test("a class on a paragraph, an image or a marker line that no selector names is a warning with a suggestion", async () => {
      const rs = await runWithCss(
        "@section .pannel\n\nText {.hilite}\n\n![x](a.png){.fig-lft}\n",
        { "book.css": ".panel { color: red } .hilite { color: blue } .fig-left { float: left }" }
      );
      expect(unknown(rs).map((r) => [r.line, r.severity, r.message])).toEqual([
        [1, "warning", expect.stringContaining('Did you mean ".panel"?')],
        [5, "warning", expect.stringContaining('Did you mean ".fig-left"?')],
      ]);
    });

    test("classes core, a book stylesheet (also via @import), or a selector list/pseudo/nesting names are known", async () => {
      const rs = await runWithCss(
        "@section .a .b .c .d .gp-left\n\n![x](a.png){.e}\n\nText {.f}\n",
        {
          "book.css": '@import "more.css"; :is(.a, .b):hover { color: red } .c > .d::before { content: ".zzz" } @media print { .f { x: y } }',
          "more.css": "img.e { float: left }",
        },
        true
      );
      expect(unknown(rs)).toEqual([]);
    });

    test("a class in an attribute selector or string is not a class; the same typo twice is one finding", async () => {
      const rs = await runWithCss("Text {.pdf}\n\nMore {.pdf}\n", { "book.css": 'a[href$=".pdf"] { color: red }' });
      expect(unknown(rs)).toHaveLength(1);
      expect(unknown(rs)[0]!.message).toContain("Used 2 times");
    });

    test("gp-* classes are left to the unknown_gp_class check, and a pipeline-emitted class needs no CSS", async () => {
      const rs = await runWithCss("@page\n\n@chapter 1 .chapter-1\n\nText[^1]\n\n[^1]: Note.\n", { "book.css": "" });
      expect(unknown(rs)).toEqual([]);
    });

    test("a marker line that already has a warning is not also reported for the classes its stray words became", async () => {
      const rs = await runOn("@page My Cover Page\n\ntext\n");
      expect(rs.map((r) => r.code)).toEqual(["extra_bare_marker_token"]);
    });
  });

  test("a plugin component's validate() results become findings, keeping its line and severity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gutterpress-markers-check-"));
    try {
      await writeFile(
        join(dir, "plugin.js"),
        [
          "export default function () {}",
          "export const markers = {",
          "  box: {",
          "    validate(box) {",
          "      const problems = [];",
          "      if (!box.attrs.label) problems.push('Add a label.');",
          "      const h = box.blocks.find((b) => b.type === 'heading');",
          "      if (h) problems.push({ message: 'No headings.', line: h.line, severity: 'error' });",
          "      return problems;",
          "    },",
          "  },",
          "};",
        ].join("\n")
      );
      const mdFile = join(dir, "ch1.md");
      await writeFile(mdFile, "Intro\n\n@box\n## Title\n\nBody\n@end-box\n");
      const base = makeCtx();
      const check = getCheckById("source.markdown.layout-markers")!;
      const results = await check.run(
        makeCtx({
          inputDir: dir,
          markdownFiles: [mdFile],
          config: { ...base.config, extensions: [{ use: "./plugin.js", path: "./plugin.js", options: {} }] },
        })
      );
      expect(results.map((r) => [r.code, r.severity, r.line, r.message])).toEqual([
        ["component_invalid", "warning", 3, "@box: Add a label."],
        ["component_invalid", "error", 4, "@box: No headings."],
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("no markdown files: no findings, no crash", async () => {
    const check = getCheckById("source.markdown.layout-markers")!;
    expect(await check.run(makeCtx({ inputDir: tmpdir(), markdownFiles: [] }))).toEqual([]);
  });
});
