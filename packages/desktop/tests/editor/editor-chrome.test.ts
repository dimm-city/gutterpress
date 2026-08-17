import { describe, expect, test } from "bun:test";
import { renderComponent } from "../support/render-svelte";
import { SLASH_ITEMS } from "../../src/lib/editor/rich-chrome.svelte";

/**
 * The inline chrome, actually RENDERED.
 *
 * `rich-chrome.test.ts` covers the geometry and the trigger rules as pure
 * functions; this covers the markup those decisions produce — the roles, the
 * aria wiring, and which branch appears. Both are needed: a correct
 * `flipClamp` in a component that renders nothing is still broken.
 */
const WORKSPACE = { left: 0, top: 0, width: 1200, height: 800 };
const noop = () => {};

const chrome = (anchor: unknown) =>
  renderComponent("lib/components/EditorChrome.svelte", {
    anchor,
    onRunSlash: noop,
    onFormat: noop,
    onClose: noop,
  });

describe("EditorChrome", () => {
  test("renders nothing when there is no anchor", async () => {
    // The common case by far — it must not leave stray boxes on screen.
    const html = await chrome(null);
    expect(html).not.toContain("gp-slash");
    expect(html).not.toContain("gp-bubble");
  });

  test("the slash menu claims role=menu and lists every block", async () => {
    const html = await chrome({ kind: "slash", x: 100, y: 100, query: "", workspace: WORKSPACE });
    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-label="Insert block"');
    expect((html.match(/role="menuitem"/g) ?? []).length).toBe(SLASH_ITEMS.length);
    // The product's own authoring vocabulary must be reachable from `/`.
    expect(html).toContain("Page break");
    expect(html).toContain("Two columns");
    expect(html).toContain("@section");
  });

  test("a query filters the rendered list", async () => {
    const html = await chrome({ kind: "slash", x: 10, y: 10, query: "head", workspace: WORKSPACE });
    expect(html).toContain("Heading 1");
    expect(html).not.toContain("Two columns");
  });

  test("a query matching nothing says so instead of rendering an empty box", async () => {
    const html = await chrome({ kind: "slash", x: 10, y: 10, query: "zzz", workspace: WORKSPACE });
    expect(html).not.toContain('role="menuitem"');
    expect(html).toContain("No blocks match");
  });

  test("the bubble is a toolbar, not a menu, and every icon button is labelled", async () => {
    // role="toolbar" because it does NOT implement menu semantics; the repo
    // fails a test elsewhere for claiming a role it does not implement.
    const html = await chrome({ kind: "selection", x: 400, y: 300, workspace: WORKSPACE });
    expect(html).toContain('role="toolbar"');
    expect(html).not.toContain('role="menu"');
    for (const label of ["Bold", "Italic", "Strikethrough", "Inline code", "Link"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
  });

  test("the toolbar has exactly ONE tab stop (ARIA toolbar pattern)", async () => {
    const html = await chrome({ kind: "selection", x: 400, y: 300, workspace: WORKSPACE });
    // One tabbable button, the rest -1, and the container itself is not a stop.
    expect((html.match(/tabindex="0"/g) ?? []).length).toBe(1);
    expect((html.match(/tabindex="-1"/g) ?? []).length).toBe(5); // container + 4 buttons
  });

  test("icon buttons actually render an icon, not an empty box", async () => {
    // Every format id must exist in Icon.svelte; a typo would render nothing
    // and the toolbar would be five blank squares.
    const html = await chrome({ kind: "selection", x: 400, y: 300, workspace: WORKSPACE });
    expect((html.match(/<svg/g) ?? []).length).toBe(5);
  });

  test("neither surface uses the modal dialog contract", async () => {
    // dialogBehavior would stamp aria-modal on a caret-anchored menu and hide
    // the author's own text from a screen reader.
    for (const anchor of [
      { kind: "slash", x: 1, y: 1, query: "", workspace: WORKSPACE },
      { kind: "selection", x: 1, y: 1, workspace: WORKSPACE },
    ]) {
      const html = await chrome(anchor);
      expect(html).not.toContain("aria-modal");
      expect(html).not.toContain('role="dialog"');
    }
  });

  test("the panel is positioned inside the workspace", async () => {
    // Anchored past the right edge: it must flip/clamp, never render offscreen.
    const html = await chrome({
      kind: "slash", x: 1190, y: 780, query: "", workspace: WORKSPACE,
    });
    const left = Number(/left: (-?\d+(?:\.\d+)?)px/.exec(html)?.[1]);
    const top = Number(/top: (-?\d+(?:\.\d+)?)px/.exec(html)?.[1]);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(left + 260).toBeLessThanOrEqual(WORKSPACE.width);
    expect(top + 300).toBeLessThanOrEqual(WORKSPACE.height);
  });
});
