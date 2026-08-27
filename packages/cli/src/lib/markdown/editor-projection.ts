/**
 * `createEditorProjection` — the Gutterpress sparse editor projection (D6,
 * docs/plans/source-first-editor-enterprise-refactor.md; run
 * docs/plans/source-first-editor/runs/SFE-P2b.md).
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
 *   an unrecognized `layout_`-prefixed   -> "plugin-region" is RESERVED
 *     token (a plugin's own core rule)      (P2c maps it for real); this run
 *                                            emits a diagnostic, no block —
 *                                            see "AMBIGUITY" below
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
 * recognize — e.g. a plugin's own core rule synthesizing one): rather than
 * guessing a kind or inferring a range, this module emits a single
 * `EDITOR_UNSUPPORTED_PROJECTION`-categorized diagnostic naming the token
 * type and projects no block. D6's `plugin-region` kind stays RESERVED —
 * P2c maps real project-plugin regions; this run only proves the fail-closed
 * path (the lane's stated boundary).
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
 * above. `refusalReason` is spec'd on `ProjectedBlock` for a "future refused-
 * but-still-anchored block shape... unused by this run" (Lane A's own
 * comment on that field, preserved) — the payload caps do not repurpose it;
 * they go through the existing `diagnostics` channel like every other
 * refusal in this module, so a consumer has exactly one place to look.
 */
import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { createMarkdownRenderer } from "./renderer";
import { SOURCE_CHAPTER_ATTR, SOURCE_RANGE_ATTR } from "./source-range";

/** D1/D6 — Gutterpress sparse-projection schema version. Bump only via an explicit decision-record amendment. */
export const PROJECTION_SCHEMA_VERSION = 1 as const;

/** D6's required projected kinds, verbatim. `"plugin-region"` is reserved (P2c) — never emitted by this run. */
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
  /** Reserved for a future refused-but-still-anchored block shape; unused by this run (ambiguous cases produce a diagnostic with NO block instead). */
  readonly refusalReason?: string;
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
}

export interface CreateEditorProjectionOptions {
  /** G-11 — stamped onto the result verbatim; the consumer (packages/editor) is what rejects a stale value against its own snapshot version. */
  readonly sourceVersion: number;
  /**
   * The SAME configured `MarkdownIt` instance the render path uses (G-03:
   * "one resolved presentation context") — e.g. one built by
   * `createMarkdownRenderer(projectPlugins)`. Defaults to a plain
   * `createMarkdownRenderer()` (no project plugins) when omitted.
   */
  readonly md?: MarkdownIt;
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

/** Fixed, tiny, safe replacement for an HTML payload that tripped either the per-payload or the aggregate cap. Never derived from the oversized content itself — nothing about the omitted bytes is echoed back. Exported (not just an internal constant) so tests assert exact equality instead of a loose substring match. */
export const HTML_PAYLOAD_PLACEHOLDER =
  '<div class="gp-projection-omitted" aria-hidden="true">Content omitted (over the Gutterpress editor size limit) — edit in source mode.</div>';

// Reused across every payload this call measures — a module-scope encoder
// carries no per-call state, so one instance is correct and avoids
// reallocating it per payload (`TextEncoder` is browser-safe: no
// `node:buffer`/`Buffer`, per D13's own "measure... browser-safe").
const textEncoder = new TextEncoder();

/** D13's byte convention: UTF-8 byte length via `TextEncoder` (browser-safe), NOT `string.length` (UTF-16 code units) and NOT a Node `Buffer`. */
function utf8ByteLength(html: string): number {
  return textEncoder.encode(html).length;
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
  const tokens = md.parse(source, {});
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

  for (const token of tokens) {
    if (token.type === "html_block") {
      const rangeAttr = token.attrGet(SOURCE_RANGE_ATTR);
      const parsed = rangeAttr ? parseSourceRangeAttr(rangeAttr) : null;
      if (parsed) {
        const [from, to] = charRangeForLines(starts, source, parsed[0], parsed[1]);
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
      const rangeAttr = token.attrGet(SOURCE_RANGE_ATTR);
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
      // A layout-like token this module does not recognize (AP-05 / D6
      // "plugin-region" reserved — see header "AMBIGUITY"). Fails closed:
      // no guessed kind, no guessed range.
      diagnostics.push({
        category: "EDITOR_UNSUPPORTED_PROJECTION",
        reason: `"${token.type}" is a layout-like token this projection does not recognize (plugin-region mapping is reserved for a later run). Edit this content in source mode.`,
      });
      continue;
    }

    // Ordinary standard-Markdown block (paragraph, heading, list, table,
    // fence, hr, blockquote, …) or an unrelated plugin token: D6 sparseness
    // — the base editor already derives these, so this projection carries
    // only Gutterpress-specific information and does not walk them.
  }

  return {
    schemaVersion: PROJECTION_SCHEMA_VERSION,
    sourceVersion: opts.sourceVersion,
    blocks,
    generated,
    diagnostics,
    // D13 — omit the key entirely when not limited (optional-field
    // convention, not `limited: false`; see the field's own doc comment).
    ...(limited ? { limited: true as const } : {}),
  };
}
