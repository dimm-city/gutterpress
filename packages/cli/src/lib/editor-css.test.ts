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
