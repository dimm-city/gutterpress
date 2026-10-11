import { describe, expect, test } from "bun:test";
import type { GutterpressProjection } from "gutterpress/render";
import { buildPipelineAttributeIndex, pickPipelineAttributes } from "../../src/gutterpress/pipeline-attrs.ts";
import { buildInlineWrapperIndex } from "../../src/gutterpress/inline-wrappers.ts";

/**
 * DOM-free halves of the block decorators: which pipeline record a block
 * gets, and how the plugin's inline wrappers are indexed. The DOM halves
 * (attributes set, phrases wrapped) are proven against the real fork by
 * the desktop's editor<->preview parity gate on a real book.
 */

const SOURCE = "#### Pain Compliance\n\nBody.\n\n#### Pain Compliance\n\nMore.\n";
const second = SOURCE.indexOf("#### Pain Compliance", 1);

function projectionWith(fields: Partial<GutterpressProjection>): GutterpressProjection {
  return {
    schemaVersion: 1,
    sourceVersion: 1,
    blocks: [],
    generated: [],
    diagnostics: [],
    pluginContainers: [],
    blockAttributes: [],
    inlineWrappers: [],
    ...fields,
  };
}

describe("pickPipelineAttributes", () => {
  const index = buildPipelineAttributeIndex(
    projectionWith({
      blockAttributes: [
        { from: 0, to: 21, path: "", attributes: { class: "dc-card-tab", "data-tier": "AUG1.4" } },
        { from: second, to: second + 21, path: "", attributes: { class: "dc-card-tab" } },
      ],
    }),
    SOURCE,
  );

  test("two blocks with the same text are told apart by the nearest offset", () => {
    expect(pickPipelineAttributes(index, "#### Pain Compliance\n\n", 0)?.[0]?.attributes).toEqual({ class: "dc-card-tab", "data-tier": "AUG1.4" });
    expect(pickPipelineAttributes(index, "#### Pain Compliance\n\n", second + 3)?.[0]?.attributes).toEqual({ class: "dc-card-tab" });
  });

  test("without a position, differing records yield nothing rather than each other's", () => {
    expect(pickPipelineAttributes(index, "#### Pain Compliance")).toBeUndefined();
  });

  test("without a position, identical records are applied", () => {
    const same = buildPipelineAttributeIndex(
      projectionWith({
        blockAttributes: [
          { from: 0, to: 21, path: "", attributes: { class: "dc-card-tab" } },
          { from: 0, to: 21, path: "tbody:nth-of-type(1) > tr:nth-of-type(1)", attributes: { "data-tier": "crit" } },
          { from: second, to: second + 21, path: "tbody:nth-of-type(1) > tr:nth-of-type(1)", attributes: { "data-tier": "crit" } },
          { from: second, to: second + 21, path: "", attributes: { class: "dc-card-tab" } },
        ],
      }),
      SOURCE,
    );
    expect(pickPipelineAttributes(same, "#### Pain Compliance")?.map((e) => e.path)).toEqual(["", "tbody:nth-of-type(1) > tr:nth-of-type(1)"]);
  });

  test("a block with no record gets nothing", () => {
    expect(pickPipelineAttributes(index, "Body.", 24)).toBeUndefined();
  });
});

describe("buildInlineWrapperIndex", () => {
  test("wrappers are keyed by the block's text, one entry per distinct element and phrase", () => {
    const index = buildInlineWrapperIndex(
      projectionWith({
        inlineWrappers: [
          { from: 0, to: 21, text: "ROLL", tag: "span", attributes: { class: "roll" } },
          { from: second, to: second + 21, text: "ROLL", tag: "span", attributes: { class: "roll" } },
          { from: second, to: second + 21, text: "ROLL", tag: "b", attributes: {} },
        ],
      }),
      SOURCE,
    );
    expect(index.get("#### Pain Compliance")?.map((w) => [w.text, w.tag, w.attributes])).toEqual([
      ["ROLL", "span", { class: "roll" }],
      ["ROLL", "b", {}],
    ]);
  });
});
