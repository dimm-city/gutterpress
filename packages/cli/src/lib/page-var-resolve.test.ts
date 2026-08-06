import { describe, expect, test } from "bun:test";
import { resolvePageVarsInCss, resolvePageVarsInHtml } from "./page-var-resolve";

describe("resolvePageVarsInCss — var() inside @page becomes a literal for Paged.js", () => {
  test("substitutes a :root token into an @page longhand margin", () => {
    const out = resolvePageVarsInCss(
      `:root { --binding-margin: 1in; }
@page :left { margin-right: var(--binding-margin, 0.75in); }`,
    );
    expect(out).toContain("margin-right: 1in");
    expect(out).not.toContain("margin-right: var(");
  });

  test("uses the fallback when the token is not defined", () => {
    const out = resolvePageVarsInCss(
      `@page :right { margin-left: var(--binding-margin, 0.75in); }`,
    );
    expect(out).toContain("margin-left: 0.75in");
  });

  test("resolves a nested var() fallback", () => {
    const out = resolvePageVarsInCss(
      `:root { --outer: 0.5in; }
@page { margin: var(--missing, var(--outer)); }`,
    );
    expect(out).toContain("margin: 0.5in");
  });

  test("resolves inside nested margin-box at-rules", () => {
    const out = resolvePageVarsInCss(
      `:root { --folio-size: 9pt; }
@page { @bottom-center { font-size: var(--folio-size); content: counter(page); } }`,
    );
    expect(out).toContain("font-size: 9pt");
  });

  test("a var with no token and no fallback is left exactly as written", () => {
    const css = `@page { margin-top: var(--nope); }`;
    expect(resolvePageVarsInCss(css)).toBe(css);
  });

  test("rules OUTSIDE @page are never rewritten", () => {
    const css = `:root { --w: 3in; }
.card { width: var(--w); }
@page { margin: var(--w); }`;
    const out = resolvePageVarsInCss(css);
    expect(out).toContain("width: var(--w)");
    expect(out).toContain("margin: 3in");
  });

  test("a token defined on an arbitrary selector is not used (static resolution only)", () => {
    const css = `.page-x { --binding-margin: 2in; }
@page { margin-left: var(--binding-margin); }`;
    expect(resolvePageVarsInCss(css)).toBe(css);
  });
});

describe("resolvePageVarsInHtml — every <style> block", () => {
  test("rewrites @page vars using tokens from a DIFFERENT style block", () => {
    const html = `<html><head><style>:root { --m: 1in; }</style>
<style>@page :left { margin-right: var(--m); }</style></head><body><p>var(--m) @page</p></body></html>`;
    const out = resolvePageVarsInHtml(html);
    expect(out).toContain("margin-right: 1in");
    // body text mentioning var()/@page is not CSS and must be untouched
    expect(out).toContain("<p>var(--m) @page</p>");
  });

  test("a token in the SAME block wins over one from another block", () => {
    const html = `<style>:root { --m: 2in; }</style><style>:root { --m: 1in; }
@page { margin: var(--m); }</style>`;
    expect(resolvePageVarsInHtml(html)).toContain("margin: 1in");
  });
});
