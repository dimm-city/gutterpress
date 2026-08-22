/**
 * Preview wheel-scroll regression (scroll-dead-preview): the pane-scoped
 * LoadingOverlay sits over the cross-origin preview iframe whenever
 * `lifecycle.rendering || lifecycle.renderCompleteOverlay` is true. Because the
 * scrim is translucent, the book stays fully visible while every wheel event
 * would otherwise be swallowed by the overlay div — "scrolling in the desktop is completely
 * broken but works in other areas" (proven live: elementFromPoint over the
 * pane returned the overlay's spinner and wheel deltas were 0 while it was
 * mounted).
 *
 * The overlay is informational chrome (translucent scrim + spinner + Cancel),
 * not an input barrier: the contract pinned here is that the scrim passes
 * pointer/wheel input through to the iframe (`pointer-events: none`) while
 * only the Cancel button restores `pointer-events: auto` so the spinner and
 * label never create a dead wheel zone.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC = path.resolve(__dirname, "../../src");
const overlaySource = fs.readFileSync(
  path.join(SRC, "lib/components/LoadingOverlay.svelte"),
  "utf8",
);

/** Extract the declaration body of a top-level CSS rule from the component's
 * <style> block. Naive brace matching is fine — the file has no nested rules
 * inside these selectors. */
function ruleBody(source: string, selector: string): string {
  const style = source.slice(source.indexOf("<style"));
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = style.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`selector ${selector} not found in LoadingOverlay <style>`);
  return m[1]!;
}

/** Strip CSS comments so a declaration mentioned in prose can't satisfy the
 * assertions below. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("LoadingOverlay never swallows preview scroll (scroll-dead-preview)", () => {
  test("the scrim passes wheel/pointer input through to the iframe", () => {
    const body = stripCssComments(ruleBody(overlaySource, ".loading-overlay"));
    expect(body).toMatch(/pointer-events:\s*none/);
  });

  test("the spinner card also passes wheel input through", () => {
    const body = stripCssComments(ruleBody(overlaySource, ".spinner-wrap"));
    expect(body).toMatch(/pointer-events:\s*none/);
  });

  test("only the actual Cancel button restores interactivity", () => {
    const body = stripCssComments(ruleBody(overlaySource, ".cancel-btn"));
    expect(body).toMatch(/pointer-events:\s*auto/);
  });
});
