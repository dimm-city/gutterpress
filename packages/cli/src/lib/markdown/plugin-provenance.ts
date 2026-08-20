/**
 * Line provenance for project-plugin tokens — recorded by the HOST at rule
 * registration, never demanded of the plugin.
 *
 * ## The gap
 *
 * The rich editor can only round-trip a plugin's markup if it can recover
 * the AUTHORED LINES behind every plugin-produced token verbatim.
 * markdown-it has two conventional carriers — `token.map` and
 * `token.markup` — but neither is required by the plugin contract
 * (CLAUDE.md §5: plugins are plain markdown-it plugins), and the house
 * marker style (markers.js, ADR 0009) deliberately leaves `map` null.
 * Requiring particular token shapes made rich editing depend on how each
 * plugin happened to be written — brittle, and unenforceable for npm
 * plugins we do not control.
 *
 * Two plugin surfaces need provenance, so there are two mechanisms — both
 * host-side observation at registration time, zero obligations on the
 * plugin:
 *
 *  - BLOCK RULES (`withBlockRuleProvenance`): the tokenizer itself knows
 *    the exact line range each invocation consumed, so map-less tokens are
 *    stamped `meta.gpEditorLines = [startLine, state.line)`.
 *  - CORE-RULER TRANSFORMS (`withCoreRuleProvenance`): a core rule rewrites
 *    the finished token stream, so provenance comes from a per-invocation
 *    diff of the transform's own input/output record — which token objects
 *    it removed, which it inserted, and the removed tokens' own maps and
 *    stamps. Regions with recoverable source are stamped `meta.gpCoreHunk`;
 *    anything ambiguous is poisoned `meta.gpCorePoison` so the editor
 *    refuses rich mode with the rule named, instead of guessing. Object
 *    identity of survivors makes the diff exact; where identity or maps run
 *    out the answer is refuse, never interpolate.
 *
 * ## Block rules: observe the tokenizer, not the plugin
 *
 * While `applyPlugins` runs, every BLOCK RULE a plugin registers is wrapped.
 * On each successful non-silent invocation the wrapper records the exact
 * line range the rule consumed — `[startLine, state.line)` — and stamps it
 * as `token.meta.gpEditorLines` on every token the invocation pushed
 * without a `map`. That is ground truth from the tokenizer itself:
 *
 *  - the range's FIRST line is where the construct began — the open
 *    marker's authored line, whatever the rule's internal style;
 *  - the range's LAST line is the final line the rule consumed — the close
 *    marker's authored line, for wrapper rules that advance past the
 *    terminator before pushing the close token (markdown-it-container
 *    style) AND for standalone one-line closer rules (marker style). Both
 *    real styles land on the same answer; a per-`push` `state.line`
 *    snapshot is off by one for one style or the other, which is why the
 *    stamp is per-invocation, not per-push.
 *
 * Nested constructs need no special casing: inner rules stamp their own
 * tokens first (tighter ranges), and the pass never overwrites an existing
 * stamp or a real `map`.
 *
 * ## Core rules: hunks → regions → policy
 *
 * Per wrapped invocation the differ snapshots `state.tokens` (array copy
 * plus a per-token fingerprint of type / content / children array
 * REFERENCE / a DEEP child signature — per-child (type, content), recursing
 * into nested children — so an in-place `child.content` edit (the
 * markdown-it `replacements` pattern) is a visible morph, not an escape.
 * Attrs are deliberately NOT fingerprinted: `attrJoin` / `attrSet` on
 * survivors is regenerated presentation, not consumed source. The differ
 * then runs the rule and identity-diffs the result:
 *
 *  - Reordered or duplicated survivors poison the invocation — a moved
 *    mapped token is authored source in a new place, and neither dropping
 *    nor re-attributing it is ground truth.
 *  - A fingerprint change on a survivor is a single-token hunk (a morph).
 *  - A removed run is attributable from its own maps/stamps; a map-less
 *    close token (`nesting === -1`) is attributable when its matching open
 *    is removed in the same hunk — markdown-it puts the whole construct's
 *    range on the open and never maps closes, so the close adds no
 *    unattributed source. Tokens NESTED inside such a matched pair are
 *    covered by the open's range for the same reason (markdown-it leaves
 *    `map` off `th_open`/`td_open`/cell `inline` furniture whose lines the
 *    construct open's map already spans). A close whose open was removed
 *    in an EARLIER hunk merges everything between into ONE region
 *    attributed to the open's map (the GFM-alert shape: container split
 *    across two removal sites, interior surviving by reference). Still
 *    the transform's own record — never gap inference.
 *  - Guards, all fail-closed: a range covering a surviving token's range
 *    (map OR stamp — a stamp there would double-write those lines, and a
 *    chained rule consuming a strict SUBSET of an earlier stamped region
 *    must refuse, not mint a second region over the same lines), a region
 *    that swallowed a survivor whose own range lies outside the region's
 *    recovered range (the cross-construct pairing shape: an open paired
 *    with a DIFFERENT construct's close would delete everything between
 *    them on save), a region inside a surviving container (serializer
 *    container delims would corrupt the verbatim lines; markers.js's
 *    delim-free layout wrappers are exempt), inline-level insertions
 *    outside a region, and pure injections that are mapped or not
 *    `html_block`.
 *  - Pure map-less, stamp-less `html_block` injections stay UNstamped: the
 *    pipeline regenerates them from surviving source on every render, so
 *    dropping them at serialize time is provably lossless.
 *
 * Stamped tokens count as attributed in later rules' diffs (stamp ≡ map),
 * so chained transforms keep provenance; re-stamping overwrites with the
 * merged range. Poison is META-ONLY — token types are never changed, so
 * every render path (preview, semantic gates, normalize planner) stays
 * pixel-identical; only the editor's parse acts on it.
 *
 * Poison is also STICKY across chained rules — first poison wins. A later
 * wrapped rule that removes (or morphs) a poison-carrying token must not
 * launder the refusal out of the stream: its candidate never stamps, and
 * the replacement span is re-poisoned with the ORIGINAL rule/reason. The
 * moved-transform fallback targets get the same carry.
 *
 * ## The orphan side channel (`env.gpCorePoisonOrphan`)
 *
 * A transform that consumes the ENTIRE document leaves no token to carry
 * poison — and an editor that then sees an empty token stream would treat
 * the file as empty and wipe it on save. When `poisonSpan` finds no
 * carrier token anywhere, the refusal is recorded on the render env
 * instead: `env[GP_CORE_POISON_ORPHAN]` is set to the `GpCorePoisonStamp`
 * (first poison wins; never overwritten). Contract for the editor
 * (stage 2): `raiseOnPoison` must check this env key in addition to
 * token-level `meta.gpCorePoison`, and refuse rich mode with the named
 * rule when it is present. Like the token stamps it is meta/env-only —
 * nothing in the print path reads it.
 *
 * ## What deliberately gets NO stamp
 *
 *  - Tokens from the BASE pipeline (paragraphs, headings, footnote /
 *    deflist, markers.js): those rules are registered before `applyPlugins`
 *    runs, so both wrappers leave base block rules AND base/host core rules
 *    (markers.js's `layout_transform`, gp-pin-scope, inline-source,
 *    `source_range`) untouched. Unmodelled base constructs still refuse
 *    rich editing (the schema decision in CLAUDE.md §5) instead of being
 *    absorbed as anonymous plugin blocks, and the chapter-opener badge path
 *    is byte-for-byte unchanged.
 *  - Pure `html_block` injections (above). The desktop editor's
 *    `editor_tag_generated` core rule retags map-less, un-stamped,
 *    un-poisoned `html_block` tokens to `gp_generated`, which renders like
 *    raw HTML but serializes to nothing. That is the third arm of the
 *    editor's three-way split — adopt (stamped tokens/regions), refuse
 *    (poisoned tokens raise before parse), drop (`gp_generated`) — and the
 *    drop is lossless only BECAUSE the injection's generator lines survive
 *    in the document.
 *
 * The print path carries the stamps too (one assembly, one dialect);
 * nothing in it reads the keys. Like `data-source-range` they are
 * host-internal metadata: never author-facing, never emitted into the DOM.
 */
import type MarkdownIt from "markdown-it";

/** Block-rule stamp meta key. Consumed by the desktop editor's `adoptPluginTokens`. */
export const GP_EDITOR_LINES = "gpEditorLines";

/** Core-rule region stamp meta key. Consumed by the desktop editor's `adoptCoreRegions`. */
export const GP_CORE_HUNK = "gpCoreHunk";

/** Core-rule poison meta key. The desktop editor's `raiseOnPoison` refuses rich mode on it. */
export const GP_CORE_POISON = "gpCorePoison";

/**
 * Env side-channel key for a refusal with NO token to carry it — a transform
 * that consumed the entire document. Value: `GpCorePoisonStamp`, first
 * poison wins. Stage-2 contract: the desktop editor's `raiseOnPoison` must
 * check `env[GP_CORE_POISON_ORPHAN]` alongside token-level poison, so an
 * empty token stream refuses rich mode instead of reading as an empty file.
 */
export const GP_CORE_POISON_ORPHAN = "gpCorePoisonOrphan";

/** Payload under `meta.gpCoreHunk` on every token of a stamped region. */
export interface GpCoreHunkStamp {
  /** Unique per stamped region (monotonic; uniqueness is the only contract). */
  id: number;
  /** Authored source lines, `token.map` semantics: 0-based, half-open `[start, end)`. */
  range: [number, number];
  /** Registered name of the core rule whose transform produced the region. */
  rule: string;
}

/** Payload under `meta.gpCorePoison` where a transform's source cannot be recovered. */
export interface GpCorePoisonStamp {
  rule: string;
  reason: string;
}

interface BlockStateLike {
  line: number;
  tokens: Array<{ map: [number, number] | null; meta: unknown }>;
}

type BlockRule = (
  state: BlockStateLike,
  startLine: number,
  endLine: number,
  silent: boolean,
) => boolean;

function stampingRule(fn: BlockRule): BlockRule {
  return function (this: unknown, state, startLine, endLine, silent) {
    const before = state.tokens.length;
    const ok = fn.call(this, state, startLine, endLine, silent);
    // `state.line > startLine`: a successful rule that consumed nothing has
    // no range to attribute (and would hang markdown-it regardless).
    if (ok && !silent && state.line > startLine) {
      for (let i = before; i < state.tokens.length; i++) {
        const token = state.tokens[i]!;
        if (token.map) continue;
        const meta = token.meta;
        if (meta == null) {
          token.meta = { [GP_EDITOR_LINES]: [startLine, state.line] };
        } else if (
          typeof meta === "object" &&
          !(GP_EDITOR_LINES in meta) &&
          Object.isExtensible(meta)
        ) {
          // Alongside the plugin's own meta (e.g. the marker-style
          // `meta.line`), never replacing it. A frozen meta is skipped —
          // a missing stamp degrades to fail-closed, never to a throw in
          // the middle of a book render.
          (meta as Record<string, unknown>)[GP_EDITOR_LINES] = [startLine, state.line];
        }
      }
    }
    return ok;
  };
}

/** `(name, fn)` methods take the rule at index 1; `(anchor, name, fn)` at 2. */
const REGISTRATION_METHODS: ReadonlyArray<readonly [string, number]> = [
  ["push", 1],
  ["at", 1],
  ["before", 2],
  ["after", 2],
];

type RulerLike = Record<string, (...args: unknown[]) => unknown>;

/**
 * Run `apply` with a ruler's registration methods intercepted, so every rule
 * registered during it is wrapped. The methods are restored afterwards —
 * rules registered outside the window (base pipeline before, host rules
 * after) stay untouched. The rule NAME always sits one argument before the
 * function in every registration method.
 */
function withRulerInterception(
  ruler: RulerLike,
  wrap: (fn: unknown, name: string) => unknown,
  apply: () => void,
): void {
  const saved = REGISTRATION_METHODS.map(([name]) => [name, ruler[name]] as const);
  for (const [name, fnIndex] of REGISTRATION_METHODS) {
    const original = ruler[name]!.bind(ruler);
    ruler[name] = (...args: unknown[]) => {
      if (typeof args[fnIndex] === "function") {
        const ruleName =
          typeof args[fnIndex - 1] === "string" ? (args[fnIndex - 1] as string) : "(unnamed rule)";
        args[fnIndex] = wrap(args[fnIndex], ruleName);
      }
      return original(...args);
    };
  }
  try {
    apply();
  } finally {
    for (const [name, fn] of saved) ruler[name] = fn!;
  }
}

/**
 * Run `apply` (the plugin-registration phase) with `md.block.ruler`'s
 * registration methods intercepted, so every block rule registered during it
 * is wrapped with the provenance stamp.
 */
export function withBlockRuleProvenance(md: MarkdownIt, apply: () => void): void {
  withRulerInterception(
    md.block.ruler as unknown as RulerLike,
    (fn) => stampingRule(fn as BlockRule),
    apply,
  );
}

/**
 * Run `apply` with `md.core.ruler`'s registration methods intercepted, so
 * every core rule registered during it is wrapped with the per-invocation
 * differ (see the header). Core rules receive `(state)` with no ok/silent
 * semantics, so the block wrapper's `ok && !silent` gate has no analogue.
 */
export function withCoreRuleProvenance(md: MarkdownIt, apply: () => void): void {
  withRulerInterception(
    md.core.ruler as unknown as RulerLike,
    (fn, name) => differRule(name, fn as CoreRule),
    apply,
  );
}

/* ------------------------------------------------------------------------ */
/* The core-rule differ                                                      */
/* ------------------------------------------------------------------------ */

interface CoreTokenLike {
  type: string;
  nesting: number;
  content: string;
  children: unknown[] | null;
  map: [number, number] | null;
  meta: unknown;
}

interface CoreStateLike {
  tokens: CoreTokenLike[];
  env: unknown;
}

type CoreRule = (state: CoreStateLike, ...rest: unknown[]) => unknown;

interface Fingerprint {
  type: string;
  content: string;
  children: unknown[] | null;
  /** Deep structural signature of `children` — see `childrenSignature`. */
  childSig: string | null;
}

/**
 * Structural signature over a token's children: per-child (type, content),
 * recursing into nested children (image alt-text tokens). The children
 * array REFERENCE alone cannot see an IN-PLACE `child.content` edit — the
 * markdown-it `replacements` pattern — which would otherwise bake plugin
 * output into the author's bytes. JSON encoding makes the signature
 * collision-safe against content containing delimiters.
 */
function childrenSignature(children: unknown[] | null | undefined): string | null {
  if (children == null) return null;
  return JSON.stringify(children.map(childSignatureNode));
}

function childSignatureNode(child: unknown): unknown {
  if (child === null || typeof child !== "object") return null;
  const c = child as CoreTokenLike;
  return [c.type, c.content, c.children ? c.children.map(childSignatureNode) : null];
}

/**
 * One maximal run of change between two shared (identity-surviving) anchor
 * tokens: `removed` from the before array, `[aStart, aEnd)` the inserted
 * span in the after array. A morph is the degenerate hunk whose removed and
 * inserted sides are the same (mutated) object.
 */
interface Hunk {
  removed: CoreTokenLike[];
  aStart: number;
  aEnd: number;
  /** Set when cross-hunk pairing found this hunk structurally unresolvable. */
  forcedReason?: string;
}

interface Candidate {
  members: Hunk[];
  /** Paired open tokens (region candidates only) — each must carry a range. */
  pairedOpens: CoreTokenLike[];
  pairedCloses: CoreTokenLike[];
  region: boolean;
}

/**
 * Token types markdown-it's inline parser owns. `inline` is the one a core
 * transform realistically splices at block position (the GFM-alert shape);
 * the rest close the same door for child-level types. Unknown plugin inline
 * types cannot be recognized here — the editor's parser refuses unknown
 * token types downstream, so they still fail closed.
 */
const INLINE_LEVEL_TYPES = new Set([
  "inline",
  "text",
  "code_inline",
  "html_inline",
  "softbreak",
  "hardbreak",
  "image",
  "link_open",
  "link_close",
  "em_open",
  "em_close",
  "strong_open",
  "strong_close",
  "s_open",
  "s_close",
]);

/**
 * markers.js's structural wrappers (`@chapter`/`@spread`/`@page`/`@section`).
 * The editor serializes these delim-free — marker line, then content
 * verbatim — so a region inside them round-trips exactly. The depth guard
 * exists for DELIM-BEARING containers (blockquote `> ` prefixes, list
 * indents) and for unknown plugin containers, whose serialized form would
 * corrupt a verbatim region; real books put their transforms inside
 * `@page`/`@section` as a matter of course, so counting the layout family
 * would refuse every one of them.
 */
const DELIM_FREE_WRAPPERS = new Set([
  "layout_chapter_open",
  "layout_chapter_close",
  "layout_spread_open",
  "layout_spread_close",
  "layout_page_open",
  "layout_page_close",
  "layout_section_open",
  "layout_section_close",
]);

/** Region ids only ever need to be unique; a monotonic counter carries no per-render state. */
let nextRegionId = 1;

function isRangeTuple(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function metaRecord(tok: CoreTokenLike): Record<string, unknown> | null {
  const meta = tok.meta;
  return meta !== null && typeof meta === "object" ? (meta as Record<string, unknown>) : null;
}

/** A token's own authored range: real `map`, else a provenance stamp (stamp ≡ map). */
function tokenRange(tok: CoreTokenLike): [number, number] | null {
  if (isRangeTuple(tok.map)) return [tok.map[0], tok.map[1]];
  const meta = metaRecord(tok);
  if (!meta) return null;
  const hunk = meta[GP_CORE_HUNK] as { range?: unknown } | undefined;
  if (hunk && isRangeTuple(hunk.range)) return [hunk.range[0], hunk.range[1]];
  const lines = meta[GP_EDITOR_LINES];
  if (isRangeTuple(lines)) return [lines[0], lines[1]];
  return null;
}

function hasProvenanceStamp(tok: CoreTokenLike): boolean {
  const meta = metaRecord(tok);
  return meta != null && (GP_CORE_HUNK in meta || GP_EDITOR_LINES in meta);
}

/**
 * Meta write with stampingRule's care: create when null, extend when
 * extensible, silently skip otherwise — a frozen or non-extensible meta
 * degrades to a MISSING mark, which downstream treats fail-closed
 * (a gapped region refuses adoption), never a throw mid-render.
 */
function writeMetaKey(tok: CoreTokenLike, key: string, value: unknown, overwrite: boolean): void {
  const meta = tok.meta;
  if (meta == null) {
    tok.meta = { [key]: value };
    return;
  }
  if (typeof meta !== "object") return;
  const rec = meta as Record<string, unknown>;
  if (key in rec) {
    if (!overwrite) return;
    const desc = Object.getOwnPropertyDescriptor(rec, key);
    if (!desc?.writable) return;
    rec[key] = value;
    return;
  }
  if (!Object.isExtensible(meta)) return;
  rec[key] = value;
}

/** A token's existing poison stamp, if shape-valid. */
function poisonOf(tok: CoreTokenLike): GpCorePoisonStamp | null {
  const meta = metaRecord(tok);
  if (!meta) return null;
  const stamp = meta[GP_CORE_POISON] as { rule?: unknown; reason?: unknown } | undefined;
  return stamp && typeof stamp.rule === "string" && typeof stamp.reason === "string"
    ? (stamp as GpCorePoisonStamp)
    : null;
}

/**
 * The earliest existing poison among `tokens` — the anti-laundering probe.
 * A later rule that removes (or morphs) a poison-carrying token must carry
 * the ORIGINAL rule/reason onto whatever replaces it; first poison wins.
 */
function firstPoison(tokens: CoreTokenLike[]): GpCorePoisonStamp | null {
  for (const tok of tokens) {
    const stamp = poisonOf(tok);
    if (stamp) return stamp;
  }
  return null;
}

/** First poison wins — the earliest failure is the root cause the author needs. */
function poisonTokens(tokens: CoreTokenLike[], stamp: GpCorePoisonStamp): void {
  for (const tok of tokens) writeMetaKey(tok, GP_CORE_POISON, stamp, false);
}

/**
 * Record a refusal that has NO token to carry it (a transform consumed the
 * entire document) on the render env instead — see GP_CORE_POISON_ORPHAN.
 * First poison wins; writeMetaKey's care applies (non-object or
 * non-extensible env degrades to a missing mark, never a throw mid-render).
 */
function recordOrphanPoison(env: unknown, stamp: GpCorePoisonStamp): void {
  if (env === null || typeof env !== "object") return;
  const rec = env as Record<string, unknown>;
  if (GP_CORE_POISON_ORPHAN in rec) return;
  if (!Object.isExtensible(env)) return;
  rec[GP_CORE_POISON_ORPHAN] = stamp;
}

/**
 * Poison a candidate's inserted/morphed span. A consumed-to-nothing hunk has
 * no inserted token to carry the mark, but the refusal must still be
 * visible, so the nearest surviving neighbor carries it. A transform that
 * consumed the WHOLE document to nothing leaves no neighbor either — the
 * refusal then goes to the env orphan channel (GP_CORE_POISON_ORPHAN), so
 * the editor can refuse instead of treating the file as empty and wiping
 * it on save.
 */
function poisonSpan(
  after: CoreTokenLike[],
  aStart: number,
  aEnd: number,
  stamp: GpCorePoisonStamp,
  env: unknown,
): void {
  let targets = after.slice(aStart, aEnd);
  if (targets.length === 0) {
    const neighbor = after[aStart] ?? after[aStart - 1];
    targets = neighbor ? [neighbor] : [];
  }
  if (targets.length === 0) {
    recordOrphanPoison(env, stamp);
    return;
  }
  poisonTokens(targets, stamp);
}

/** Do `X_open` / `X_close` name one construct? Anything else is not a provable pair. */
function pairsWith(open: CoreTokenLike, close: CoreTokenLike): boolean {
  return (
    open.type.endsWith("_open") &&
    close.type.endsWith("_close") &&
    open.type.slice(0, -5) === close.type.slice(0, -6)
  );
}

/** Opens and closes of a removed run left unmatched by its own interior pairs. */
function splitUnmatched(removed: CoreTokenLike[]): {
  unmatchedOpens: CoreTokenLike[];
  unmatchedCloses: CoreTokenLike[];
} {
  const stack: CoreTokenLike[] = [];
  const unmatchedCloses: CoreTokenLike[] = [];
  for (const tok of removed) {
    if (tok.nesting === 1) {
      stack.push(tok);
    } else if (tok.nesting === -1) {
      if (stack.length > 0) stack.pop();
      else unmatchedCloses.push(tok);
    }
  }
  return { unmatchedOpens: stack, unmatchedCloses };
}

/**
 * Tokens of a removed run covered by the run's own matched constructs. A
 * close matched by a same-type open in the run adds no unattributed source —
 * markdown-it puts the whole construct's range on the open and never maps
 * closes — and when that open carries a recoverable range, every token
 * nested inside the pair is covered by it too: markdown-it leaves `map` off
 * nested construct furniture (`th_open` / `td_open` / table-cell `inline`)
 * whose lines the construct open's map already spans. Interior coverage
 * REQUIRES the open's range — under a range-less open those lines would
 * silently fall out of the stamped union, which is exactly the loss the
 * attribution walk exists to refuse.
 */
function inHunkCovered(removed: CoreTokenLike[]): Set<CoreTokenLike> {
  const stack: Array<{ open: CoreTokenLike; startIdx: number }> = [];
  const covered = new Set<CoreTokenLike>();
  for (let i = 0; i < removed.length; i++) {
    const tok = removed[i]!;
    if (tok.nesting === 1) {
      stack.push({ open: tok, startIdx: i });
    } else if (tok.nesting === -1 && stack.length > 0) {
      const { open, startIdx } = stack.pop()!;
      if (!pairsWith(open, tok)) continue;
      covered.add(tok);
      if (tokenRange(open)) {
        for (let j = startIdx + 1; j < i; j++) covered.add(removed[j]!);
      }
    }
  }
  return covered;
}

function differRule(ruleName: string, fn: CoreRule): CoreRule {
  return function (this: unknown, state: CoreStateLike, ...rest: unknown[]) {
    const before = state.tokens.slice();
    const fingerprints = new Map<CoreTokenLike, Fingerprint>();
    for (const tok of before) {
      fingerprints.set(tok, {
        type: tok.type,
        content: tok.content,
        children: tok.children,
        childSig: childrenSignature(tok.children),
      });
    }
    const result = fn.call(this, state, ...rest);
    diffInvocation(ruleName, before, fingerprints, state.tokens, state.env);
    return result;
  };
}

function diffInvocation(
  rule: string,
  before: CoreTokenLike[],
  fingerprints: Map<CoreTokenLike, Fingerprint>,
  after: CoreTokenLike[],
  env: unknown,
): void {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const sharedBefore = before.filter((tok) => afterSet.has(tok));
  const sharedAfter = after.filter((tok) => beforeSet.has(tok));

  // Moves poison. A duplicated reference also lands here (the shared
  // sequences diverge), which is the right verdict: two copies of one
  // authored token cannot both be its source.
  const moved =
    sharedBefore.length !== sharedAfter.length ||
    sharedBefore.some((tok, i) => sharedAfter[i] !== tok);
  if (moved) {
    let targets = after.filter((tok) => !beforeSet.has(tok));
    if (targets.length === 0) {
      targets = sharedAfter.filter((tok, i) => sharedBefore[i] !== tok);
    }
    // Anti-laundering: a vanished token that already carried poison keeps
    // its ORIGINAL rule/reason on the fallback targets — first poison wins.
    const vanished = before.filter((tok) => !afterSet.has(tok));
    poisonTokens(targets, firstPoison(vanished) ?? { rule, reason: "reordered authored content" });
    return;
  }

  // Hunks between consecutive shared anchors, plus single-token morph hunks
  // for anchors whose fingerprint changed.
  const hunks: Hunk[] = [];
  let bi = 0;
  let ai = 0;
  for (let s = 0; s <= sharedBefore.length; s++) {
    const anchor = s < sharedBefore.length ? sharedBefore[s]! : null;
    const bStart = bi;
    while (bi < before.length && before[bi] !== anchor) bi++;
    const aStart = ai;
    while (ai < after.length && after[ai] !== anchor) ai++;
    if (bi > bStart || ai > aStart) {
      hunks.push({ removed: before.slice(bStart, bi), aStart, aEnd: ai });
    }
    if (anchor === null) break;
    const fp = fingerprints.get(anchor)!;
    // childSig last: the deep signature is only recomputed when the cheap
    // checks pass. It is what catches IN-PLACE child mutation (the
    // markdown-it `replacements` pattern) that the array reference misses.
    if (
      fp.type !== anchor.type ||
      fp.content !== anchor.content ||
      fp.children !== anchor.children ||
      fp.childSig !== childrenSignature(anchor.children)
    ) {
      hunks.push({ removed: [anchor], aStart: ai, aEnd: ai + 1 });
    }
    bi++;
    ai++;
  }
  if (hunks.length === 0) return;

  // Cross-hunk span pairing: a removed close whose matching open was removed
  // in an earlier hunk merges everything between into one region. Matching
  // is stack discipline over the transform's own removals — a close whose
  // open was NOT removed (or names a different construct) is unresolvable.
  const pendingOpens: Array<{ tok: CoreTokenLike; hunk: number }> = [];
  const pairs: Array<{ open: CoreTokenLike; close: CoreTokenLike; s: number; e: number }> = [];
  for (let h = 0; h < hunks.length; h++) {
    const hunk = hunks[h]!;
    const { unmatchedOpens, unmatchedCloses } = splitUnmatched(hunk.removed);
    for (const close of unmatchedCloses) {
      const top = pendingOpens.pop();
      if (!top || !pairsWith(top.tok, close)) {
        hunk.forcedReason = "removed a close token whose matching open was not removed";
        continue;
      }
      pairs.push({ open: top.tok, close, s: top.hunk, e: h });
    }
    for (const open of unmatchedOpens) pendingOpens.push({ tok: open, hunk: h });
  }

  // Coalesce pairing intervals (nested pairs collapse into the outermost).
  const intervals = pairs
    .map((p) => [p.s, p.e] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push([iv[0], iv[1]]);
  }

  const inRegion = new Array<boolean>(hunks.length).fill(false);
  const candidates: Candidate[] = [];
  for (const [s, e] of merged) {
    for (let i = s; i <= e; i++) inRegion[i] = true;
    const regionPairs = pairs.filter((p) => p.s >= s && p.e <= e);
    candidates.push({
      members: hunks.slice(s, e + 1),
      pairedOpens: regionPairs.map((p) => p.open),
      pairedCloses: regionPairs.map((p) => p.close),
      region: true,
    });
  }
  for (let i = 0; i < hunks.length; i++) {
    if (!inRegion[i]) {
      candidates.push({ members: [hunks[i]!], pairedOpens: [], pairedCloses: [], region: false });
    }
  }

  for (const cand of candidates) classifyCandidate(rule, cand, after, beforeSet, env);
}

/** The policy table. Each candidate stamps, poisons, or (pure injections) stays untouched. */
function classifyCandidate(
  rule: string,
  cand: Candidate,
  after: CoreTokenLike[],
  beforeSet: Set<CoreTokenLike>,
  env: unknown,
): void {
  const members = cand.members;
  const aStart = members[0]!.aStart;
  const aEnd = members[members.length - 1]!.aEnd;
  const removed: CoreTokenLike[] = [];
  let insertedCount = 0;
  let forcedReason: string | undefined;
  for (const hunk of members) {
    removed.push(...hunk.removed);
    insertedCount += hunk.aEnd - hunk.aStart;
    forcedReason ??= hunk.forcedReason;
  }

  // Anti-laundering guard, FIRST: a removed (or morphed) token carrying
  // poison is an earlier rule's standing refusal. Consuming it must not
  // erase that refusal — never stamp this candidate; re-poison the
  // replacement span with the ORIGINAL rule/reason (first poison wins).
  const laundered = firstPoison(removed);
  if (laundered) {
    poisonSpan(after, aStart, aEnd, laundered, env);
    return;
  }

  if (forcedReason) {
    poisonSpan(after, aStart, aEnd, { rule, reason: forcedReason }, env);
    return;
  }

  if (removed.length === 0) {
    // Pure injection: only regenerable html_block output may pass unstamped.
    const inserted = after.slice(aStart, aEnd);
    const impure = inserted.some(
      (tok) => tok.type !== "html_block" || isRangeTuple(tok.map) || hasProvenanceStamp(tok),
    );
    if (impure) {
      const carriesSource = inserted.some(
        (tok) => isRangeTuple(tok.map) || hasProvenanceStamp(tok),
      );
      poisonSpan(
        after,
        aStart,
        aEnd,
        {
          rule,
          reason: carriesSource
            ? "inserted tokens carrying authored source (moved or copied content)"
            : "injected non-html content that would be absorbed as authored markdown",
        },
        env,
      );
    }
    return;
  }

  if (insertedCount === 0) {
    // Consumed to nothing: no inserted token exists to carry the range, so
    // the authored lines would silently vanish on serialize.
    poisonSpan(
      after,
      aStart,
      aEnd,
      { rule, reason: "consumed authored content and inserted no replacement" },
      env,
    );
    return;
  }

  // Attribution from the transform's own record. Walking the concatenated
  // removed runs with a depth counter over THIS region's paired open/close
  // tokens: everything inside a paired construct is covered by the open's
  // map (markdown-it puts the whole construct's range on the open), so only
  // depth-0 tokens must carry their own range or be an in-hunk matched close.
  const pairedOpens = new Set(cand.pairedOpens);
  const pairedCloses = new Set(cand.pairedCloses);
  let constructDepth = 0;
  for (const hunk of members) {
    const covered = inHunkCovered(hunk.removed);
    for (const tok of hunk.removed) {
      if (pairedOpens.has(tok)) {
        if (!tokenRange(tok)) {
          poisonSpan(
            after,
            aStart,
            aEnd,
            { rule, reason: "rewrote content whose source can't be recovered" },
            env,
          );
          return;
        }
        constructDepth++;
        continue;
      }
      if (pairedCloses.has(tok)) {
        constructDepth--;
        continue;
      }
      if (constructDepth > 0) continue;
      if (tokenRange(tok)) continue;
      if (covered.has(tok)) continue;
      poisonSpan(
        after,
        aStart,
        aEnd,
        { rule, reason: "rewrote content whose source can't be recovered" },
        env,
      );
      return;
    }
  }

  // Range: the union of the removed tokens' maps/stamps.
  let rangeStart = Infinity;
  let rangeEnd = -Infinity;
  for (const tok of removed) {
    const range = tokenRange(tok);
    if (range) {
      rangeStart = Math.min(rangeStart, range[0]);
      rangeEnd = Math.max(rangeEnd, range[1]);
    }
  }
  if (!(rangeStart < rangeEnd)) {
    poisonSpan(
      after,
      aStart,
      aEnd,
      { rule, reason: "rewrote content whose source can't be recovered" },
      env,
    );
    return;
  }

  // Containment guard (regions): every swallowed survivor must live inside
  // the region's recovered range. A survivor whose own range (map or stamp)
  // lies outside proves the span pairing crossed constructs — an open
  // paired with a DIFFERENT construct's close — and a stamp would delete
  // everything between the mismatched pair on save. This implicitly
  // enforces that the paired close belongs to the open.
  if (cand.region) {
    for (let i = aStart; i < aEnd; i++) {
      const tok = after[i]!;
      if (!beforeSet.has(tok)) continue;
      const r = tokenRange(tok);
      if (!r) continue;
      if (r[0] < rangeStart || r[1] > rangeEnd) {
        poisonSpan(
          after,
          aStart,
          aEnd,
          { rule, reason: "swallowed surviving content whose source lies outside the rewritten construct" },
          env,
        );
        return;
      }
    }
  }

  // Overlap guard: a stamp whose range covers lines that surviving tokens
  // still serialize would double-write them. Span pairing already swallowed
  // the survivors a legitimate container rewrite encloses. The survivor's
  // range comes from tokenRange (map OR stamp): a map-less stamped survivor
  // — half of an earlier rule's region a chained rule consumed a strict
  // subset of — must refuse too, or two regions would mint the same lines
  // and duplicate authored content on save.
  for (let i = 0; i < after.length; i++) {
    if (i >= aStart && i < aEnd) continue;
    const tok = after[i]!;
    if (!beforeSet.has(tok)) continue;
    const r = tokenRange(tok);
    if (!r) continue;
    if (r[0] < rangeEnd && rangeStart < r[1]) {
      poisonSpan(
        after,
        aStart,
        aEnd,
        { rule, reason: "replaced content overlapping surviving authored content" },
        env,
      );
      return;
    }
  }

  // Depth guard: inside a surviving container the serializer's delims
  // (wrapBlock) would double- or under-prefix the verbatim lines. The
  // layout family is exempt (see DELIM_FREE_WRAPPERS); unknown containers
  // still count — fail closed.
  let survivorDepth = 0;
  for (let i = 0; i < aStart; i++) {
    const tok = after[i]!;
    if (beforeSet.has(tok) && !DELIM_FREE_WRAPPERS.has(tok.type)) survivorDepth += tok.nesting;
  }
  if (survivorDepth > 0) {
    poisonSpan(after, aStart, aEnd, { rule, reason: "rewrote content inside a surviving container" }, env);
    return;
  }

  // Type guard: an inline-level replacement outside a region would be
  // absorbed at an illegal block position. Inside a region the atom
  // swallows it whole, so regions are exempt.
  if (!cand.region) {
    for (let i = aStart; i < aEnd; i++) {
      if (INLINE_LEVEL_TYPES.has(after[i]!.type)) {
        poisonSpan(
          after,
          aStart,
          aEnd,
          { rule, reason: "inserted inline-level tokens at block position" },
          env,
        );
        return;
      }
    }
  }

  const id = nextRegionId++;
  for (let i = aStart; i < aEnd; i++) {
    const stamp: GpCoreHunkStamp = { id, range: [rangeStart, rangeEnd], rule };
    // Re-stamping by a later rule overwrites with its merged range; a real
    // `map` is never touched (survivors keep theirs beside the stamp).
    writeMetaKey(after[i]!, GP_CORE_HUNK, stamp, true);
  }
}
