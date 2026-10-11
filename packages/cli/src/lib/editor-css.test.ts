import { describe, expect, test } from "bun:test";
import { composeEditorCss, scopeCssToEditor } from "./editor-css.ts";

const SCOPE = ".md-document";

/**
 * The composed editor sheet has to hand the book's document the same colour
 * context the printed page starts from. Without it the document inherits the
 * app chrome's text colour, which is near-white under a dark app theme, and
 * every run of book text the author did not colour explicitly (table cells,
 * list items, plain paragraphs) renders pale on the page's light paper.
 */
describe("the page's colour context", () => {
  test("the composed sheet opens with the page's own colour context, inside the scope", () => {
    const css = composeEditorCss({ scopeSelector: SCOPE });
    expect(css).toContain(`@scope (${SCOPE})`);
    const scopeAt = css.indexOf("@scope");
    const contextAt = css.indexOf("color-scheme: light");
    const markersAt = css.indexOf("gutterpress markers");
    expect(contextAt).toBeGreaterThan(scopeAt);
    expect(markersAt).toBeGreaterThan(contextAt);
    // One rule: the scheme and the ink the page starts from, on the scope root.
    expect(css.slice(scopeAt, markersAt)).toContain(":scope {");
    expect(css.slice(scopeAt, markersAt)).toContain("color: canvastext");
  });

  test("an author's own document colour still wins: it comes later at equal specificity", () => {
    const css = composeEditorCss({
      scopeSelector: SCOPE,
      projectCss: "body { color: #1a1512; }",
    });
    const contextAt = css.indexOf("color-scheme: light");
    const authorAt = css.indexOf("#1a1512");
    expect(contextAt).toBeGreaterThan(-1);
    expect(authorAt).toBeGreaterThan(contextAt);
    // The author's `body` rule is rewritten to the same `:scope` this context
    // uses, so "later in the sheet" is what decides it.
    expect(css.slice(authorAt - 60, authorAt)).toContain(":scope");
  });

  test("scopeCssToEditor stays a pure transform: it adds no colour of its own", () => {
    const css = scopeCssToEditor("p { margin: 0; }", SCOPE);
    expect(css).not.toContain("color-scheme");
    expect(css).not.toContain("canvastext");
  });
});

/**
 * The editor's cascade is the page's (extensions cascade contract, #296):
 * core sits in `gp.marker` / `gp.vocab`, each extension in its own layer,
 * the author's stylesheets unlayered on top. Layer BLOCKS must stay inside
 * the scope - hoisted, their rules would land on the app chrome - while the
 * `@layer` order STATEMENT is hoisted so first declaration fixes the order.
 */
describe("cascade layers", () => {
  test("core is layered like the page and the order statement is hoisted above the scope", () => {
    const css = composeEditorCss({ scopeSelector: SCOPE });
    const scopeAt = css.indexOf("@scope");
    expect(css.indexOf("@layer gp.marker, gp.vocab;")).toBeLessThan(scopeAt);
    expect(css.indexOf("@layer gp.marker {")).toBeGreaterThan(scopeAt);
    expect(css.indexOf("@layer gp.vocab {")).toBeGreaterThan(css.indexOf("@layer gp.marker {"));
  });

  test("an extension's layer block stays inside the scope, after core and before the author's CSS", () => {
    const css = composeEditorCss({
      scopeSelector: SCOPE,
      pluginCss: "@layer ext.alpha;\n\n/* alpha */\n@layer ext.alpha {\np { color: red; }\n}",
      projectCss: "p { color: blue; }",
    });
    const scopeAt = css.indexOf("@scope");
    expect(css.indexOf("@layer ext.alpha;")).toBeLessThan(scopeAt);
    const alphaAt = css.indexOf("@layer ext.alpha {");
    expect(alphaAt).toBeGreaterThan(css.indexOf("@layer gp.vocab {"));
    expect(css.indexOf("color: blue")).toBeGreaterThan(alphaAt);
    // Nothing of the extension escaped the scope.
    expect(css.slice(0, scopeAt)).not.toContain("color: red");
  });

  test("rules inside an extension's layer still get the document-root rewrite", () => {
    const css = scopeCssToEditor("@layer ext.alpha {\nbody { font-size: 11pt; }\n}", SCOPE);
    expect(css).toContain(":scope");
    expect(css).not.toContain("body {");
  });
});
