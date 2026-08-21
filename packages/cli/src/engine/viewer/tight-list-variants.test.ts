import { expect, test } from "bun:test";
import { nextEditorSheet, tightListVariantSelector, withTightListVariants } from "./live-document";

/**
 * The editing DOM has ONE element the printed page does not: ProseMirror's
 * `list_item` always holds a paragraph, where markdown-it prints a tight
 * item's text straight inside the `li`. Rules that land ON that paragraph are
 * handled in `paginationCss` (it steps out of the cascade); these tests cover
 * the other half — rules that reach THROUGH it, which get a copy naming the
 * paragraph where the DOM actually has it.
 *
 * The properties that matter are the safety ones: the author's own CSS is
 * copied, never rewritten; a stylesheet with nothing to copy comes back
 * byte-identical; the copy sits immediately after its original so the cascade
 * order the author wrote still decides ties; and anything the reader cannot
 * be certain about is passed through untouched.
 */

test("a rule reaching through a list item gets a copy that names the paragraph", () => {
  // The field guide's contents page, which is where this was measured.
  const css = ".dc-toc ol>li>a { font-size: 20px; font-weight: 700; }";
  const out = withTightListVariants(css);
  expect(out).toContain(css); // the original, untouched
  expect(out).toContain(".dc-toc ol>li > :where([data-tight] > li > p) >a {");
  expect(out).toContain("font-size: 20px");
});

test("the copy is inserted immediately after its original", () => {
  // Cascade order decides ties between equal-specificity rules, so a copy
  // parked at the end of the sheet would start winning arguments its
  // original loses.
  const css = "li>a { color: red; }\n.x li a { color: blue; }\n";
  const out = withTightListVariants(css);
  expect(out.indexOf(":where([data-tight]")).toBeLessThan(out.indexOf(".x li a"));
});

test("a stylesheet with nothing to copy is returned byte-identical", () => {
  const css = [
    "@media print { .a { color: red } }",
    "@page { size: A4; margin: 1in }",
    "@font-face { font-family: X; src: url('x.woff2') }",
    ".card li p { margin: 0 }",
    "/* a comment with li > a inside it */",
    'a[title="li > a"] { color: red }',
    ".deep { --x: 'li > a' }",
  ].join("\n");
  expect(withTightListVariants(css)).toBe(css);
});

test("a copy inside a grouping at-rule stays inside it", () => {
  const out = withTightListVariants("@media screen { .t ol>li>a { color: red } }");
  const inner = out.slice(out.indexOf("{") + 1, out.lastIndexOf("}"));
  expect(inner).toContain(":where([data-tight] > li > p)");
});

test("selectors the reader cannot be certain about are left alone", () => {
  // Parentheses and brackets can carry the very characters the rewrite reads.
  expect(tightListVariantSelector(":not(li > a) span")).toBeNull();
  expect(tightListVariantSelector('li[data-x="a>b"] > a')).toBeNull();
  // …and a class that merely ENDS in "li" is not the element.
  expect(tightListVariantSelector(".foo-li > a")).toBeNull();
  expect(tightListVariantSelector(".list-item > a")).toBeNull();
});

test("the copy carries the same specificity as the rule it came from", () => {
  // `:where()` contributes nothing, so the copy cannot start outranking
  // rules the original loses to. Counted as (ids, classes, types).
  const variant = tightListVariantSelector(".dc-toc ol>li>a")!;
  const types = (variant.match(/(^|[\s>+~])(ol|li|a|p)\b/g) ?? []).length;
  const outside = variant.slice(0, variant.indexOf(":where("));
  const inside = variant.slice(variant.indexOf(":where("));
  expect(outside.match(/(^|[\s>+~])(ol|li|a)\b/g)).toHaveLength(2); // ol, li
  expect(inside).toContain(":where([data-tight] > li > p) >a");
  expect(types).toBeGreaterThan(0);
  expect(variant.match(/\.dc-toc/g)).toHaveLength(1); // one class, as before
});

test("only the selectors that need it are copied", () => {
  // `.a > b` already matches in the editor; repeating it in the copy would
  // double a rule for no reason.
  const variant = tightListVariantSelector(".a > b, .t li>a")!;
  expect(variant).toBe(".t li > :where([data-tight] > li > p) >a");
});

test("multiple list levels in one selector each get the paragraph", () => {
  const variant = tightListVariantSelector("li>ul>li>a")!;
  expect(variant.match(/:where\(\[data-tight\] > li > p\)/g)).toHaveLength(2);
});

test("the editor sheet ships the copies with the book's own CSS", () => {
  const sheet = nextEditorSheet(null, "@page { size: 6in 9in } .t ol>li>a { color: red }", 1, 800);
  expect(sheet).not.toBeNull();
  expect(sheet!.text).toContain(":where([data-tight] > li > p)");
  // …and the paragraph itself is out of the cascade.
  expect(sheet!.text).toContain(":where([data-tight] > li) > p { all: unset !important;");
});
