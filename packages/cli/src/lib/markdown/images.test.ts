import { test, expect } from "bun:test";
import MarkdownIt from "markdown-it";
import { registerImageRule, collectHtmlImageRefs, type ImageRefEnv } from "./images";
import { createMarkdownRenderer } from "./renderer";

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

// --gp-shape mirroring (shape-outside cannot read the element's own src from
// CSS — url() contexts reject attr() — so the rule mirrors it). These go
// through createMarkdownRenderer because the class only exists after
// markdown-it-attrs runs.
test("a .gp-shape image gets its src mirrored into an inline --gp-shape url", () => {
  const md = createMarkdownRenderer();
  const html = md.render("![b](beast.png){.gp-right .gp-shape}");
  expect(html).toContain('class="gp-right gp-shape"');
  expect(html).toContain('style="--gp-shape:url(&quot;beast.png&quot;)"');
});

test("images without .gp-shape get no style attribute", () => {
  const md = createMarkdownRenderer();
  const html = md.render("![b](beast.png){.gp-right .gp-small}");
  expect(html).toContain('<img src="beast.png" alt="b"');
  expect(html).toContain('class="gp-right gp-small"');
  expect(html).not.toContain("--gp-shape");
});

test("escaped punctuation and entities survive in rendered image alt text", () => {
  const html = createMarkdownRenderer().render("![A \\] \\[ &amp; \\` safe and `code`](x.png)");
  expect(html).toContain('alt="A ] [ &amp; ` safe and code"');
});

test("an author-supplied style attribute survives, after ours, so the author wins", () => {
  const md = createMarkdownRenderer();
  const html = md.render('![b](x.png){.gp-shape style="border:1px"}');
  expect(html).toContain('style="--gp-shape:url(&quot;x.png&quot;); border:1px"');
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

test("collectHtmlImageRefs preserves data and local URL commas in srcset", () => {
  const refs = collectHtmlImageRefs(
    `<source srcset="data:image/svg+xml,%3Csvg%3E%3C/svg%3E 1x, images/actual,comma.png 2x, ordinary.png 3x">`,
  );
  expect(refs).toEqual([
    "data:image/svg+xml,%3Csvg%3E%3C/svg%3E",
    "images/actual,comma.png",
    "ordinary.png",
  ]);
});

test("collectHtmlImageRefs separates descriptor-less candidates without splitting internal commas", () => {
  expect(
    collectHtmlImageRefs(
      `<source srcset="images/a,b.png, images/plain.png, data:image/png;base64,AAAA,">`,
    ),
  ).toEqual(["images/a,b.png", "images/plain.png", "data:image/png;base64,AAAA"]);
});

test("collectHtmlImageRefs handles <source srcset> inside <picture>", () => {
  const refs = collectHtmlImageRefs(
    `<picture><source srcset="wide.avif 1200w, narrow.avif 400w"><img src="fallback.png"></picture>`
  );
  expect(refs).toEqual(["fallback.png", "wide.avif", "narrow.avif"]);
});

test("collectHtmlImageRefs collects an unquoted single-URL srcset", () => {
  expect(
    collectHtmlImageRefs(`<picture><source srcset=missing.jpg><img src=fallback.png></picture>`),
  ).toEqual(["fallback.png", "missing.jpg"]);
});

test("collectHtmlImageRefs does not confuse data-src with src in either order", () => {
  expect(
    collectHtmlImageRefs(
      `<img data-src="lazy-before.jpg" src="real-before.jpg">
       <img src="real-after.jpg" data-src="lazy-after.jpg">
       <img data-src="lazy-only.jpg">`,
    ),
  ).toEqual(["real-before.jpg", "real-after.jpg"]);
});

test("collectHtmlImageRefs does not confuse data-srcset with srcset in either order", () => {
  expect(
    collectHtmlImageRefs(
      `<source data-srcset="lazy-before.jpg 1x" srcset="real-a.jpg 1x, real-b.jpg 2x">
       <img srcset="real-c.jpg 1x, real-d.jpg 2x" data-srcset="lazy-after.jpg 1x">
       <img data-srcset="lazy-only.jpg 1x">`,
    ),
  ).toEqual(["real-a.jpg", "real-b.jpg", "real-c.jpg", "real-d.jpg"]);
});

test("collectHtmlImageRefs ignores tag-looking literals and comments", () => {
  const refs = collectHtmlImageRefs(
    `<style>.demo::before { content: '<img src="style.jpg">' }</style>
     <script>const example = '<img src="script.jpg">';</script>
     <pre><img src="pre.jpg"></pre><code><img src="code.jpg"></code>
     <textarea><img src="textarea.jpg"></textarea>
     <!-- <picture><source srcset="comment-a.jpg 1x"><img src="comment-b.jpg"></picture> -->
     <picture><source srcset="real-wide.jpg 2x"><img src="real.jpg"></picture>`,
  );
  expect(refs).toEqual(["real.jpg", "real-wide.jpg"]);
});
