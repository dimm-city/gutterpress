/**
 * real-book-plugin-locality.test.ts (SFE-P3d-parity, Lane E)
 *
 * Parity-gate condition 3, PLUGIN-BOOK half of DELIVERABLE 2 — "A
 * representative edit in each real chapter changes exactly its own range
 * and nothing else, asserted against an independent oracle (the P2a
 * locality oracle, reused, not re-derived)."
 *
 * The run spec's own DETAILS section names the case that matters most for
 * this lane specifically: "Include the case that matters most: an edit
 * ADJACENT to a plugin region must not disturb the region, and an edit
 * INSIDE a refused/unsupported region must either be exact or refuse —
 * never silently rewrite." Both are covered below, on the real plugin-book
 * corpus (`packages/desktop/tests/fixtures/plugin-book/`), through the same
 * reused P2a oracle Lane B's `real-book-locality.test.ts` uses — imported
 * from `packages/editor/tests/corpus/support/independent-bound.ts`, not
 * re-derived (that file's own header explains why a second, self-agreeing
 * oracle would prove nothing).
 *
 * ## What "inside a refused/unsupported region" means here
 *
 * D6/G-06: an unrecognized plugin token with insufficient evidence gets a
 * typed diagnostic and NO `ProjectedBlock` — the document is never locked,
 * it fails CLOSED to plain source text (see
 * `editor-projection-plugins.test.ts`'s own "no-evidence" describe block).
 * So there is no separate "locked region" concept at the source-edit layer:
 * the shared command layer (`applyCommand`) has no notion of projections at
 * all. What this file proves is that even INSIDE the exact byte range a
 * refused plugin token occupies, the real command layer + independent
 * oracle behave exactly as they do everywhere else in real prose — bounded
 * ("exact") or refused, never a silent wide rewrite — which is what makes
 * "no chip, source mode fallback" a SAFE degradation rather than a hidden
 * risk.
 */
import { describe, expect, test } from "bun:test";
import { DesktopDocumentHost } from "../../src/lib/editor-host/desktop-document-host";
import { applyRichCommand } from "../../src/lib/editor/rich-commands";
import { createEditorProjection } from "gutterpress/render";
import { DIAGNOSTIC_CATEGORIES } from "@dimm-city/gutterpress-editor/core";
import {
  CORPUS_COMMAND_CASES,
  computeAgainstHost,
  spliceIndependently,
} from "../../../editor/tests/corpus/support/command-harness.ts";
import { assertEditWithinIndependentBound } from "../../../editor/tests/corpus/support/independent-bound.ts";
import { loadPluginBookChapters, pluginBookRenderer, type PluginBookChapter } from "../fixtures/plugin-book/support";

const LOADED: readonly PluginBookChapter[] = loadPluginBookChapters();
const CHAPTERS_WITH_CALLOUTS = LOADED.filter((f) => /^@@callout\s+.+$/m.test(f.text));

// AP-21 liveness: this file's own core premise (there IS a plugin region to
// test adjacency/interior locality against) must hold before anything else
// runs.
if (CHAPTERS_WITH_CALLOUTS.length === 0) {
  throw new Error(
    "real-book-plugin-locality.test.ts: no plugin-book chapter contains a \"@@callout\" marker — the fixture " +
      "changed shape and this file's entire premise is now vacuous.",
  );
}

/** Walks backward from `from` over the blank-line run to the end of the
 *  preceding non-blank content, then two characters further in — a caret
 *  comfortably OUTSIDE `[from, to)`, even accounting for the widest
 *  wrap-toggle marker slop (`independent-bound.ts`'s `WRAP_MAX_MARKER_LEN`,
 *  max 2 chars). */
function caretBeforeRange(text: string, from: number): number {
  let i = from;
  while (i > 0 && (text.charAt(i - 1) === "\n" || text.charAt(i - 1) === "\r")) i--;
  return Math.max(0, i - 2);
}

/** The mirror of {@link caretBeforeRange}, walking forward from `to`. */
function caretAfterRange(text: string, to: number): number {
  let i = to;
  while (i < text.length && (text.charAt(i) === "\n" || text.charAt(i) === "\r")) i++;
  return Math.min(text.length, i + 2);
}

interface PluginRegionInfo {
  readonly file: PluginBookChapter;
  readonly from: number;
  readonly to: number;
}

/** The evidence-bearing `plugin-region` block per callout chapter, resolved
 *  through the real, unmodified production projection — never hand-built. */
const REGIONS: readonly PluginRegionInfo[] = CHAPTERS_WITH_CALLOUTS.map((file) => {
  const md = pluginBookRenderer(true);
  const projection = createEditorProjection(file.text, { sourceVersion: 0, md, trusted: true });
  const block = projection.blocks.find((b) => b.kind === "plugin-region");
  if (!block) {
    throw new Error(`${file.id}: expected a plugin-region block (AP-21 liveness) but found none.`);
  }
  return { file, from: block.from, to: block.to };
});

let adjacentAcceptedCount = 0;
let adjacentRefusedCount = 0;

describe("edit ADJACENT to a plugin region must not disturb the region", () => {
  for (const region of REGIONS) {
    const before = caretBeforeRange(region.file.text, region.from);
    const after = caretAfterRange(region.file.text, region.to);

    for (const commandCase of CORPUS_COMMAND_CASES) {
      test(`${region.file.id} / ${commandCase.label} / caret just BEFORE the plugin region — edit stays outside [${region.from},${region.to})`, () => {
        const host = new DesktopDocumentHost(region.file.text, { documentId: `${region.file.id}#before` });
        const selection = { start: before, endExclusive: before };
        const result = computeAgainstHost(host, selection, commandCase.command);
        if ("refused" in result) {
          expect(DIAGNOSTIC_CATEGORIES).toContain(result.refused.category);
          expect(host.getSnapshot().text).toBe(region.file.text);
          adjacentRefusedCount++;
          return;
        }
        adjacentAcceptedCount++;
        assertEditWithinIndependentBound(commandCase.command, region.file.text, selection, result.edit);
        // The region-specific claim this deliverable names directly: the
        // edit does not reach into the plugin region's own byte range at
        // all.
        expect(result.edit.to).toBeLessThanOrEqual(region.from);
      });

      test(`${region.file.id} / ${commandCase.label} / caret just AFTER the plugin region — edit stays outside [${region.from},${region.to})`, () => {
        const host = new DesktopDocumentHost(region.file.text, { documentId: `${region.file.id}#after` });
        const selection = { start: after, endExclusive: after };
        const result = computeAgainstHost(host, selection, commandCase.command);
        if ("refused" in result) {
          expect(DIAGNOSTIC_CATEGORIES).toContain(result.refused.category);
          expect(host.getSnapshot().text).toBe(region.file.text);
          adjacentRefusedCount++;
          return;
        }
        adjacentAcceptedCount++;
        assertEditWithinIndependentBound(commandCase.command, region.file.text, selection, result.edit);
        expect(result.edit.from).toBeGreaterThanOrEqual(region.to);
      });
    }
  }

  test("liveness (AP-21): the adjacent-to-plugin-region sweep was not universally refused", () => {
    expect(adjacentAcceptedCount + adjacentRefusedCount).toBeGreaterThan(0);
    expect(adjacentAcceptedCount).toBeGreaterThan(0);
  });
});

describe("the actual desktop entry point (applyRichCommand) also leaves an adjacent plugin region untouched", () => {
  for (const region of REGIONS) {
    test(`${region.file.id} — applyRichCommand(toggle-bold) at a caret just before the plugin region does not touch [${region.from},${region.to})`, () => {
      const before = caretBeforeRange(region.file.text, region.from);
      const host = new DesktopDocumentHost(region.file.text, { documentId: `${region.file.id}#rich-before` });
      const outcome = applyRichCommand(host, { kind: "toggle-bold" }, { from: before, to: before });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      // The region's own text (by exact byte range on the ORIGINAL
      // document) is still present, byte for byte, in the edited result —
      // the strongest available "the region itself was not disturbed"
      // check, independent of where the insertion landed.
      const regionText = region.file.text.slice(region.from, region.to);
      expect(outcome.snapshot.text).toContain(regionText);
    });
  }
});

// ── edit INSIDE a refused/unsupported region ────────────────────────────

interface RefusedRegionInfo {
  readonly file: PluginBookChapter;
  readonly from: number;
  readonly to: number;
}

/** The SAME chapters, but through the no-evidence plugin variant: no
 *  `plugin-region` block is produced (D6 fail-closed), only a diagnostic —
 *  the exact "unsupported projection" shape the run spec's "refused"
 *  wording names. The byte range tested below is the marker's own raw
 *  source line, resolved independently of any projection (a plain regex
 *  match against the committed fixture text), since a refused token has no
 *  `ProjectedBlock.from`/`.to` to read. */
const REFUSED_REGIONS: readonly RefusedRegionInfo[] = CHAPTERS_WITH_CALLOUTS.map((file) => {
  const noEvidenceMd = pluginBookRenderer(false);
  const projection = createEditorProjection(file.text, { sourceVersion: 0, md: noEvidenceMd, trusted: true });

  // AP-21 liveness: prove the no-evidence variant genuinely produces the
  // refused shape on this exact chapter before this file relies on it.
  expect(projection.blocks.some((b) => b.kind === "plugin-region")).toBe(false);
  const refusal = projection.diagnostics.find((d) => d.reason.includes("plugin_callout_open"));
  if (!refusal) {
    throw new Error(`${file.id}: expected an EDITOR_UNSUPPORTED_PROJECTION diagnostic naming plugin_callout_open.`);
  }
  expect(refusal.category).toBe("EDITOR_UNSUPPORTED_PROJECTION");

  const match = /^@@callout\s+.+$/m.exec(file.text);
  if (!match) throw new Error(`${file.id}: expected a "@@callout ..." source line.`);
  return { file, from: match.index, to: match.index + match[0]!.length };
});

let insideAcceptedCount = 0;
let insideRefusedCount = 0;

describe("edit INSIDE a refused/unsupported plugin region — exact or refused, never a silent wide rewrite", () => {
  for (const region of REFUSED_REGIONS) {
    // A collapsed caret and a full-line selection strictly inside the
    // marker's own raw text — the two shapes a rich surface with no chip
    // for this region would actually offer an author (typing at a point,
    // or selecting the visible line before formatting it).
    const midpoint = Math.floor((region.from + region.to) / 2);
    const selections: readonly { readonly label: string; readonly selection: { start: number; endExclusive: number } }[] = [
      { label: "caret inside the unsupported region", selection: { start: midpoint, endExclusive: midpoint } },
      { label: "whole unsupported-region line selected", selection: { start: region.from, endExclusive: region.to } },
    ];

    for (const { label, selection } of selections) {
      for (const commandCase of CORPUS_COMMAND_CASES) {
        test(`${region.file.id} / ${commandCase.label} / ${label} — edit is exact-and-bounded or refused, never a silent wide rewrite`, () => {
          const host = new DesktopDocumentHost(region.file.text, {
            documentId: `${region.file.id}#refused-${label}`,
          });
          const result = computeAgainstHost(host, selection, commandCase.command);
          if ("refused" in result) {
            expect(DIAGNOSTIC_CATEGORIES).toContain(result.refused.category);
            expect(host.getSnapshot().text).toBe(region.file.text);
            insideRefusedCount++;
            return;
          }
          insideAcceptedCount++;
          // "Exact": bounded by the SAME reused independent oracle every
          // other real-book locality assertion uses — proves the edit did
          // NOT silently widen to cover the whole document (or the whole
          // chapter) just because this particular region has no chip.
          assertEditWithinIndependentBound(commandCase.command, region.file.text, selection, result.edit);
          const expected = spliceIndependently(region.file.text, result.edit.from, result.edit.to, result.edit.insert);
          expect(host.getSnapshot().text).toBe(expected);
        });
      }
    }
  }

  test("liveness (AP-21): the inside-refused-region sweep was not universally refused", () => {
    expect(insideAcceptedCount + insideRefusedCount).toBeGreaterThan(0);
    expect(insideAcceptedCount).toBeGreaterThan(0);
  });
});
