import { describe, expect, test } from "bun:test";
import { createEditorProjection } from "gutterpress/render";
import type { BlockAstNode, CustomBlockRendering } from "@dimm-city/vscode-markdown-editor";
import type { GutterpressProjection, ProjectedBlock } from "gutterpress/render";
import { buildBlockIndex, matchProjectedBlock, projectionNeedsRefresh } from "../../src/gutterpress/match.ts";
import { buildChipPlan } from "../../src/gutterpress/plan.ts";
import { createGutterpressBlockProvider } from "../../src/gutterpress/provider.ts";

/**
 * SFE-P2b Lane B — unit coverage for `src/gutterpress/{match,plan,provider}.ts`.
 *
 * Deliberately DOM-free: imports `match.ts`/`plan.ts` (which never touch
 * DOM at all — see their own headers) plus `provider.ts`'s
 * `createGutterpressBlockProvider` ONLY for the stale/no-match paths, which
 * return `undefined` BEFORE ever reaching `render-chip.ts`'s
 * `document.createElement` calls. This file never calls `renderCustomBlock`
 * on an input that would actually MATCH while non-stale — that would reach
 * real DOM construction, which `bun:test` does not provide in this package
 * (see `tests/web/mount.test.ts`'s header: every DOM-touching P1a case
 * moved to a `.btest.ts` real-Chromium suite for exactly this reason). The
 * full mount-through-render path, including every chip's actual DOM shape,
 * is proven end-to-end by `tests/gutterpress/gutterpress.btest.ts`.
 *
 * A fake `BlockAstNode` is passed to `renderCustomBlock` in the tests
 * below via `FAKE_NODE` — safe because `provider.ts`'s implementation never
 * reads its `node` argument at all (only `sourceText` drives matching; see
 * `match.ts`'s header for why no `absoluteStart` is available to use even
 * if it wanted to).
 */

const FAKE_NODE = {} as unknown as BlockAstNode;
const UNUSED_DOCUMENT = {} as unknown as Document;

// A realistic fixture covering every kind this run touches: chapter, page
// (-> a generated chapter-opener), an ordinary paragraph (outside the
// projection entirely), and a standalone raw-html block. Blank-line
// separated around every marker/raw-html line — see match.ts's header for
// why that shape is what the fork's own parser needs to keep each one its
// own single node.
const FIXTURE_SOURCE =
  [
    "@chapter C.01",
    "",
    "@page splash",
    "",
    "Intro paragraph.",
    "",
    '<div class="widget">raw</div>',
    "",
    "Trail text.",
  ].join("\n") + "\n";

function buildFixtureProjection(sourceVersion = 1): GutterpressProjection {
  return createEditorProjection(FIXTURE_SOURCE, { sourceVersion });
}

function blockOf(projection: GutterpressProjection, kind: ProjectedBlock["kind"]): ProjectedBlock {
  const block = projection.blocks.find((b) => b.kind === kind);
  if (!block) throw new Error(`test fixture: no ${kind} block in projection`);
  return block;
}

// ── matching (G-05: exact-range match only, no fuzzy matching) ─────────────

describe("matchProjectedBlock — exact-range match, not fuzzy", () => {
  test("matches a marker block's exact source, plus any amount of the fork's own trailing blank-line glue", () => {
    const projection = buildFixtureProjection();
    const index = buildBlockIndex(projection, FIXTURE_SOURCE);
    const page = blockOf(projection, "page");
    const exactSlice = FIXTURE_SOURCE.slice(page.from, page.to);
    expect(exactSlice).toBe("@page splash\n");

    // Zero, one, or two extra trailing newlines all resolve to the SAME
    // block -- empirically verified against the real fork in
    // gutterpress.btest.ts (a fork paragraph node absorbs exactly one
    // trailing blank separator line's terminator into its own span).
    for (const extra of ["", "\n", "\n\n"]) {
      const match = matchProjectedBlock(index, exactSlice + extra);
      expect(match?.block).toBe(page);
    }
  });

  test("does NOT match when sourceText merely CONTAINS a marker's text as a substring -- proves this is not the test-only provider's fuzzy .includes() search", () => {
    const projection = buildFixtureProjection();
    const index = buildBlockIndex(projection, FIXTURE_SOURCE);

    // A single fused paragraph with "@page splash" embedded mid-sentence --
    // the exact substring the block's own slice matches (trimmed) is
    // present, but NOT at the start, and the whole string is not the
    // block's own exact span.
    const fusedSourceText = "Some intro @page splash after.\n\n";
    expect(matchProjectedBlock(index, fusedSourceText)).toBeUndefined();
  });

  test("does NOT match a lazy-continuation fusion (marker line glued to REAL following content, no blank separator)", () => {
    const projection = buildFixtureProjection();
    const index = buildBlockIndex(projection, FIXTURE_SOURCE);
    const page = blockOf(projection, "page");
    const exactSlice = FIXTURE_SOURCE.slice(page.from, page.to);

    // The prefix is exactly the known block's own bytes, but the remainder
    // is REAL authored content, not pure whitespace glue -- must refuse,
    // not guess.
    expect(matchProjectedBlock(index, exactSlice + "Some text")).toBeUndefined();
  });

  test("does NOT match an empty or whitespace-only sourceText", () => {
    const projection = buildFixtureProjection();
    const index = buildBlockIndex(projection, FIXTURE_SOURCE);
    expect(matchProjectedBlock(index, "")).toBeUndefined();
    expect(matchProjectedBlock(index, "   \n\n")).toBeUndefined();
  });

  test("matches a raw-html block's exact source too", () => {
    const projection = buildFixtureProjection();
    const index = buildBlockIndex(projection, FIXTURE_SOURCE);
    const rawHtml = blockOf(projection, "raw-html");
    const exactSlice = FIXTURE_SOURCE.slice(rawHtml.from, rawHtml.to);
    expect(exactSlice).toBe('<div class="widget">raw</div>\n');
    expect(matchProjectedBlock(index, exactSlice)?.block).toBe(rawHtml);
  });

  test("two blocks with byte-identical exact text but DIFFERENT chip content fail closed -- neither block's chip is ever painted on the other's call (SFE-P2b repair round 1: replaces a prior test that hand-built two attribute-less blocks and could not have caught this)", () => {
    // Two chapters, each opening with an identically-worded "@page splash" --
    // an entirely ordinary book shape. markers.js derives `class`/
    // `data-chapter-label` from the ENCLOSING @chapter frame, not from the
    // @page line's own text, so these two blocks' viewAttributes/generated
    // previews differ even though their trimmed source is byte-identical.
    const source =
      [
        "@chapter A",
        "",
        "@page splash",
        "",
        "Body one.",
        "",
        "@chapter B",
        "",
        "@page splash",
        "",
        "Body two.",
      ].join("\n") + "\n";
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    const pages = projection.blocks.filter((b) => b.kind === "page");
    expect(pages).toHaveLength(2);
    expect(source.slice(pages[0]!.from, pages[0]!.to)).toBe("@page splash\n");
    expect(source.slice(pages[1]!.from, pages[1]!.to)).toBe("@page splash\n");
    // The premise this test is guarding against: same trimmed text, but the
    // real pipeline attaches DIFFERENT chapter labels to each occurrence.
    expect(pages[0]!.viewAttributes?.["data-chapter-label"]).toBe("A");
    expect(pages[1]!.viewAttributes?.["data-chapter-label"]).toBe("B");

    const index = buildBlockIndex(projection, source);
    // Fail closed: an ambiguous key matches NEITHER occurrence -- painting
    // block A's or block B's chip on the wrong call would be wrong content,
    // which G-05 treats as worse than no chip at all.
    expect(matchProjectedBlock(index, "@page splash\n")).toBeUndefined();
    expect(matchProjectedBlock(index, "@page splash\n\n")).toBeUndefined();
  });

  test("a blockquoted duplicate of a real marker line makes that key unmatchable everywhere -- the refused occurrence never steals the real block's chip", () => {
    // The real block ("@page splash" at the top level) is legitimately
    // projected; the blockquoted repeat is refused by editor-projection.ts
    // (`markerLineLooksAuthored` fails: the line starts with ">", not "@").
    // The fork still calls renderCustomBlock for the refused occurrence with
    // a sourceText that trim-equals the real block's own key.
    const source = "@page splash\n\n> @page splash\n\nTail.\n";
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    const pages = projection.blocks.filter((b) => b.kind === "page");
    expect(pages).toHaveLength(1);
    expect(source.slice(pages[0]!.from, pages[0]!.to)).toBe("@page splash\n");
    expect(
      projection.diagnostics.some(
        (d) => d.category === "EDITOR_UNSUPPORTED_PROJECTION" && d.reason.includes("does not reproduce a"),
      ),
    ).toBe(true);

    const index = buildBlockIndex(projection, source);
    // Fails closed even for a call carrying the REAL block's own exact
    // range's text -- the key is ambiguous document-wide, not per-call, so
    // there is no way to tell the two calls apart from text alone.
    expect(matchProjectedBlock(index, "@page splash\n")).toBeUndefined();
  });
});

describe("projectionNeedsRefresh (G-11)", () => {
  test("false when the current version matches the projection's own sourceVersion", () => {
    const projection = buildFixtureProjection(3);
    expect(projectionNeedsRefresh(projection, 3)).toBe(false);
  });

  test("true once the current version has moved on", () => {
    const projection = buildFixtureProjection(3);
    expect(projectionNeedsRefresh(projection, 4)).toBe(true);
    expect(projectionNeedsRefresh(projection, 0)).toBe(true);
  });

  test("D13: true whenever `limited` is true, even when sourceVersion still matches -- editor-projection.ts's own contract: 'A consumer MUST treat limited: true as stale-equivalent'", () => {
    // 10,001 markers -- one past MAX_PROJECTED_BLOCKS -- really does set
    // `limited: true` (not asserted as a given; computed via the real
    // pipeline, matching limits.btest.ts's own "sanity" case).
    const bigSource = "@page-break\n".repeat(10_001);
    const bigProjection = createEditorProjection(bigSource, { sourceVersion: 5 });
    expect(bigProjection.limited).toBe(true);
    expect(projectionNeedsRefresh(bigProjection, 5)).toBe(true);
  });

  test("a NOT-limited projection at the matching version is not stale", () => {
    const projection = buildFixtureProjection(5);
    expect(projection.limited).toBeUndefined();
    expect(projectionNeedsRefresh(projection, 5)).toBe(false);
  });
});

// ── plan building (D6/G-04: generated content is never segmented) ──────────

describe("buildChipPlan", () => {
  test("a marker block (editMode: structured) plans as segmented, with no generated previews when none anchor to it", () => {
    const projection = buildFixtureProjection();
    const chapter = blockOf(projection, "chapter");
    const sourceText = FIXTURE_SOURCE.slice(chapter.from, chapter.to);
    const plan = buildChipPlan(chapter, [], sourceText);
    expect(plan.segmented).toBe(true);
    expect(plan.sourceText).toBe(sourceText);
    expect(plan.generatedPreviews).toEqual([]);
  });

  test("a raw-html block (editMode: source) plans as NOT segmented -- inert text preview, matching the run spec's deliberately-safe interim", () => {
    const projection = buildFixtureProjection();
    const rawHtml = blockOf(projection, "raw-html");
    const sourceText = FIXTURE_SOURCE.slice(rawHtml.from, rawHtml.to);
    const plan = buildChipPlan(rawHtml, [], sourceText);
    expect(plan.segmented).toBe(false);
    expect(plan.sourceText).toBe(sourceText);
  });

  test("generated-view in-chip inclusion: the page marker's plan carries the exact generated chapter-opener HTML text", () => {
    const projection = buildFixtureProjection();
    const page = blockOf(projection, "page");
    expect(projection.generated).toHaveLength(1);
    const generatedView = projection.generated[0]!;
    expect(generatedView.anchor).toBe(page.to);
    expect(generatedView.html).toBe('<div class="chapter-opener" data-chapter-label="C.01">C.01</div>\n');

    const index = buildBlockIndex(projection, FIXTURE_SOURCE);
    const match = matchProjectedBlock(index, FIXTURE_SOURCE.slice(page.from, page.to));
    expect(match?.generatedPreviews).toEqual([generatedView]);

    const plan = buildChipPlan(match!.block, match!.generatedPreviews, FIXTURE_SOURCE.slice(page.from, page.to));
    expect(plan.generatedPreviews).toEqual([generatedView.html]);
  });

  test("no-segments-for-generated: generatedPreviews is a plain string array -- there is no field a SourceSegment could ever occupy (type-level guarantee, not just a runtime check)", () => {
    const projection = buildFixtureProjection();
    const page = blockOf(projection, "page");
    const view = projection.generated[0]!;
    const plan = buildChipPlan(page, [view], FIXTURE_SOURCE.slice(page.from, page.to));
    expect(plan.generatedPreviews).toHaveLength(1);
    for (const preview of plan.generatedPreviews) {
      // A string cannot carry a `{ dom, start, length }` SourceSegment --
      // this loop existing at all, over plain strings, IS the proof.
      expect(typeof preview).toBe("string");
    }
  });
});

// ── stale fallthrough (G-11) — the full provider, never reaching DOM ───────

describe("createGutterpressBlockProvider — stale fallthrough (G-11)", () => {
  test("returns undefined for a block that WOULD otherwise match, when isStale() reports true", () => {
    const projection = buildFixtureProjection();
    const page = blockOf(projection, "page");
    const matchingSourceText = FIXTURE_SOURCE.slice(page.from, page.to);

    const provider = createGutterpressBlockProvider(projection, {
      source: FIXTURE_SOURCE,
      ownerDocument: UNUSED_DOCUMENT,
      isStale: () => true,
    });

    // Never reaches render-chip.ts's document.createElement -- if it did,
    // this call would throw under bun:test's DOM-less runtime, failing the
    // test outright rather than merely returning the wrong value.
    const result: CustomBlockRendering | undefined = provider.renderCustomBlock(FAKE_NODE, matchingSourceText);
    expect(result).toBeUndefined();
  });

  test("needsRefresh() reflects the projection's own sourceVersion regardless of isStale", () => {
    const projection = buildFixtureProjection(7);
    const provider = createGutterpressBlockProvider(projection, {
      source: FIXTURE_SOURCE,
      ownerDocument: UNUSED_DOCUMENT,
    });
    expect(provider.needsRefresh(7)).toBe(false);
    expect(provider.needsRefresh(8)).toBe(true);
  });

  test("returns undefined for sourceText that matches nothing, whether or not isStale is set", () => {
    const projection = buildFixtureProjection();
    const provider = createGutterpressBlockProvider(projection, {
      source: FIXTURE_SOURCE,
      ownerDocument: UNUSED_DOCUMENT,
    });
    expect(provider.renderCustomBlock(FAKE_NODE, "Ordinary paragraph text, not projected.\n\n")).toBeUndefined();
  });

  test("isStale is consulted before any matching work -- a stale provider never renders even a definitely-matching, definitely-non-empty sourceText", () => {
    const projection = buildFixtureProjection();
    const chapter = blockOf(projection, "chapter");
    const provider = createGutterpressBlockProvider(projection, {
      source: FIXTURE_SOURCE,
      ownerDocument: UNUSED_DOCUMENT,
      isStale: () => true,
    });
    expect(
      provider.renderCustomBlock(FAKE_NODE, FIXTURE_SOURCE.slice(chapter.from, chapter.to)),
    ).toBeUndefined();
  });
});
