/**
 * A plugin's DECLARED container (#240: a `markers` export instead of a
 * hand-written core rule) in the editor projection.
 *
 * The page gets `<aside class="dc-alert warning">` around the authored
 * blocks (plus the label element markers.js emits first); the editor must
 * agree with no diagnostic: the marker line is a "plugin-marker" chip, the
 * label is that chip's generated view, and the element itself is a
 * `pluginContainers` entry anchored to the authored blocks it holds - the
 * same mounting a plugin's hand-built wrapper gets, so a book styling
 * `.dc-alert > h3:first-child` sees the same tree on both surfaces.
 */
import { describe, expect, test } from "bun:test";
import { createEditorProjection } from "./editor-projection.ts";
import { createMarkdownRenderer } from "./renderer.ts";

const md = createMarkdownRenderer([
  {
    name: "declared-fixture",
    plugin: () => {},
    options: {},
    markers: {
      callout: {
        tag: "aside",
        class: "dc-alert",
        variants: { warning: "warning" },
        label: { from: "attr:label", class: "dc-alert-label", tag: "strong" },
      },
      note: { tag: "div", class: "dc-note" },
    },
  },
]);

const project = (source: string) => createEditorProjection(source, { sourceVersion: 1, md, trusted: true });

describe("declared containers (#240)", () => {
  test("the marker line is a plugin-marker chip carrying the element's attributes, with no diagnostic", () => {
    const source = "Intro.\n\n@callout warning label=Careful\n\nInside.\n\n@end-callout\n\nAfter.\n";
    const p = project(source);
    expect(p.diagnostics).toEqual([]);
    const chip = p.blocks.find((b) => b.kind === "plugin-marker");
    expect(chip).toBeDefined();
    expect(source.slice(chip!.from, chip!.to).trim()).toBe("@callout warning label=Careful");
    expect(chip!.viewAttributes).toMatchObject({ class: "dc-alert warning", "data-callout": "warning", "data-label": "Careful" });
    // The closer is a chip the editor classifies from text; it projects nothing of its own.
    expect(p.blocks.filter((b) => b.kind === "plugin-marker")).toHaveLength(1);
  });

  test("the label is the chip's generated view, and the element wraps the chip through the closer", () => {
    const source = "@callout warning label=Careful\n\nInside.\n\n@end-callout\n\nAfter.\n";
    const p = project(source);
    expect(p.diagnostics).toEqual([]);
    const chip = p.blocks.find((b) => b.kind === "plugin-marker")!;
    expect(p.generated.map((g) => [g.anchor, g.html.trim()])).toEqual([
      [chip.to, '<strong class="dc-alert-label">Careful</strong>'],
    ]);
    expect(p.pluginContainers).toEqual([
      {
        tag: "aside",
        attributes: { class: "dc-alert warning", "data-callout": "warning", "data-label": "Careful" },
        // With a label to show, the element begins WITH the marker's own block (the label sits inside it on the page)...
        open: { text: "@callout warning label=Careful", offset: 0 },
        // ...and ends at the closer's block, never past it.
        close: { text: "@end-callout", offset: source.indexOf("@end-callout") },
      },
    ]);
  });

  test("without a label the element begins at the first authored block inside it", () => {
    const source = "@note\n\nInside.\n\nMore.\n\n@end-note\n\nAfter.\n";
    const p = project(source);
    expect(p.diagnostics).toEqual([]);
    expect(p.generated).toEqual([]);
    expect(p.pluginContainers).toEqual([
      {
        tag: "div",
        attributes: { class: "dc-note" },
        open: { text: "Inside.", offset: source.indexOf("Inside.") },
        close: { text: "@end-note", offset: source.indexOf("@end-note") },
      },
    ]);
  });

  test("a container left open ends at the enclosing scope's boundary, like the page closes it", () => {
    const source = "@section\n\n@note\n\nInside.\n\n@end-section\n\nAfter.\n";
    const p = project(source);
    expect(p.diagnostics).toEqual([]);
    expect(p.pluginContainers.map((c) => [c.open.text, c.close?.text ?? null])).toEqual([["Inside.", "@end-section"]]);
  });

  test("a container with nothing inside it mounts no wrapper", () => {
    const p = project("@note\n\n@end-note\n\nAfter.\n");
    expect(p.diagnostics).toEqual([]);
    expect(p.pluginContainers).toEqual([]);
  });
});
