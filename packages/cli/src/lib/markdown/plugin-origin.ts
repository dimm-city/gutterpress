/**
 * `plugin-origin` — the SFE-P2c evidence-based transform-origin mechanism
 * (docs/plans/source-first-editor-enterprise-refactor.md D6; run
 * docs/plans/source-first-editor/runs/SFE-P2c.md, "Origin mechanism — the
 * binding constraint"). This module answers exactly one question for
 * `editor-projection.ts`: when a trusted, project-plugin-produced token
 * carries no `data-source-range` evidence of its own, can the exact authored
 * source range it was built FROM be recovered from before/after
 * token-stream OBJECT IDENTITY across the plugin core-rule boundary — and if
 * not, why not, naming the offending rule where obtainable.
 *
 * §1/§8 / ADR 0004: this module is part of the PURE, node-free render graph
 * (`gutterpress/render`) exactly like `editor-projection.ts` — it imports
 * ONLY `markdown-it` types. NO `node:*`, NO `fs`/`path`/`url`.
 * `scripts/check-render-pure.mjs` gates the bundled `dist/render.js` this
 * module becomes part of transitively (via `editor-projection.ts`).
 *
 * ============================================================================
 * PART 1 — CAPTURE: where in the core-rule chain "before" and "after" mean
 * ============================================================================
 *
 * THE REAL ORDER, ESTABLISHED EMPIRICALLY (not assumed — the run spec's own
 * instruction). A fresh `createMarkdownRenderer()` (no project plugins)
 * produces this exact `md.core.ruler` name order (probed directly against
 * `(md.core.ruler).__rules__` — the same internal property
 * `inline-source.ts` already reads for the identical reason: markdown-it
 * exposes no other way to enumerate registered rule names):
 *
 *   normalize, block, layout_transform, inline, footnote_tail,
 *   curly_attributes, linkify, replacements, smartquotes, text_join,
 *   gp_pin_scope_check, inline_source_raw_html, source_range
 *
 * Two facts this establishes, both load-bearing for the bracket chosen below:
 *
 *   1. `source_range` (source-range.ts) runs LAST, after every project
 *      plugin's own core rule — confirmed by `renderer.ts`'s own
 *      `md.core.ruler.push("source_range", ...)`, called unconditionally
 *      AFTER `applyPlugins(...)`. This is the exact concern the run spec
 *      flags: "if source_range runs after plugins, surviving tokens already
 *      have their evidence stamped post-transform, which changes what
 *      'before' means." It does. Concretely: a token a plugin's core rule
 *      REPLACES never had a chance to be annotated (it's gone by the time
 *      `source_range` runs); a token a plugin's core rule PRESERVES BY
 *      IDENTITY (a survivor) already carries whatever `data-source-range`
 *      `source_range` stamps onto the FINAL stream — which is exactly the
 *      P2b evidence-bearing path `editor-projection.ts` already uses and
 *      this module has no business touching (rule 2 below).
 *   2. A project plugin's OWN core rule position in the chain is under THE
 *      PLUGIN'S OWN CONTROL, not Gutterpress's — a "plain markdown-it
 *      plugin" (§5 CLAUDE.md) can register via `.push()` (lands wherever the
 *      ruler currently ends, i.e. AFTER `gp_pin_scope_check` for a plugin
 *      applied through `applyPlugins`) OR via `.after(anchorName, ...)` /
 *      `.before(anchorName, ...)` targeting ANY existing rule name,
 *      including ones EARLIER than `gp_pin_scope_check`. Verified directly:
 *      the run spec's own reference shape — study markers.js's OWN rule —
 *      registers via `md.core.ruler.after("layout_transform", ...)`
 *      (`editor-projection-plugins.test.ts`'s `asideMarkerPlugin`), which
 *      lands BEFORE `inline`, `footnote_tail`, `curly_attributes`, and
 *      `gp_pin_scope_check` — NOT between `gp_pin_scope_check` and
 *      `inline_source_raw_html`, where a plain `.push()`-registered plugin
 *      would land. TRUE clean bracketing of "exactly the plugin region and
 *      nothing else" is therefore NOT POSSIBLE for an arbitrary third-party
 *      plugin — the run spec explicitly anticipates this ("if the chain does
 *      not allow clean bracketing, say so and implement the closest sound
 *      alternative").
 *
 * THE CLOSEST SOUND ALTERNATIVE this module implements: bracket at the
 * WIDEST anchors that are (a) always present on any `md` built by
 * `createMarkdownRenderer()`, REGARDLESS of whether project plugins are
 * configured, and (b) provably bound EVERY registration position a
 * `.push()`-registered OR an `.after("layout_transform", …)`-registered
 * plugin (this module's two observed real shapes) can land at:
 *
 *   - BEFORE anchor: `.after("layout_transform", "gp_plugin_origin_before",
 *     …)`. `layout_transform` is the EARLIEST point Gutterpress's own
 *     pipeline offers a block-token stream with markers already resolved
 *     into real `layout_*` tokens (rather than raw `layout_marker`
 *     bookkeeping tokens) — the natural, and empirically demonstrated, floor
 *     for "a plugin that wants to consume already-parsed block content."
 *     Registering here (LAZILY, at `createEditorProjection` call time —
 *     always AFTER the `md`'s entire configuration phase, including every
 *     `applyPlugins` call, is complete) inserts this module's rule
 *     IMMEDIATELY after `layout_transform`, which — because `.after()`
 *     always splices relative to the NAMED rule's CURRENT array position,
 *     not to when the caller registered — lands BEFORE whatever a plugin
 *     ALSO anchored at `.after("layout_transform", …)` already occupies
 *     (verified: a second `.after("layout_transform", X)` call always
 *     inserts immediately after `layout_transform`, pushing the FIRST
 *     occupant one position later). A plugin registering even earlier than
 *     `layout_transform` (e.g. `.after('block', …)`, wanting Gutterpress's
 *     own unresolved marker bookkeeping tokens) is a documented, known gap:
 *     such a plugin's activity falls OUTSIDE this bracket and its tokens
 *     present as ordinary "before" survivors — a fail-closed miss (this
 *     module simply never sees a diff to explain), never a wrong answer.
 *   - AFTER anchor: `.before("inline_source_raw_html",
 *     "gp_plugin_origin_after", …)`. `inline_source_raw_html`
 *     (`inline-source.ts`) is `md.core.ruler.push`-registered by
 *     `createMarkdownRenderer` STRICTLY AFTER `applyPlugins(...)` returns —
 *     meaning every plugin's OWN registration call (`.push()`, `.after()`,
 *     `.before()`, targeting ANY existing name) has already happened and
 *     landed SOMEWHERE in the array by the time `inline_source_raw_html` is
 *     pushed to the CURRENT end. `.push()` always appends past whatever is
 *     currently last, so `inline_source_raw_html` is GUARANTEED to be the
 *     rule immediately after every plugin-registered rule, regardless of
 *     where each one chose to insert itself. This anchor is therefore sound
 *     without qualification.
 *
 * Both anchors are checked for existence before registering (via the same
 * `__rules__` introspection) — a bare `MarkdownIt` with no Gutterpress
 * plugins applied (several existing P2b/P2c fixtures construct one directly)
 * has NEITHER name, and `registerPluginOriginCapture` is then a documented
 * no-op rather than a thrown "Parser rule not found" — every downstream
 * caller sees "no snapshot available" and refuses, exactly like any other
 * insufficient-evidence case.
 *
 * The two registered rules do nothing but `state.tokens.slice()` (a
 * read-only snapshot) into a namespaced key on `state.env` — never mutate
 * `state.tokens` or any token — so rendered output is provably unaffected
 * (SFE-P2c's "Rendered book/preview/PDF output byte-identical" requirement)
 * and this module cannot itself become a source of the very ambiguity it
 * exists to detect.
 *
 * ============================================================================
 * PART 2 — DIFF: object identity, then the four rules verbatim
 * ============================================================================
 *
 * Given `before` (right after `layout_transform`) and `after` (right before
 * `inline_source_raw_html`, i.e. the SAME array `editor-projection.ts`
 * itself walks — nothing between this module's own "after" rule and the
 * caller's use of `tokens` reassigns `state.tokens`, only annotates
 * attributes), rule 2 (survivors keep their own evidence) is NOT this
 * module's concern at all — `editor-projection.ts` already handles every
 * token that carries its own `data-source-range` directly, before this
 * module is ever consulted (see that module's "EVIDENCE-BEARING PLUGIN-
 * REGION" section). This module is called ONLY for a token proven absent
 * from `before` by construction (a trusted, unrecognized, `nesting === 1`
 * token that has no `data-source-range` of its own cannot be a survivor: a
 * survivor is definitionally a token that existed BEFORE any plugin ran, and
 * nothing plugin-created exists in the `before` snapshot).
 *
 * Rule 3 (clean splice) and rule 4 (refuse) are implemented by
 * {@link resolvePluginTokenOriginFromSnapshot} via a LOCAL, per-token
 * analysis: walk outward from the queried token's `after`-index to the
 * nearest SURVIVING token on each side (a survivor = present in both arrays
 * by `===`, and present in `after` EXACTLY ONCE — see "copy" below), map
 * those two anchors back to their `before`-positions, and treat everything
 * `before`-side strictly between them as "the removed run." This is a
 * deliberately LOCAL (not whole-document-hunk-table) design: it is naturally
 * immune to unrelated activity elsewhere in the document (a footnote
 * relocation, a linkify insertion far away) because such activity never
 * becomes one of THIS token's two nearest anchors. Six DISTINCT ways this
 * local analysis can fail to support rule 3, each checked explicitly and
 * each producing its own named reason (see `plugin-origin.test.ts`'s
 * refusal matrix, one fixture per shape):
 *
 *   1. INTERLEAVED EDITS — detected GLOBALLY, once per snapshot: walk every
 *      survivor in `before` order and confirm its `after`-index is strictly
 *      increasing. A violation means SOME survivor changed relative order
 *      between the two snapshots (the plugin reordered content, not just
 *      replaced it) — local anchor pairs cannot be trusted anywhere near
 *      that disorder, so every no-evidence token in this render refuses.
 *      This is intentionally the most conservative of the six checks: it
 *      trades recall for the only kind of soundness a pure identity diff can
 *      actually prove.
 *   2. MULTIPLE OVERLAPPING SPLICES / COPY — a token (queried, or a
 *      candidate anchor) that appears MORE THAN ONCE in `after` by `===`.
 *      Object identity makes a literal duplicate detectable in O(1) via a
 *      count map; a duplicated token cannot honestly be "the" survivor
 *      anchor for any one local analysis, and a duplicated queried token
 *      cannot honestly originate from one source region.
 *   3. MOVED TOKENS — a `before`-side token this module is about to declare
 *      "removed" (i.e. it lies in the computed removed run) is found to
 *      still be present in `after` (anywhere, by `===`). It was relocated,
 *      not replaced.
 *   4. CONSUME-ALL WITH NO CARRIER — walking outward from the queried token
 *      finds NO surviving anchor on EITHER side: nothing in the entire
 *      document survived the plugin boundary, so there is no boundary left
 *      to bound a removed run against.
 *   5. (An anchor-order/empty-run degenerate case, grouped with "moved" in
 *      the reason text since it has the identical root cause: a boundary
 *      that "looks like" the nearest survivor turns out to leave zero or
 *      negative removed tokens — the hallmark of a token that jumped past
 *      where it used to sit rather than a region being cleanly replaced.)
 *   6. PARTIAL EVIDENCE — every token in an otherwise-clean removed run is
 *      checked via {@link resolveTokenRange} (the SAME map-then-meta.line
 *      priority `source-range.ts` documents and implements — duplicated,
 *      not imported, exactly as `editor-projection.ts`'s own header
 *      explains for its `buildLineStarts`/`charRangeForLines` duplication:
 *      packages/cli must not depend on packages/desktop, and this is a
 *      same-package, same-family duplication of a THIRD file's small,
 *      already-tested contract, not a second copy of `editor-projection.ts`
 *      itself). rule 3 requires COMPLETE evidence — literally every removed
 *      token, closes included. A `paragraph_close` never carries `token.map`
 *      in markdown-it itself (verified against `markdown-it/lib/
 *      rules_block/paragraph.mjs`), so a plugin that consumes an ordinary
 *      `paragraph_open`/`inline`/`paragraph_close` triple and emits a
 *      map-less replacement ALWAYS refuses here — a deliberate, honest
 *      consequence of reading rule 3's "every removed token" literally
 *      rather than carving out an exception for close tokens that would
 *      itself be a guess about which tokens "should" need evidence.
 *
 * Every refusal reason names the offending plugin core-rule NAME when
 * exactly one is identifiable in the bracketed region (via the SAME
 * `__rules__` introspection, filtered against a hand-maintained closed set
 * of Gutterpress's OWN non-plugin core-rule names — the identical "positive
 * knowledge of what the base pipeline can produce" pattern
 * `editor-projection.ts`'s own `BASE_PIPELINE_OPEN_TOKEN_TYPES` already
 * uses, verified against the SAME probe this header documents). When zero or
 * more than one plugin rule is registered in the bracketed region, the
 * reason says so explicitly rather than fabricating a single name — the run
 * spec's own instruction ("if the offending rule genuinely cannot be
 * identified, the reason must say so explicitly rather than fabricating a
 * name").
 *
 * ============================================================================
 * HONEST VERDICT ON RULE 3'S SOUNDNESS (recorded here, not just in the run
 * report, so it travels with the code)
 * ============================================================================
 *
 * Rule 3, as implemented, is SOUND for the shape it actually recognizes: a
 * queried token's two nearest surviving neighbors are the only trustworthy
 * boundary a pure identity diff can establish, and every one of the six
 * checks above exists because an adversarial construction was found that
 * would otherwise mis-attribute. One residual, PROVEN-UNSOLVABLE-FROM-
 * IDENTITY-ALONE limitation is recorded rather than hidden: if a plugin
 * relocates a formerly-intervening survivor to sit AFTER a combined
 * replacement for TWO separate, non-adjacent removed tokens (i.e. the
 * replacement for a later removal is placed adjacent to an earlier one,
 * ahead of the relocated survivor), no array-identity diff — local or a
 * full whole-document LCS hunk table alike — can distinguish that from "one
 * removed token legitimately replaced by two output tokens" (this module's
 * own intended happy path). This is not a gap specific to the local design
 * here; it is the same ambiguity ANY identity-based diff has for that input
 * shape. Rule 3 is therefore scoped, deliberately, to a plugin that does not
 * itself reorder survivors — which the global interleave check (case 1
 * above) enforces as a document-wide invariant, catching the vast majority
 * of ways a plugin could trigger this shape (the reorder itself) even where
 * it cannot catch the narrowest possible construction of it. No case in this
 * module's own refusal matrix was found to require narrowing rule 3 to
 * refuse-always; the six checks above are the sound boundary this run
 * settled on.
 */
import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

// ── capture: rule names and registration ────────────────────────────────────

/** Exported so tests don't hardcode the strings. */
export const PLUGIN_ORIGIN_BEFORE_RULE = "gp_plugin_origin_before";
export const PLUGIN_ORIGIN_AFTER_RULE = "gp_plugin_origin_after";

/** See header PART 1 for why these two, and only these two, are sound anchors. */
const ORIGIN_ANCHOR_BEFORE = "layout_transform";
const ORIGIN_ANCHOR_AFTER = "inline_source_raw_html";

/** Namespaced `state.env` key this module stashes its snapshot under. */
const ENV_KEY = "__gpPluginOriginSnapshot";

/**
 * Every core-rule NAME Gutterpress's OWN fixed pipeline can register,
 * verified empirically against a plugin-free `createMarkdownRenderer()` (see
 * header PART 1's probe output) plus this module's own two rules. Anything
 * ELSE found between {@link PLUGIN_ORIGIN_BEFORE_RULE} and
 * {@link PLUGIN_ORIGIN_AFTER_RULE} is, by exclusion, project-plugin-
 * registered — the same closed-set-of-known-base-pipeline-names technique
 * `editor-projection.ts`'s `BASE_PIPELINE_OPEN_TOKEN_TYPES` uses for token
 * TYPES, applied here to core-rule NAMES.
 */
const KNOWN_NON_PLUGIN_CORE_RULE_NAMES = new Set<string>([
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
  PLUGIN_ORIGIN_BEFORE_RULE,
  PLUGIN_ORIGIN_AFTER_RULE,
]);

interface CoreRulerEntry {
  readonly name: string;
}

/** `md.core.ruler.__rules__` — the same internal property `inline-source.ts` already reads (no other way to enumerate registered rule names). */
function coreRuleEntries(md: MarkdownIt): readonly CoreRulerEntry[] {
  return (md.core.ruler as unknown as { __rules__: readonly CoreRulerEntry[] }).__rules__;
}

function coreRuleExists(md: MarkdownIt, name: string): boolean {
  return coreRuleEntries(md).some((rule) => rule.name === name);
}

/** Plugin core-rule names registered strictly between this module's two brackets, filtered to exclude Gutterpress's own known pipeline. Computed fresh per parse — ruler structure is fixed for the lifetime of one `md.parse()` call, and a shared `md` can gain plugins only at `md.use()` time, never mid-parse. */
function pluginRuleNamesBetweenAnchors(md: MarkdownIt): readonly string[] {
  const entries = coreRuleEntries(md);
  const beforeIdx = entries.findIndex((rule) => rule.name === PLUGIN_ORIGIN_BEFORE_RULE);
  const afterIdx = entries.findIndex((rule) => rule.name === PLUGIN_ORIGIN_AFTER_RULE);
  if (beforeIdx === -1 || afterIdx === -1 || afterIdx <= beforeIdx) return [];
  const names: string[] = [];
  for (let i = beforeIdx + 1; i < afterIdx; i++) {
    const name = entries[i]!.name;
    if (!KNOWN_NON_PLUGIN_CORE_RULE_NAMES.has(name)) names.push(name);
  }
  return names;
}

/**
 * Register the before/after snapshot rule pair on `md`, bracketing the
 * region a project plugin's own core rule(s) run in (see header PART 1).
 *
 * Idempotent (checked via the SAME `__rules__` introspection, not a
 * module-level registry — AP-30, no mutable global state) — safe to call on
 * every `createEditorProjection` invocation even when `md` is reused across
 * many calls (e.g. a host caching one configured instance per project).
 *
 * A no-op, NEVER a throw, when either anchor is absent — a bare `MarkdownIt`
 * with no Gutterpress pipeline applied (several existing P2b/P2c fixtures
 * construct one directly) has neither name, and every downstream origin
 * query then sees "no snapshot available" and refuses, exactly like any
 * other insufficient-evidence case; it does not corrupt or block anything
 * else `md.parse()` does.
 *
 * The two rules themselves only ever `state.tokens.slice()` (read-only) into
 * `state.env` — never mutate a token or `state.tokens` — so rendered output
 * is provably unaffected (SFE-P2c: "Rendered book/preview/PDF output
 * byte-identical").
 */
export function registerPluginOriginCapture(md: MarkdownIt): void {
  if (coreRuleExists(md, PLUGIN_ORIGIN_BEFORE_RULE)) return;
  if (!coreRuleExists(md, ORIGIN_ANCHOR_BEFORE) || !coreRuleExists(md, ORIGIN_ANCHOR_AFTER)) return;

  md.core.ruler.after(ORIGIN_ANCHOR_BEFORE, PLUGIN_ORIGIN_BEFORE_RULE, (state) => {
    const env = state.env as Record<string, unknown> | null | undefined;
    if (!env || typeof env !== "object") return;
    (env as Record<string, unknown>)[ENV_KEY] = { before: state.tokens.slice() };
  });

  md.core.ruler.before(ORIGIN_ANCHOR_AFTER, PLUGIN_ORIGIN_AFTER_RULE, (state) => {
    const env = state.env as Record<string, unknown> | null | undefined;
    if (!env || typeof env !== "object") return;
    const bucket = (env as Record<string, unknown>)[ENV_KEY] as { before?: readonly Token[] } | undefined;
    (env as Record<string, unknown>)[ENV_KEY] = {
      before: bucket?.before ?? [],
      after: state.tokens.slice(),
      pluginRuleNames: pluginRuleNamesBetweenAnchors(md),
    };
  });
}

interface PluginOriginSnapshot {
  readonly before: readonly Token[];
  readonly after: readonly Token[];
  readonly pluginRuleNames: readonly string[];
}

function readPluginOriginSnapshot(env: unknown): PluginOriginSnapshot | null {
  if (!env || typeof env !== "object") return null;
  const bucket = (env as Record<string, unknown>)[ENV_KEY];
  if (!bucket || typeof bucket !== "object") return null;
  const { before, after, pluginRuleNames } = bucket as {
    before?: unknown;
    after?: unknown;
    pluginRuleNames?: unknown;
  };
  if (!Array.isArray(before) || !Array.isArray(after)) return null;
  return {
    before: before as readonly Token[],
    after: after as readonly Token[],
    pluginRuleNames: Array.isArray(pluginRuleNames) ? (pluginRuleNames as readonly string[]) : [],
  };
}

// ── diff: evidence, rule 3 (clean splice), rule 4 (refuse) ─────────────────

function isFiniteRangeTuple(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

/**
 * The SAME `token.map`-then-`token.meta.line` priority `source-range.ts`
 * documents and implements (see that file's header). Duplicated, not
 * imported — see this module's own header PART 2 for why (packages/cli must
 * not depend on packages/desktop is not the reason here; this is a
 * same-package duplication of a small, stable, already-tested contract,
 * exactly the precedent `editor-projection.ts`'s own header sets for
 * `buildLineStarts`/`charRangeForLines`).
 */
function resolveTokenRange(token: Token): readonly [number, number] | null {
  if (isFiniteRangeTuple(token.map)) return [token.map[0], token.map[1]];
  const meta = token.meta as { line?: unknown } | null | undefined;
  const line = meta?.line;
  if (typeof line === "number" && Number.isFinite(line)) return [line - 1, line];
  return null;
}

export type PluginOriginResult =
  | { readonly ok: true; readonly range: readonly [number, number] }
  | { readonly ok: false; readonly reason: string };

function describeRule(pluginRuleNames: readonly string[]): string {
  if (pluginRuleNames.length === 1) return `plugin core rule "${pluginRuleNames[0]}"`;
  if (pluginRuleNames.length === 0) {
    return "no project-plugin core rule name could be identified in the bracketed region (only Gutterpress's own core rules ran there)";
  }
  return (
    `one of several plugin core rules registered in this render (${pluginRuleNames
      .map((name) => `"${name}"`)
      .join(", ")}) — the specific offending rule could not be isolated from a whole-region token snapshot`
  );
}

/**
 * The pure diff/classification core (rules 3 and 4 — see this module's own
 * header for the full design and the six named refusal shapes). Exported
 * directly so tests can exercise EACH shape with hand-constructed
 * `before`/`after` arrays where a realistic markdown-it pipeline cannot
 * naturally produce it (e.g. object-identity duplication), alongside
 * pipeline-driven fixtures for the shapes that arise naturally (clean
 * splice, partial evidence, consume-all).
 */
export function resolvePluginTokenOriginFromSnapshot(
  token: Token,
  tokenIndex: number,
  after: readonly Token[],
  before: readonly Token[],
  pluginRuleNames: readonly string[],
): PluginOriginResult {
  const rule = describeRule(pluginRuleNames);

  const beforeIndexOf = new Map<Token, number>();
  const beforeDuplicates = new Set<Token>();
  for (let i = 0; i < before.length; i++) {
    const t = before[i]!;
    if (beforeIndexOf.has(t)) beforeDuplicates.add(t);
    else beforeIndexOf.set(t, i);
  }

  const afterCount = new Map<Token, number>();
  const afterIndexOf = new Map<Token, number>();
  for (let i = 0; i < after.length; i++) {
    const t = after[i]!;
    afterCount.set(t, (afterCount.get(t) ?? 0) + 1);
    if (!afterIndexOf.has(t)) afterIndexOf.set(t, i);
  }

  const isReliableSurvivor = (t: Token): boolean =>
    beforeIndexOf.has(t) && !beforeDuplicates.has(t) && (afterCount.get(t) ?? 0) === 1;

  // Shape 1 — INTERLEAVED EDITS: global survivor-order check across the
  // WHOLE snapshot, once. A violation means this document's plugin activity
  // reordered content, not just replaced it — no local anchor pair anywhere
  // can then be trusted (see header "HONEST VERDICT").
  let previousAfterIdx = -1;
  for (let i = 0; i < before.length; i++) {
    const t = before[i]!;
    if (!isReliableSurvivor(t)) continue;
    const afterIdx = afterIndexOf.get(t)!;
    if (afterIdx <= previousAfterIdx) {
      return {
        ok: false,
        reason:
          `Refusing: ${rule} reordered other tokens elsewhere in this document — a token ` +
          `that survives the plugin boundary appears in a different relative order before ` +
          `vs. after, so no local origin near "${token.type}" can be trusted (interleaved ` +
          `edits). Edit this content in source mode.`,
      };
    }
    previousAfterIdx = afterIdx;
  }

  // Shape 2 — COPY / MULTIPLE OVERLAPPING SPLICES: the queried token itself
  // is duplicated by object identity in `after`.
  if ((afterCount.get(token) ?? 0) > 1) {
    return {
      ok: false,
      reason:
        `Refusing: "${token.type}" (produced by ${rule}) appears more than once in the ` +
        `transformed token stream — the same object cannot honestly be attributed to one ` +
        `source region twice (copy / multiple overlapping splices). Edit this content in ` +
        `source mode.`,
    };
  }

  // Locate the nearest surviving anchor on each side of the queried token.
  let leftAfterIdx = tokenIndex - 1;
  while (leftAfterIdx >= 0 && !isReliableSurvivor(after[leftAfterIdx]!)) leftAfterIdx--;
  let rightAfterIdx = tokenIndex + 1;
  while (rightAfterIdx < after.length && !isReliableSurvivor(after[rightAfterIdx]!)) rightAfterIdx++;

  // Shape 4 — CONSUME-ALL WITH NO CARRIER: no surviving anchor anywhere.
  if (leftAfterIdx < 0 && rightAfterIdx >= after.length) {
    return {
      ok: false,
      reason:
        `Refusing: no surviving token exists anywhere in the transformed stream to anchor ` +
        `an origin search for "${token.type}" (produced by ${rule}) — the entire document ` +
        `was consumed and replaced with no carrier left as a boundary (consume-all). Edit ` +
        `this content in source mode.`,
    };
  }

  const beforeLeftIdx = leftAfterIdx < 0 ? -1 : beforeIndexOf.get(after[leftAfterIdx]!)!;
  const beforeRightIdx = rightAfterIdx >= after.length ? before.length : beforeIndexOf.get(after[rightAfterIdx]!)!;

  // Shape 3/5 — MOVED TOKENS (degenerate anchor order): the anchors are out
  // of order, or leave nothing between them, in the pre-transform snapshot.
  if (beforeRightIdx <= beforeLeftIdx) {
    return {
      ok: false,
      reason:
        `Refusing: the tokens surrounding "${token.type}" (produced by ${rule}) are out of ` +
        `order between the pre- and post-transform snapshots — this looks like a moved ` +
        `token, not a clean replacement. Edit this content in source mode.`,
    };
  }

  const removedRun = before.slice(beforeLeftIdx + 1, beforeRightIdx);
  if (removedRun.length === 0) {
    return {
      ok: false,
      reason:
        `Refusing: no tokens were removed between the nearest surviving tokens around ` +
        `"${token.type}" (produced by ${rule}) — this looks like an insertion or a ` +
        `relocated boundary rather than a consumed-and-replaced region. Edit this content ` +
        `in source mode.`,
    };
  }

  // Shape 3 — MOVED TOKENS: a would-be-removed token is still present in
  // `after` somewhere — it was relocated, not replaced.
  for (const removed of removedRun) {
    if ((afterCount.get(removed) ?? 0) > 0) {
      return {
        ok: false,
        reason:
          `Refusing: "${removed.type}" was expected to be consumed by ${rule} to produce ` +
          `"${token.type}" but still appears in the transformed stream — it was moved ` +
          `rather than replaced, so this region cannot be cleanly attributed. Edit this ` +
          `content in source mode.`,
      };
    }
  }

  // Shape 6 — PARTIAL EVIDENCE: every removed token must carry its own
  // complete range evidence, closes included (see header PART 2, shape 6).
  const ranges: Array<readonly [number, number]> = [];
  for (const removed of removedRun) {
    const range = resolveTokenRange(removed);
    if (!range) {
      return {
        ok: false,
        reason:
          `Refusing: the region consumed by ${rule} to produce "${token.type}" contains a ` +
          `token ("${removed.type}") with no source-range evidence of its own (map/` +
          `meta.line missing) — rule 3 requires COMPLETE evidence on every removed token, ` +
          `not just some (partial evidence). Edit this content in source mode.`,
      };
    }
    ranges.push(range);
  }

  const from = Math.min(...ranges.map((r) => r[0]));
  const to = Math.max(...ranges.map((r) => r[1]));
  return { ok: true, range: [from, to] };
}

/**
 * Integration entry point: reads the snapshot `registerPluginOriginCapture`
 * stashed on `env` (via `md.parse(source, env)`) and delegates to
 * {@link resolvePluginTokenOriginFromSnapshot}. Returns a structured refusal
 * (never throws) when no snapshot is available — a `md` that never had
 * {@link registerPluginOriginCapture} run successfully against it (missing
 * anchors), or an `env` that was never threaded through `md.parse()`.
 */
export function resolvePluginTokenOrigin(
  token: Token,
  tokenIndex: number,
  tokens: readonly Token[],
  env: unknown,
): PluginOriginResult {
  const snapshot = readPluginOriginSnapshot(env);
  if (!snapshot) {
    return {
      ok: false,
      reason:
        `Refusing: no before/after plugin-origin snapshot is available for "${token.type}" ` +
        `— either registerPluginOriginCapture found no bracketable core-rule anchors on ` +
        `this markdown-it instance, or state.env was not threaded through md.parse(). ` +
        `Edit this content in source mode.`,
    };
  }
  return resolvePluginTokenOriginFromSnapshot(token, tokenIndex, tokens, snapshot.before, snapshot.pluginRuleNames);
}
