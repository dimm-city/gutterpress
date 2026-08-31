/**
 * SFE-P2c Lane A — plugin-awareness acceptance tests for
 * `createEditorProjection` (run docs/plans/source-first-editor/runs/SFE-P2c.md).
 * Co-located with `editor-projection.ts`/`editor-projection.test.ts` per this
 * package's convention. Renders through the REAL pipeline
 * (`createMarkdownRenderer([...loadedPlugins])`, never a parallel parser
 * config — G-03), exactly like `editor-projection-limits.test.ts`'s own
 * `bigHtmlPlugin` fixture (SFE-P2b Lane C).
 *
 * SCOPE: this file owns everything SFE-P2c Lane A adds to
 * `editor-projection.ts` — the `trusted` gate and the evidence-bearing
 * `plugin-region` classification. It does NOT test Lane B's origin-recovery
 * mechanism (unbuilt as of this run — the map-less fixture below proves only
 * that this lane's own integration point fails closed, per the run spec's
 * "leave a clearly-marked integration point" instruction) and does NOT
 * re-test P2b's marker-family/raw-html/generated-view contract —
 * `editor-projection.test.ts` and `editor-projection-limits.test.ts` (both
 * untouched by this lane) are the source of truth for those and must keep
 * passing UNMODIFIED alongside this file (verified together — see this run's
 * gate commands).
 *
 * FIXTURE SHAPE ("a realistic plugin fixture shaped like a REAL registered
 * markdown-it rule" — the run spec's test-plan wording): `asideMarkerPlugin`
 * below mirrors markers.js's OWN `layout_transform` core rule pattern
 * exactly (see `markers.js`'s header and its
 * `md.core.ruler.after('block', 'layout_transform', ...)` registration): a
 * single core rule, anchored `after('layout_transform', ...)` — the position
 * a REAL project plugin loaded via `applyPlugins` runs at, since
 * `renderer.ts` applies custom plugins after `md.use(gutterpressMarkers)` —
 * walks the flat block-level token array exactly once, consumes a
 * recognized paragraph (the standard `paragraph_open`/`inline`/
 * `paragraph_close` triple markdown-it's own paragraph rule produces),
 * replaces it with a single custom open/close pair, and pushes every OTHER
 * token through UNCHANGED by the SAME object reference — the exact
 * survivor-preservation shape `markers.js`'s own `out.push(tok)` establishes
 * for content it does not touch. `packages/open-design-plugin` (the run
 * spec's other named reference) ships no markdown-it rule of its own to
 * study — it is a Claude Code skill package, not a markdown-it plugin — so
 * markers.js is the concrete, in-repo reference this fixture follows.
 *
 * AP-21 LIVENESS: every describe block below asserts the plugin's own
 * emitted token type actually appears in the token stream (via a direct
 * `md.parse()` call, independent of `createEditorProjection`) BEFORE any
 * projection-behavior assertion — see each test's own "liveness" line.
 */
import { describe, test, expect } from "bun:test";
import MarkdownIt from "markdown-it";
import {
  createEditorProjection,
  type GutterpressProjection,
  type ProjectedBlock,
  type ProjectedBlockKind,
} from "./editor-projection";
import { createMarkdownRenderer, type LoadedPlugin } from "./renderer";

// ── realistic plugin fixture ─────────────────────────────────────────────

const ASIDE_RE = /^@@aside\s+(.+)$/;

/**
 * A realistic project-plugin core rule (see this file's header). Recognizes
 * a `@@aside <label>` paragraph and replaces it with a single
 * `plugin_aside_open`/`plugin_aside_close` pair carrying the label as a
 * `data-aside-label` attribute (mirroring markers.js's own `meta.name` ->
 * `data-<kind>-label` pattern).
 *
 * `keepEvidence` selects which of this run's two required shapes the
 * emitted open token gets:
 *   - `true`: copies `token.map` from the consumed `paragraph_open`'s own
 *     map — "some plugins preserve token.map" (the evidence-bearing case
 *     this lane's classification branch handles directly).
 *   - `false`: emits the open token with NO map/meta at all, mirroring
 *     markers.js's OWN chapter-opener token (`new state.Token(...)`, no
 *     evidence) — the case this lane can only refuse.
 */
function asideMarkerPlugin(keepEvidence: boolean): LoadedPlugin {
  const plugin = (md: MarkdownIt): void => {
    md.core.ruler.after("layout_transform", "aside_plugin_transform", (state) => {
      const out: typeof state.tokens = [];
      for (let i = 0; i < state.tokens.length; i++) {
        const tok = state.tokens[i]!;
        const next = state.tokens[i + 1];
        const closer = state.tokens[i + 2];
        const match =
          tok.type === "paragraph_open" && next?.type === "inline" && closer?.type === "paragraph_close"
            ? ASIDE_RE.exec(next.content)
            : null;
        if (!match) {
          out.push(tok);
          continue;
        }
        const open = new state.Token("plugin_aside_open", "aside", 1);
        open.attrSet("data-aside-label", match[1]!);
        if (keepEvidence) open.map = tok.map;
        out.push(open);
        out.push(new state.Token("plugin_aside_close", "aside", -1));
        i += 2; // consumed paragraph_open + inline + paragraph_close
      }
      state.tokens = out;
    });
  };
  return {
    name: keepEvidence ? "aside-plugin-with-evidence" : "aside-plugin-no-evidence",
    plugin,
    options: {},
  };
}

function blockOf(projection: GutterpressProjection, kind: ProjectedBlockKind): ProjectedBlock {
  const found = projection.blocks.find((b) => b.kind === kind);
  if (!found) throw new Error(`expected a projected block of kind "${kind}", found none (liveness check — AP-21)`);
  return found;
}

function assertSortedNonOverlapping(projection: GutterpressProjection, source: string): void {
  let previous: ProjectedBlock | null = null;
  for (const block of projection.blocks) {
    expect(block.from).toBeGreaterThanOrEqual(0);
    expect(block.from).toBeLessThan(block.to);
    expect(block.to).toBeLessThanOrEqual(source.length);
    if (previous) {
      expect(block.from).toBeGreaterThanOrEqual(previous.from);
      expect(previous.to).toBeLessThanOrEqual(block.from);
    }
    previous = block;
  }
}

// ── evidence-bearing plugin-region ───────────────────────────────────────

describe("evidence-bearing plugin-region (this lane's own scope, in full)", () => {
  test("a plugin token that kept its own token.map projects as plugin-region with the exact byte range", () => {
    const source = "@@aside Pull quote here\n";
    const md = createMarkdownRenderer([asideMarkerPlugin(true)]);

    // AP-21 liveness: prove the transform actually ran before any
    // projection-behavior assertion.
    const tokenTypes = md.parse(source, {}).map((t) => t.type);
    expect(tokenTypes).toContain("plugin_aside_open");
    expect(tokenTypes).toContain("plugin_aside_close");

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    assertSortedNonOverlapping(projection, source);

    expect(projection.blocks).toHaveLength(1);
    const block = blockOf(projection, "plugin-region");
    // Byte-exact, per the run spec's test-plan wording.
    expect(source.slice(block.from, block.to)).toBe("@@aside Pull quote here\n");
    expect(block.editMode).toBe("source");
    expect(projection.diagnostics).toHaveLength(0);
  });

  test("the plugin's own view attributes survive onto the block (AP-06), minus the render graph's bookkeeping keys", () => {
    const source = "@@aside Sidebar label\n";
    const md = createMarkdownRenderer([asideMarkerPlugin(true)]);
    expect(md.parse(source, {}).map((t) => t.type)).toContain("plugin_aside_open");

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    const block = blockOf(projection, "plugin-region");
    expect(block.viewAttributes?.["data-aside-label"]).toBe("Sidebar label");
    expect(block.viewAttributes).not.toHaveProperty("data-source-range");
    expect(block.viewAttributes).not.toHaveProperty("data-chapter-src");
  });

  test("SFE-P2c repair round 1 (finding 6): the block also carries the plugin's own rendered HTML as inactiveHtml, rendered via the SAME md.renderer/rule set the print path uses -- not the raw authored marker text", () => {
    const source = "@@aside Pull quote here\n";
    const md = createMarkdownRenderer([asideMarkerPlugin(true)]);

    // AP-21 liveness + independently-computed expected value: render the
    // SAME open/close token slice through the SAME md.renderer this
    // module's own production code uses (a second `md.parse()` call on the
    // SAME md/source is deterministic, so the resulting STRING matches
    // even though the underlying token OBJECTS differ from the ones
    // createEditorProjection parses internally).
    const tokens = md.parse(source, {});
    const openIdx = tokens.findIndex((t) => t.type === "plugin_aside_open");
    const closeIdx = tokens.findIndex((t) => t.type === "plugin_aside_close");
    expect(openIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThan(openIdx);
    const expectedHtml = md.renderer.render(tokens.slice(openIdx, closeIdx + 1), md.options, {});

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    const block = blockOf(projection, "plugin-region");
    expect(block.inactiveHtml).toBe(expectedHtml);
    // Meaningfully different from the raw authored marker line -- proving
    // this is the PLUGIN's rendered output, not the source text
    // `buildChipPlan` would otherwise fall back to (packages/editor).
    expect(block.inactiveHtml).toContain("<aside");
    expect(block.inactiveHtml).not.toBe(source);
  });
});

// ── no-evidence: typed refusal, Lane B's integration point ──────────────

describe("no-evidence plugin token: typed refusal, no block, document stays projectable", () => {
  test("a plugin token with no token.map/meta.line becomes a diagnostic naming its type, never a block", () => {
    const source = "@@aside Untracked note\n\nTrailing paragraph still here.\n";
    const md = createMarkdownRenderer([asideMarkerPlugin(false)]);

    // AP-21 liveness: the map-less transform really ran.
    expect(md.parse(source, {}).map((t) => t.type)).toContain("plugin_aside_open");

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });

    expect(projection.blocks.find((b) => b.kind === "plugin-region")).toBeUndefined();
    const refusal = projection.diagnostics.find((d) => d.reason.includes("plugin_aside_open"));
    expect(refusal).toBeDefined();
    expect(refusal!.category).toBe("EDITOR_UNSUPPORTED_PROJECTION");
    // SFE-P2c repair round 1 (finding 2): the diagnostic now carries
    // plugin-origin.ts's OWN rule-named refusal reason end to end — not
    // one fixed generic string for every rule-4 shape. This document's
    // shape is "partial evidence" (the consumed paragraph_close never
    // carries token.map), and the offending core rule is named directly.
    expect(refusal!.reason).toMatch(/partial evidence/i);
    expect(refusal!.reason).toMatch(/aside_plugin_transform/);

    // Fail-closed, not fail-blocked: the projection itself is still valid
    // and the document remains fully editable as plain markdown (this run's
    // own module contract — never throw).
    expect(projection.schemaVersion).toBe(1);
    expect(projection.blocks).toHaveLength(0);
  });
});

// ── survivor tokens around both shapes ───────────────────────────────────

describe("survivor tokens project unchanged around a mix of plugin and core-marker content", () => {
  test("an evidence-bearing plugin-region alongside @page/@page-break: all three project, ordered and disjoint", () => {
    const source = [
      "Intro paragraph.",
      "",
      "@page one",
      "",
      "@@aside Pull quote here",
      "",
      "Outro paragraph.",
      "",
      "@page-break",
      "",
    ].join("\n");
    const md = createMarkdownRenderer([asideMarkerPlugin(true)]);
    expect(md.parse(source, {}).map((t) => t.type)).toContain("plugin_aside_open");

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    assertSortedNonOverlapping(projection, source);

    // Exactly the three Gutterpress/plugin-specific blocks — the two plain
    // paragraphs are D6-sparse survivors, not walked at all.
    expect(projection.blocks.map((b) => b.kind)).toEqual(["page", "plugin-region", "page-break"]);
    expect(projection.diagnostics).toHaveLength(0);

    const pageBlock = blockOf(projection, "page");
    expect(source.slice(pageBlock.from, pageBlock.to)).toBe("@page one\n");

    const asideBlock = blockOf(projection, "plugin-region");
    expect(source.slice(asideBlock.from, asideBlock.to)).toBe("@@aside Pull quote here\n");

    const breakBlock = blockOf(projection, "page-break");
    expect(source.slice(breakBlock.from, breakBlock.to)).toBe("@page-break\n");
  });

  test("a no-evidence plugin-region's refusal does not disturb the surrounding @page/@page-break projections", () => {
    const source = [
      "@page one",
      "",
      "@@aside Untracked note",
      "",
      "@page-break",
      "",
    ].join("\n");
    const md = createMarkdownRenderer([asideMarkerPlugin(false)]);
    expect(md.parse(source, {}).map((t) => t.type)).toContain("plugin_aside_open");

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    assertSortedNonOverlapping(projection, source);

    expect(projection.blocks.map((b) => b.kind)).toEqual(["page", "page-break"]);
    const refusal = projection.diagnostics.find((d) => d.reason.includes("plugin_aside_open"));
    expect(refusal).toBeDefined();
  });
});

// ── base-pipeline survivors are never misclassified, even when trusted ──

describe("base-pipeline tokens are never misclassified as plugin-region", () => {
  test("footnotes and definition lists stay unwalked (D6 sparseness) with trusted: true and zero project plugins", () => {
    const source = ["Term", ": Definition", "", "Footnoted text[^1].", "", "[^1]: Footnote body.", ""].join("\n");
    const md = createMarkdownRenderer(); // no project plugins at all
    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    expect(projection.blocks).toHaveLength(0);
    expect(projection.diagnostics).toHaveLength(0);
  });

  test("ordinary paragraphs around an evidence-bearing plugin-region are never themselves classified as plugin-region", () => {
    const source = "Intro paragraph.\n\n@@aside Pull quote here\n\nOutro paragraph.\n";
    const md = createMarkdownRenderer([asideMarkerPlugin(true)]);
    expect(md.parse(source, {}).map((t) => t.type)).toContain("plugin_aside_open");

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    expect(projection.blocks).toHaveLength(1);
    expect(projection.blocks[0]!.kind).toBe("plugin-region");
  });
});

// ── untrusted / no-plugin path: identical to P2b ─────────────────────────

describe("untrusted context (D12 default; behavior-table row A/C)", () => {
  const source = [
    "Intro paragraph.",
    "",
    "@page one",
    "",
    "@@aside Pull quote here",
    "",
    "Outro paragraph.",
    "",
    "@page-break",
    "",
  ].join("\n");

  test("a plugin-applied md WITHOUT trusted:true produces a projection byte-identical to the same source through a plugin-free md", () => {
    const pluginMd = createMarkdownRenderer([asideMarkerPlugin(true)]);
    // AP-21 liveness: the plugin's transform really ran on this exact
    // md/source pair — its output is nonetheless invisible below because
    // trust was withheld, not because it never fired.
    expect(pluginMd.parse(source, {}).map((t) => t.type)).toContain("plugin_aside_open");

    const plainMd = createMarkdownRenderer();

    // `trusted` OMITTED — the default, impossible-to-skip-by-omission
    // untrusted path.
    const withPluginUntrusted = createEditorProjection(source, { sourceVersion: 3, md: pluginMd });
    const withoutPluginAtAll = createEditorProjection(source, { sourceVersion: 3, md: plainMd });

    expect(withPluginUntrusted).toEqual(withoutPluginAtAll);
    expect(withPluginUntrusted.blocks.some((b) => b.kind === "plugin-region")).toBe(false);
    expect(withPluginUntrusted.diagnostics).toHaveLength(0);
  });

  test("trusted: false explicitly behaves identically to omitting the field", () => {
    const pluginMd = createMarkdownRenderer([asideMarkerPlugin(true)]);
    expect(pluginMd.parse(source, {}).map((t) => t.type)).toContain("plugin_aside_open");

    const omitted = createEditorProjection(source, { sourceVersion: 1, md: pluginMd });
    const explicit = createEditorProjection(source, { sourceVersion: 1, md: pluginMd, trusted: false });
    expect(explicit).toEqual(omitted);
  });

  test("the SAME source, trusted, DOES produce a plugin-region — proving 'untrusted' is per-call, not a source/plugin limitation", () => {
    const pluginMd = createMarkdownRenderer([asideMarkerPlugin(true)]);
    const trustedProjection = createEditorProjection(source, { sourceVersion: 1, md: pluginMd, trusted: true });
    expect(trustedProjection.blocks.some((b) => b.kind === "plugin-region")).toBe(true);
  });
});

// ── AP-05 layout_-prefixed diagnostic stays unconditional ───────────────

describe("the pre-existing layout_-prefixed diagnostic is unaffected by the trust gate", () => {
  test("an unrecognized layout_-prefixed token still refuses even when trusted: true", () => {
    const md = new MarkdownIt({ html: true });
    md.block.ruler.before("paragraph", "fake_widget", (state, startLine, _endLine, silent) => {
      const pos = state.bMarks[startLine]! + state.tShift[startLine]!;
      const max = state.eMarks[startLine]!;
      const line = state.src.slice(pos, max);
      if (line.trim() !== "@@widget") return false;
      if (silent) return true;
      state.push("layout_widget_open", "div", 1);
      state.push("layout_widget_close", "div", -1);
      state.line = startLine + 1;
      return true;
    });

    const source = "@@widget\nHello\n";
    // AP-21 liveness against this file's own fixture, independent of
    // editor-projection.test.ts's identical-shape fixture.
    expect(md.parse(source, {}).map((t) => t.type)).toContain("layout_widget_open");

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    expect(projection.blocks).toHaveLength(0);
    expect(projection.diagnostics).toHaveLength(1);
    expect(projection.diagnostics[0]!.category).toBe("EDITOR_UNSUPPORTED_PROJECTION");
    expect(projection.diagnostics[0]!.reason).toContain("layout_widget_open");
  });
});

// ── SFE-P2c repair round 1 — plugin-region corroboration guard ──────────
//
// Reproduces the confirmed finding directly: `plugin-region` previously had
// NO check at all that a claimed range corroborates against source, on
// EITHER the evidence-bearing (`token.map` set by the plugin) or the
// Lane-B-recovered path. Four distinct over-claim shapes, each verified to
// have produced a wrong (nested/overlapping/over-claiming) block before
// this repair round, now refuse instead.

/**
 * Duplicated from `plugin-origin.test.ts` (a small, stable, hr-consuming
 * clean-splice fixture, not production code -- same repo, per-file test
 * duplication is this codebase's own established convention, see this
 * file's `asideMarkerPlugin` header for the identical rationale applied to
 * this fixture). A real registered markdown-it core rule that consumes an
 * `hr` and replaces it with a single, map-less `plugin_tip_open/close`
 * pair -- the Lane-B (origin-recovery) shape, used here to reproduce the
 * corroboration-guard fixtures for the RECOVERED path.
 */
function tipMarkerPlugin(): LoadedPlugin {
  const plugin = (md: MarkdownIt): void => {
    md.core.ruler.after("layout_transform", "tip_marker_transform", (state) => {
      const out: typeof state.tokens = [];
      for (const tok of state.tokens) {
        if (tok.type === "hr") {
          out.push(new state.Token("plugin_tip_open", "aside", 1));
          out.push(new state.Token("plugin_tip_close", "aside", -1));
          continue;
        }
        out.push(tok);
      }
      state.tokens = out;
    });
  };
  return { name: "tip-marker-plugin", plugin, options: {} };
}

/** Registers `after("layout_transform", …)` and wraps the FIRST `@@aside <label>` paragraph with a SINGLE open token whose `token.map` honestly spans from the marker's own line through to the LAST line any surviving token in the document can prove -- the archetypal "wrapper" plugin (CLAUDE.md §5: "@sidebar or @callout") that preserves everything else by identity. */
function wrapperAsideMarkerPlugin(): LoadedPlugin {
  const plugin = (md: MarkdownIt): void => {
    md.core.ruler.after("layout_transform", "wrapper_aside_transform", (state) => {
      let endLine = 0;
      for (const t of state.tokens) {
        if (Array.isArray(t.map)) endLine = Math.max(endLine, t.map[1]);
      }
      const out: typeof state.tokens = [];
      let wrapped = false;
      for (let i = 0; i < state.tokens.length; i++) {
        const tok = state.tokens[i]!;
        const next = state.tokens[i + 1];
        const closer = state.tokens[i + 2];
        const match =
          !wrapped && tok.type === "paragraph_open" && next?.type === "inline" && closer?.type === "paragraph_close"
            ? ASIDE_RE.exec(next.content)
            : null;
        if (match) {
          const open = new state.Token("plugin_wrapper_open", "aside", 1);
          open.attrSet("data-aside-label", match[1]!);
          open.map = [tok.map![0]!, endLine];
          out.push(open);
          i += 2;
          wrapped = true;
          continue;
        }
        out.push(tok);
      }
      if (wrapped) out.push(new state.Token("plugin_wrapper_close", "aside", -1));
      state.tokens = out;
    });
  };
  return { name: "wrapper-aside-plugin", plugin, options: {} };
}

describe("shape 1 -- nested/overlapping blocks (a wrapper plugin claims a wide, honestly-computed map around a survivor marker token)", () => {
  test("a wrapper plugin-region that would nest a @page-break inside its own range refuses instead of producing overlapping blocks; the page-break still projects on its own", () => {
    const source = "@@aside Note\n\n@page-break\n\nTail.\n";
    const md = createMarkdownRenderer([wrapperAsideMarkerPlugin()]);

    // AP-21 liveness: the wrapper really claims through the end of the
    // document, and layout_page_break really survives by identity.
    const tokenTypes = md.parse(source, {}).map((t) => t.type);
    expect(tokenTypes).toContain("plugin_wrapper_open");
    expect(tokenTypes).toContain("layout_page_break");

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    assertSortedNonOverlapping(projection, source);

    expect(projection.blocks.map((b) => b.kind)).toEqual(["page-break"]);
    const refusal = projection.diagnostics.find((d) => d.reason.includes("plugin_wrapper_open"));
    expect(refusal).toBeDefined();
    expect(refusal!.reason).toMatch(/nested Gutterpress marker|corroborate against source/i);
  });

  test("SFE-P2c repair round 2: a wrapper plugin-region that would nest a raw-html block refuses instead of producing overlapping blocks -- the raw-html block still projects on its own", () => {
    // The residual shape `pluginRegionLinesLookAuthored`'s `@`-line content
    // heuristic (the test above) cannot catch: `<div>hi</div>` never starts
    // with `@`, so a wrapper honestly claiming `token.map` through the end
    // of the document slipped past that check entirely pre-fix, yielding
    // BOTH a `plugin-region` covering the whole document AND a nested
    // `raw-html` block -- `blocks[0].to > blocks[1].from`, violating this
    // module's own "never overlapping, never nested" invariant.
    const source = "@@aside Note\n\n<div>hi</div>\n\nTail.\n";
    const md = createMarkdownRenderer([wrapperAsideMarkerPlugin()]);

    // AP-21 liveness: the wrapper really claims through the end of the
    // document, and the raw html_block really survives by identity.
    const tokenTypes = md.parse(source, {}).map((t) => t.type);
    expect(tokenTypes).toContain("plugin_wrapper_open");
    expect(tokenTypes).toContain("html_block");

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    assertSortedNonOverlapping(projection, source);

    expect(projection.blocks.map((b) => b.kind)).toEqual(["raw-html"]);
    const rawHtmlBlock = blockOf(projection, "raw-html");
    expect(source.slice(rawHtmlBlock.from, rawHtmlBlock.to)).toBe("<div>hi</div>\n");

    const refusal = projection.diagnostics.find((d) => d.reason.includes("plugin_wrapper_open"));
    expect(refusal).toBeDefined();
    expect(refusal!.reason).toMatch(/raw-html/i);
  });
});

describe("shape 2 -- container-prefix over-claim (a marker line nested under a blockquote or list item)", () => {
  test("evidence-bearing path: '> @@aside ...' refuses -- the plugin's own token.map, widened to whole lines, would otherwise claim the blockquote's own '>' byte", () => {
    const source = "> @@aside Nested label\n";
    const md = createMarkdownRenderer([asideMarkerPlugin(true)]);
    expect(md.parse(source, {}).map((t) => t.type)).toContain("plugin_aside_open");

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    expect(projection.blocks).toHaveLength(0);
    const refusal = projection.diagnostics.find((d) => d.reason.includes("plugin_aside_open"));
    expect(refusal).toBeDefined();
    expect(refusal!.reason).toMatch(/container-prefixed|corroborate against source/i);
  });

  test("evidence-bearing path: '- @@aside ...' (a list item) refuses the same way", () => {
    const source = "- @@aside In a list\n";
    const md = createMarkdownRenderer([asideMarkerPlugin(true)]);
    expect(md.parse(source, {}).map((t) => t.type)).toContain("plugin_aside_open");

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    expect(projection.blocks).toHaveLength(0);
    const refusal = projection.diagnostics.find((d) => d.reason.includes("plugin_aside_open"));
    expect(refusal).toBeDefined();
  });

  test("Lane-B recovered path: a blockquoted '> ---' refuses the same way -- what P2b refuses for markers, P2c now also refuses for plugin-regions", () => {
    const source = "> ---\n";
    const md = createMarkdownRenderer([tipMarkerPlugin()]);
    expect(md.parse(source, {}).map((t) => t.type)).toContain("plugin_tip_open");

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    expect(projection.blocks).toHaveLength(0);
    const refusal = projection.diagnostics.find((d) => d.reason.includes("plugin_tip_open"));
    expect(refusal).toBeDefined();
    expect(refusal!.reason).toMatch(/container-prefixed|corroborate against source/i);
  });

  test("Lane-B recovered path: 'A.\\n\\n> ---\\n\\nB.\\n' (blockquoted mid-document) refuses the same way", () => {
    const source = "A.\n\n> ---\n\nB.\n";
    const md = createMarkdownRenderer([tipMarkerPlugin()]);
    expect(md.parse(source, {}).map((t) => t.type)).toContain("plugin_tip_open");

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    expect(projection.blocks).toHaveLength(0);
    const refusal = projection.diagnostics.find((d) => d.reason.includes("plugin_tip_open"));
    expect(refusal).toBeDefined();
  });
});

// ── SFE-P2c repair round 3 (finding 1) — claimed-range overlap, no wrap ──
//
// `pluginRegionContainsProjectableBlock` (round 2) is keyed to TOKEN NESTING:
// it scans the slice strictly between a plugin-region's own open/close pair.
// That closes the round-2 shape (a wrapper whose close comes AFTER the
// survivor it nests), but a plugin can also emit a SELF-CONTAINED open/close
// pair -- nothing between them to scan -- while still setting a `token.map`
// that claims source spanning a LATER token the pair never structurally
// wraps. This fixture reproduces that shape directly.

/**
 * Registers `after("layout_transform", …)` and replaces the FIRST
 * `@@aside <label>` paragraph with a SELF-CONTAINED
 * `plugin_overclaim_open`/`plugin_overclaim_close` pair pushed immediately
 * adjacent to each other -- unlike {@link wrapperAsideMarkerPlugin}, this
 * pair never wraps any surviving token; `findMatchingCloseIndex` finds the
 * close at `openIndex + 1`, so the interior slice
 * `pluginRegionContainsProjectableBlock` walks is empty. The open token's
 * `token.map` nonetheless spans from the marker's own line through the LAST
 * line any surviving token in the document can prove -- an honest "this is
 * everything I consumed" claim from the plugin's own point of view, but one
 * its own token pair does not structurally contain.
 */
function overclaimAsideMarkerPlugin(): LoadedPlugin {
  const plugin = (md: MarkdownIt): void => {
    md.core.ruler.after("layout_transform", "overclaim_aside_transform", (state) => {
      let endLine = 0;
      for (const t of state.tokens) {
        if (Array.isArray(t.map)) endLine = Math.max(endLine, t.map[1]);
      }
      const out: typeof state.tokens = [];
      let claimed = false;
      for (let i = 0; i < state.tokens.length; i++) {
        const tok = state.tokens[i]!;
        const next = state.tokens[i + 1];
        const closer = state.tokens[i + 2];
        const match =
          !claimed && tok.type === "paragraph_open" && next?.type === "inline" && closer?.type === "paragraph_close"
            ? ASIDE_RE.exec(next.content)
            : null;
        if (match) {
          const open = new state.Token("plugin_overclaim_open", "aside", 1);
          open.attrSet("data-aside-label", match[1]!);
          open.map = [tok.map![0]!, endLine];
          out.push(open);
          out.push(new state.Token("plugin_overclaim_close", "aside", -1));
          i += 2;
          claimed = true;
          continue;
        }
        out.push(tok);
      }
      state.tokens = out;
    });
  };
  return { name: "overclaim-aside-plugin", plugin, options: {} };
}

describe("shape 4 -- claimed range not structurally wrapped (a self-contained open/close pair claims a map spanning content it never wraps)", () => {
  test("SFE-P2c repair round 3 (finding 1): a plugin-region whose pair is adjacent (nothing to scan) but whose claimed map spans a later raw-html block refuses that raw-html block as overlapping, instead of producing nested blocks", () => {
    const source = "@@aside Note\n\n<div>hi</div>\n\nTail.\n";
    const md = createMarkdownRenderer([overclaimAsideMarkerPlugin()]);

    // AP-21 liveness: the pair really is adjacent (nothing wrapped between
    // them) and the raw html_block really survives by identity -- both
    // preconditions this shape depends on.
    const tokens = md.parse(source, {});
    const openIdx = tokens.findIndex((t) => t.type === "plugin_overclaim_open");
    const closeIdx = tokens.findIndex((t) => t.type === "plugin_overclaim_close");
    expect(openIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBe(openIdx + 1);
    expect(tokens.map((t) => t.type)).toContain("html_block");

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    assertSortedNonOverlapping(projection, source);

    // Pre-fix this produced `blocks = [plugin-region:0:35, raw-html:14:28]`
    // -- overlapping, violating the module's own invariant, with ZERO
    // diagnostics. Post-fix: the plugin-region projects (its own pair is
    // self-contained, so the containment scan finds nothing), and the
    // LATER raw-html block -- inside the claimed-but-not-wrapped range --
    // refuses instead of overlapping it.
    expect(projection.blocks.map((b) => b.kind)).toEqual(["plugin-region"]);
    const pluginBlock = blockOf(projection, "plugin-region");
    expect(source.slice(pluginBlock.from, pluginBlock.to)).toBe(source);

    const overlapRefusal = projection.diagnostics.find((d) =>
      /overlaps a block already projected/i.test(d.reason),
    );
    expect(overlapRefusal).toBeDefined();
    expect(overlapRefusal!.reason).toMatch(/raw-html/i);
  });
});

describe("shape 3 -- uncorroborated plugin-declared map (a plugin sets an out-of-bounds token.map)", () => {
  test("a plugin that sets open.map = [0, 99] on a 5-line document refuses instead of claiming the whole document as one token's writable range", () => {
    const source = "A.\n\n---\n\nB.\n";
    const md = createMarkdownRenderer([
      {
        name: "wide-map-plugin",
        options: {},
        plugin: (m: MarkdownIt) =>
          m.core.ruler.after("layout_transform", "wide_map_transform", (state) => {
            const out: typeof state.tokens = [];
            for (const tok of state.tokens) {
              if (tok.type === "hr") {
                const open = new state.Token("plugin_wide_open", "aside", 1);
                open.map = [0, 99];
                out.push(open);
                out.push(new state.Token("plugin_wide_close", "aside", -1));
                continue;
              }
              out.push(tok);
            }
            state.tokens = out;
          }),
      },
    ]);

    // AP-21 liveness: the plugin really set the out-of-bounds map.
    const tokens = md.parse(source, {});
    const widened = tokens.find((t) => t.type === "plugin_wide_open");
    expect(widened?.map).toEqual([0, 99]);

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    expect(projection.blocks).toHaveLength(0);
    const refusal = projection.diagnostics.find((d) => d.reason.includes("plugin_wide_open"));
    expect(refusal).toBeDefined();
    expect(refusal!.reason).toMatch(/out-of-bounds|corroborate against source/i);
  });
});
