import { describe, expect, test } from "bun:test";
import { createMarkdownRenderer } from "./renderer";

/** Rendered HTML without the source-map attributes every block carries. */
const render = (src: string) =>
  createMarkdownRenderer().render(src, {}).replace(/ data-source-[a-z]+="[^"]*"/g, "");

describe("typography from plain typing", () => {
  test("the dashes and the ellipsis the character check names", () => {
    expect(render("pp. 307--357, wait---really, and so on...\n")).toBe(
      "<p>pp. 307–357, wait—really, and so on…</p>\n",
    );
  });

  test("straight quotes still print curly", () => {
    expect(render('She said "it\'s fine".\n')).toBe("<p>She said “it’s fine”.</p>\n");
  });

  test("the symbols and collapses 0.11.22 printed are back (#483)", () => {
    expect(render("Copyright (c) 2026 (C) (tm) (TM) (r) (R), 10 +- 2, a..b, what?.... wow!!!!! huh????? one,, two\n")).toBe(
      "<p>Copyright © 2026 © ™ ™ ® ®, 10 ± 2, a…b, what?.. wow!!! huh??? one, two</p>\n",
    );
    // A backslash keeps a sequence as typed, as it did.
    expect(render("\\(c) stays\n")).toBe("<p>(c) stays</p>\n");
  });

  test("a list labelled (a), (b), (c) keeps its labels (#426)", () => {
    // In one sentence, …
    expect(render("You may (a) run, (b) hide, or (c) fight.\n")).toBe(
      "<p>You may (a) run, (b) hide, or (c) fight.</p>\n",
    );
    // … one paragraph or item each, …
    expect(render("(a) First.\n\n(b) Second.\n\n(c) Third.\n")).toBe(
      "<p>(a) First.</p>\n<p>(b) Second.</p>\n<p>(c) Third.</p>\n",
    );
    // … and in capitals; a copyright after a lower-case list is still ©.
    expect(render("- (A) one\n- (B) two\n- (C) three\n\nCopyright (c) 2026\n")).toBe(
      "<ul>\n<li>(A) one</li>\n<li>(B) two</li>\n<li>(C) three</li>\n</ul>\n<p>Copyright © 2026</p>\n",
    );
    // (r) after (q) likewise; a (c) before any (b) is a copyright.
    expect(render("(p) x (q) y (r) z, and (c) 2026\n")).toBe("<p>(p) x (q) y (r) z, and © 2026</p>\n");
  });

  test("code spans, fenced code and autolinks are left alone", () => {
    expect(render("`a--b` and `c...` and `(c)`\n")).toBe(
      "<p><code>a--b</code> and <code>c...</code> and <code>(c)</code></p>\n",
    );
    expect(render("<https://example.org/(c)/a..b>\n")).toContain(">https://example.org/(c)/a..b</a>");
    expect(render("```\nx--y\n```\n")).toBe("<pre><code>x--y\n</code></pre>\n");
    expect(render("<https://example.org/a--b/...>\n")).toContain('href="https://example.org/a--b/..."');
    expect(render("<https://example.org/a--b/...>\n")).toContain(">https://example.org/a--b/...</a>");
  });

  test("a run of dots prints one ellipsis, as markdown-it always made it", () => {
    expect(render("and then....\n")).toBe("<p>and then…</p>\n");
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
