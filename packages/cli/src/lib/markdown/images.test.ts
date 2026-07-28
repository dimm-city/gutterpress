import { test, expect } from "bun:test";
import MarkdownIt from "markdown-it";
import { registerImageRule, collectHtmlImageRefs, type ImageRefEnv } from "./images";

/** Render `src` through a markdown-it with the rule installed, returning the env. */
function renderWith(markdown: string): { html: string; env: ImageRefEnv } {
  const md = new MarkdownIt({ html: true });
  registerImageRule(md);
  const env: ImageRefEnv = {};
  const html = md.render(markdown, env);
  return { html, env };
}

test("records every markdown image reference verbatim", () => {
  const { env } = renderWith("![a](images/a.png)\n\n![b](art/deep/b.jpg)");
  expect(env.imageRefs).toEqual(["images/a.png", "art/deep/b.jpg"]);
});

test("emits the src UNCHANGED — no path rewriting", () => {
  // The old normalizeImageSrc collapsed `temp/images/x` and `./images/x` to
  // `images/x`. That rewrite had no producer anywhere in the codebase and
  // silently broke any author with a real `temp/images/` folder, because
  // nothing ever created the `images/` path it invented.
  const { html, env } = renderWith("![a](temp/images/a.png)");
  expect(html).toContain('src="temp/images/a.png"');
  expect(env.imageRefs).toEqual(["temp/images/a.png"]);
});

test("a folder the author actually uses survives untouched", () => {
  const { env } = renderWith("![a](./images/a.png)\n\n![b](assets/b.png)");
  expect(env.imageRefs).toEqual(["./images/a.png", "assets/b.png"]);
});

test("records remote and data: references too (the build filters them, not the rule)", () => {
  const { env } = renderWith("![a](https://example.com/a.png)");
  expect(env.imageRefs).toEqual(["https://example.com/a.png"]);
});

test("no images means no env pollution", () => {
  const { env } = renderWith("# just a heading");
  expect(env.imageRefs).toBeUndefined();
});

test("collectHtmlImageRefs finds raw HTML <img> the markdown rule never sees", () => {
  // Raw HTML and plugin-emitted markup bypass the markdown image token, so
  // scanning the assembled body is what keeps "referenced means shipped" true
  // for every image rather than only the markdown-authored ones.
  const refs = collectHtmlImageRefs(
    `<img src="a.png"><img src='b.png'><img class="x" src=c.png >`
  );
  expect(refs).toEqual(["a.png", "b.png", "c.png"]);
});

test("collectHtmlImageRefs tolerates attributes before src and self-closing tags", () => {
  const refs = collectHtmlImageRefs(`<img alt="hi" data-x="1" src="deep/dir/x.webp" />`);
  expect(refs).toEqual(["deep/dir/x.webp"]);
});

test("collectHtmlImageRefs returns nothing for markup with no images", () => {
  expect(collectHtmlImageRefs("<p>text</p>")).toEqual([]);
});

test("collectHtmlImageRefs collects every srcset candidate, not just src", () => {
  // A candidate missing from the copy plan 404s during pagination and vanishes
  // from the PDF with no error, because only planned files reach the output.
  const refs = collectHtmlImageRefs(
    `<img src="a.png" srcset="a-1x.png 1x, a-2x.png 2x">`
  );
  expect(refs).toEqual(["a.png", "a-1x.png", "a-2x.png"]);
});

test("collectHtmlImageRefs handles <source srcset> inside <picture>", () => {
  const refs = collectHtmlImageRefs(
    `<picture><source srcset="wide.avif 1200w, narrow.avif 400w"><img src="fallback.png"></picture>`
  );
  expect(refs).toEqual(["fallback.png", "wide.avif", "narrow.avif"]);
});
