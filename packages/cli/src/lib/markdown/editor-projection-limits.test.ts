/**
 * D13 resource caps + the malformed/ambiguity fixture matrix for
 * `createEditorProjection` (run docs/plans/source-first-editor/runs/SFE-P2b.md,
 * Lane C). Co-located with `editor-projection.ts`/`editor-projection.test.ts`
 * per this package's convention (see this run's write-ownership table).
 *
 * SCOPE: this file owns everything D13 adds to `editor-projection.ts` — the
 * block-count cap (10,000), the per-payload HTML cap (1 MiB), the aggregate
 * HTML cap (8 MiB) — plus a formalized version of the 12 ad-hoc malformed/
 * ambiguous fixtures Lane A probed while building the base module (its own
 * header's "KIND ENUMERATION"/"AMBIGUITY"/"INLINE HTML" sections). It does
 * NOT re-test Lane A's exact-range/attribute-fidelity contract —
 * `editor-projection.test.ts` (Lane A's file, not touched by this lane) is
 * the source of truth for that and stays green throughout (verified below by
 * running both files together — see the run's gate commands).
 *
 * BOUNDARY-EXACT (the run spec's own words): every cap below is tested at
 * exactly N (passes clean) and N+1 (trips), never at some looser "well
 * above/below" value — a cap implemented one-off would still pass a loose
 * test.
 *
 * SABOTAGE (G-12) — PERFORMED LOCALLY, NOT COMMITTED, recorded here per the
 * run spec ("record in the test file header which sabotages were
 * performed"). Each cap was sabotaged TWICE, because the first round found a
 * real gap in this file's OWN fixtures, not just in the production code:
 *
 * ROUND 1 (fixtures built from the exported cap constant, e.g.
 * `bigHtmlSource([MAX_INACTIVE_HTML_BYTES + 1])`): raising a constant moved
 * BOTH the cap AND the fixture size together, so the boundary-exact
 * pass/trip tests stayed green even with the cap effectively disabled — only
 * a separate "constant equals literal N" pin test caught it. That is a real
 * finding (self-referential fixtures are not boundary-exact proof of the
 * cap, only of internal consistency), so every fixture-generation call and
 * length assertion in this file was rewritten to a hardcoded literal
 * (`10_000`/`10_001`, `1024 * 1024`(+1), `1024 * 1024` per-block /
 * `8 * 1024 * 1024` aggregate) — see the "literal, not the constant"
 * comments at each call site below — leaving the constants referenced only
 * by their own dedicated pin tests and by derived values that legitimately
 * need the current constant (e.g. `htmlBudget` bookkeeping inside
 * `editor-projection.ts` itself, which is production code, not a test
 * fixture).
 *
 * ROUND 2 (against the hardened literal fixtures — the actual proof this
 * file relies on):
 *
 *   1. Block-count cap: `MAX_PROJECTED_BLOCKS` in `editor-projection.ts` was
 *      temporarily raised from `10_000` to `50_000`. Result: 2 tests FAILED
 *      -- the pin test, AND "10,001 @page-break markers: exactly ONE limit
 *      diagnostic, exactly 10,000 blocks projected" (10,001 blocks were
 *      projected, zero `EDITOR_PROJECTION_LIMIT` diagnostics, `limited` was
 *      `undefined`). Reverted to `10_000`; re-run confirmed clean.
 *   2. Per-payload cap: `MAX_INACTIVE_HTML_BYTES` was temporarily raised from
 *      `1024 * 1024` to `4 * 1024 * 1024`. Result: 5 tests FAILED -- the pin
 *      test, the aggregate describe's own cross-check ("perBlock equals
 *      MAX_INACTIVE_HTML_BYTES"), "1 MiB + 1 byte -> placeholder", the
 *      GeneratedView.html payload-cap test, and the "blocks before a
 *      payload-cap trip are unaffected" test. Reverted; re-run confirmed
 *      clean.
 *   3. Aggregate cap: `MAX_AGGREGATE_HTML_BYTES` was temporarily raised from
 *      `8 * 1024 * 1024` to `64 * 1024 * 1024`. Result: 4 tests FAILED --
 *      the pin test, the cross-check, "9th tiny block pushes the total over
 *      the cap" (all 9 payloads returned in full, zero diagnostics), and
 *      "10th block after the trip is also placeholdered". Reverted; re-run
 *      confirmed clean.
 *
 * Each sabotage was applied one constant at a time, this file re-run alone
 * to observe the failure, then reverted with a clean `bun test` pass of this
 * file (and, at the end, this file together with `editor-projection.test.ts`
 * and a full `bun run typecheck`) confirmed before moving to the next.
 */
import { describe, test, expect } from "bun:test";
import MarkdownIt from "markdown-it";
import {
  createEditorProjection,
  HTML_PAYLOAD_PLACEHOLDER,
  MAX_AGGREGATE_HTML_BYTES,
  MAX_INACTIVE_HTML_BYTES,
  MAX_PROJECTED_BLOCKS,
  type GutterpressProjection,
  type ProjectedBlockKind,
} from "./editor-projection";
import { createMarkdownRenderer, type LoadedPlugin } from "./renderer";

// ── shared synthetic-plugin helper (payload-cap tests) ──────────────────────
//
// D13's own directive: "a synthetic md instance (opts.md) whose plugin emits
// an html_block with content sized 1MiB (pass) and 1MiB+1 (placeholder +
// diagnostic)". This plugin recognizes one-line `@@bightml:<n>` markers and
// emits an html_block token with a REAL `token.map` (so the pipeline's own
// `source_range` core rule annotates `data-source-range` on it exactly the
// way an ordinary raw-HTML block would be annotated — this is the "inactiveHtml"
// / raw-html path, not the AP-05 map-less path) and `content` of exactly `n`
// ASCII 'x' characters. ASCII-only content keeps char length === UTF-8 byte
// length exactly, so every boundary below is arithmetically exact — no
// encoding surprises to account for.
function bigHtmlPlugin(): LoadedPlugin {
  const plugin = (md: MarkdownIt): void => {
    md.block.ruler.before(
      "paragraph",
      "big_html_test_only",
      (state, startLine, _endLine, silent) => {
        const pos = state.bMarks[startLine]! + state.tShift[startLine]!;
        const max = state.eMarks[startLine]!;
        const line = state.src.slice(pos, max);
        const m = /^@@bightml:(\d+)$/.exec(line.trim());
        if (!m) return false;
        if (silent) return true;
        const size = Number(m[1]);
        const tok = state.push("html_block", "", 0);
        tok.content = "x".repeat(size);
        tok.map = [startLine, startLine + 1];
        state.line = startLine + 1;
        return true;
      },
    );
  };
  return { name: "big-html-test-only-plugin", plugin, options: {} };
}

/** One `@@bightml:<size>\n` marker line per entry, in order. */
function bigHtmlSource(sizes: readonly number[]): string {
  return sizes.map((size) => `@@bightml:${size}\n`).join("");
}

// ── D13 cap 1: block-count (boundary-exact) ──────────────────────────────────

describe("D13 block-count cap (boundary-exact: 10,000 / 10,001)", () => {
  test(`MAX_PROJECTED_BLOCKS is exactly ${10_000} (documents the boundary the tests below assume)`, () => {
    expect(MAX_PROJECTED_BLOCKS).toBe(10_000);
  });

  test("exactly 10,000 @page-break markers project cleanly: all 10,000 blocks, no limit diagnostic, not limited", () => {
    // Literal 10_000, deliberately NOT `MAX_PROJECTED_BLOCKS` -- D13 names
    // this exact number, and building the fixture from the constant would
    // make this test pass trivially against a sabotaged constant (self-
    // referential: cap and fixture would move together). See this file's
    // header "SABOTAGE" note 1.
    const source = "@page-break\n".repeat(10_000);
    const t0 = performance.now();
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    const elapsedMs = performance.now() - t0;
    // Recorded for the lane report, not asserted tightly (CI hardware
    // varies) -- only a generous ceiling to catch an actual pathological
    // regression (e.g. an accidental O(n^2) in the char-offset walk).
    console.info(`[D13 cap timing] 10000 @page-break blocks: ${elapsedMs.toFixed(1)}ms`);
    expect(elapsedMs).toBeLessThan(5_000);

    expect(projection.blocks).toHaveLength(10_000);
    expect(projection.blocks.every((b) => b.kind === "page-break")).toBe(true);
    expect(projection.diagnostics.filter((d) => d.category === "EDITOR_PROJECTION_LIMIT")).toHaveLength(0);
    expect(projection.limited).toBeUndefined();
  });

  test("10,001 @page-break markers: exactly ONE limit diagnostic, exactly 10,000 blocks projected, projection still valid", () => {
    // Same reasoning as above: literal 10_001, not `MAX_PROJECTED_BLOCKS + 1`.
    const source = "@page-break\n".repeat(10_001);
    const t0 = performance.now();
    const projection = createEditorProjection(source, { sourceVersion: 7 });
    const elapsedMs = performance.now() - t0;
    console.info(`[D13 cap timing] 10001 @page-break blocks (capped): ${elapsedMs.toFixed(1)}ms`);
    expect(elapsedMs).toBeLessThan(5_000);

    expect(projection.blocks).toHaveLength(10_000);
    const limitDiagnostics = projection.diagnostics.filter((d) => d.category === "EDITOR_PROJECTION_LIMIT");
    expect(limitDiagnostics).toHaveLength(1);
    expect(limitDiagnostics[0]!.reason).toContain("10000");
    expect(projection.limited).toBe(true);

    // "Never affect blocks already emitted": every block that DID make it in
    // still has a fully valid, non-overlapping range (D6's own invariant,
    // re-checked here specifically against the capped output).
    expect(projection.schemaVersion).toBe(1);
    expect(projection.sourceVersion).toBe(7);
    let previousTo = -1;
    for (const block of projection.blocks) {
      expect(block.from).toBeGreaterThanOrEqual(0);
      expect(block.from).toBeLessThan(block.to);
      expect(block.to).toBeLessThanOrEqual(source.length);
      expect(block.from).toBeGreaterThanOrEqual(previousTo);
      previousTo = block.to;
    }
  });

  test("the cap does not affect a smaller document with a mix of ordinary marker kinds under it", () => {
    // Guards against an off-by-one or wrong-array cap check (e.g. counting
    // `generated` or `diagnostics` instead of `blocks`) that would only show
    // up once more than one kind is in play.
    const source = "@chapter C.01\n@page one\nHi\n@section .a\nBody\n@column-break\nMore\n@end-section\n@page-break\n";
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    expect(projection.blocks.map((b) => b.kind)).toEqual([
      "chapter",
      "page",
      "section",
      "column-break",
      "page-break",
    ]);
    expect(projection.limited).toBeUndefined();
  });
});

// ── D13 cap 2: per-payload HTML (boundary-exact: 1 MiB / 1 MiB + 1) ─────────

describe("D13 per-payload HTML cap (boundary-exact: 1 MiB / 1 MiB + 1 byte)", () => {
  test(`MAX_INACTIVE_HTML_BYTES is exactly 1 MiB (${1024 * 1024})`, () => {
    expect(MAX_INACTIVE_HTML_BYTES).toBe(1024 * 1024);
  });

  test("a raw-html block's inactiveHtml at exactly 1 MiB passes through unchanged, no diagnostic", () => {
    // Literal byte counts, deliberately NOT `MAX_INACTIVE_HTML_BYTES` -- see
    // the block-count cap's "literal, not the constant" reasoning above
    // (this file's header, SABOTAGE note 2, found this exact gap: a fixture
    // built from the constant passes trivially against a sabotaged one).
    const md = createMarkdownRenderer([bigHtmlPlugin()]);
    const source = bigHtmlSource([1024 * 1024]);
    const projection = createEditorProjection(source, { sourceVersion: 1, md });

    expect(projection.blocks).toHaveLength(1);
    const block = projection.blocks[0]!;
    expect(block.kind).toBe("raw-html");
    expect(block.inactiveHtml).toHaveLength(1024 * 1024);
    expect(block.inactiveHtml).not.toBe(HTML_PAYLOAD_PLACEHOLDER);
    expect(projection.diagnostics).toHaveLength(0);
    expect(projection.limited).toBeUndefined();
  });

  test("a raw-html block's inactiveHtml at 1 MiB + 1 byte becomes the safe placeholder, with a diagnostic", () => {
    const md = createMarkdownRenderer([bigHtmlPlugin()]);
    const source = bigHtmlSource([1024 * 1024 + 1]);
    const projection = createEditorProjection(source, { sourceVersion: 1, md });

    expect(projection.blocks).toHaveLength(1);
    const block = projection.blocks[0]!;
    expect(block.kind).toBe("raw-html");
    // The block itself is STILL projected, with a fully valid range (cap 2
    // never sets `limited` -- see editor-projection.ts's own header) --
    // only the rendered-preview string shrinks.
    expect(block.from).toBe(0);
    expect(block.to).toBeGreaterThan(0);
    expect(block.inactiveHtml).toBe(HTML_PAYLOAD_PLACEHOLDER);

    const limitDiagnostics = projection.diagnostics.filter((d) => d.category === "EDITOR_PROJECTION_LIMIT");
    expect(limitDiagnostics).toHaveLength(1);
    expect(limitDiagnostics[0]!.reason).toContain(String(1024 * 1024 + 1));
    expect(projection.limited).toBeUndefined();
  });

  test("the same cap guards GeneratedView.html, not only raw-html's inactiveHtml", () => {
    // A synthetic html_block shaped like the REAL chapter-opener (matches
    // CHAPTER_OPENER_CONTENT_RE, no data-source-range -- see
    // editor-projection.ts's header "GENERATED VIEWS") but padded to exceed
    // the per-payload cap, proving D13's "any single GeneratedView.html or
    // inactiveHtml" wording is honored for BOTH payload kinds this module
    // emits, not just the raw-html one the run spec's own example names.
    // A plain MarkdownIt instance, mirroring editor-projection.test.ts's own
    // AP-05 fixture pattern -- this fixture needs no `data-source-range`
    // annotation at all (a generated view has no authored range by
    // definition), so it deliberately does NOT run through
    // createMarkdownRenderer()'s source_range core rule.
    const md = new MarkdownIt({ html: true });
    md.block.ruler.before("paragraph", "fake_generated_opener", (state, startLine, _endLine, silent) => {
      const pos = state.bMarks[startLine]! + state.tShift[startLine]!;
      const max = state.eMarks[startLine]!;
      const line = state.src.slice(pos, max);
      if (line.trim() !== "@@fakeopener") return false;
      if (silent) return true;
      const tok = state.push("html_block", "", 0);
      const padding = "y".repeat(1024 * 1024 + 1); // literal, not MAX_INACTIVE_HTML_BYTES -- see the pair above
      tok.content = `<div class="chapter-opener" data-chapter-label="X">X${padding}</div>\n`;
      // Deliberately NO token.map, NO token.meta -- the real chapter-opener
      // shape (an authentically generated view has no authored range).
      state.line = startLine + 1;
      return true;
    });

    const projection = createEditorProjection("@@fakeopener\nHi\n", { sourceVersion: 1, md });
    expect(projection.blocks).toHaveLength(0);
    expect(projection.generated).toHaveLength(1);
    expect(projection.generated[0]!.html).toBe(HTML_PAYLOAD_PLACEHOLDER);
    const limitDiagnostics = projection.diagnostics.filter((d) => d.category === "EDITOR_PROJECTION_LIMIT");
    expect(limitDiagnostics).toHaveLength(1);
  });
});

// ── D13 cap 3: aggregate HTML (boundary-exact: exactly 8 MiB / 8 MiB + 1) ───

describe("D13 aggregate HTML cap (boundary-exact: exactly the 8 MiB cap / one byte over)", () => {
  test(`MAX_AGGREGATE_HTML_BYTES is exactly 8 MiB (${8 * 1024 * 1024})`, () => {
    expect(MAX_AGGREGATE_HTML_BYTES).toBe(8 * 1024 * 1024);
  });

  // Literal, deliberately NOT `MAX_AGGREGATE_HTML_BYTES / 8` -- same
  // reasoning as the block-count and per-payload caps above: a fixture
  // built from the constant would pass trivially against a sabotaged one
  // (this file's header SABOTAGE notes 1-3 -- all three caps had this gap
  // before their fixtures were hardened to literals).
  const perBlock = 1024 * 1024; // (8 * 1024 * 1024) / 8 -- also exactly MAX_INACTIVE_HTML_BYTES

  test("sanity: 8 * (MAX_AGGREGATE_HTML_BYTES / 8) equals MAX_AGGREGATE_HTML_BYTES exactly, and each share equals MAX_INACTIVE_HTML_BYTES exactly", () => {
    expect(perBlock).toBe(MAX_INACTIVE_HTML_BYTES);
    expect(perBlock * 8).toBe(MAX_AGGREGATE_HTML_BYTES);
  });

  test("8 blocks totalling EXACTLY the 8 MiB aggregate cap: every block kept in full, no diagnostic", () => {
    const md = createMarkdownRenderer([bigHtmlPlugin()]);
    const sizes = new Array(8).fill(perBlock) as number[];
    const projection = createEditorProjection(bigHtmlSource(sizes), { sourceVersion: 1, md });

    expect(projection.blocks).toHaveLength(8);
    // Each individual payload is exactly AT (not over) the per-payload cap
    // too -- boundary-exact on both caps simultaneously, by construction.
    for (const block of projection.blocks) {
      expect(block.inactiveHtml).toHaveLength(perBlock);
      expect(block.inactiveHtml).not.toBe(HTML_PAYLOAD_PLACEHOLDER);
    }
    expect(projection.diagnostics).toHaveLength(0);
    expect(projection.limited).toBeUndefined();
  });

  test("a 9th tiny block pushes the running total 1 byte over the aggregate cap: that block alone becomes a placeholder, exactly ONE aggregate diagnostic", () => {
    const md = createMarkdownRenderer([bigHtmlPlugin()]);
    const sizes = [...new Array(8).fill(perBlock), 1] as number[];
    const projection = createEditorProjection(bigHtmlSource(sizes), { sourceVersion: 1, md });

    expect(projection.blocks).toHaveLength(9);
    const [first8, ninth] = [projection.blocks.slice(0, 8), projection.blocks[8]!];
    for (const block of first8) {
      expect(block.inactiveHtml).toHaveLength(perBlock);
      expect(block.inactiveHtml).not.toBe(HTML_PAYLOAD_PLACEHOLDER);
    }
    expect(ninth.inactiveHtml).toBe(HTML_PAYLOAD_PLACEHOLDER);

    const limitDiagnostics = projection.diagnostics.filter((d) => d.category === "EDITOR_PROJECTION_LIMIT");
    expect(limitDiagnostics).toHaveLength(1);
    expect(limitDiagnostics[0]!.reason).toContain(String(MAX_AGGREGATE_HTML_BYTES));
    // Cap 3, like cap 2, never sets `limited` -- the 8 kept blocks and the
    // one placeholdered block all still have fully valid ranges/kinds.
    expect(projection.limited).toBeUndefined();
  });

  test("a 10th block AFTER the aggregate cap has already tripped is ALSO placeholdered, but does not add a second diagnostic", () => {
    const md = createMarkdownRenderer([bigHtmlPlugin()]);
    const sizes = [...new Array(8).fill(perBlock), 1, 1] as number[];
    const projection = createEditorProjection(bigHtmlSource(sizes), { sourceVersion: 1, md });

    expect(projection.blocks).toHaveLength(10);
    expect(projection.blocks[8]!.inactiveHtml).toBe(HTML_PAYLOAD_PLACEHOLDER);
    expect(projection.blocks[9]!.inactiveHtml).toBe(HTML_PAYLOAD_PLACEHOLDER);
    const limitDiagnostics = projection.diagnostics.filter((d) => d.category === "EDITOR_PROJECTION_LIMIT");
    expect(limitDiagnostics).toHaveLength(1); // still exactly one, not two
  });
});

// ── D13 caps never throw, never affect blocks already emitted ───────────────

describe("D13 caps never throw and never mutate blocks already emitted", () => {
  test("a mix of ordinary marker blocks BEFORE a payload-cap trip are byte-identical to an uncapped run", () => {
    const md = createMarkdownRenderer([bigHtmlPlugin()]);
    const source = `@chapter C.01\n@page one\n${bigHtmlSource([1024 * 1024 + 1])}`;
    expect(() => createEditorProjection(source, { sourceVersion: 1, md })).not.toThrow();

    const projection = createEditorProjection(source, { sourceVersion: 1, md });
    const chapterBlock = projection.blocks.find((b) => b.kind === "chapter")!;
    const pageBlock = projection.blocks.find((b) => b.kind === "page")!;
    expect(source.slice(chapterBlock.from, chapterBlock.to)).toBe("@chapter C.01\n");
    expect(source.slice(pageBlock.from, pageBlock.to)).toBe("@page one\n");
    expect(projection.blocks.find((b) => b.kind === "raw-html")!.inactiveHtml).toBe(HTML_PAYLOAD_PLACEHOLDER);
  });

  test("an empty document never throws and produces an empty, valid projection", () => {
    expect(() => createEditorProjection("", { sourceVersion: 1 })).not.toThrow();
    const projection = createEditorProjection("", { sourceVersion: 1 });
    expect(projection).toEqual({
      schemaVersion: 1,
      sourceVersion: 1,
      blocks: [],
      generated: [],
      diagnostics: [],
      pluginContainers: [],
      blockAttributes: [],
      inlineWrappers: [],
    });
  });
});

// ── malformed / ambiguity matrix (formalizes Lane A's 12 ad-hoc fixtures) ───
//
// Each row: [name, source, expected block kinds IN ORDER, expected
// diagnostic count, expected generated-view count]. Every row was verified
// against the REAL pipeline's actual token stream before being written here
// (not guessed) -- see this run's report for the probe transcript. Ten rows
// live in this table; the eleventh (a map-less AP-05-shaped token) and
// twelfth (an already-covered inline-HTML case, kept here as its own
// standalone assertion for the matrix's own liveness count) follow as
// dedicated tests below the table, since they need a non-default `md`
// instance / already-established fixtures respectively.

interface MalformedRow {
  readonly name: string;
  readonly source: string;
  readonly expectedKinds: readonly ProjectedBlockKind[];
  readonly expectedDiagnosticCount: number;
  readonly expectedGeneratedCount: number;
}

const MALFORMED_MATRIX: readonly MalformedRow[] = [
  {
    name: "orphan @continue (no open @section): markers.js silently drops it -- zero tokens",
    source: "@continue\nHi\n",
    expectedKinds: [],
    expectedDiagnosticCount: 0,
    expectedGeneratedCount: 0,
  },
  {
    name: 'mistyped "@Section" (wrong case): not a recognized marker at all -- ordinary prose, zero projected blocks',
    source: "@page\n\n@Section\n\ntext\n",
    expectedKinds: ["page"],
    expectedDiagnosticCount: 0,
    expectedGeneratedCount: 0,
  },
  {
    name: "empty decorated section (@section .sidebar immediately @end-section): still a valid, fully-projected block",
    source: "@section .sidebar\n@end-section\nHi\n",
    expectedKinds: ["section"],
    expectedDiagnosticCount: 0,
    expectedGeneratedCount: 0,
  },
  {
    name: "unbalanced @end-section (nothing open): a silent markers.js no-op -- zero tokens",
    source: "@end-section\nHi\n",
    expectedKinds: [],
    expectedDiagnosticCount: 0,
    expectedGeneratedCount: 0,
  },
  {
    name: "nameless @page (no name/class/id given): still projects, just with a smaller viewAttributes set",
    source: "@page\nHi\n",
    expectedKinds: ["page"],
    expectedDiagnosticCount: 0,
    expectedGeneratedCount: 0,
  },
  {
    name: "weird/hostile attrs (an attempted attribute-injection-shaped class value): no throw, block still projects verbatim",
    source: "@section .col-split class='x\"><y'\nA\n@column-break\nB\n@end-section\n",
    expectedKinds: ["section", "column-break"],
    expectedDiagnosticCount: 0,
    expectedGeneratedCount: 0,
  },
  {
    name: "empty document: empty everything, no throw",
    source: "",
    expectedKinds: [],
    expectedDiagnosticCount: 0,
    expectedGeneratedCount: 0,
  },
  {
    name: "CRLF line endings across every marker-family kind at once: exact ranges, correct kind order, chapter-opener still generated",
    source:
      "@chapter C.01\r\n@page one\r\nHi\r\n@section .a\r\nBody\r\n@column-break\r\nMore\r\n@end-section\r\n@page-break\r\n",
    expectedKinds: ["chapter", "page", "section", "column-break", "page-break"],
    expectedDiagnosticCount: 0,
    expectedGeneratedCount: 1,
  },
  {
    name: "orphan @column-break (no enclosing @section at all): still a valid standalone marker token",
    source: "@column-break\nHi\n",
    expectedKinds: ["column-break"],
    expectedDiagnosticCount: 0,
    expectedGeneratedCount: 0,
  },
  {
    name: "a standalone HTML comment: an ordinary html_block with token.map, projects as raw-html",
    source: "before\n\n<!-- a comment -->\n\nafter\n",
    expectedKinds: ["raw-html"],
    expectedDiagnosticCount: 0,
    expectedGeneratedCount: 0,
  },
];

describe("malformed / ambiguity matrix (formalizes Lane A's 12 ad-hoc fixtures)", () => {
  test.each(MALFORMED_MATRIX.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    let projection: GutterpressProjection | undefined;
    expect(() => {
      projection = createEditorProjection(row.source, { sourceVersion: 1 });
    }).not.toThrow();

    expect(projection!.blocks.map((b) => b.kind)).toEqual([...row.expectedKinds]);
    expect(projection!.diagnostics).toHaveLength(row.expectedDiagnosticCount);
    expect(projection!.generated).toHaveLength(row.expectedGeneratedCount);

    // "Document remains projectable": re-running the SAME projection call is
    // pure/idempotent and still never throws (a real editor re-derives the
    // projection on every keystroke -- D6: "Projection output is derived and
    // may be discarded and rebuilt at any time").
    expect(() => createEditorProjection(row.source, { sourceVersion: 2 })).not.toThrow();
  });

  // Row 11/12 of the matrix: a map-less AP-05-shaped token (needs its own
  // synthetic `md`, so it cannot share the default-pipeline table above) and
  // inline HTML (already exact-asserted in editor-projection.test.ts's own
  // "raw HTML blocks" describe -- reasserted here so this file's matrix
  // count is honestly 12, not 10, per the run spec's own enumeration).

  test("(matrix item 11) a map-less layout_-prefixed token (AP-05 shape): no throw, zero blocks, exactly one named diagnostic, document stays projectable", () => {
    const md = new MarkdownIt({ html: true });
    md.block.ruler.before("paragraph", "fake_region_test_only", (state, startLine, _endLine, silent) => {
      const pos = state.bMarks[startLine]! + state.tShift[startLine]!;
      const max = state.eMarks[startLine]!;
      const line = state.src.slice(pos, max);
      if (line.trim() !== "@@region") return false;
      if (silent) return true;
      // Deliberately no token.map, no token.meta -- the AP-05 shape.
      state.push("layout_region_open", "div", 1);
      state.push("layout_region_close", "div", -1);
      state.line = startLine + 1;
      return true;
    });

    const source = "@@region\nHello\n";
    let projection: GutterpressProjection | undefined;
    expect(() => {
      projection = createEditorProjection(source, { sourceVersion: 1, md });
    }).not.toThrow();

    expect(projection!.blocks).toHaveLength(0);
    expect(projection!.diagnostics).toHaveLength(1);
    expect(projection!.diagnostics[0]!.category).toBe("EDITOR_UNSUPPORTED_PROJECTION");
    expect(projection!.diagnostics[0]!.reason).toContain("layout_region_open");
    expect(source).toContain("Hello"); // fail-closed, not fail-blocked
    expect(() => createEditorProjection(source, { sourceVersion: 2, md })).not.toThrow();
  });

  test("(matrix item 12) inline HTML: no throw, zero blocks, exactly one diagnostic, document stays projectable", () => {
    const source = "Some <b>bold</b> text.\n";
    let projection: GutterpressProjection | undefined;
    expect(() => {
      projection = createEditorProjection(source, { sourceVersion: 1 });
    }).not.toThrow();

    expect(projection!.blocks).toHaveLength(0);
    expect(projection!.diagnostics).toHaveLength(1);
    expect(projection!.diagnostics[0]!.category).toBe("EDITOR_UNSUPPORTED_PROJECTION");
    expect(() => createEditorProjection(source, { sourceVersion: 2 })).not.toThrow();
  });

  test("liveness (AP-21): the matrix table itself has exactly 10 rows, plus 2 standalone tests above = 12 total", () => {
    expect(MALFORMED_MATRIX).toHaveLength(10);
  });
});
