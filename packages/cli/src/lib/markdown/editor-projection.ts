/**
 * `createEditorProjection` — the Gutterpress sparse editor projection (D6,
 * docs/plans/source-first-editor-enterprise-refactor.md; runs
 * docs/plans/source-first-editor/runs/SFE-P2b.md and, for the plugin-aware
 * additions documented in "PLUGIN-AWARENESS (SFE-P2c)" below,
 * docs/plans/source-first-editor/runs/SFE-P2c.md).
 *
 * §1/§8 / ADR 0004: this module is part of the PURE, node-free render graph
 * (`gutterpress/render`, `src/render.ts`) — it imports ONLY `markdown-it`
 * (types) and this package's own pure `renderer.ts`/`source-range.ts`. NO
 * `node:*`, NO `fs`/`path`/`url`. `scripts/check-render-pure.mjs` gates this.
 *
 * WHAT THIS BUILDS (D6): "The editor projection is not a second complete
 * Markdown AST. It contains only Gutterpress-specific information the base
 * editor cannot derive." Concretely: one `ProjectedBlock` per authored
 * Gutterpress layout-marker DECLARATION LINE (`@chapter`/`@spread`/`@page`/
 * `@section`/`@page-break`/`@column-break`) and per standalone raw HTML
 * block; one `GeneratedView` for pipeline output with no authored range
 * (markers.js's `.chapter-opener` injection); a typed diagnostic — and NO
 * block — for anything this run cannot honestly attribute to source
 * (D6/G-05: never infer a range from DOM, tag gaps, text equality, or
 * reverse conversion).
 *
 * ONE PIPELINE (G-03 / the run spec's "do NOT build a parallel parser
 * config"): this module reuses `createMarkdownRenderer()` from `./renderer`
 * — the SAME configured `MarkdownIt` instance the render/preview/PDF path
 * uses — and reads the TOKEN STREAM via `md.parse()`, never the rendered
 * HTML string and never a second Markdown parser. Range evidence comes
 * exclusively from the `data-source-range` attribute the `source_range` core
 * rule (`./source-range.ts`) already annotates onto every marker-family
 * token, in that rule's own documented priority order (`token.map`, then
 * `token.meta.line` for `layout_*` wrappers — see that file's header and
 * ADR 0009). This module does not re-derive `token.map`/`meta.line` itself;
 * duplicating that priority logic here would be a second, driftable copy of
 * `source-range.ts`'s contract.
 *
 * KIND ENUMERATION (D6's required kinds, mapped from markers.js's OWN
 * `KNOWN_KINDS` marker vocabulary — see markers.js's parser and
 * `editor-projection.test.ts`'s enumeration test, which reads that source
 * file's array literal and asserts this mapping's coverage against it):
 *
 *   markers.js kind   ->  ProjectedBlockKind   ->  source token type(s)
 *   ----------------      -----------------        --------------------
 *   chapter           ->  "chapter"             ->  layout_chapter_open
 *   spread            ->  "spread"              ->  layout_spread_open
 *   page              ->  "page"                ->  layout_page_open
 *   section           ->  "section"             ->  layout_section_open
 *     (incl. the section @continue opens — it is an ordinary
 *      layout_section_open token, same kind, same evidence path)
 *   page-break        ->  "page-break"          ->  layout_page_break
 *   column-break      ->  "column-break"        ->  layout_column_break
 *   continue          ->  (not a kind of its own — @continue closes one
 *                          section and opens another; the new section IS a
 *                          normal "section" block above)
 *   end-section       ->  (not a kind — closes a section, produces no token
 *                          of its own)
 *
 * Plus, outside markers.js's marker vocabulary:
 *   html_block token, with evidence      -> "raw-html"
 *   html_block token, matching the       -> GeneratedView (see below), not
 *     `.chapter-opener` generated shape     a block
 *   an unrecognized `layout_`-prefixed   -> diagnostic, no block (this
 *     token (Gutterpress's OWN reserved     branch is unconditional — see
 *     namespace)                            "AMBIGUITY" below)
 *   trusted + a project-plugin's own     -> "plugin-region" WITH the
 *     nesting===1 open token that KEPT      token's own exact range
 *     its `token.map` (SFE-P2c;
 *     "PLUGIN-AWARENESS" below)
 *   trusted + the same, but map-less     -> diagnostic, no block (Lane B's
 *     (no evidence of its own)               origin-recovery integration
 *                                            point; see "PLUGIN-AWARENESS")
 *   untrusted (default) + any of the     -> nothing at all — not walked,
 *     above                                  exactly P2b's behavior
 *   inline HTML (`html_inline` tokens,   -> diagnostics entry ONLY, no
 *     support matrix's source-only row)     block (see "INLINE HTML" below)
 *
 * `layout_marker` (markers.js's own internal bookkeeping token type) is
 * never reached by this walk: `layout_transform` always drains and replaces
 * it before core rules finish (see markers.js's header comment) — it only
 * survives to a rendered token stream when NO markers are used at all, in
 * which case none exist to walk either. `layout_*_close` tokens are reached
 * but deliberately produce nothing: the matching `*_open` token already
 * carries this block's full kind/range (D6 sparseness — one projected block
 * per marker DECLARATION, not one per open+close pair).
 *
 * WHY BLOCKS ARE NOT NESTED (an intentional, evidence-driven design choice,
 * not an oversight — "derive which [relation] the marker DOM actually
 * produces" per the run spec): a `chapter`/`spread`/`page`/`section` block's
 * `[from, to)` covers ONLY its own marker DECLARATION LINE, never the body
 * down to its matching close marker. This is exactly what the evidence
 * supports and no more: markers.js's own header states token.map is
 * "deliberately left null on all of these tokens" (ADR 0009) specifically
 * so `markdown-it-source-map` cannot resolve scroll-sync to the wrapper
 * instead of the content — only `token.meta.line`, ONE line, is threaded.
 * Computing a "whole chapter body" range by scanning forward to the matching
 * close token would be exactly the kind of gap-inference D6/G-05 forbid
 * ("never inferred from... tag gaps"). The consequence: projected blocks for
 * the marker family are simply ORDERED, DISJOINT single-line (or, for
 * `raw-html`, multi-line but still non-overlapping) spans in document order
 * — never overlapping, never nested. `editor-projection.test.ts` asserts
 * this directly: `blocks` is sorted by `from`, and for consecutive blocks
 * `blocks[i].to <= blocks[i + 1].from`.
 *
 * CHAR-OFFSET CONVENTION (D1/D3: UTF-16 code-unit offsets; the run spec asks
 * this module to "define the exact convention... DOCUMENT it, and assert it
 * in tests"): this module does NOT invent a new convention — it mirrors the
 * ALREADY-established, already-tested wire contract at
 * `packages/desktop/src/lib/editor/source-range.ts` (`buildLineStarts` /
 * `charRange`), duplicated here rather than imported (packages/cli must not
 * depend on packages/desktop — D4 direction). Line breaks are found with
 * `/\r\n?|\n/g` — CRLF, lone CR, or LF each count as exactly one line break,
 * matching markdown-it's own `normalize` core rule, which collapses all
 * three to `\n` before parsing (so a CRLF/lone-CR source has the SAME
 * number of lines, at the SAME line indices, as what markdown-it actually
 * walks — verified empirically in `editor-projection.test.ts` against
 * markdown-it's reported `token.map` for CRLF and no-trailing-newline
 * sources). `to` is the char offset of the START of the line immediately
 * after the block's last line — equivalently `source.length` once `to`
 * reaches or exceeds the number of recorded line-starts (the file's last
 * line, or a source with no trailing newline). This means `to` ALWAYS
 * INCLUDES the block's own trailing line terminator(s): ranges are
 * therefore mutually adjacent and non-overlapping by construction, and
 * `source.slice(from, to)` reproduces the block's own line(s) byte-for-byte,
 * terminator included — exactly what "slice-exact" requires.
 *
 * This module deliberately does NOT throw on a malformed
 * `data-source-range` value the way the desktop `charRange` does: that
 * function is called against one attribute at overlay-open time, where a
 * throw-and-catch-upstream is the right shape for an interactive action.
 * This module instead builds a whole-document projection that must NEVER
 * throw (the run spec's malformed-marker requirement: "projection degrades
 * per-block, never throws, never guesses") — a malformed or missing range
 * becomes a typed diagnostic and the affected block is simply omitted
 * (fail closed; the source stays editable as plain markdown).
 *
 * ATTRIBUTE FIDELITY / AP-06 (`viewAttributes`): every attribute on a
 * marker-family token EXCEPT the two this SAME render graph adds AFTER
 * markers.js has finished building the token — `data-source-range` /
 * `data-chapter-src`, both set ONLY by the `source_range` core rule
 * (`./source-range.ts`), which is registered strictly after markers.js's
 * `layout_transform` rule (see `renderer.ts`). Every OTHER attribute on a
 * `layout_*_open` / `layout_page_break` / `layout_column_break` token was
 * set by markers.js ITSELF (`addClasses`/`attachDataAttrs`, called
 * synchronously while building the token from its own parsed marker line)
 * — no other core rule in `createMarkdownRenderer`'s pipeline ever calls
 * `attrSet` on these specific token types: `gp-pin-scope.js` only READS
 * `class` off them (never writes), and `images.ts`/`inline-source.ts` only
 * touch image/inline tokens, never `layout_*`. This is how this module
 * resolves AP-06's "never from transformed tokens": the exclusion list is
 * exactly (and only) the two keys `source-range.ts` is documented to add.
 *
 * GENERATED VIEWS (`.chapter-opener`, D6/G-04/AP-13): markers.js injects the
 * chapter-opener as a synthetic `html_block` token — `new
 * state.Token('html_block', '', 0)` — with NO `token.map` and NO
 * `token.meta.line` (see `openPage` in markers.js), so it never receives
 * `data-source-range` evidence: exactly the "no authored range" shape D6
 * requires a `GeneratedView` for. It is recognized by its own fixed,
 * markers.js-emitted HTML shape (`CHAPTER_OPENER_CONTENT_RE`) — the only
 * honest way to name it without a markers.js change this lane may not make.
 * `GeneratedView.html` is `token.content` directly: markdown-it's own
 * DEFAULT `html_block` renderer rule is exactly `(tokens, idx) =>
 * tokens[idx].content` (see `source-range.ts`'s header, which documents the
 * same fact), and this pipeline never overrides that rule — only the
 * `layout_*` token types get custom renderer rules (`markers.js`). So
 * `token.content` IS byte-identical to what the render path would emit for
 * this fragment; re-invoking the renderer for one token would be strictly
 * more code for the same string. `GeneratedView.anchor` is the generating
 * marker's range END — concretely, `lastBlockEnd`, the `to` of the
 * immediately preceding `ProjectedBlock`. This is correct BY CONSTRUCTION,
 * not a guess: markers.js pushes the opener token directly after the
 * `layout_page_open` token it belongs to (see `openPage`), so in this
 * single forward pass over the flat token stream, "the previous block's
 * `to`" and "the generating `@page` marker's range end" are the same
 * offset.
 *
 * INLINE HTML (support matrix, `docs/plans/source-first-editor/pr158-lessons.md`
 * §10.1 "Raw HTML with exact source" / inline row): `html_inline` tokens
 * (`<b>`/`<span>`/… written inline within a paragraph, heading, etc.) never
 * carry per-token map evidence at all — `source-range.ts`'s own header notes
 * inline-level tokens are deliberately not walked for exactly this reason.
 * This run records ONE diagnostic per `inline` token that contains at least
 * one `html_inline` child (not one per occurrence — a paragraph with two
 * inline tags gets one diagnostic, not two) and projects NO block for it;
 * `packages/cli/src/lib/markdown/inline-source.ts`'s own image/link
 * provenance is a different, unrelated concern (image `src`/link `href`
 * editing) and is untouched by this module.
 *
 * AMBIGUITY / AP-05 (a `layout_`-prefixed token this module does not
 * recognize — e.g. a plugin's own core rule synthesizing one INTO
 * Gutterpress's OWN reserved `layout_` namespace): rather than guessing a
 * kind or inferring a range, this module emits a single
 * `EDITOR_UNSUPPORTED_PROJECTION`-categorized diagnostic naming the token
 * type and projects no block. This branch is UNCONDITIONAL — independent of
 * the `trusted` gate SFE-P2c adds (see "PLUGIN-AWARENESS" next) — because it
 * is about a reserved NAME, not about executing untrusted plugin code:
 * SFE-P2b's own test for this exact shape passes a bare `MarkdownIt`
 * instance with no trust concept in play at all, and it must keep passing
 * unmodified. A THIRD-PARTY project plugin's own token vocabulary — which
 * will almost never use the `layout_` prefix, since it is not that plugin's
 * namespace to begin with — is handled by the separate, trust-gated
 * mechanism documented next.
 *
 * PLUGIN-AWARENESS (SFE-P2c): this module was extended to be plugin-aware
 * here; the rest of this section is new since P2b.
 *
 * HOST CONTRACT (D12, §5 CLAUDE.md): this module NEVER loads or applies
 * project plugins itself. It only ever CONSUMES an already-configured `md`
 * — `opts.md`, defaulting to a plain `createMarkdownRenderer()` with none
 * applied. Loading plugins (resolving from npm/a vendored tree, verifying
 * receipts, importing) and applying them (`applyPlugins(md, loadedPlugins)`,
 * `renderer.ts`) are the HOST's job, on the Node side, BEFORE the `md`
 * instance ever reaches this function. This is not a stylistic choice: it is
 * structurally impossible for this module to do otherwise and remain
 * browser-safe (see the file-header §1/§8/ADR-0004 note above) —
 * `plugins.ts` (the loader) imports `node:crypto`, `node:fs`,
 * `node:fs/promises`, `node:os`, `node:path`, `node:url`, `node:module`,
 * plus `acorn`/`es-module-lexer`/`resolve.exports` to parse and rewrite
 * plugin source on disk; none of that can exist in `gutterpress/render`
 * (`scripts/check-render-pure.mjs` would fail the build the instant it did).
 * So "the projection loads plugins" is not merely undesirable, it is a
 * contradiction with this module's own pure/browser-safe contract — the
 * HOST-applies-then-hands-in shape is the ONLY shape that can satisfy both
 * "plugins execute in the host, never the editor webview" (D12) and "this
 * module ships in `gutterpress/render`" at once.
 *
 * TRUST GATE (`opts.trusted`, default `false`): D12 — "Project plugins
 * execute only in trusted desktop projects or trusted VS Code workspaces."
 * Defaulting to `false` makes the UNTRUSTED path the one a caller gets by
 * omission — it cannot be skipped by forgetting a flag, only by explicitly
 * opting in. Precisely what this flag does and does NOT gate:
 *   - It does NOT decide whether plugin code executes. That already
 *     happened (or did not) before this module ever sees `md` — see "HOST
 *     CONTRACT" above. A caller that hands in a plugin-applied `md` without
 *     `trusted: true` gets a `md.parse()` result that MAY already reflect
 *     the plugin's transform (the tokens are whatever `md.parse()`
 *     produces); what `trusted` controls is only whether THIS module is
 *     willing to expose any of that as a `plugin-region` block.
 *   - When `false` (or `md` was never plugin-applied to begin with), EVERY
 *     unrecognized, non-`layout_`-prefixed token this module encounters
 *     falls through completely unwalked — byte-identical to P2b's behavior
 *     for the same shape, diagnostic-free, block-free (see
 *     `editor-projection-plugins.test.ts`'s untrusted-path test, which
 *     proves this by comparing the FULL projection against the same source
 *     parsed through a plugin-free `md`, not merely spot-checking one
 *     field).
 *   - When `true`, the classification below activates for tokens this
 *     module does not otherwise recognize.
 *
 * EVIDENCE-BEARING PLUGIN-REGION (this run's Lane A scope, in full): a
 * trusted `nesting === 1` "open" token whose type is neither a recognized
 * Gutterpress marker kind, nor `layout_`-prefixed (that branch above always
 * wins first when it matches), nor a member of
 * `BASE_PIPELINE_OPEN_TOKEN_TYPES` (the fixed, hand-maintained, closed set
 * of types Gutterpress's OWN base pipeline — markdown-it core plus the
 * always-on bundled rules — can produce with ZERO project plugins; see that
 * constant's own doc comment for exactly why this exclusion is required,
 * not optional) is presumed project-plugin-produced. If it carries
 * `data-source-range` evidence of ITS OWN — i.e. `source_range.ts`'s core
 * rule, which runs LAST in the pipeline (`renderer.ts`, after every custom
 * plugin), already annotated this EXACT token because the plugin itself
 * preserved `token.map` (or set `token.meta.line`) when it created the
 * token — this module uses that evidence DIRECTLY, exactly like the
 * marker-family branch above, and projects `kind: "plugin-region"` with
 * that exact range, `editMode: "source"` (matching `raw-html`'s two-state
 * posture: G-07's active state is source-aware editing of the block's own
 * exact range, not a structured command surface a third-party plugin never
 * opted into), and `viewAttributes` via the SAME `extractViewAttributes`
 * helper the marker family uses (AP-06 applies identically — the only
 * non-authored keys any token in this pipeline ever gains are the two
 * `source_range.ts` adds). This needs no origin RECOVERY at all: the range
 * came from the token's own recorded evidence, the same as any other
 * evidence-bearing token this module has always handled.
 *
 * NO EVIDENCE / LANE B INTEGRATION POINT (now wired, SFE-P2c): when the SAME
 * trusted, plugin-produced, unrecognized token carries no `data-source-range`
 * of its own (the plugin consumed source and synthesized a token the way
 * markers.js's OWN chapter-opener does — `new state.Token(...)` with no
 * map/meta at all), this module cannot honestly attribute a range to it by
 * itself — inventing one would be exactly the AP-05 guess D6/G-05 forbid.
 * The call site below hands this case to `resolvePluginRegionOrigin`,
 * which now delegates to `plugin-origin.ts`'s evidence-based
 * before/after-token-stream-object-identity mechanism (that module's own
 * header documents the full design: rule 3's clean-splice recovery and rule
 * 4's six distinct refusal shapes). A refusal from that module — including
 * "no snapshot available" for an `md` this module's own
 * `registerPluginOriginCapture` call could not bracket — becomes the SAME
 * shape of `EDITOR_UNSUPPORTED_PROJECTION` diagnostic this module has always
 * used for an unattributable token; the call site's own diagnostic text is
 * unchanged from P2b/Lane A (see `resolvePluginRegionOrigin`'s own doc
 * comment for the exact contract).
 *
 * PLUGIN CSS: `collectPluginCss(loadedPlugins)` (`renderer.ts`) concatenates
 * every loaded plugin's own `css` export. This module does not call it and
 * does not know about it — plugin CSS reaches the editor the SAME way the
 * rest of the resolved presentation context does (pr158-lessons.md G-03 /
 * `EditorPresentationContext`): the HOST loads plugins once, calls
 * `collectPluginCss` alongside `applyPlugins`, and hands the editor BOTH the
 * `md` instance (for this module) and the CSS string (for the editor's own
 * stylesheet) as sibling outputs of the SAME host-side load. This module
 * has no CSS-shaped output and adds none — implementing editor-side CSS
 * loading is out of this lane's and this module's scope entirely.
 *
 * D13 CAPS (SFE-P2b Lane C addition — `editor-projection-limits.test.ts`):
 * enforced in a small, clearly-marked section below ("── D13 resource caps
 * ──"), grafted onto Lane A's walk above WITHOUT restructuring it. Three
 * independent caps, all fail-closed, all NEVER throw, all leave every block
 * already emitted untouched:
 *
 *   1. BLOCK-COUNT cap (`MAX_PROJECTED_BLOCKS`, 10,000): once `blocks.length`
 *      would exceed the cap, the walk STOPS immediately (`break`, not
 *      `continue`) — one `EDITOR_PROJECTION_LIMIT` diagnostic is appended and
 *      the top-level `limited: true` flag is set. `limited` is this module's
 *      "the rest of the document has no block coverage at all" signal — a
 *      consumer should treat it exactly like a stale projection (G-11's
 *      existing convention) and fall through to plain/default rendering for
 *      the WHOLE document, not attempt partial chip rendering up to the cap.
 *   2. PER-PAYLOAD cap (`MAX_INACTIVE_HTML_BYTES`, 1 MiB): any single
 *      `ProjectedBlock.inactiveHtml` or `GeneratedView.html` this module is
 *      about to emit is measured in UTF-8 BYTES via `TextEncoder` (D13 says
 *      "measure... browser-safe" — `TextEncoder` is available in every
 *      target this module ships to: Node, Bun, and the browser; `Buffer` is
 *      not). Over the cap, the payload is replaced with a small fixed
 *      placeholder string plus a diagnostic — the block/view itself is still
 *      emitted (unlike cap 1, this does NOT set `limited`: the block's own
 *      range/kind is still valid and fully covered, only its rendered-HTML
 *      preview shrinks to a placeholder).
 *   3. AGGREGATE cap (`MAX_AGGREGATE_HTML_BYTES`, 8 MiB): a running UTF-8-byte
 *      total across every kept (non-placeholder) `inactiveHtml`/`.html` value
 *      this call emits. The first payload that would push the running total
 *      over the cap — and every one after it — becomes a placeholder too;
 *      exactly ONE aggregate diagnostic is appended, at the moment the total
 *      first tips over (not once per subsequent payload). A payload already
 *      placeholdered by cap 2 contributes nothing to this running total (its
 *      real bytes were never emitted).
 *
 * `limited` is intentionally NOT set by caps 2/3 — see cap 1's paragraph
 * above; the payload caps go through the existing `diagnostics` channel like every other
 * refusal in this module, so a consumer has exactly one place to look.
 */
import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { createMarkdownRenderer } from "./renderer";
import { SOURCE_CHAPTER_ATTR, SOURCE_RANGE_ATTR } from "./source-range";
import { registerPluginOriginCapture, resolvePluginTokenOrigin } from "./plugin-origin";
import { parseMarkerLine } from "./markers.js";

/** D1/D6 — Gutterpress sparse-projection schema version. Bump only via an explicit decision-record amendment. */
export const PROJECTION_SCHEMA_VERSION = 1 as const;

/** D6's required projected kinds, verbatim. `"plugin-region"` (SFE-P2c) is emitted only when `opts.trusted` is `true` — see the module header "PLUGIN-AWARENESS". */
export type ProjectedBlockKind =
  | "chapter"
  | "page"
  | "spread"
  | "section"
  | "page-break"
  | "column-break"
  | "plugin-region"
  | "raw-html";

/** docs/plans/source-first-editor/pr158-lessons.md §8.2 — the two-state (+ fallback) edit surface a projected block offers. */
export type ProjectionEditMode = "structured" | "source" | "readonly";

/**
 * One authored Gutterpress-specific source range this module could attribute
 * with real evidence (D6: "Every authored projected block has a valid
 * source range"). `from`/`to` are UTF-16 char offsets into the EXACT
 * `source` string passed to {@link createEditorProjection} — see this
 * module's header for the half-open convention. Never mutated, never
 * serialized back to source by this module (G-04: authored source /
 * source-derived view metadata are distinct types) — `viewAttributes` is
 * VIEW metadata, not a second copy of writable bytes.
 */
export interface ProjectedBlock {
  readonly id: string;
  readonly kind: ProjectedBlockKind;
  readonly from: number;
  readonly to: number;
  readonly editMode: ProjectionEditMode;
  /** The block's own raw authored HTML/text, when a rendered preview needs one (currently only `raw-html`). */
  readonly inactiveHtml?: string;
  /** Source-derived, presentation-safe attributes (AP-06) — never written back to source. */
  readonly viewAttributes?: Readonly<Record<string, string>>;
}

/**
 * Rendered pipeline output with an anchor but explicitly NO writable source
 * range (D6: "Every generated view has an anchor and no writable source
 * range"; G-04). Intentionally has no `from`/`to` fields AT THE TYPE LEVEL —
 * see `editor-projection.test.ts`'s compile-time proof — so a
 * generated→source conversion cannot type-check, not merely fail a runtime
 * check.
 */
export interface GeneratedView {
  readonly id: string;
  readonly anchor: number;
  readonly html: string;
}

/**
 * This module's own diagnostic category vocabulary — mirrors D14's naming
 * convention (`docs/plans/source-first-editor-enterprise-refactor.md`) as
 * plain string constants, WITHOUT importing `packages/editor` (D4 direction:
 * `packages/editor` imports FROM `gutterpress/render`, never the reverse).
 * Extend this union additively if a later run needs another D14-aligned
 * category from this module; do not repurpose an existing value.
 *
 * `"EDITOR_PROJECTION_LIMIT"` (SFE-P2b Lane C, D13) — a resource cap fired:
 * the block-count cap, a per-payload HTML size cap, or the aggregate HTML
 * size cap. See "── D13 resource caps ──" below for which.
 */
export type ProjectionDiagnosticCategory = "EDITOR_UNSUPPORTED_PROJECTION" | "EDITOR_PROJECTION_LIMIT";

/** A typed refusal: this module could not honestly attribute a range (or recognize a token), so it produced no block instead of guessing (G-05, G-06). */
export interface ProjectionDiagnostic {
  readonly category: ProjectionDiagnosticCategory;
  /** Names the token type and why its evidence was insufficient — the safe next action is always "edit in source mode" (the document is never blocked). */
  readonly reason: string;
}

/**
 * D6's top-level projection shape, plus one SFE-P2b Lane C (D13) addition:
 * `limited`.
 */
/**
 * A container element a PROJECT PLUGIN opens for one of its own markers.
 *
 * A plugin turns `@specialty .augmerc` into a real wrapper — the Dimm City
 * plugin emits `<div class="dc-specialty augmerc">` — and that wrapper is
 * what its stylesheet targets. An editor that knows only the marker's own
 * name cannot guess the class (`specialty` is not `dc-specialty`), so the
 * content inside renders unwrapped and unstyled: those portraits measured
 * 696px against the book's 58px, and one chapter came out 39 pages against
 * 25. Reporting the wrapper the pipeline ACTUALLY emitted is the only way an
 * editor can reproduce it for an arbitrary plugin.
 */
/** One opening tag, alone in an `html_block` — the shape a plugin's container marker becomes. */
const OPENING_TAG_RE = /^\s*<([a-z][\w-]*)((?:\s+[^<>]*)?)>\s*$/i;
const ATTR_RE = /([a-zA-Z_:][-\w:.]*)\s*=\s*"([^"]*)"/g;

/**
 * The container elements a document's plugins opened, in document order.
 *
 * A plugin container marker (`@specialty`) is replaced in the token stream
 * by the wrapper the plugin emits, as a single opening tag in an
 * `html_block`. Matching them back to their marker by KIND rather than by
 * position is what keeps an author's own raw `<div class="colophon-grid">`
 * from being mistaken for one: a wrapper counts as a container for kind `k`
 * only when one of its classes IS `k` or ends with `-k`, which is the naming
 * every plugin following core's marker convention already uses
 * (`dc-specialty` for `@specialty`).
 */
function collectPluginContainers(tokens: readonly Token[], source: string): PluginContainer[] {
  const kinds = new Set<string>();
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("@")) continue;
    const parsed = parseMarkerLine(trimmed, { allowUnknownKinds: true }) as
      | { kind: string; unknownKind?: boolean }
      | null;
    if (parsed?.unknownKind) kinds.add(parsed.kind);
  }
  if (kinds.size === 0) return [];

  const out: PluginContainer[] = [];
  for (const token of tokens) {
    if (token.type !== "html_block") continue;
    const m = OPENING_TAG_RE.exec(token.content);
    if (!m) continue;
    const attributes: Record<string, string> = {};
    for (const a of m[2]!.matchAll(ATTR_RE)) attributes[a[1]!] = a[2]!;
    const classes = (attributes["class"] ?? "").split(/\s+/).filter(Boolean);
    // Longest kind first, so `@specialty-card` is not claimed by `@specialty`.
    const kind = [...kinds]
      .sort((a, b) => b.length - a.length)
      .find((k) => classes.some((c) => c === k || c.endsWith(`-${k}`)));
    if (!kind) continue;
    out.push({ kind, tag: m[1]!.toLowerCase(), attributes });
  }
  return out;
}

export interface PluginContainer {
  /** The marker kind this wrapper belongs to (`specialty` for `dc-specialty`). */
  readonly kind: string;
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface GutterpressProjection {
  readonly schemaVersion: 1;
  readonly sourceVersion: number;
  readonly blocks: readonly ProjectedBlock[];
  readonly generated: readonly GeneratedView[];
  readonly diagnostics: readonly ProjectionDiagnostic[];
  /**
   * D13 — present and `true` ONLY when the block-count cap
   * (`MAX_PROJECTED_BLOCKS`) stopped the walk before every block in `source`
   * could be projected; omitted (never `false`) otherwise, matching this
   * module's other optional-field convention (`ProjectedBlock.inactiveHtml`,
   * `.viewAttributes`). A consumer MUST treat `limited: true` as
   * stale-equivalent (G-11's existing convention): fall through to default
   * (non-projected) rendering for the whole document rather than paint chips
   * for the 10,000 blocks that DID get covered — the document is only
   * PARTIALLY represented, and pretending otherwise would silently hide
   * every block past the cap. The per-payload and aggregate HTML caps do NOT
   * set this flag — a block whose `inactiveHtml`/`.html` was replaced with a
   * placeholder still has a fully valid range and kind; only its rendered
   * preview shrank.
   */
  readonly limited?: true;
  /**
   * Container elements this document's PLUGINS opened, in document order —
   * see {@link PluginContainer}. Empty for a document with no plugin
   * containers, which is every project that uses only core's markers.
   */
  readonly pluginContainers: readonly PluginContainer[];
}

export interface CreateEditorProjectionOptions {
  /** G-11 — stamped onto the result verbatim; the consumer (packages/editor) is what rejects a stale value against its own snapshot version. */
  readonly sourceVersion: number;
  /**
   * The SAME configured `MarkdownIt` instance the render path uses (G-03:
   * "one resolved presentation context") — e.g. one built by
   * `createMarkdownRenderer(projectPlugins)`. Defaults to a plain
   * `createMarkdownRenderer()` (no project plugins) when omitted. See the
   * module header "HOST CONTRACT": this module never loads or applies
   * plugins itself — a plugin-applied `md` is always the caller's own doing,
   * on the Node/host side, before it reaches this function.
   */
  readonly md?: MarkdownIt;
  /**
   * SFE-P2c / D12 trust gate. Defaults to `false` — the UNTRUSTED path is
   * what a caller gets by omission, not something it must remember to ask
   * for. See the module header "PLUGIN-AWARENESS" / "TRUST GATE" for the
   * exact contract: this flag never decides whether plugin code executed
   * (that is already decided by whichever `md` was handed to `opts.md`); it
   * only decides whether THIS module is willing to classify an unrecognized,
   * plugin-produced token as a `"plugin-region"` block instead of leaving it
   * unwalked exactly as P2b did.
   */
  readonly trusted?: boolean;
}

// ── line-start / char-offset table ─────────────────────────────────────────
// Mirrors packages/desktop/src/lib/editor/source-range.ts's buildLineStarts/
// charRange verbatim (see this module's header "CHAR-OFFSET CONVENTION").
// Duplicated, not imported: packages/cli must not depend on packages/desktop.

const LINE_BREAK_RE = /\r\n?|\n/g;

/** `starts[i]` is the char offset where 0-based line `i` begins. Built once per `createEditorProjection` call. */
function buildLineStarts(source: string): number[] {
  const starts = [0];
  LINE_BREAK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINE_BREAK_RE.exec(source))) starts.push(m.index + m[0].length);
  return starts;
}

/** Resolve one 0-based line index to a char offset, clamping to `source.length` past the last recorded line-start. */
function lineStartOffset(starts: readonly number[], source: string, lineIndex: number): number {
  return lineIndex < starts.length ? starts[lineIndex]! : source.length;
}

/** `[from, to)` LINE range -> `[from, to)` CHAR range, via {@link lineStartOffset}. */
function charRangeForLines(
  starts: readonly number[],
  source: string,
  fromLine: number,
  toLine: number,
): readonly [number, number] {
  return [lineStartOffset(starts, source, fromLine), lineStartOffset(starts, source, toLine)];
}

/**
 * Parse a `data-source-range="start:end"` attribute value. Returns `null`
 * (never throws) on anything malformed: not the exact `\d+:\d+` shape, or a
 * non-strictly-increasing pair — both mean "insufficient evidence", handled
 * by the caller as a diagnostic, never a thrown error (this module must
 * never throw — see the header).
 */
function parseSourceRangeAttr(value: string): readonly [number, number] | null {
  const m = /^(\d+):(\d+)$/.exec(value);
  if (!m) return null;
  const from = Number(m[1]);
  const to = Number(m[2]);
  if (!(from < to)) return null;
  return [from, to];
}

// ── marker-family token classification ──────────────────────────────────────

const OPEN_KIND_BY_TOKEN_TYPE: Readonly<Record<string, ProjectedBlockKind>> = {
  layout_chapter_open: "chapter",
  layout_spread_open: "spread",
  layout_page_open: "page",
  layout_section_open: "section",
};

const BREAK_KIND_BY_TOKEN_TYPE: Readonly<Record<string, ProjectedBlockKind>> = {
  layout_page_break: "page-break",
  layout_column_break: "column-break",
};

/** The exact HTML shape markers.js's `openPage` generates for the one-time chapter-opener (see that function). */
const CHAPTER_OPENER_CONTENT_RE = /^<div class="chapter-opener" data-chapter-label="/;

/** Attrs added to marker-family tokens by a rule OTHER than markers.js itself — never authored, so never surfaced as `viewAttributes` (AP-06; see header). */
const NON_AUTHORED_TOKEN_ATTRS = new Set<string>([SOURCE_RANGE_ATTR, SOURCE_CHAPTER_ATTR]);

/**
 * One attribute of a token, read without assuming the token is a markdown-it
 * `Token` INSTANCE.
 *
 * Every token the core parser produces has `attrGet`, but a plugin may push a
 * plain object shaped like a token instead — nothing in markdown-it's plugin
 * contract requires the class, and real plugins do it. Calling the method
 * blindly threw `token.attrGet is not a function` and took the WHOLE
 * projection down with it, so the desktop editor fell back to its
 * plugin-less, book-CSS-less build: the author's own styling and pagination
 * vanished from the editor, under a diagnostic that blamed their manifest.
 * One plugin token is not a reason to stop understanding the document.
 */
function tokenAttr(token: Token, name: string): string | null {
  if (typeof token.attrGet === "function") return token.attrGet(name);
  const attrs = (token as { attrs?: readonly (readonly [string, string])[] | null }).attrs;
  if (!Array.isArray(attrs)) return null;
  for (const pair of attrs) {
    if (Array.isArray(pair) && pair[0] === name) return pair[1] ?? null;
  }
  return null;
}

/** Every token attr except the render-graph's own bookkeeping keys (AP-06 — see header). `undefined` when nothing is left, so `ProjectedBlock.viewAttributes` stays a clean optional. */
function extractViewAttributes(token: Token): Readonly<Record<string, string>> | undefined {
  if (!token.attrs || token.attrs.length === 0) return undefined;
  let out: Record<string, string> | undefined;
  for (const [key, value] of token.attrs) {
    if (NON_AUTHORED_TOKEN_ATTRS.has(key)) continue;
    (out ??= {})[key] = value;
  }
  return out;
}

/**
 * Cheap runtime self-check ("assert in code where cheap" — the run spec):
 * a marker-family block's resolved char range, once its own leading
 * indentation is trimmed, must begin with the marker sigil `@` —
 * `markerBlock` in markers.js reads the WHOLE line
 * (`state.bMarks[startLine]..state.eMarks[startLine]`), so this can only
 * fail if this module's own offset math is wrong, never from authored
 * content (a line markers.js turned into a `layout_*` token always started
 * with `@`).
 */
function markerLineLooksAuthored(source: string, from: number, to: number): boolean {
  return /^[ \t]*@/.test(source.slice(from, to));
}

// ── SFE-P2c plugin-region classification (see module header
// "PLUGIN-AWARENESS") ───────────────────────────────────────────────────────

/**
 * SFE-P2c repair round 1 — the plugin-region analogue of
 * {@link markerLineLooksAuthored}, applied to BOTH the evidence-bearing
 * (`token.map` set by the plugin itself) and Lane-B-recovered plugin-region
 * ranges before either is trusted enough to become a `ProjectedBlock`.
 * `plugin-region` previously had NO corroboration check at all — a claimed
 * `[fromLine, toLine)` was converted straight to a char range and pushed.
 * Three distinct over-claim shapes, all reproduced live, are refused here:
 *
 *   1. OUT-OF-BOUNDS LINE CLAIM — `toLine` past the number of lines
 *      {@link buildLineStarts} actually recorded for `source` (e.g. a
 *      plugin-set `token.map = [0, 99]` on a 5-line document). Left
 *      unchecked, {@link lineStartOffset} silently CLAMPS `to` to
 *      `source.length`, over-claiming the rest of the document as this
 *      one token's own consumed source.
 *   2. CONTAINER-PREFIX OVER-CLAIM — the range's FIRST physical line begins
 *      with a leading blockquote/list container marker (`>`, a bullet, an
 *      ordinal). `token.map`/a Lane-B recovered range is a LINE range, and
 *      {@link charRangeForLines} widens it to WHOLE physical lines, so a
 *      plugin marker nested under `> `/`- ` (e.g. `"> @@aside label"`)
 *      would otherwise silently claim container bytes the plugin's own
 *      parse never saw — the exact shape P2b's `markerLineLooksAuthored`
 *      already refuses for the marker family; this generalizes it.
 *   3. NESTED GUTTERPRESS MARKER — any physical line STRICTLY INSIDE the
 *      claimed range (i.e. every line after the first) itself looks like
 *      an authored Gutterpress marker declaration (the same `@` sigil
 *      check `markerLineLooksAuthored` makes). A wrapper plugin that
 *      preserves a marker token by identity while claiming a WIDE
 *      `token.map`/union range around it would otherwise produce nested,
 *      overlapping blocks — violating this module's own header invariant
 *      ("blocks[i].to <= blocks[i + 1].from") by accident of token-stream
 *      walk order rather than by construction.
 *
 * Only the FIRST line is checked for container-prefix over-claim (shape 2):
 * a marker-family block legitimately nested inside its OWN correctly-
 * projected container is a separate, already-handled case (P2b's own
 * `markerLineLooksAuthored`), and a plugin-region's interior lines are the
 * plugin's own consumed content, not something this module can validate
 * beyond "it is not itself another authored Gutterpress marker" (shape 3).
 */
function pluginRegionLinesLookAuthored(
  source: string,
  starts: readonly number[],
  fromLine: number,
  toLine: number,
): boolean {
  if (toLine > starts.length) return false;
  const firstLineText = source.slice(
    lineStartOffset(starts, source, fromLine),
    lineStartOffset(starts, source, fromLine + 1),
  );
  if (/^[ \t]*(?:>|[-*+][ \t]|\d{1,9}[.)][ \t])/.test(firstLineText)) return false;
  for (let line = fromLine + 1; line < toLine; line++) {
    const lineText = source.slice(lineStartOffset(starts, source, line), lineStartOffset(starts, source, line + 1));
    if (/^[ \t]*@/.test(lineText)) return false;
  }
  return true;
}

/**
 * Every nesting===1 "open" token type Gutterpress's OWN fixed base pipeline
 * — `createMarkdownRenderer()` with ZERO project plugins: markdown-it core
 * plus the always-on bundled rules (markdown-it-attrs, markdown-it-footnote,
 * markdown-it-deflist, markdown-it-source-map) — can produce. Verified
 * empirically against the pinned plugin versions, not guessed (see
 * `editor-projection-plugins.test.ts`'s base-pipeline-survivors test).
 * `gutterpressMarkers`'s own `layout_*` family is deliberately EXCLUDED from
 * this set: it is already recognized by `OPEN_KIND_BY_TOKEN_TYPE` and the
 * `layout_`-prefix check above, both of which run — and `continue` — before
 * this set is ever consulted. `gp-pin-scope.js`, `images.ts`, and
 * `inline-source.ts` add no block-level token types at all (they only
 * read/annotate existing tokens), so they need no entries either, and
 * `BUILTIN_OPTIONAL_PLUGINS` (markdown-it-mark/sub/sup/abbr) are inline-only
 * marks that never appear at this nesting.
 *
 * Hand-maintained and closed, exactly like `source-range.ts`'s own
 * `SELF_CLOSING_BLOCK_TYPES` — this package owns every rule that can add to
 * it, so this is positive knowledge of "content the base editor already
 * derives" (D6 sparseness), not a guess about a third party's vocabulary.
 *
 * WHY THIS SET MUST EXIST: below, a trusted nesting===1 open token whose
 * type is neither a recognized Gutterpress marker kind nor a member of this
 * set is presumed project-plugin-produced. Without this exclusion, EVERY
 * ordinary paragraph/heading/list-item/table/footnote/definition-list
 * token — which also carries `data-source-range`, since
 * `source-range.ts`'s `isAnnotationTarget` accepts any nesting===1 token
 * UNCONDITIONALLY — would be misclassified as a plugin region the instant
 * `trusted: true` is passed, breaking "survivor tokens project exactly as
 * in P2b" (this run's own requirement).
 */
const BASE_PIPELINE_OPEN_TOKEN_TYPES = new Set<string>([
  // markdown-it core
  "paragraph_open",
  "heading_open",
  "blockquote_open",
  "bullet_list_open",
  "ordered_list_open",
  "list_item_open",
  "table_open",
  "thead_open",
  "tbody_open",
  "tr_open",
  "th_open",
  "td_open",
  // markdown-it-footnote
  "footnote_block_open",
  "footnote_open",
  // markdown-it-deflist
  "dl_open",
  "dt_open",
  "dd_open",
]);

/**
 * A resolved plugin-region char range, OR a rule-named refusal reason
 * (SFE-P2c repair round 1 — finding: the rich, rule-named reason
 * `plugin-origin.ts` computes used to be discarded at the call site and
 * replaced with one fixed generic string for all six rule-4 shapes; see
 * {@link resolvePluginRegionOrigin} and its call site below, which
 * now use `reason` directly as the projected diagnostic's text).
 */
type PluginRegionOrigin =
  | { readonly ok: true; readonly range: readonly [number, number] }
  | { readonly ok: false; readonly reason: string };

/**
 * The ONE corroborate-and-convert path for a trusted, project-plugin-produced,
 * nesting===1 open token: takes the LINE range the token's own
 * `data-source-range` evidence claims (`parsedRange`, the evidence-bearing
 * case — `source_range.ts` runs LAST, after every custom plugin, so a plugin
 * that preserved `token.map` gets stamped directly), or, when the token
 * carries no evidence, RECOVERS one through `plugin-origin.ts`'s
 * `resolvePluginTokenOrigin` (rule 3: a single clean before/after
 * core-rule-boundary splice; rule 4: refuse, six named shapes — see that
 * module's header), which reads the before/after snapshot
 * `registerPluginOriginCapture` stashed on `env` during `md.parse()`.
 *
 * Either way the claimed range is corroborated against `source` by
 * {@link pluginRegionLinesLookAuthored} BEFORE being trusted (SFE-P2c
 * repair round 1: closes a confirmed finding that neither case checked a
 * claimed range against source content at all), then converted from the
 * `token.map` LINE convention to the CHAR range this module's blocks carry
 * via {@link charRangeForLines}. Never throws; never returns a guessed range
 * for a refusal — a refusal carries the rule-named reason (prefixed with the
 * token type, this module's diagnostic-text convention).
 */
function resolvePluginRegionOrigin(
  token: Token,
  parsedRange: readonly [number, number] | null,
  env: unknown,
  starts: readonly number[],
  source: string,
): PluginRegionOrigin {
  let fromLine: number;
  let toLine: number;
  let claim: "resolved" | "recovered origin";
  if (parsedRange) {
    [fromLine, toLine] = parsedRange;
    claim = "resolved";
  } else {
    const result = resolvePluginTokenOrigin(token, env);
    if (!result.ok) return { ok: false, reason: `"${token.type}": ${result.reason}` };
    [fromLine, toLine] = result.range;
    claim = "recovered origin";
  }
  if (!pluginRegionLinesLookAuthored(source, starts, fromLine, toLine)) {
    return {
      ok: false,
      reason:
        `"${token.type}" token's ${claim} range does not corroborate against source ` +
        `(a container-prefixed first line, a nested Gutterpress marker line, or an ` +
        `out-of-bounds line claim) — refusing to project a plugin-region whose evidence ` +
        `cannot be verified against source. Edit this content in source mode.`,
    };
  }
  return { ok: true, range: charRangeForLines(starts, source, fromLine, toLine) };
}

// ── D13 resource caps (SFE-P2b Lane C addition — see module header "D13
// CAPS") ──────────────────────────────────────────────────────────────────
// Grafted onto Lane A's single-pass walk below without restructuring it:
// every cap is checked at the exact point a value would otherwise be
// emitted, and every cap fails closed (placeholder/stop), never throws.

/** D13 — block-count cap. Boundary-exact: 10,000 blocks project cleanly, the 10,001st trips this cap (see `editor-projection-limits.test.ts`). */
export const MAX_PROJECTED_BLOCKS = 10_000;

/** D13 — per-payload cap, in UTF-8 bytes (1 MiB). Applies to any single `ProjectedBlock.inactiveHtml` or `GeneratedView.html` this module emits. */
export const MAX_INACTIVE_HTML_BYTES = 1024 * 1024;

/** D13 — aggregate cap, in UTF-8 bytes (8 MiB), across every kept (non-placeholder) HTML payload this call emits. */
export const MAX_AGGREGATE_HTML_BYTES = 8 * 1024 * 1024;

/** D13: rich mode's own file-size ceiling — a document over this many UTF-8
 *  bytes opens in source mode instead of building a projection at all. One
 *  constant, exported through `gutterpress/render`, so the desktop host, the
 *  VS Code extension and their tests all gate on the same number. */
export const RICH_MODE_MAX_CONTENT_BYTES = 2 * 1024 * 1024;

/** Fixed, tiny, safe replacement for an HTML payload that tripped either the per-payload or the aggregate cap. Never derived from the oversized content itself — nothing about the omitted bytes is echoed back. Exported (not just an internal constant) so tests assert exact equality instead of a loose substring match. */
export const HTML_PAYLOAD_PLACEHOLDER =
  '<div class="gp-projection-omitted" aria-hidden="true">Content omitted (over the Gutterpress editor size limit) — edit in source mode.</div>';

/**
 * D13's byte convention: UTF-8 byte length, NOT `string.length` (UTF-16 code
 * units) and NOT a Node `Buffer` (browser-safe). Counted straight off the
 * code units — `TextEncoder.encode(html).length` gives the same answer but
 * allocates a full second copy of every payload it measures (up to 1 MiB
 * each, 8 MiB aggregate per projection). A lone surrogate counts 3 bytes,
 * exactly as `TextEncoder` encodes it (U+FFFD).
 */
function utf8ByteLength(html: string): number {
  let bytes = 0;
  for (let i = 0; i < html.length; i++) {
    const c = html.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < html.length) {
      const next = html.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** Mutable running total for the aggregate cap — threaded through one `createEditorProjection` call only, never module-level state (a thrown/concurrent render must not leak a count into the next call). */
interface AggregateHtmlBudget {
  bytesEmitted: number;
  capDiagnosticEmitted: boolean;
}

/**
 * Applies the per-payload cap, then the aggregate cap, to one HTML payload
 * this module is about to emit (`inactiveHtml` or a `GeneratedView.html`).
 * Returns `html` unchanged when both caps are clear (and records its bytes
 * against `budget`); otherwise appends exactly one diagnostic for whichever
 * cap fired and returns {@link HTML_PAYLOAD_PLACEHOLDER}. Never throws, never
 * sets `limited` (see module header — only the block-count cap does).
 */
function capHtmlPayload(
  html: string,
  diagnostics: ProjectionDiagnostic[],
  budget: AggregateHtmlBudget,
): string {
  const bytes = utf8ByteLength(html);

  if (bytes > MAX_INACTIVE_HTML_BYTES) {
    diagnostics.push({
      category: "EDITOR_PROJECTION_LIMIT",
      reason: `An HTML payload is ${bytes} bytes, over the ${MAX_INACTIVE_HTML_BYTES}-byte (1 MiB) per-payload cap (D13); replaced with a safe placeholder. Edit this content in source mode.`,
    });
    return HTML_PAYLOAD_PLACEHOLDER;
  }

  if (budget.bytesEmitted + bytes > MAX_AGGREGATE_HTML_BYTES) {
    if (!budget.capDiagnosticEmitted) {
      budget.capDiagnosticEmitted = true;
      diagnostics.push({
        category: "EDITOR_PROJECTION_LIMIT",
        reason: `Aggregate generated/plugin HTML exceeded the ${MAX_AGGREGATE_HTML_BYTES}-byte (8 MiB) cap (D13); this and every later HTML payload in this document are replaced with a safe placeholder. Edit this content in source mode.`,
      });
    }
    return HTML_PAYLOAD_PLACEHOLDER;
  }

  budget.bytesEmitted += bytes;
  return html;
}

/**
 * Finds the index of the CLOSING token matching the `nesting === 1` "open"
 * token at `openIndex`, by walking forward summing `.nesting` (the same
 * general technique markdown-it's own renderer/token walkers use for
 * nested block structure) until the running depth returns to `0`. Returns
 * `-1` — never throws — if the stream ends before a match is found (a
 * malformed/truncated token array a buggy plugin could in principle
 * produce; this module's own contract is "never throw, degrade per-block").
 */
function findMatchingCloseIndex(tokens: readonly Token[], openIndex: number): number {
  let depth = tokens[openIndex]!.nesting;
  for (let i = openIndex + 1; i < tokens.length; i++) {
    depth += tokens[i]!.nesting;
    if (depth === 0) return i;
  }
  return -1;
}

/**
 * SFE-P2c repair round 2 — the STRUCTURAL half of the containment guard
 * (see {@link pluginRegionLinesLookAuthored}'s shape 3 for the content-
 * heuristic half it complements, not replaces). Shape 3 refuses a
 * plugin-region whose claimed range's interior TEXT looks like an authored
 * `@` marker line — but it is a text match, so it says nothing about a
 * `raw-html` block nested the same way: `<div>…</div>` never starts with
 * `@`, so a wrapper plugin that honestly claims `token.map` spanning
 * consumed-and-re-pushed content that happens to include a survivor
 * `html_block` token slipped past shape 3 entirely, producing nested,
 * overlapping blocks (the module header's own "never overlapping, never
 * nested" invariant violated by accident of walk order rather than by
 * construction — reproduced live pre-fix: a wrapper plugin claiming
 * `"@@aside Note\n\n<div>hi</div>\n\nTail.\n"` end to end yielded both a
 * `plugin-region` covering the whole document AND a separate `raw-html`
 * block nested inside it).
 *
 * Walks the token slice strictly BETWEEN a plugin-region's own open/close
 * pair (`(openIndex, closeIndex)`, both exclusive — `findMatchingCloseIndex`'s
 * own convention) for any token this same walk would, if it reached that
 * token directly, independently turn into its OWN `ProjectedBlock`: a
 * recognized marker-family open or break token, or an `html_block` token —
 * in both cases gated on the token actually carrying `data-source-range`
 * evidence of its own, since a token with none never becomes a block either
 * way and so poses no containment risk. A hit refuses the WIDER,
 * less-specific plugin-region claim so the narrower, evidence-backed
 * interior block can project on its own instead — the exact precedent this
 * module already establishes for the marker-family case (the "shape 1"
 * fixture in `editor-projection-plugins.test.ts`: a wrapper that would nest
 * a `@page-break` refuses, and the page-break still projects by itself).
 * `closeIndex === -1` (an unmatched open — {@link findMatchingCloseIndex}'s
 * own documented failure mode) is treated as "no interior to scan": this
 * function never throws and never widens a refusal beyond what the token
 * stream actually shows.
 *
 * SFE-P2c repair round 3 addendum: this scan is keyed to TOKEN NESTING (the
 * slice strictly between the plugin-region's own open/close pair), while the
 * block's boundaries come from the CLAIMED RANGE (`origin.range`, from the
 * plugin's `token.map`). When a plugin's map claims MORE source than its own
 * open/close pair actually wraps — a self-contained pair adjacent to, not
 * around, the later token — this function's slice is empty and it has
 * nothing to catch: that shape is instead caught by the `from < lastBlockEnd`
 * overlap guard below (and its symmetric counterpart on the `raw-html`
 * branch), which checks the CLAIMED RANGE against every already-projected
 * block regardless of token nesting. The two guards are complementary, not
 * redundant: this one catches over-claims that DO wrap a projectable token;
 * the overlap guards catch over-claims that don't.
 */
function pluginRegionContainsProjectableBlock(
  tokens: readonly Token[],
  openIndex: number,
  closeIndex: number,
): boolean {
  if (closeIndex === -1) return false;
  for (let i = openIndex + 1; i < closeIndex; i++) {
    const t = tokens[i]!;
    const isMarkerFamily = Boolean(OPEN_KIND_BY_TOKEN_TYPE[t.type] ?? BREAK_KIND_BY_TOKEN_TYPE[t.type]);
    const isRawHtml = t.type === "html_block";
    if ((isMarkerFamily || isRawHtml) && tokenAttr(t, SOURCE_RANGE_ATTR)) return true;
  }
  return false;
}

/**
 * SFE-P2c repair round 1 (finding 6 — "inactive plugin view renders the
 * block's authored source, not the plugin's own produced HTML"): the run
 * spec's behavior table requires the inactive view to render "the plugin's
 * own HTML inertly" — this module previously supplied none for
 * `plugin-region` at all, so `packages/editor`'s chip fell back to the raw
 * authored marker text (no different from source mode).
 *
 * Renders the token slice `[openIndex, closeIndex]` — this plugin-region's
 * own open/close pair, INCLUDING its interior — through `md.renderer`, the
 * SAME renderer object and rule set the render/preview/PDF path uses (G-03
 * "one pipeline" / "do NOT build a parallel parser config"; the marker
 * family's `.chapter-opener` `GeneratedView` uses this identical
 * "re-render, don't hand-roll" posture — see this module's header
 * "GENERATED VIEWS"). D13's per-payload/aggregate HTML caps apply via the
 * SAME {@link capHtmlPayload} every other `inactiveHtml`/`GeneratedView.html`
 * in this module goes through.
 *
 * Never throws and never guesses: returns `undefined` — not a placeholder,
 * not the source text — when the matching close token cannot be found, or
 * if rendering this specific slice throws (a plugin's own custom renderer
 * rule is host code this module does not control; this module's contract
 * is "never throw" for ITS OWN callers, so a plugin renderer exception is
 * caught rather than propagated). `ProjectedBlock.inactiveHtml` is already
 * optional, and `packages/editor/src/gutterpress/plan.ts`'s `buildChipPlan`
 * already falls back to the block's own authored `sourceText` when it is
 * absent — so `undefined` here is fail-closed to EXACTLY today's posture
 * for this one block, never a new failure mode.
 *
 * SFE-P2c repair round 2: `closeIndex` is now supplied by the caller
 * (previously computed here via {@link findMatchingCloseIndex}) — the call
 * site needs the SAME index first, to run
 * {@link pluginRegionContainsProjectableBlock}'s structural containment
 * check before this function ever runs, so it is computed once and reused
 * rather than walked twice for the same token slice.
 */
function pluginRegionInactiveHtml(
  md: MarkdownIt,
  tokens: readonly Token[],
  openIndex: number,
  closeIndex: number,
  env: unknown,
  diagnostics: ProjectionDiagnostic[],
  htmlBudget: AggregateHtmlBudget,
): string | undefined {
  if (closeIndex === -1) return undefined;
  try {
    const html = md.renderer.render(tokens.slice(openIndex, closeIndex + 1), md.options, env);
    return capHtmlPayload(html, diagnostics, htmlBudget);
  } catch {
    return undefined;
  }
}

/**
 * D13 block-count cap check — called immediately before every `blocks.push`
 * site. Returns `true` once the cap has already been reached, appending
 * exactly ONE `EDITOR_PROJECTION_LIMIT` diagnostic the first time (never
 * again — the caller `break`s its walk on the first `true`, per "STOP
 * projecting further blocks", so this can only fire once per call anyway;
 * the guard is defense-in-depth, not load-bearing).
 */
function blockCapReached(
  blocks: readonly ProjectedBlock[],
  diagnostics: ProjectionDiagnostic[],
): boolean {
  if (blocks.length < MAX_PROJECTED_BLOCKS) return false;
  diagnostics.push({
    category: "EDITOR_PROJECTION_LIMIT",
    reason: `Projection stopped at the ${MAX_PROJECTED_BLOCKS}-block cap (D13); ${MAX_PROJECTED_BLOCKS} blocks were projected and the rest of this document has no block coverage. Edit in source mode.`,
  });
  return true;
}

/**
 * Build the Gutterpress sparse editor projection for `source` (D6).
 *
 * Pure and synchronous: runs the configured pipeline's parser once
 * (`md.parse`), walks the resulting flat token array exactly once (no
 * recursion beyond markdown-it's own single-level `inline.children`), and
 * returns a plain, immutable-by-convention result. Never throws — see the
 * header's char-offset-convention note and `parseSourceRangeAttr`.
 */
export function createEditorProjection(
  source: string,
  opts: CreateEditorProjectionOptions,
): GutterpressProjection {
  const md = opts.md ?? createMarkdownRenderer();
  // SFE-P2c Lane B: bracket the plugin core-rule region (see
  // plugin-origin.ts's header PART 1) and thread a real `env` object through
  // `md.parse()` (rather than a throwaway `{}`) so the before/after snapshot
  // that registration stashes survives past this call for
  // `resolvePluginRegionOrigin` to read below. Idempotent and a safe
  // no-op on any `md` without Gutterpress's own pipeline applied — see that
  // function's own doc comment.
  registerPluginOriginCapture(md);
  const env: Record<string, unknown> = {};
  const tokens = md.parse(source, env);
  const starts = buildLineStarts(source);

  const blocks: ProjectedBlock[] = [];
  const generated: GeneratedView[] = [];
  const diagnostics: ProjectionDiagnostic[] = [];

  // D13 — per-call cap state (see "── D13 resource caps ──" above). Never
  // module-level: scoped fresh to this one createEditorProjection call.
  let limited = false;
  const htmlBudget: AggregateHtmlBudget = { bytesEmitted: 0, capDiagnosticEmitted: false };

  // The `to` of the most recently projected block — a generated view with
  // no range of its own anchors here (see header "GENERATED VIEWS").
  let lastBlockEnd = 0;

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex]!;

    if (token.type === "html_block") {
      const rangeAttr = tokenAttr(token, SOURCE_RANGE_ATTR);
      const parsed = rangeAttr ? parseSourceRangeAttr(rangeAttr) : null;
      if (parsed) {
        const [from, to] = charRangeForLines(starts, source, parsed[0], parsed[1]);

        // SFE-P2c repair round 3 (finding 1) — the symmetric counterpart of
        // the plugin-region branch's own `from < lastBlockEnd` guard below:
        // a raw-html block's CLAIMED range comes from `data-source-range`
        // corroborated only against this document's own line count
        // (parseSourceRangeAttr/charRangeForLines have no notion of OTHER
        // already-projected blocks), so a plugin-region whose token pair
        // does not actually wrap this html_block token — but whose claimed
        // `token.map` spans past it anyway — could still produce a nested,
        // overlapping block that `pluginRegionContainsProjectableBlock`'s
        // token-slice scan cannot see (that scan only walks tokens strictly
        // between the plugin-region's own open/close pair; a token the
        // plugin's map over-claims without wrapping is never in that
        // slice). Fixing this HERE, rather than widening that scan, makes
        // the "never overlapping" invariant (module header, "ORDERED,
        // DISJOINT ... never overlapping, never nested") hold for this
        // branch by construction, regardless of which earlier branch
        // produced the wide claim.
        if (from < lastBlockEnd) {
          diagnostics.push({
            category: "EDITOR_UNSUPPORTED_PROJECTION",
            reason: `"${token.type}" token's resolved range overlaps a block already projected earlier in this document — refusing to project an overlapping raw-html block. Edit this content in source mode.`,
          });
          continue;
        }

        // D13 block-count cap: checked here, not just in the marker-family
        // branch below — a huge raw-HTML-heavy document must stop exactly
        // the same way a marker-heavy one does.
        if (blockCapReached(blocks, diagnostics)) {
          limited = true;
          break;
        }
        blocks.push({
          id: `raw-html:${from}:${to}`,
          kind: "raw-html",
          from,
          to,
          editMode: "source",
          // D13 per-payload / aggregate caps (never affects `from`/`to` —
          // only the rendered-preview string).
          inactiveHtml: capHtmlPayload(token.content, diagnostics, htmlBudget),
        });
        lastBlockEnd = to;
        continue;
      }

      if (CHAPTER_OPENER_CONTENT_RE.test(token.content)) {
        generated.push({
          id: `generated:chapter-opener:${lastBlockEnd}`,
          anchor: lastBlockEnd,
          // D13 per-payload / aggregate caps — a GeneratedView carries no
          // range to protect either way (G-04), only its `html` shrinks.
          html: capHtmlPayload(token.content, diagnostics, htmlBudget),
        });
        continue;
      }

      diagnostics.push({
        category: "EDITOR_UNSUPPORTED_PROJECTION",
        reason:
          "html_block token has no source-range evidence (data-source-range missing) and does not match the known chapter-opener generated fragment. Edit this content in source mode.",
      });
      continue;
    }

    if (token.type === "inline") {
      // Inline HTML pairs (support matrix, header "INLINE HTML"): a
      // diagnostics entry only, no block, this run. `token.children` is the
      // one level markdown-it ever nests text-level tokens at (see
      // source-range.ts's header) — no recursion needed.
      const hasInlineHtml = (token.children ?? []).some((child) => child.type === "html_inline");
      if (hasInlineHtml) {
        const where = token.map ? ` (source lines ${token.map[0] + 1}-${token.map[1]})` : "";
        diagnostics.push({
          category: "EDITOR_UNSUPPORTED_PROJECTION",
          reason: `Inline HTML${where} is source-only in this projection — no block is projected for an inline HTML pair. Edit it in source mode.`,
        });
      }
      continue;
    }

    const kind = OPEN_KIND_BY_TOKEN_TYPE[token.type] ?? BREAK_KIND_BY_TOKEN_TYPE[token.type];
    if (kind) {
      const rangeAttr = tokenAttr(token, SOURCE_RANGE_ATTR);
      const parsed = rangeAttr ? parseSourceRangeAttr(rangeAttr) : null;
      if (!parsed) {
        diagnostics.push({
          category: "EDITOR_UNSUPPORTED_PROJECTION",
          reason: `${token.type} token has no source-range evidence (map/meta.line missing). Edit this content in source mode.`,
        });
        continue;
      }

      const [from, to] = charRangeForLines(starts, source, parsed[0], parsed[1]);
      if (!markerLineLooksAuthored(source, from, to)) {
        diagnostics.push({
          category: "EDITOR_UNSUPPORTED_PROJECTION",
          reason: `${token.type} token's resolved range does not reproduce a "@" marker line — refusing to project a block whose evidence cannot be verified against source.`,
        });
        continue;
      }

      // D13 block-count cap: "STOP projecting further blocks" — break the
      // WHOLE walk, not just this push, once the cap is already reached.
      if (blockCapReached(blocks, diagnostics)) {
        limited = true;
        break;
      }

      blocks.push({
        id: `${kind}:${from}:${to}`,
        kind,
        from,
        to,
        editMode: "structured",
        viewAttributes: extractViewAttributes(token),
      });
      lastBlockEnd = to;
      continue;
    }

    if (token.nesting === -1) {
      // Any closing tag — the four known `layout_*_close` types AND any
      // closer an unrecognized layout-like plugin token might pair with —
      // carries no projectable information of its own: the matching OPEN
      // token already carries (or, for an unrecognized kind, already
      // diagnosed) this construct's full kind/range (D6 sparseness). This
      // is also why an unrecognized open/close pair produces exactly ONE
      // diagnostic below, not two.
      continue;
    }

    if (token.type.startsWith("layout_")) {
      // A layout-like token this module does not recognize, in Gutterpress's
      // OWN reserved `layout_` namespace (AP-05 / header "AMBIGUITY").
      // Unconditional — independent of `trusted` — see the header's
      // "AMBIGUITY" section for why. Fails closed: no guessed kind, no
      // guessed range.
      diagnostics.push({
        category: "EDITOR_UNSUPPORTED_PROJECTION",
        reason: `"${token.type}" is a layout-like token this projection does not recognize. Edit this content in source mode.`,
      });
      continue;
    }

    // SFE-P2c "PLUGIN-AWARENESS" (module header): a trusted, project-plugin-
    // produced block-level open token this module does not otherwise
    // recognize — not a Gutterpress marker kind (handled above), not
    // `layout_`-prefixed (handled immediately above; a layout_-prefixed
    // token can never reach here, it always `continue`s first), not a
    // member of the base pipeline's own known vocabulary. Gated on
    // `opts.trusted` so the untrusted default degrades to EXACTLY P2b's
    // silent fallthrough below (see header "TRUST GATE").
    if (opts.trusted && token.nesting === 1 && !BASE_PIPELINE_OPEN_TOKEN_TYPES.has(token.type)) {
      const rangeAttr = tokenAttr(token, SOURCE_RANGE_ATTR);
      const parsed = rangeAttr ? parseSourceRangeAttr(rangeAttr) : null;
      // EVIDENCE-BEARING case (this lane, A): the plugin preserved its own
      // `token.map`/`token.meta.line`, so `source_range.ts` — which runs
      // LAST, after every custom plugin (renderer.ts) — already stamped
      // real evidence directly onto THIS token. No origin RECOVERY needed —
      // but the claimed range is now corroborated against source before
      // being trusted (SFE-P2c repair round 1: this branch previously
      // pushed a plugin-set `token.map` verbatim with no check at all; see
      // `pluginRegionLinesLookAuthored`'s own doc comment for the three
      // over-claim shapes this closes). NO-EVIDENCE case (Lane B's
      // territory): the integration point.
      const origin = resolvePluginRegionOrigin(token, parsed, env, starts, source);

      if (!origin.ok) {
        // SFE-P2c repair round 1: this diagnostic's `reason` is now the
        // RULE-NAMED text `plugin-origin.ts`/`pluginRegionLinesLookAuthored`
        // computed, not one fixed generic string for every rule-4 shape —
        // the refusal matrix is now visible at the surface a consumer of
        // `projection.diagnostics` actually reads, not only inside this
        // module's own test suite.
        diagnostics.push({ category: "EDITOR_UNSUPPORTED_PROJECTION", reason: origin.reason });
        continue;
      }

      const [from, to] = origin.range;

      // SFE-P2c repair round 2 — structural containment guard (see
      // `pluginRegionContainsProjectableBlock`'s own doc comment): the
      // BIDIRECTIONAL half `pluginRegionLinesLookAuthored`'s shape-3 content
      // heuristic could not cover, because a `raw-html` block's interior
      // never starts with `@`. Computed once here and reused below for
      // `pluginRegionInactiveHtml` — `closeIndex` is the same slice either
      // way. Checked BEFORE the `lastBlockEnd` overlap guard: this is about
      // this region's OWN interior, not its relationship to prior blocks.
      const closeIndex = findMatchingCloseIndex(tokens, tokenIndex);
      if (pluginRegionContainsProjectableBlock(tokens, tokenIndex, closeIndex)) {
        diagnostics.push({
          category: "EDITOR_UNSUPPORTED_PROJECTION",
          reason:
            `"${token.type}" token's claimed range contains a block this projection would ` +
            `independently project (a Gutterpress marker, a page/column break, or a raw-html ` +
            `block with its own source-range evidence) — refusing the wider plugin-region claim ` +
            `so the contained block can project on its own instead. Edit this content in source mode.`,
        });
        continue;
      }

      // SFE-P2c repair round 1 — containment guard, defense in depth
      // alongside `pluginRegionLinesLookAuthored`'s own content-based
      // nested-marker check above: a range starting before the most
      // recently projected block's own end would overlap or be contained
      // by it — the same "never overlapping" invariant this module's own
      // header pins for the whole document, checked here explicitly for
      // plugin-region rather than relied on by accident of walk order.
      if (from < lastBlockEnd) {
        diagnostics.push({
          category: "EDITOR_UNSUPPORTED_PROJECTION",
          reason: `"${token.type}" token's resolved range overlaps a block already projected earlier in this document — refusing to project an overlapping plugin-region. Edit this content in source mode.`,
        });
        continue;
      }

      // D13 block-count cap applies identically to plugin regions.
      if (blockCapReached(blocks, diagnostics)) {
        limited = true;
        break;
      }

      // SFE-P2c repair round 1 (finding 6): the plugin's own rendered HTML
      // for its consumed source, via the SAME renderer/rule set the print
      // path uses (G-03) — see `pluginRegionInactiveHtml`'s own doc
      // comment. D13 caps apply via the SAME `capHtmlPayload` every other
      // HTML payload in this module goes through. `undefined` (matching
      // token stream, no matching close, or a plugin renderer rule that
      // threw) omits the key entirely — this module's existing optional-
      // field convention (never present with an `undefined` value).
      const pluginInactiveHtml = pluginRegionInactiveHtml(
        md,
        tokens,
        tokenIndex,
        closeIndex,
        env,
        diagnostics,
        htmlBudget,
      );
      blocks.push({
        id: `plugin-region:${from}:${to}`,
        kind: "plugin-region",
        from,
        to,
        // G-07: the active state is source-aware editing of the block's own
        // exact range, not a structured command surface — matches
        // `raw-html`'s posture, the closest existing analogue.
        editMode: "source",
        ...(pluginInactiveHtml !== undefined ? { inactiveHtml: pluginInactiveHtml } : {}),
        viewAttributes: extractViewAttributes(token),
      });
      lastBlockEnd = to;
      continue;
    }

    // Ordinary standard-Markdown block (paragraph, heading, list, table,
    // fence, hr, blockquote, footnote, definition list, …) — D6 sparseness:
    // the base editor already derives these, so this projection carries
    // only Gutterpress-specific information and does not walk them. When
    // `trusted` is not set (the default) or `md` carries no project
    // plugins, an unrecognized project-plugin token also falls through
    // here, completely unwalked — exactly P2b's behavior, unchanged (header
    // "TRUST GATE" / "Untrusted context").
  }

  return {
    schemaVersion: PROJECTION_SCHEMA_VERSION,
    sourceVersion: opts.sourceVersion,
    blocks,
    generated,
    diagnostics,
    pluginContainers: collectPluginContainers(tokens, source),
    // D13 — omit the key entirely when not limited (optional-field
    // convention, not `limited: false`; see the field's own doc comment).
    ...(limited ? { limited: true as const } : {}),
  };
}
