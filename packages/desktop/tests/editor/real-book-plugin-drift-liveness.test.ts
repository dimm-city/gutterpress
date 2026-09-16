/**
 * real-book-plugin-drift-liveness.test.ts (SFE-P3d-parity, then SFE-P3e Lane A)
 *
 * Parity-gate condition 3, PLUGIN-BOOK half of DELIVERABLE 3 — G-12/AP-20
 * byte-drift liveness, applied to this lane's own plugin-region-specific
 * claims. `real-book-plugin-byte-identity.test.ts` and
 * `real-book-plugin-locality.test.ts` prove the POSITIVE case on the
 * plugin-book corpus; this file is the SABOTAGE proof that those specific
 * assertions — including the plugin-region-adjacency and inside-refused-
 * region claims this lane adds beyond Lane B's generic corpus — are capable
 * of failing at all.
 *
 * Three parts, each targeting a claim THIS lane's other two files rely on
 * that Lane B's sibling `real-book-drift-liveness.test.ts` does not cover
 * (that file already proves the generic byte-identity/independent-bound
 * sabotage on its own corpus; duplicating that exact proof again here on
 * different fixture text would not add evidence — this file targets what is
 * actually NEW in this lane):
 *
 *   A. The plugin-region LIVENESS assertion itself (AP-21: "a projection
 *      with zero plugin regions makes the whole test vacuous") — proves
 *      that if the fixture or the plugin ever stopped firing, this lane's
 *      liveness check would catch it, not silently pass on zero regions.
 *      This is the failure mode pr158-lessons.md AP-21 names directly: "The
 *      first plugin-region interaction check reported success on a chapter
 *      with no relevant regions."
 *   B. The no-edit byte-identity assertion, on the plugin-book corpus
 *      specifically (same sabotage shapes as Lane B's file, applied to
 *      THIS lane's own fixture — proving this lane's own corpus, not just
 *      Lane B's, is capable of catching drift).
 *   C. The adjacent-to-plugin-region / inside-refused-region locality
 *      claims from `real-book-plugin-locality.test.ts` — proves a
 *      sabotaged edit that widens into (or past) a plugin region trips
 *      BOTH the reused independent-bound oracle AND this lane's own
 *      region-boundary check, on real plugin-book text.
 */
import { describe, expect, test } from "bun:test";
import { DesktopDocumentHost } from "../../src/lib/editor-host/desktop-document-host";
import { createEditorProjection } from "gutterpress/render";
import type { DocumentSnapshot, EditorDocumentHost, SourceEdit } from "@dimm-city/gutterpress-editor/core";
import { CORPUS_COMMAND_CASES } from "../../../editor/tests/corpus/support/command-harness.ts";
import { assertEditWithinIndependentBound } from "../../../editor/tests/corpus/support/independent-bound.ts";
import MarkdownIt from "markdown-it";
import { createMarkdownRenderer } from "gutterpress/render";
import {
  loadPluginBookChapters,
  buildRealPluginBookProjection,
  type PluginBookChapter,
} from "../fixtures/plugin-book/support";

const LOADED: readonly PluginBookChapter[] = loadPluginBookChapters();
const CHAPTERS_WITH_CALLOUTS = LOADED.filter((f) => /^@@callout\s+.+$/m.test(f.text));

// ── Part A — plugin-region liveness sabotage (this lane's own AP-21 claim) ─

describe("drift liveness (G-12/AP-20) — the plugin-region LIVENESS assertion CAN fail", () => {
  test("a markdown-it instance with NO project plugin loaded produces ZERO plugin-region blocks on a chapter this lane claims has one -- the liveness assertion trips", () => {
    const file = CHAPTERS_WITH_CALLOUTS[0]!;
    // The exact sabotage shape this lane guards against: the fixture / the
    // "plugin loaded" wiring silently regresses to a plain, plugin-free
    // renderer (mirrors `+page.svelte`'s TODAY reality — see
    // `real-book-plugin-byte-identity.test.ts`'s header).
    const plainMd = createMarkdownRenderer();
    const projection = createEditorProjection(file.text, { sourceVersion: 0, md: plainMd, trusted: true });
    const pluginRegionCount = projection.blocks.filter((b) => b.kind === "plugin-region").length;
    expect(pluginRegionCount).toBe(0);

    // The EXACT liveness assertion the byte-identity file runs before
    // trusting its own byte-identity checks — reproduced here (not
    // imported: each real-book-plugin-*.test.ts is self-contained, matching
    // Lane B's own per-file convention) to prove it throws under this
    // sabotage.
    expect(() => {
      expect(pluginRegionCount).toBeGreaterThan(0);
    }).toThrow();
  });

  test("a callout plugin registered under the WRONG marker syntax (a fixture/plugin mismatch) also trips the same liveness assertion", () => {
    const file = CHAPTERS_WITH_CALLOUTS[0]!;
    // A plugin that looks for a marker the fixture does not use — models a
    // fixture/plugin drift (someone renamed the fixture's marker syntax
    // without updating the plugin, or vice versa) rather than a totally
    // missing plugin.
    const wrongMarkerPlugin = (md: MarkdownIt): void => {
      md.core.ruler.after("layout_transform", "wrong_marker_transform", (state) => {
        const out: typeof state.tokens = [];
        for (let i = 0; i < state.tokens.length; i++) {
          const tok = state.tokens[i]!;
          const next = state.tokens[i + 1];
          const closer = state.tokens[i + 2];
          const match =
            tok.type === "paragraph_open" && next?.type === "inline" && closer?.type === "paragraph_close"
              ? /^@@nonexistent-marker\s+(.+)$/.exec(next.content)
              : null;
          if (!match) {
            out.push(tok);
            continue;
          }
          const open = new state.Token("plugin_callout_open", "div", 1);
          open.map = tok.map;
          out.push(open);
          out.push(new state.Token("plugin_callout_close", "div", -1));
          i += 2;
        }
        state.tokens = out;
      });
    };
    const md = createMarkdownRenderer([{ name: "wrong-marker-plugin", plugin: wrongMarkerPlugin, options: {} }]);
    const projection = createEditorProjection(file.text, { sourceVersion: 0, md, trusted: true });
    const pluginRegionCount = projection.blocks.filter((b) => b.kind === "plugin-region").length;
    expect(pluginRegionCount).toBe(0);
    expect(() => {
      expect(pluginRegionCount).toBeGreaterThan(0);
    }).toThrow();
  });

  test("POSITIVE CONTROL: the REAL callout plugin, loaded through the REAL host pipeline, on the real fixture, does NOT trip the same liveness assertion", async () => {
    const file = CHAPTERS_WITH_CALLOUTS[0]!;
    const { projection, pluginErrors } = await buildRealPluginBookProjection(file.text, 0);
    expect(pluginErrors).toEqual([]);
    const pluginRegionCount = projection.blocks.filter((b) => b.kind === "plugin-region").length;
    expect(() => {
      expect(pluginRegionCount).toBeGreaterThan(0);
    }).not.toThrow();
  });
});

// ── Part B — no-edit byte-identity sabotage, on the plugin-book corpus ────

function assertNoEditByteIdentity(host: Pick<EditorDocumentHost, "getSnapshot">, original: string): void {
  const after = host.getSnapshot();
  expect(after.text).toBe(original);
  expect(Buffer.from(after.text, "utf8").equals(Buffer.from(original, "utf8"))).toBe(true);
}

function driftingFakeHost(
  originalText: string,
  drift: (t: string) => string,
): { getSnapshot(): DocumentSnapshot; sabotageMount(): void } {
  let text = originalText;
  return {
    getSnapshot: () => ({ text, version: 0 }),
    sabotageMount: () => {
      text = drift(text);
    },
  };
}

const DRIFT_MODES: readonly { readonly label: string; readonly drift: (t: string) => string }[] = [
  { label: "appended trailing space", drift: (t) => `${t} ` },
  { label: "dropped final character", drift: (t) => t.slice(0, -1) },
  {
    label: "substituted one mid-document character",
    drift: (t) =>
      t.length < 2 ? `${t}x` : t.slice(0, Math.floor(t.length / 2)) + "X" + t.slice(Math.floor(t.length / 2) + 1),
  },
];

describe("drift liveness (G-12/AP-20) — the plugin-book no-edit byte-identity assertion CAN fail", () => {
  for (const file of LOADED) {
    for (const mode of DRIFT_MODES) {
      test(`${file.id} — ${mode.label}: a silently-drifting mount trips the byte-identity assertion`, () => {
        const host = driftingFakeHost(file.text, mode.drift);
        host.sabotageMount();
        expect(() => assertNoEditByteIdentity(host, file.text)).toThrow();
      });
    }

    test(`${file.id} — POSITIVE CONTROL: the real DesktopDocumentHost, mounted with zero edits, does NOT trip the same assertion`, () => {
      const host = new DesktopDocumentHost(file.text, { documentId: `${file.id}#drift-control` });
      expect(() => assertNoEditByteIdentity(host, file.text)).not.toThrow();
    });
  }
});

// ── Part C — plugin-region-adjacent / inside-refused-region sabotage ─────

function widenToWholeDocumentRewrite(text: string): SourceEdit {
  return {
    from: 0,
    to: text.length,
    insert: "SABOTAGED: this edit silently rewrote the entire document.",
    expectedVersion: 0,
  };
}

interface PluginRegionInfo {
  readonly file: PluginBookChapter;
  readonly from: number;
  readonly to: number;
}

const REGIONS: readonly PluginRegionInfo[] = await Promise.all(
  CHAPTERS_WITH_CALLOUTS.map(async (file) => {
    const { projection } = await buildRealPluginBookProjection(file.text, 0);
    const block = projection.blocks.find((b) => b.kind === "plugin-region")!;
    return { file, from: block.from, to: block.to };
  }),
);

function isLooseOrderedListCase(commandCase: {
  readonly command: { readonly kind: string; readonly variant?: string };
}): boolean {
  return commandCase.command.kind === "toggle-list" && commandCase.command.variant === "ordered";
}

describe("drift liveness (G-12/AP-20) — the reused independent-bound oracle CAN fail on plugin-region-adjacent selections", () => {
  for (const region of REGIONS) {
    // A selection just before the plugin region — the exact shape
    // `real-book-plugin-locality.test.ts`'s "adjacent" tests use.
    const selection = { start: Math.max(0, region.from - 2), endExclusive: Math.max(0, region.from - 2) };

    for (const commandCase of CORPUS_COMMAND_CASES.filter((c) => !isLooseOrderedListCase(c))) {
      test(`${region.file.id} / ${commandCase.label} / adjacent-before-region — a whole-document-rewrite edit trips the independent bound`, () => {
        const sabotagedEdit = widenToWholeDocumentRewrite(region.file.text);
        expect(() =>
          assertEditWithinIndependentBound(commandCase.command, region.file.text, selection, sabotagedEdit),
        ).toThrow();
      });
    }

    test(`${region.file.id} — a sabotaged edit that overlaps INTO the plugin region trips this lane's own region-boundary check`, () => {
      // A "just barely reaches into the region" sabotage: one byte past
      // the true bound, ending one character INSIDE [region.from,
      // region.to) instead of stopping at region.from — the exact shape
      // `real-book-plugin-locality.test.ts`'s "edit stays outside" checks
      // (`expect(result.edit.to).toBeLessThanOrEqual(region.from)`) exist
      // to catch.
      const sabotagedEdit: SourceEdit = {
        from: selection.start,
        to: region.from + 1,
        insert: "X",
        expectedVersion: 0,
      };
      expect(() => {
        expect(sabotagedEdit.to).toBeLessThanOrEqual(region.from);
      }).toThrow();
    });
  }

  // POSITIVE CONTROL lives in real-book-plugin-locality.test.ts: every
  // adjacent-to-region and inside-refused-region case run there against the
  // REAL (unsabotaged) command layer does NOT trip either check — this file
  // exists only to prove the other direction, that both checks WOULD fail
  // if the implementation regressed.
});
