/**
 * Acceptance tests for the `source_chapter` core rule (source-chapter.ts).
 *
 * The rule stamps `data-chapter-src` onto every block-level token so the
 * preview frame can tell which source file an on-page block came from —
 * scroll sync, the chapter-jump outline, and click-to-source all key off it.
 *
 * It used to also emit `data-source-range`, the addressing primitive of the
 * pre-galley editing surface. The galley editor addresses nodes by
 * ProseMirror position instead, so nothing read those ranges; the attribute
 * and its ~400 lines of tests went with the surface they served. What is
 * pinned here is the half of the contract that still has consumers.
 */
import { describe, test, expect } from "bun:test";
import { createMarkdownRenderer } from "./renderer.ts";
import { SOURCE_CHAPTER_ATTR } from "./source-chapter.ts";

const md = createMarkdownRenderer();
const render = (src: string, chapter?: string) =>
  md.render(src, chapter ? { sourceChapter: chapter } : {});

describe("source_chapter", () => {
  test("stamps every block with the chapter it came from", () => {
    const html = render("# Title\n\nA paragraph.\n\n- one\n- two\n", "ch1.md");
    for (const tag of ["<h1", "<p", "<ul", "<li"]) {
      expect(html).toContain(`${tag} ${SOURCE_CHAPTER_ATTR}="ch1.md"`);
    }
  });

  test("self-closing blocks are stamped too", () => {
    const html = render("before\n\n---\n\n```js\nconst x = 1;\n```\n", "ch1.md");
    expect(html).toContain(`<hr ${SOURCE_CHAPTER_ATTR}="ch1.md"`);
    // markdown-it puts fence attrs on the inner <code>.
    expect(html).toContain(`${SOURCE_CHAPTER_ATTR}="ch1.md"`);
  });

  test("marker wrappers and breaks carry it (their renderers bypass renderToken)", () => {
    const html = render("@section\n\ntext\n\n@page-break\n\n@end-section\n", "ch1.md");
    expect(html).toContain(`class="section" ${SOURCE_CHAPTER_ATTR}="ch1.md"`);
    expect(html).toMatch(/class="gp-page-break"[^>]*data-chapter-src="ch1\.md"/);
  });

  test("no chapter in env: nothing is stamped", () => {
    const html = render("A paragraph.\n");
    expect(html).not.toContain(SOURCE_CHAPTER_ATTR);
  });

  test("idempotent across renders on a shared instance (attrSet, not attrPush)", () => {
    const src = "A paragraph.\n";
    render(src, "ch1.md");
    const second = render(src, "ch1.md");
    expect(second.match(new RegExp(SOURCE_CHAPTER_ATTR, "g"))).toHaveLength(1);
  });

  test("the retired range attribute is gone from rendered output", () => {
    const html = render("# Title\n\ntext\n\n@page-break\n", "ch1.md");
    expect(html).not.toContain("data-source-range");
  });
});
