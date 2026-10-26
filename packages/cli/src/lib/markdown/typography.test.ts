import { describe, expect, test } from "bun:test";
import { createMarkdownRenderer } from "./renderer";

/** Rendered HTML without the source-map attributes every block carries. */
const render = (src: string) =>
  createMarkdownRenderer().render(src, {}).replace(/ data-source-[a-z]+="[^"]*"/g, "");

describe("typography from plain typing", () => {
  test("the three sequences the character check names", () => {
    expect(render("pp. 307--357, wait---really, and so on...\n")).toBe(
      "<p>pp. 307–357, wait—really, and so on…</p>\n",
    );
  });

  test("straight quotes still print curly", () => {
    expect(render('She said "it\'s fine".\n')).toBe("<p>She said “it’s fine”.</p>\n");
  });

  test("nothing else is rewritten", () => {
    const src = "items (a), (b) and (c); (r), (tm), +-, a..b, what??!!, one,, two\n";
    expect(render(src)).toBe(`<p>${src.trimEnd()}</p>\n`);
  });

  test("code spans, fenced code and autolinks are left alone", () => {
    expect(render("`a--b` and `c...`\n")).toBe("<p><code>a--b</code> and <code>c...</code></p>\n");
    expect(render("```\nx--y\n```\n")).toBe("<pre><code>x--y\n</code></pre>\n");
    expect(render("<https://example.org/a--b/...>\n")).toContain('href="https://example.org/a--b/..."');
    expect(render("<https://example.org/a--b/...>\n")).toContain(">https://example.org/a--b/...</a>");
  });

  test("four dots print an ellipsis and a full stop", () => {
    expect(render("and then....\n")).toBe("<p>and then….</p>\n");
  });
});

describe("quotation marks follow the book's language", () => {
  const renderIn = (language: string | undefined, src: string) =>
    createMarkdownRenderer(undefined, { language }).render(src, {}).replace(/ data-source-[a-z]+="[^"]*"/g, "");

  test("English by default, and for a language not listed", () => {
    expect(renderIn(undefined, '"Hi," she said.\n')).toBe("<p>“Hi,” she said.</p>\n");
    expect(renderIn("xx", '"Hi"\n')).toBe("<p>“Hi”</p>\n");
  });

  test("German, Swiss German, French (with its spaces) and Brazilian Portuguese", () => {
    expect(renderIn("de", '"Hallo", sagte sie.\n')).toBe("<p>„Hallo“, sagte sie.</p>\n");
    expect(renderIn("de-CH", '"Hallo"\n')).toBe("<p>«Hallo»</p>\n");
    expect(renderIn("fr", '"Bonjour"\n')).toBe("<p>« Bonjour »</p>\n");
    expect(renderIn("pt-BR", '"Olá"\n')).toBe("<p>“Olá”</p>\n");
    expect(renderIn("pt", '"Olá"\n')).toBe("<p>«Olá»</p>\n");
  });
});
