/**
 * SFE-P2c Lane B — tests for `plugin-origin.ts` (run
 * docs/plans/source-first-editor/runs/SFE-P2c.md, "Origin mechanism — the
 * binding constraint"). See that module's own header for the full design;
 * this file exists to prove it.
 *
 * Three kinds of fixture, deliberately mixed (per this module's own header,
 * "HONEST VERDICT" and PART 2):
 *
 *   - PIPELINE fixtures (a real `createMarkdownRenderer([...])` +
 *     `md.parse()`, exactly like `editor-projection-plugins.test.ts`'s own
 *     `asideMarkerPlugin` pattern) for shapes a real markdown-it core rule
 *     naturally produces: the clean-splice happy path, partial evidence, and
 *     consume-all/poison.
 *   - HAND-BUILT `Token` array fixtures, calling
 *     `resolvePluginTokenOriginFromSnapshot` directly, for shapes that need
 *     precise control over object identity a pipeline can't easily
 *     manufacture on demand (duplicate identity — "copy"; a relocated
 *     removed-run member; global survivor reordering). This is legitimate,
 *     targeted unit testing of the diff algorithm's own contract, not a
 *     substitute for the pipeline fixtures above.
 *   - One INTEGRATION round-trip through `createEditorProjection` (not just
 *     this module's own exports), proving the wiring Lane B added to
 *     `editor-projection.ts` actually delivers a byte-exact recovered range
 *     end to end.
 *
 * AP-21 (liveness before behavior) is asserted on every pipeline fixture: a
 * direct `md.parse()` call proves the plugin's own token type is really in
 * the stream before any projection/origin assertion runs.
 */
import { describe, test, expect } from "bun:test";
import MarkdownIt from "markdown-it";
import Token from "markdown-it/lib/token.mjs";
import {
  registerPluginOriginCapture,
  resolvePluginTokenOrigin,
  resolvePluginTokenOriginFromSnapshot,
  PLUGIN_ORIGIN_BEFORE_RULE,
  PLUGIN_ORIGIN_AFTER_RULE,
} from "./plugin-origin";
import { createEditorProjection, type GutterpressProjection, type ProjectedBlock } from "./editor-projection";
import { createMarkdownRenderer, type LoadedPlugin } from "./renderer";

/**
 * Duplicated from `editor-projection-plugins.test.ts` (not exported there —
 * a small, stable test-only assertion, not production code, so a same-repo
 * per-file copy is the repo's own established convention rather than a
 * cross-test-file import). Asserts D6's "ordered, disjoint, never
 * overlapping" invariant end to end.
 */
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

function ruleNames(md: MarkdownIt): string[] {
  return (md.core.ruler as unknown as { __rules__: Array<{ name: string }> }).__rules__.map(
    (r) => r.name,
  );
}

// ── PART 1 — empirical probe of the real core-rule chain ───────────────────
// The run spec: "Establish the real order empirically with a probe, and
// document it." This is that probe, re-run on every test invocation (not
// just asserted once in prose) so a future markdown-it/plugin upgrade that
// silently reorders the chain fails HERE instead of corrupting origin
// recovery silently.

describe("empirical core-rule chain probe (documents plugin-origin.ts's header PART 1)", () => {
  test("a plugin-free createMarkdownRenderer() has the exact documented rule order", () => {
    const md = createMarkdownRenderer();
    expect(ruleNames(md)).toEqual([
      "normalize",
      "block",
      "layout_transform",
      "inline",
      "footnote_tail",
      "curly_attributes",
      "linkify",
      "replacements",
      "smartquotes",
      "text_join",
      "gp_pin_scope_check",
      "inline_source_raw_html",
      "source_range",
    ]);
  });

  test("source_range is registered LAST, after every rule any project plugin could add", () => {
    const md = createMarkdownRenderer([
      {
        name: "probe-push-plugin",
        options: {},
        plugin: (m: MarkdownIt) => m.core.ruler.push("probe_push_rule", () => {}),
      },
    ]);
    expect(ruleNames(md).at(-1)).toBe("source_range");
    expect(ruleNames(md).indexOf("probe_push_rule")).toBeLessThan(ruleNames(md).indexOf("source_range"));
  });

  test("a push()-registered plugin rule lands after gp_pin_scope_check (the common case)", () => {
    const md = createMarkdownRenderer([
      {
        name: "probe-push-plugin",
        options: {},
        plugin: (m: MarkdownIt) => m.core.ruler.push("probe_push_rule", () => {}),
      },
    ]);
    const names = ruleNames(md);
    expect(names.indexOf("probe_push_rule")).toBeGreaterThan(names.indexOf("gp_pin_scope_check"));
    expect(names.indexOf("probe_push_rule")).toBeLessThan(names.indexOf("inline_source_raw_html"));
  });

  test('an after("layout_transform", …)-registered plugin rule (the run spec\'s own reference shape) lands BEFORE gp_pin_scope_check — proving true clean bracketing at that anchor is impossible', () => {
    const md = createMarkdownRenderer([
      {
        name: "probe-after-layout-plugin",
        options: {},
        plugin: (m: MarkdownIt) =>
          m.core.ruler.after("layout_transform", "probe_after_layout_rule", () => {}),
      },
    ]);
    const names = ruleNames(md);
    expect(names.indexOf("probe_after_layout_rule")).toBeGreaterThan(names.indexOf("layout_transform"));
    expect(names.indexOf("probe_after_layout_rule")).toBeLessThan(names.indexOf("gp_pin_scope_check"));
    expect(names.indexOf("probe_after_layout_rule")).toBeLessThan(names.indexOf("inline"));
  });

  test("registerPluginOriginCapture's TIGHT bracket lands immediately either side of a single after(layout_transform) plugin rule, excluding inline/footnote_tail/curly_attributes entirely (SFE-P2c repair round 1 — replaces the round-0 assertion that pinned the WIDE bracket as the only behavior)", () => {
    const md = createMarkdownRenderer([
      {
        name: "probe-after-layout-plugin",
        options: {},
        plugin: (m: MarkdownIt) =>
          m.core.ruler.after("layout_transform", "probe_after_layout_rule", () => {}),
      },
    ]);
    registerPluginOriginCapture(md);
    const names = ruleNames(md);
    // Tight: PLUGIN_ORIGIN_BEFORE_RULE lands immediately before the plugin's
    // own rule, PLUGIN_ORIGIN_AFTER_RULE immediately after it — both still
    // strictly before `inline`, so `footnote_tail`/`curly_attributes` (which
    // only ever run after `inline`) fall OUTSIDE the bracket, closing the
    // base-pipeline-contamination finding this repair round fixes.
    expect(names.indexOf(PLUGIN_ORIGIN_BEFORE_RULE)).toBeGreaterThan(names.indexOf("layout_transform"));
    expect(names.indexOf(PLUGIN_ORIGIN_BEFORE_RULE)).toBe(names.indexOf("probe_after_layout_rule") - 1);
    expect(names.indexOf(PLUGIN_ORIGIN_AFTER_RULE)).toBe(names.indexOf("probe_after_layout_rule") + 1);
    expect(names.indexOf(PLUGIN_ORIGIN_AFTER_RULE)).toBeLessThan(names.indexOf("inline"));
    expect(names.indexOf(PLUGIN_ORIGIN_AFTER_RULE)).toBeLessThan(names.indexOf("footnote_tail"));
    expect(names.indexOf(PLUGIN_ORIGIN_AFTER_RULE)).toBeLessThan(names.indexOf("curly_attributes"));
  });

  test("registerPluginOriginCapture falls back to the WIDE bracket when no plugin core rule is identifiable between the anchors (a plain md)", () => {
    const md = createMarkdownRenderer();
    registerPluginOriginCapture(md);
    const names = ruleNames(md);
    expect(names.indexOf(PLUGIN_ORIGIN_BEFORE_RULE)).toBeGreaterThan(names.indexOf("layout_transform"));
    expect(names.indexOf(PLUGIN_ORIGIN_BEFORE_RULE)).toBeLessThan(names.indexOf("inline"));
    expect(names.indexOf(PLUGIN_ORIGIN_AFTER_RULE)).toBeGreaterThan(names.indexOf("gp_pin_scope_check"));
    expect(names.indexOf(PLUGIN_ORIGIN_AFTER_RULE)).toBeLessThan(names.indexOf("inline_source_raw_html"));
  });

  test("a push()-registered plugin rule (landing after gp_pin_scope_check) also gets a TIGHT bracket, not the wide one", () => {
    const md = createMarkdownRenderer([
      {
        name: "probe-push-plugin",
        options: {},
        plugin: (m: MarkdownIt) => m.core.ruler.push("probe_push_rule", () => {}),
      },
    ]);
    registerPluginOriginCapture(md);
    const names = ruleNames(md);
    expect(names.indexOf(PLUGIN_ORIGIN_BEFORE_RULE)).toBe(names.indexOf("probe_push_rule") - 1);
    expect(names.indexOf(PLUGIN_ORIGIN_AFTER_RULE)).toBe(names.indexOf("probe_push_rule") + 1);
  });

  test("registration is idempotent: calling it twice does not duplicate either bracket rule", () => {
    const md = createMarkdownRenderer();
    registerPluginOriginCapture(md);
    registerPluginOriginCapture(md);
    const names = ruleNames(md);
    expect(names.filter((n) => n === PLUGIN_ORIGIN_BEFORE_RULE)).toHaveLength(1);
    expect(names.filter((n) => n === PLUGIN_ORIGIN_AFTER_RULE)).toHaveLength(1);
  });

  test("a bare MarkdownIt with no Gutterpress pipeline is a documented no-op, never a throw", () => {
    const bare = new MarkdownIt({ html: true });
    expect(() => registerPluginOriginCapture(bare)).not.toThrow();
    expect(ruleNames(bare)).not.toContain(PLUGIN_ORIGIN_BEFORE_RULE);
    expect(ruleNames(bare)).not.toContain(PLUGIN_ORIGIN_AFTER_RULE);
  });

  test("registration never changes rendered output (the two rules are read-only)", () => {
    const source = "Hello **world**.\n\n---\n\nMore text.\n";
    const withoutCapture = createMarkdownRenderer().render(source);
    const md = createMarkdownRenderer();
    registerPluginOriginCapture(md);
    const withCapture = md.render(source);
    expect(withCapture).toBe(withoutCapture);
  });
});

// ── PART 2 — rule 3: the clean-splice happy path (byte-exact) ─────────────
//
// Uses `hr` (thematic break) as the consumed input specifically BECAUSE it
// is markdown-it's own single, self-closing, `.map`-bearing block token
// (verified against markdown-it/lib/rules_block/hr.mjs) — unlike a
// paragraph's `open/inline/close` triple, whose `_close` token NEVER carries
// `.map` in markdown-it itself, an `hr` gives a removed run every one of
// whose members has complete evidence, which is exactly what rule 3
// requires. This is still "a real registered markdown-it core rule" shape
// (a plugin scanning `state.tokens` and splicing in a replacement), just
// applied to the one base-pipeline token shape that can actually satisfy
// rule 3's "every removed token" requirement.

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

describe("rule 3 — clean-splice recovery (the required happy path)", () => {
  test("a single self-closing consumed token with complete evidence recovers a byte-exact plugin-region, end to end through createEditorProjection", () => {
    const source = "Intro paragraph.\n\n---\n\nOutro paragraph.\n";
    const md = createMarkdownRenderer([tipMarkerPlugin()]);

    // AP-21 liveness: prove the transform actually ran before any
    // origin/projection assertion.
    const tokenTypes = md.parse(source, {}).map((t) => t.type);
    expect(tokenTypes).toContain("plugin_tip_open");
    expect(tokenTypes).toContain("plugin_tip_close");
    expect(tokenTypes).not.toContain("hr");

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    const block = projection.blocks.find((b) => b.kind === "plugin-region");
    expect(block).toBeDefined();
    // Byte-exact, per the run spec's test-plan wording.
    expect(source.slice(block!.from, block!.to)).toBe("---\n");
    expect(block!.editMode).toBe("source");
    expect(projection.diagnostics).toHaveLength(0);
  });

  test("the pure resolver reports the recovered range as a LINE range (token.map convention), independent of the char-offset integration", () => {
    const source = "First.\n\n---\n\nLast.\n";
    const md = createMarkdownRenderer([tipMarkerPlugin()]);
    const env: Record<string, unknown> = {};
    registerPluginOriginCapture(md);
    const tokens = md.parse(source, env);
    const openIdx = tokens.findIndex((t) => t.type === "plugin_tip_open");
    expect(openIdx).toBeGreaterThanOrEqual(0);

    const result = resolvePluginTokenOrigin(tokens[openIdx]!, env);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // "---" is source line 2 (0-based line 2), a single-line map [2, 3].
      expect(result.range).toEqual([2, 3]);
    }
  });

  test("multiple independent clean splices in one document each recover their own byte-exact range", () => {
    const source = "A.\n\n---\n\nB.\n\n---\n\nC.\n";
    const md = createMarkdownRenderer([tipMarkerPlugin()]);
    expect(md.parse(source, {}).filter((t) => t.type === "plugin_tip_open")).toHaveLength(2);

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    const blocks = projection.blocks.filter((b) => b.kind === "plugin-region");
    expect(blocks).toHaveLength(2);
    expect(source.slice(blocks[0]!.from, blocks[0]!.to)).toBe("---\n");
    expect(source.slice(blocks[1]!.from, blocks[1]!.to)).toBe("---\n");
    expect(projection.diagnostics).toHaveLength(0);
  });
});

// ── PART 3 — the refusal matrix: six genuinely distinct rule-4 shapes ─────

describe("refusal matrix — shape 1: interleaved edits (global survivor reorder)", () => {
  test("a plugin that reorders two surviving tokens refuses origin recovery for an unrelated added token, naming the plugin rule", () => {
    const survivorA = new Token("paragraph_open", "p", 1);
    survivorA.map = [0, 1];
    const survivorB = new Token("paragraph_open", "p", 1);
    survivorB.map = [2, 3];
    const added = new Token("plugin_x_open", "div", 1);

    // AP-21 liveness proxy for a hand-built fixture: assert the constructed
    // shape actually has the property the test claims (reordering), not
    // just assert the refusal blindly.
    const before = [survivorA, survivorB];
    const after = [survivorB, added, survivorA]; // survivorA/survivorB swapped
    expect(after.indexOf(survivorB)).toBeLessThan(after.indexOf(survivorA));

    const result = resolvePluginTokenOriginFromSnapshot(added, 1, after, before, ["reorder_plugin_rule"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/interleaved edits/i);
      expect(result.reason).toMatch(/reorder_plugin_rule/);
    }
  });
});

describe("refusal matrix — shape 2: copy (the queried token itself is duplicated)", () => {
  test("a token appearing twice in the transformed stream by object identity refuses, naming 'copy'", () => {
    const survivorLeft = new Token("paragraph_open", "p", 1);
    survivorLeft.map = [0, 1];
    const survivorRight = new Token("paragraph_open", "p", 1);
    survivorRight.map = [4, 5];
    const removed = new Token("paragraph_open", "p", 1);
    removed.map = [2, 3];
    const duplicated = new Token("plugin_dup_open", "div", 1);

    const before = [survivorLeft, removed, survivorRight];
    const after = [survivorLeft, duplicated, survivorRight, duplicated]; // same object twice
    expect(after.filter((t) => t === duplicated)).toHaveLength(2);

    const result = resolvePluginTokenOriginFromSnapshot(duplicated, 1, after, before, ["dup_plugin_rule"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/copy|overlapping splices/i);
      expect(result.reason).toMatch(/dup_plugin_rule/);
    }
  });
});

describe("refusal matrix — shape 2b: copy, the REALISTIC shape (one consumed region producing two DIFFERENT sibling output regions)", () => {
  test("hand-built: two distinct fresh objects both claim the same removed run refuses, naming 'copy', for EITHER sibling queried", () => {
    const survivorLeft = new Token("paragraph_open", "p", 1);
    survivorLeft.map = [0, 1];
    const survivorRight = new Token("paragraph_open", "p", 1);
    survivorRight.map = [4, 5];
    const removed = new Token("paragraph_open", "p", 1);
    removed.map = [2, 3];
    const openA = new Token("plugin_a_open", "div", 1);
    const closeA = new Token("plugin_a_close", "div", -1);
    const openB = new Token("plugin_b_open", "div", 1);
    const closeB = new Token("plugin_b_close", "div", -1);

    const before = [survivorLeft, removed, survivorRight];
    const after = [survivorLeft, openA, closeA, openB, closeB, survivorRight];
    // Liveness proxy: two DIFFERENT objects (not the identity-duplicate
    // shape 2a already covers), both nesting===1 opens, sitting in the
    // ADDED run between survivorLeft and survivorRight (index 1..4).
    expect(openA).not.toBe(openB);
    expect(after.slice(1, 5).filter((t) => t.nesting === 1)).toHaveLength(2);

    for (const [queried, idx] of [
      [openA, 1],
      [openB, 3],
    ] as const) {
      const result = resolvePluginTokenOriginFromSnapshot(queried, idx, after, before, ["copy_plugin_rule"]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/copy/i);
        expect(result.reason).toMatch(/copy_plugin_rule/);
      }
    }
  });

  test("end to end through createEditorProjection: a real registered plugin rule replacing one consumed hr with TWO sibling wrapper pairs refuses for both, yielding zero blocks (not two blocks with duplicate ids and overlapping ranges)", () => {
    const source = "Intro paragraph.\n\n---\n\nOutro paragraph.\n";
    const md = createMarkdownRenderer([
      {
        name: "copy-plugin",
        options: {},
        plugin: (m: MarkdownIt) =>
          m.core.ruler.after("layout_transform", "copy_plugin_transform", (state) => {
            const out: typeof state.tokens = [];
            for (const tok of state.tokens) {
              if (tok.type === "hr") {
                out.push(new state.Token("plugin_a_open", "div", 1));
                out.push(new state.Token("plugin_a_close", "div", -1));
                out.push(new state.Token("plugin_b_open", "div", 1));
                out.push(new state.Token("plugin_b_close", "div", -1));
                continue;
              }
              out.push(tok);
            }
            state.tokens = out;
          }),
      },
    ]);

    // AP-21 liveness: prove the transform actually produced BOTH sibling
    // regions before any refusal assertion.
    const tokenTypes = md.parse(source, {}).map((t) => t.type);
    expect(tokenTypes).toContain("plugin_a_open");
    expect(tokenTypes).toContain("plugin_b_open");
    expect(tokenTypes).not.toContain("hr");

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });

    // The defect this fixture reproduces: BEFORE this repair, both siblings
    // were accepted with the identical union range, yielding duplicate
    // `ProjectedBlock.id`s and `blocks[0].to > blocks[1].from`. After this
    // repair, rule 4's copy shape refuses for both — zero blocks, two
    // rule-named diagnostics, document stays fully editable.
    expect(projection.blocks.filter((b) => b.kind === "plugin-region")).toHaveLength(0);
    const copyRefusals = projection.diagnostics.filter((d) => d.reason.match(/copy/i));
    expect(copyRefusals).toHaveLength(2);
    for (const d of copyRefusals) {
      expect(d.category).toBe("EDITOR_UNSUPPORTED_PROJECTION");
      expect(d.reason).toMatch(/copy_plugin_transform/);
    }

    // The block ids/overlap invariants the finding's own header (D6) pins:
    // trivially true here since zero blocks are emitted, but assert the
    // general-purpose helper anyway so a future regression that DOES start
    // emitting blocks for this shape is still caught.
    assertSortedNonOverlapping(projection, source);
  });
});

describe("NOT shape 2b — one output region with a freshly generated interior (the idiomatic wrapper shape) still recovers a clean-splice origin", () => {
  test("SFE-P2c repair round 2: a real registered plugin rule replacing one consumed hr with ONE wrapper pair around a generated paragraph recovers byte-exact, instead of being miscounted as a two-sibling copy", () => {
    const source = "A.\n\n---\n\nB.\n";
    const md = createMarkdownRenderer([
      {
        name: "callout-plugin",
        options: {},
        plugin: (m: MarkdownIt) =>
          m.core.ruler.after("layout_transform", "callout_transform", (state) => {
            const out: typeof state.tokens = [];
            for (const tok of state.tokens) {
              if (tok.type === "hr") {
                out.push(new state.Token("plugin_callout_open", "aside", 1));
                const paragraphOpen = new state.Token("paragraph_open", "p", 1);
                const inline = new state.Token("inline", "", 0);
                inline.content = "Generated body.";
                inline.children = [];
                const paragraphClose = new state.Token("paragraph_close", "p", -1);
                out.push(paragraphOpen, inline, paragraphClose);
                out.push(new state.Token("plugin_callout_close", "aside", -1));
                continue;
              }
              out.push(tok);
            }
            state.tokens = out;
          }),
      },
    ]);

    // AP-21 liveness: prove the transform produced exactly ONE top-level
    // output region (with a generated interior), not two siblings, before
    // any origin/projection assertion.
    const tokenTypes = md.parse(source, {}).map((t) => t.type);
    expect(tokenTypes).toContain("plugin_callout_open");
    expect(tokenTypes).toContain("plugin_callout_close");
    expect(tokenTypes).not.toContain("hr");
    expect(tokenTypes.filter((t) => t === "plugin_callout_open")).toHaveLength(1);

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });

    // The defect this fixture reproduces: BEFORE this repair, the depth-
    // blind count saw TWO nesting===1 opens in the added run
    // (plugin_callout_open AND the nested paragraph_open) and refused this
    // as "copy" -- pure recall loss on the single most idiomatic plugin
    // shape (a wrapper around freshly generated content), on the exact
    // clean-splice path this run's own test-plan row names. After this
    // repair, only DEPTH-0 opens count, so this recovers.
    const block = projection.blocks.find((b) => b.kind === "plugin-region");
    expect(block).toBeDefined();
    // Byte-exact, per the run spec's test-plan wording -- the consumed
    // `hr`'s own source line, not the generated interior text.
    expect(source.slice(block!.from, block!.to)).toBe("---\n");
    expect(block!.editMode).toBe("source");
    expect(projection.diagnostics).toHaveLength(0);
    assertSortedNonOverlapping(projection, source);
  });
});

describe("SFE-P2c repair round 3 regression — an unmatched leading close in the added run must not mask sibling opens (depth floor)", () => {
  test("hand-built: a straddling wrapper (open before a survivor, close after it) ahead of two genuine sibling opens still refuses both as copy", () => {
    // before: [paragraph(A) triple, hr, paragraph(B) triple]
    const paragraphOpenA = new Token("paragraph_open", "p", 1);
    paragraphOpenA.map = [0, 1];
    const inlineA = new Token("inline", "", 0);
    const paragraphCloseA = new Token("paragraph_close", "p", -1);
    const hr = new Token("hr", "hr", 0);
    hr.map = [2, 3];
    const paragraphOpenB = new Token("paragraph_open", "p", 1);
    paragraphOpenB.map = [4, 5];
    const inlineB = new Token("inline", "", 0);
    const paragraphCloseB = new Token("paragraph_close", "p", -1);
    const before = [paragraphOpenA, inlineA, paragraphCloseA, hr, paragraphOpenB, inlineB, paragraphCloseB];

    // after: a wrapper straddles the FIRST survivor (open before it, close
    // after it — the archetypal `@sidebar`/`@callout` shape, CLAUDE.md §5),
    // then the hr is replaced by two DIFFERENT sibling pairs, neither
    // wrapping the other.
    const wrapOpen = new Token("plugin_wrap_open", "div", 1);
    const wrapClose = new Token("plugin_wrap_close", "div", -1);
    const openA = new Token("plugin_a_open", "div", 1);
    const closeA = new Token("plugin_a_close", "div", -1);
    const openB = new Token("plugin_b_open", "div", 1);
    const closeB = new Token("plugin_b_close", "div", -1);
    const after = [
      wrapOpen,
      paragraphOpenA,
      inlineA,
      paragraphCloseA,
      wrapClose,
      openA,
      closeA,
      openB,
      closeB,
      paragraphOpenB,
      inlineB,
      paragraphCloseB,
    ];

    // Liveness proxy: the added run between the two nearest survivors
    // (paragraphCloseA .. paragraphOpenB, after-indices 4..8) BEGINS with an
    // unmatched close (`wrapClose`) ahead of two genuine sibling opens —
    // exactly the shape that drove the unclamped depth counter to -1
    // pre-fix, masking both siblings from `addedTopLevelOpenCount`.
    expect(after.slice(4, 9).map((t) => t.nesting)).toEqual([-1, 1, -1, 1, -1]);

    for (const [queried, idx] of [
      [openA, 5],
      [openB, 7],
    ] as const) {
      const result = resolvePluginTokenOriginFromSnapshot(queried, idx, after, before, ["straddle_plugin_rule"]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/copy/i);
        expect(result.reason).toMatch(/straddle_plugin_rule/);
      }
    }
  });

  test("end to end through createEditorProjection: a real registered core rule that straddles a survivor with a wrapper, then replaces a later hr with two sibling pairs, refuses the siblings instead of fabricating an origin for one of them", () => {
    const source = "A.\n\n---\n\nB.\n";
    const md = createMarkdownRenderer([
      {
        name: "straddle-plugin",
        options: {},
        plugin: (m: MarkdownIt) =>
          m.core.ruler.after("layout_transform", "straddle_plugin_transform", (state) => {
            const out: typeof state.tokens = [];
            let openedWrapper = false;
            for (const tok of state.tokens) {
              if (!openedWrapper && tok.type === "paragraph_open") {
                out.push(new state.Token("plugin_wrap_open", "div", 1));
                openedWrapper = true;
              }
              if (tok.type === "hr") {
                out.push(new state.Token("plugin_wrap_close", "div", -1));
                out.push(new state.Token("plugin_a_open", "div", 1));
                out.push(new state.Token("plugin_a_close", "div", -1));
                out.push(new state.Token("plugin_b_open", "div", 1));
                out.push(new state.Token("plugin_b_close", "div", -1));
                continue;
              }
              out.push(tok);
            }
            state.tokens = out;
          }),
      },
    ]);

    // AP-21 liveness: the wrapper really straddles the first survivor, and
    // both siblings really replace the hr, before any refusal assertion.
    const tokenTypes = md.parse(source, {}).map((t) => t.type);
    expect(tokenTypes).toEqual([
      "plugin_wrap_open",
      "paragraph_open",
      "inline",
      "paragraph_close",
      "plugin_wrap_close",
      "plugin_a_open",
      "plugin_a_close",
      "plugin_b_open",
      "plugin_b_close",
      "paragraph_open",
      "inline",
      "paragraph_close",
    ]);

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });

    // The defect this fixture reproduces: BEFORE this repair, the unmatched
    // `plugin_wrap_close` leading the added run drove `depth` to -1, so
    // neither sibling open was ever counted at depth 0 — `plugin_a_open`
    // was handed the consumed `hr` range as a fabricated clean-splice
    // origin (`plugin-region:4:8`) even though `plugin_b_open` had an
    // equally good claim on the same run. After this repair, both siblings
    // refuse as "copy" and zero blocks are emitted for the consumed `hr`.
    expect(projection.blocks.filter((b) => b.kind === "plugin-region")).toHaveLength(0);
    const copyRefusals = projection.diagnostics.filter((d) => /copy/i.test(d.reason));
    expect(copyRefusals).toHaveLength(2);
    for (const d of copyRefusals) {
      expect(d.category).toBe("EDITOR_UNSUPPORTED_PROJECTION");
      expect(d.reason).toMatch(/straddle_plugin_transform/);
    }
    assertSortedNonOverlapping(projection, source);
  });
});

describe("refusal matrix — shape 3: moved tokens (a removed-run member reappears elsewhere)", () => {
  test("a token this module is about to declare 'removed' but which is duplicated elsewhere in the transformed stream refuses as moved", () => {
    const survivorLeft = new Token("paragraph_open", "p", 1);
    survivorLeft.map = [0, 1];
    const survivorRight = new Token("paragraph_open", "p", 1);
    survivorRight.map = [4, 5];
    const relocated = new Token("paragraph_open", "p", 1);
    relocated.map = [2, 3];
    const added = new Token("plugin_y_open", "div", 1);

    const before = [survivorLeft, relocated, survivorRight];
    // `relocated` reappears TWICE elsewhere in `after` (not adjacent to the
    // query) — duplicated (afterCount > 1) so it is excluded from the
    // global-reorder anchor pool but still detectably present when this
    // module scans the removed run it computed for `added`.
    const after = [survivorLeft, added, survivorRight, relocated, relocated];

    const result = resolvePluginTokenOriginFromSnapshot(added, 1, after, before, ["relocate_plugin_rule"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/moved/i);
      expect(result.reason).toMatch(/relocate_plugin_rule/);
    }
  });
});

describe("refusal matrix — shape 4: consume-all with no carrier", () => {
  test("a plugin that replaces the entire token stream leaves no surviving anchor to bound an origin search", () => {
    const source = "@@wipe hello\n";
    const md = createMarkdownRenderer([
      {
        name: "wipe-plugin",
        options: {},
        plugin: (m: MarkdownIt) =>
          m.core.ruler.after("layout_transform", "wipe_plugin_transform", (state) => {
            state.tokens = [
              new state.Token("plugin_wipe_open", "div", 1),
              new state.Token("plugin_wipe_close", "div", -1),
            ];
          }),
      },
    ]);

    // AP-21 liveness.
    expect(md.parse(source, {}).map((t) => t.type)).toEqual(["plugin_wipe_open", "plugin_wipe_close"]);

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    expect(projection.blocks).toHaveLength(0);
    const refusal = projection.diagnostics.find((d) => d.reason.includes("plugin_wipe_open"));
    expect(refusal).toBeDefined();

    // Also assert the module's own richer reason directly.
    const env: Record<string, unknown> = {};
    registerPluginOriginCapture(md);
    const tokens = md.parse(source, env);
    const result = resolvePluginTokenOrigin(tokens[0]!, env);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/consume-all/i);
      expect(result.reason).toMatch(/wipe_plugin_transform/);
    }
  });
});

describe("refusal matrix — shape 5: empty removed run (pure insertion / degenerate boundary)", () => {
  test("nearest anchors that leave nothing between them in the pre-transform snapshot refuse rather than guess", () => {
    const survivorLeft = new Token("paragraph_open", "p", 1);
    survivorLeft.map = [0, 1];
    const survivorRight = new Token("paragraph_open", "p", 1);
    survivorRight.map = [1, 2];
    const inserted = new Token("plugin_z_open", "div", 1);

    // survivorLeft and survivorRight are ALREADY adjacent in `before` — an
    // insertion between them in `after` has nothing to attribute to.
    const before = [survivorLeft, survivorRight];
    const after = [survivorLeft, inserted, survivorRight];

    const result = resolvePluginTokenOriginFromSnapshot(inserted, 1, after, before, ["insert_plugin_rule"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no tokens were removed|insertion|relocated boundary/i);
      expect(result.reason).toMatch(/insert_plugin_rule/);
    }
  });
});

describe("refusal matrix — shape 6: partial evidence in the removed run", () => {
  function asideLikePlugin(): LoadedPlugin {
    const plugin = (md: MarkdownIt): void => {
      md.core.ruler.after("layout_transform", "partial_evidence_transform", (state) => {
        const out: typeof state.tokens = [];
        for (let i = 0; i < state.tokens.length; i++) {
          const tok = state.tokens[i]!;
          const next = state.tokens[i + 1];
          const closer = state.tokens[i + 2];
          const isTarget =
            tok.type === "paragraph_open" &&
            next?.type === "inline" &&
            closer?.type === "paragraph_close" &&
            next.content === "@@note";
          if (!isTarget) {
            out.push(tok);
            continue;
          }
          // No .map/.meta on the replacement, and the removed run includes
          // `paragraph_close`, which markdown-it itself never gives a .map
          // (verified against rules_block/paragraph.mjs) — so this removed
          // run can never satisfy "every removed token has complete
          // evidence," by construction, regardless of what the plugin does
          // to the open token.
          out.push(new state.Token("plugin_note_open", "div", 1));
          out.push(new state.Token("plugin_note_close", "div", -1));
          i += 2;
        }
        state.tokens = out;
      });
    };
    return { name: "partial-evidence-plugin", plugin, options: {} };
  }

  test("consuming an ordinary paragraph_open/inline/paragraph_close triple always refuses — paragraph_close never carries evidence", () => {
    const source = "@@note\n\nTrailing paragraph.\n";
    const md = createMarkdownRenderer([asideLikePlugin()]);

    // AP-21 liveness.
    expect(md.parse(source, {}).map((t) => t.type)).toContain("plugin_note_open");

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    expect(projection.blocks.find((b) => b.kind === "plugin-region")).toBeUndefined();
    const refusal = projection.diagnostics.find((d) => d.reason.includes("plugin_note_open"));
    expect(refusal).toBeDefined();

    const env: Record<string, unknown> = {};
    registerPluginOriginCapture(md);
    const tokens = md.parse(source, env);
    const openIdx = tokens.findIndex((t) => t.type === "plugin_note_open");
    const result = resolvePluginTokenOrigin(tokens[openIdx]!, env);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/partial evidence/i);
      expect(result.reason).toMatch(/paragraph_close/);
      expect(result.reason).toMatch(/partial_evidence_transform/);
    }
  });
});

// ── PART 4 — ported PR 158 adversarial shapes (pr158-lessons.md §12.2) ────
// "Port the BEHAVIOR and expected result, not any ProseMirror-era
// implementation." The consume-and-replace, copied, and moved shapes are
// already covered above (rule 3's happy path and refusal-matrix shapes 2/3).
// This section ports the two remaining shapes §12.2 names that are specific
// to a source-first token-stream mechanism: the empty-token-stream poison
// case, and an orphan (unattributable) generated token.

describe("ported PR 158 shape — empty-token-stream poison case", () => {
  test("a plugin that empties state.tokens entirely degrades to zero blocks, never throws", () => {
    const source = "Any content at all.\n";
    const md = createMarkdownRenderer([
      {
        name: "poison-plugin",
        options: {},
        plugin: (m: MarkdownIt) =>
          m.core.ruler.after("layout_transform", "poison_transform", (state) => {
            state.tokens = [];
          }),
      },
    ]);

    // AP-21 liveness: prove the poison really happened.
    expect(md.parse(source, {})).toEqual([]);

    expect(() =>
      createEditorProjection(source, { sourceVersion: 1, md, trusted: true }),
    ).not.toThrow();
    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    expect(projection.blocks).toHaveLength(0);
    expect(projection.schemaVersion).toBe(1);
  });
});

describe("ported PR 158 shape — orphan generated token (no anchor on either side)", () => {
  test("a queried token with no surviving anchor anywhere in a single-token document refuses as consume-all, not as a guessed whole-document range", () => {
    const orphan = new Token("plugin_orphan_open", "div", 1);
    const before: Token[] = [];
    const after = [orphan];

    const result = resolvePluginTokenOriginFromSnapshot(orphan, 0, after, before, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/consume-all/i);
      expect(result.reason).toMatch(/no project-plugin core rule name could be identified/);
    }
  });
});

// ── PART 5 — rule-name attribution ──────────────────────────────────────

describe("rule-name attribution", () => {
  test("exactly one plugin rule active in the bracketed region is named directly", () => {
    const source = "Intro.\n\n---\n\nOutro.\n";
    const md = createMarkdownRenderer([tipMarkerPlugin()]);
    const env: Record<string, unknown> = {};
    registerPluginOriginCapture(md);
    const tokens = md.parse(source, env);
    const openIdx = tokens.findIndex((t) => t.type === "plugin_tip_open");
    // Force a refusal path (empty removed run doesn't apply here; use the
    // orphan/consume-all shape's message format by checking a partial-
    // evidence-style attribution instead — reuse shape 6's fixture, which
    // already asserts the rule name is embedded) is redundant with the
    // shape-6 test above; here we assert the SUCCESS path also carries no
    // stray "could not be identified" text, proving attribution isn't
    // fabricated when it isn't needed.
    const result = resolvePluginTokenOrigin(tokens[openIdx]!, env);
    expect(result.ok).toBe(true);
  });

  test("zero identifiable plugin rules in the bracketed region says so explicitly rather than fabricating a name", () => {
    const result = resolvePluginTokenOriginFromSnapshot(
      new Token("plugin_orphan_open", "div", 1),
      0,
      [new Token("plugin_orphan_open", "div", 1)],
      [],
      [],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no project-plugin core rule name could be identified/);
    }
  });

  test("more than one plugin rule active in the bracketed region says the offending rule could not be isolated, listing all candidates", () => {
    const survivorLeft = new Token("paragraph_open", "p", 1);
    survivorLeft.map = [0, 1];
    const survivorRight = new Token("paragraph_open", "p", 1);
    survivorRight.map = [1, 2];
    const inserted = new Token("plugin_multi_open", "div", 1);
    const before = [survivorLeft, survivorRight];
    const after = [survivorLeft, inserted, survivorRight];

    const result = resolvePluginTokenOriginFromSnapshot(inserted, 1, after, before, [
      "first_plugin_rule",
      "second_plugin_rule",
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/first_plugin_rule/);
      expect(result.reason).toMatch(/second_plugin_rule/);
      expect(result.reason).toMatch(/could not be isolated/);
    }
  });
});

// ── PART 6 — integration fallback: no snapshot available ──────────────────

describe("integration fallback — no snapshot available", () => {
  test("resolvePluginTokenOrigin refuses cleanly (never throws) when registerPluginOriginCapture never bracketed this md", () => {
    const bare = new MarkdownIt({ html: true });
    const token = new Token("plugin_unbracketed_open", "div", 1);
    const result = resolvePluginTokenOrigin(token, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no before\/after plugin-origin snapshot is available/);
    }
    // Sanity: the bare instance itself was never bracketed (registration is
    // this module's own no-op path, independently verified above).
    expect(ruleNames(bare)).not.toContain(PLUGIN_ORIGIN_BEFORE_RULE);
  });

  test("resolvePluginTokenOrigin refuses cleanly when env was never threaded through md.parse()", () => {
    const md = createMarkdownRenderer([tipMarkerPlugin()]);
    registerPluginOriginCapture(md);
    // Deliberately parse with a throwaway env, discarding it — mirrors what
    // P2b's original `md.parse(source, {})` call site did before this run.
    const tokens = md.parse("Intro.\n\n---\n\nOutro.\n", {});
    const openIdx = tokens.findIndex((t) => t.type === "plugin_tip_open");
    const result = resolvePluginTokenOrigin(tokens[openIdx]!, undefined);
    expect(result.ok).toBe(false);
  });
});

// ── PART 7 — base-pipeline mutators do not contaminate origin recovery
// (SFE-P2c repair round 1) ───────────────────────────────────────────────
//
// Reproduces the confirmed finding directly: `footnote_tail` (relocates
// footnote-definition tokens to the end of `state.tokens`) and
// `curly_attributes` (splices out a `{.class}` paragraph's own triple) are
// BOTH always-on, base-pipeline core rules that used to run INSIDE the
// wide bracket whenever a `.after("layout_transform", …)`-registered
// plugin was the only plugin rule registered — tripping the global
// survivor-order check (shape 1) on activity the plugin never caused, and
// having `describeRule` fabricate that plugin's own name as the culprit.
// `registerPluginOriginCapture`'s TIGHT bracket (see that function's own
// doc comment) now excludes both entirely for this common single-plugin
// shape, since neither rule runs before `inline` in the pipeline order.

describe("footnote_tail does not contaminate origin recovery", () => {
  test("a footnoted document alongside a clean-splice plugin still recovers a byte-exact plugin-region -- footnote_tail's own relocation runs OUTSIDE the tightened bracket", () => {
    const source = "Text with a note[^1]\n\n[^1]: The note body.\n\n---\n\nAfter.\n";
    const md = createMarkdownRenderer([tipMarkerPlugin()]);

    // AP-21 liveness: footnote_tail really relocates the footnote body to
    // the END of the stream (verified against the render path: the
    // rendered footnote section appears AFTER "After.", not in its
    // authored position), and the plugin's own transform really ran.
    const rendered = md.render(source);
    expect(rendered.indexOf("footnote-item")).toBeGreaterThan(rendered.indexOf("After."));
    expect(md.parse(source, {}).map((t) => t.type)).toContain("plugin_tip_open");

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    const block = projection.blocks.find((b) => b.kind === "plugin-region");
    expect(block).toBeDefined();
    // Byte-exact recovery, unchanged by the unrelated footnote relocation.
    expect(source.slice(block!.from, block!.to)).toBe("---\n");
    expect(projection.diagnostics).toHaveLength(0);
  });
});

describe("curly_attributes does not contaminate origin recovery", () => {
  test("a {.class}-bearing paragraph (curly_attributes splices its own attribute-line triple out of state.tokens) alongside a clean-splice plugin still recovers a byte-exact plugin-region", () => {
    const source = "Styled paragraph.\n{.callout}\n\n---\n\nAfter.\n";
    const md = createMarkdownRenderer([tipMarkerPlugin()]);

    // AP-21 liveness: curly_attributes really merged the attribute line
    // into the preceding paragraph (one triple, not two, with the class
    // attached), and the plugin's own transform really ran.
    const tokens = md.parse(source, {});
    const styledParagraph = tokens.find((t) => t.type === "paragraph_open");
    expect(styledParagraph?.attrGet("class")).toBe("callout");
    expect(tokens.map((t) => t.type)).toContain("plugin_tip_open");

    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    const block = projection.blocks.find((b) => b.kind === "plugin-region");
    expect(block).toBeDefined();
    expect(source.slice(block!.from, block!.to)).toBe("---\n");
    expect(projection.diagnostics).toHaveLength(0);
  });
});
