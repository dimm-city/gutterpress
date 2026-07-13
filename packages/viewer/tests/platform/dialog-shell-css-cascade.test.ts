/**
 * Regression guard for the FIX ROUND 1 border-color cascade bug in the
 * shared dialog shell CSS (found during M1/#42 dialog-system-consolidation
 * review).
 *
 * The bug: `.dlg-actions button` (specificity 0,1,1) restated the
 * color-bearing `border` shorthand (`border: 1px solid transparent`), which
 * always outranked `.dlg-ghost`'s `border-color: var(--app-border)`
 * (specificity 0,1,0) — so every footer ghost button (Cancel/Back/Refresh/
 * Browse/Close) rendered with an invisible transparent border instead of the
 * pre-migration visible one.
 *
 * There is no component/DOM mount harness in this repo's bun:test setup (see
 * NewProjectWizard.test.ts), so an actual computed-style assertion isn't
 * possible here. This test instead encodes the specificity invariant at the
 * source level: the generic `.dlg-actions button` rule must never carry a
 * color-bearing `border` (shorthand or `border-color` longhand) — only the
 * per-variant rules (`.dlg-primary`/`.dlg-ghost`/`.dlg-danger-armed`) may set
 * border-color, and each of those must actually set it. That is exactly the
 * invariant whose violation caused the visual regression, and it re-triggers
 * this test if anyone reintroduces it.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const CSS_PATH = path.resolve(
  __dirname,
  "../../src/lib/styles/dialog-shell.css",
);

function readCss(): string {
  return fs.readFileSync(CSS_PATH, "utf-8");
}

/** Extract the body of the first `selector { ... }` block matching `selector`. */
function ruleBody(css: string, selector: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const idx = withoutComments.indexOf(selector);
  expect(idx).toBeGreaterThanOrEqual(0);
  const open = withoutComments.indexOf("{", idx);
  const close = withoutComments.indexOf("}", open);
  return withoutComments.slice(open + 1, close);
}

describe("dialog-shell.css — border-color cascade (FIX ROUND 1 regression guard)", () => {
  // Selectors below are `:global(...)` wrapped (2026-07-11, css_unused_selector
  // fix — see the file's own top-of-file comment): each consuming dialog only
  // renders a subset of this shared sheet's classes, and Svelte's per-component
  // unused-CSS-selector pass was flagging whichever subset a given dialog's
  // markup doesn't use, even though every selector IS used by some sibling
  // dialog. `:global()` opts them out of that per-component pruning without
  // changing the compiled specificity of the "used" case (confirmed against a
  // production build). The selector text these tests search for must match
  // that wrapper.
  test("the generic `.dlg-actions button` rule does not set a color-bearing border", () => {
    const body = ruleBody(readCss(), ":global(.dlg-actions button) {");
    // Width/style are fine to restate here; a bare `border:` shorthand or a
    // `border-color:` longhand would clobber every per-variant color at
    // equal-or-higher specificity and must not reappear.
    expect(body).not.toMatch(/\bborder\s*:/);
    expect(body).not.toMatch(/\bborder-color\s*:/);
  });

  test("`.dlg-primary` supplies its own border-color (transparent, matching its own fill)", () => {
    const body = ruleBody(readCss(), ":global(.dlg-primary) {");
    expect(body).toMatch(/border-color\s*:\s*transparent/);
  });

  test("`.dlg-ghost` supplies its own visible border-color", () => {
    const body = ruleBody(readCss(), ":global(.dlg-ghost) {");
    expect(body).toMatch(/border-color\s*:\s*var\(--app-border\)/);
  });

  test("`.dlg-danger-armed` still supplies its own error border-color", () => {
    const body = ruleBody(readCss(), ":global(.dlg-danger-armed) {");
    expect(body).toMatch(/border-color\s*:\s*var\(--app-error-border/);
  });
});
