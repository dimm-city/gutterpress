/**
 * markdown -> ProseMirror doc, using GUTTERPRESS'S OWN markdown-it instance.
 *
 * This is configuration, not a converter. `prosemirror-markdown`'s
 * `MarkdownParser` is designed to tokenize with a markdown-it instance you
 * supply and map the resulting tokens through `ParseSpec` entries — and it
 * declares `markdown-it: ^14`, the same major the CLI ships. So the editor
 * parses with the identical pipeline that prints: same plugins, same
 * `markers.js`. There is no second markdown dialect anywhere in the product,
 * which is the property ADR 0009 was protecting when it warned against a
 * second parser. One deliberate divergence: `typographer`/`linkify` are
 * flipped off for the duration of each doc-model parse (see `parse()` below)
 * — they rewrite TEXT, not structure, and a doc model built from their
 * output writes `’`/`“”`/`–` and linkified URLs back into the author's file.
 *
 * FAIL CLOSED. `MarkdownParser` throws on a token type it has no spec for
 * ("Token type `x` not supported by Markdown parser"). That is exactly the
 * preflight semantics we want, and it is the library's behaviour rather than
 * a list we have to remember to maintain: footnotes, definition lists and the
 * sub/sup/mark/abbr plugin set all raise, so a file using them opens in
 * SOURCE mode instead of being silently mis-serialized.
 */
import { MarkdownParser, type ParseSpec } from "prosemirror-markdown";
import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type { Mark, Node as PMNode } from "prosemirror-model";
import { gutterpressSchema } from "./schema";
import { authoredBlockAttrs, extraAttrs } from "./attrs";

/** The adoption payload `adoptPluginTokens` stashes on a rewritten token. */
interface PluginPayload {
  marker: string;
  closeMarker?: string;
  tag: string;
  viewAttrs: Record<string, string> | null;
  text?: string;
}

function pluginPayload(tok: Token): PluginPayload {
  return (tok.meta as { gpPlugin: PluginPayload }).gpPlugin;
}

/**
 * Core-rule transform provenance, written by the cli differ
 * (`plugin-provenance.ts`, `withCoreRuleProvenance`) and read here as literal
 * meta keys — the same convention as `gpEditorLines` below: the browser
 * bundle reads token meta directly rather than importing constants through
 * `gutterpress/render`.
 *
 * `gpCoreHunk` marks every token of a RECOVERABLE transform region — the
 * synthesized replacements AND the survivors the region swallowed (those
 * keep their real `map` beside the stamp). `range` has `token.map`
 * semantics: 0-based, half-open. `gpCorePoison` marks a transform whose
 * authored source could not be attributed; the parse must refuse on it.
 */
interface CoreHunkStamp {
  id: number;
  range: [number, number];
  rule: string;
}

function coreHunkOf(tok: Token): CoreHunkStamp | undefined {
  const hunk = (tok.meta as { gpCoreHunk?: unknown } | null)?.gpCoreHunk as
    | { id?: unknown; range?: unknown; rule?: unknown }
    | null
    | undefined;
  if (!hunk || typeof hunk !== "object") return undefined;
  return typeof hunk.id === "number" &&
    Array.isArray(hunk.range) &&
    hunk.range.length === 2 &&
    typeof hunk.rule === "string"
    ? (hunk as CoreHunkStamp)
    : undefined;
}

/** Presence of EITHER key, well-formed or not — the fail-closed predicate. */
function hasCoreProvenance(tok: Token): boolean {
  const meta = tok.meta as Record<string, unknown> | null;
  return (
    meta != null && typeof meta === "object" && ("gpCoreHunk" in meta || "gpCorePoison" in meta)
  );
}

/** The refusal sentence for an unattributable core-rule transform. */
function corePoisonError(rule: string, reason: string): Error {
  return new Error(
    `The plugin rule \`${rule}\` ${reason}, so this file can't be edited richly.`,
  );
}

/**
 * The env key the cli differ writes when a refusal has NO token carrier —
 * a transform consumed the entire document to nothing, so there is no
 * surviving neighbor for `gpCorePoison` to sit on. Read as a literal string,
 * like the meta keys above (the browser bundle never imports constants
 * through `gutterpress/render`). Value shape: `{ rule, reason }`.
 */
const GP_CORE_POISON_ORPHAN = "gpCorePoisonOrphan";

/**
 * Refuse a parse whose poison has no token to ride on.
 *
 * Without this, a transform that eats the whole document reads as an EMPTY
 * FILE: the doc model parses to nothing and a save would wipe the author's
 * bytes. Two independent checks, both fail closed: the differ's orphan
 * stamp (which names the rule), and — in case the stream reached us empty
 * through a path the differ never saw — a bare "non-blank source, zero
 * tokens" refusal.
 */
function raiseOnOrphanPoison(env: Record<string, unknown>, src: string, tokens: Token[]): void {
  const orphan = env[GP_CORE_POISON_ORPHAN] as
    | { rule?: unknown; reason?: unknown }
    | null
    | undefined;
  if (orphan != null && typeof orphan === "object") {
    throw corePoisonError(
      typeof orphan.rule === "string" ? orphan.rule : "(unknown rule)",
      typeof orphan.reason === "string"
        ? orphan.reason
        : "rewrote content whose source can't be recovered",
    );
  }
  if (tokens.length === 0 && src.trim() !== "") {
    throw new Error(
      "a plugin transform consumed this file's entire content, so this file can't be edited richly",
    );
  }
}

/**
 * Refuse a token stream carrying `gpCorePoison` — BEFORE any adoption pass.
 *
 * Poison marks a plugin core-rule transform whose authored source the differ
 * could not attribute. It is meta-only, so every render path (preview,
 * semantic gates) is pixel-identical; the editor's parse is the one consumer
 * that must act on it, and it must act first — adopting or dropping the
 * tokens would silently damage the author's file. Like the
 * `referenceLabels` raise in `parse()`, this is an explicit check because
 * the library's own failure would name a token type, not the plugin rule
 * the author needs to hear about. Every token is scanned, not just
 * synthesized ones: a consumed-to-nothing transform leaves no inserted
 * token, so its poison sits on the nearest SURVIVING neighbor — often a
 * plain mapped `paragraph_open`.
 */
function raiseOnPoison(tokens: Token[]): Token[] {
  for (const tok of tokens) {
    const poison = (tok.meta as { gpCorePoison?: unknown } | null)?.gpCorePoison as
      | { rule?: unknown; reason?: unknown }
      | null
      | undefined;
    if (poison == null) continue;
    throw corePoisonError(
      typeof poison.rule === "string" ? poison.rule : "(unknown rule)",
      typeof poison.reason === "string"
        ? poison.reason
        : "rewrote content whose source can't be recovered",
    );
  }
  return tokens;
}

/**
 * Adopt a core-rule transform's stamped region as ONE verbatim atom.
 *
 * The differ stamps every token of a recoverable region with the same
 * `gpCoreHunk` id and the authored line range the transform consumed. The
 * whole span — synthesized wrappers, swallowed survivors, replaced inlines —
 * collapses to a single `plugin_atom` carrying `lines.slice(start, end)`
 * verbatim, which is all the serializer ever writes back; the pipeline
 * regenerates the transform's output from those lines on every render.
 *
 * This must run FIRST among the adoption passes: `adoptHtmlWrappers` would
 * otherwise pair a transform's lone-tag wrappers and write the SYNTHESIZED
 * HTML into the author's file as the marker — materializing generated
 * markup, the exact failure provenance exists to prevent.
 *
 * Contiguity is verified, never assumed: every token between a region's
 * first and last member must carry the same id, or be a survivor whose
 * `map` lies inside the region's range (swallowed with it). A gap means a
 * stamp write was skipped (frozen meta) or the region was torn —
 * unattributable, so it converts to poison and raises (fail closed).
 *
 * The map-within-range test applies to SAME-ID members too: a swallowed
 * survivor keeps its real `map` beside the stamp, and if that map lies
 * outside the stamped range the range is too narrow — `lines.slice` would
 * silently truncate the survivor's authored lines out of the atom. Same
 * verdict as a gap: unattributable, poison, refuse.
 */
/**
 * A converted core region that might be half of a wrapper PAIR (phase 2 of
 * the provenance plan): a single synthesized `html_block` whose content is
 * one lone open/close tag. Recorded during the region scan and matched
 * afterwards by {@link pairCoreWrapperRegions}. `at` indexes the OUTPUT
 * array (later conversions only append, so earlier indices stay valid).
 */
/** One wrapper half a transform's synthesized output amounts to. */
type WrapperOp =
  | { kind: "open"; tag: string; attrs: Record<string, string> }
  | { kind: "close"; tag: string };

/** A region's wrapper halves, plus any generated markup that sits INSIDE the
 *  last wrapper it opens (shown in the view, never written back). */
type WrapperOps = { ops: WrapperOp[]; generated: string | null };

type CoreWrapperCandidate =
  | {
      at: number;
      kind: "open";
      tag: string;
      attrs: Record<string, string>;
      marker: string;
      generated: string | null;
    }
  | { at: number; kind: "close"; tag: string; marker: string }
  /**
   * A region whose synthesized output is NOTHING BUT lone tags, closing some
   * wrappers and opening others at one point in the document (phase 2.5).
   *
   * This is what adjacent marker paragraphs produce: `@end-lede` + `@toc` are
   * one differ hunk, and the transform's output for it is `</div>` followed by
   * `<div class="dc-toc">`. The region can therefore close the lede and open
   * the TOC — and it must, or every chained component in the book (the field
   * guide's TOC, its `@definition` runs, its `@gear` cards: 51 regions against
   * 40 that pair as single tags) renders unstyled in the editor while print
   * shows the box.
   *
   * What it must NOT do is guess WHICH authored line produced which tag —
   * that attribution does not exist in the record, and getting it wrong would
   * write the author's markers back in the wrong order. So the region's lines
   * stay ONE undivided string, written by the first wrapper the boundary
   * emits; the rest write nothing. The bytes are identical to the atom form
   * either way; only the nesting changes.
   */
  | {
      at: number;
      kind: "boundary";
      ops: WrapperOp[];
      marker: string;
      generated: string | null;
    }
  /**
   * An opaque region — one holding survivors, or synthesized content that is
   * not purely lone tags. It may CONTAIN the real closer for an earlier
   * opener, so nothing may pair across it: measured on chapter-00, tag-name
   * matching across such an atom nested the whole TOC inside the lede's
   * `dc-intro` box.
   */
  | { at: number; kind: "barrier" };

/**
 * Upgrade matched open/close core-region atoms into ONE `gp_plugin_block`
 * pair, so the editor renders the plugin's real tag + classes AROUND the
 * editable content between the markers (the book's own stylesheet then
 * applies in-view) instead of two labeled atoms with plain flow between.
 *
 * Pairing is deterministic from the transform's own output — the synthesized
 * tag names, nearest-unclosed (the same discipline `adoptHtmlWrappers` uses
 * for authored wrappers) — and STRICTLY view-level: a paired block
 * serializes `marker` + content + `closeMarker` exactly as the two atoms
 * plus the content between them would, so the bytes written back are
 * identical either way. Every rejection therefore fails SOFT to the atom
 * form, never to a refusal: an unmatched tag, an empty pair (`block+`
 * content would be violated), or between-content whose token nesting is
 * unbalanced (the pair would not sit at one level of the tree) simply stays
 * two atoms.
 */
function pairCoreWrapperRegions(tokens: Token[], cands: CoreWrapperCandidate[]): Token[] {
  /** An open wrapper waiting for its close, and where its token sits. */
  type Pending = { at: number; tag: string; attrs: Record<string, string>; marker: string; emit: Emission };
  /** One wrapper half a candidate will actually emit, once matching is known. */
  type Emission = { cand: CoreWrapperCandidate; index: number; role: "open" | "close"; open?: Pending };

  const stack: Pending[] = [];
  /**
   * Opens that never got a close, or whose span turned out unbalanced. They
   * emit NOTHING — an open wrapper with no close would leave the token stream
   * unbalanced and the document model would fail to build. Every path that
   * abandons a pending open has to come through here.
   */
  const abandoned = new Set<Emission>();
  const abandon = (from: number) => {
    for (const p of stack.slice(from)) abandoned.add(p.emit);
    stack.length = from;
  };
  /** Per candidate (by `at`), the wrapper halves it emits, in order. */
  const emissions = new Map<number, Emission[]>();
  const record = (cand: CoreWrapperCandidate, e: Emission) => {
    const list = emissions.get(cand.at) ?? [];
    list.push(e);
    emissions.set(cand.at, list);
  };

  /** Can a block spanning `from`…`to` sit at one level of the tree? */
  const spanIsBalanced = (from: number, to: number): boolean => {
    if (to - from <= 1) return false; // empty pair — `block+` needs content
    let depth = 0;
    for (let i = from + 1; i < to; i++) {
      const between = tokens[i]!;
      // An AUTHORED lone-tag html_block between the markers is an
      // adoptHtmlWrappers candidate whose own pair may cross this one's
      // boundary (its nesting is still 0 here — that pass runs later, so the
      // balance sum below cannot see it). Fail soft rather than build a
      // block a later pass can splice across.
      if (
        between.type === "html_block" &&
        (loneOpenTag(between.content) !== null || loneCloseTag(between.content) !== null)
      ) {
        return false;
      }
      depth += between.nesting;
      if (depth < 0) return false;
    }
    return depth === 0;
  };

  /** Close the nearest unclosed `tag`, or report that nothing matched. */
  const closeNearest = (tag: string, at: number, cand: CoreWrapperCandidate, index: number): boolean => {
    let pos = -1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]!.tag === tag) { pos = i; break; }
    }
    if (pos === -1) return false;
    const open = stack[pos]!;
    // Anything opened INSIDE the match and never closed stays an atom; the
    // match itself is popped without being abandoned — it is about to pair.
    abandon(pos + 1);
    stack.length = pos;
    if (!spanIsBalanced(open.at, at)) {
      abandoned.add(open.emit);
      return false;
    }
    record(cand, { cand, index, role: "close", open });
    return true;
  };

  for (const cand of cands) {
    if (cand.kind === "barrier") {
      abandon(0);
      continue;
    }
    if (cand.kind === "open") {
      const emit: Emission = { cand, index: 0, role: "open" };
      record(cand, emit);
      stack.push({ at: cand.at, tag: cand.tag, attrs: cand.attrs, marker: cand.marker, emit });
      continue;
    }
    if (cand.kind === "close") {
      closeNearest(cand.tag, cand.at, cand, 0);
      continue;
    }
    // A boundary: close what it closes, then open what it opens. A close that
    // matches nothing simply does not become a wrapper — the region keeps its
    // atom bytes and the surrounding text stays unwrapped, never mis-nested.
    let index = 0;
    for (const op of cand.ops) {
      if (op.kind === "close") {
        if (closeNearest(op.tag, cand.at, cand, index)) index++;
      } else {
        const emit: Emission = { cand, index, role: "open" };
        record(cand, emit);
        stack.push({ at: cand.at, tag: op.tag, attrs: op.attrs, marker: cand.marker, emit });
        index++;
      }
    }
  }

  // Opens still pending at the end never closed either.
  abandon(0);

  // ── apply ────────────────────────────────────────────────────────────────
  // Only now is it known how many wrappers each candidate emits, so the token
  // array is rebuilt: a candidate that emits none keeps its atom, and one that
  // emits several replaces its atom with that many wrapper tokens. The
  // authored lines ride the FIRST wrapper emitted (a close writes them after
  // its block's content, an open before — either way exactly where the atom
  // would have written them, exactly once).
  const out: Token[] = [];
  /** The token each emitted half became, so a close can reach its open. */
  const emitted = new Map<Emission, Token>();
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const list = (emissions.get(i) ?? []).filter(
      (e) => !(e.role === "open" && abandoned.has(e)),
    );
    if (list.length === 0) {
      out.push(tok);
      continue;
    }
    const marker = markerOf(tok);
    list.sort((a, b) => a.index - b.index);
    for (const [n, e] of list.entries()) {
      // The atom token becomes the first wrapper; any further halves are new
      // tokens (they carry no authored bytes of their own).
      const t = n === 0 ? tok : wrapperToken(tok);
      const mine = n === 0 ? marker : "";
      if (e.role === "close") {
        t.type = "plugin_block_close";
        t.nesting = -1;
        t.meta = null;
        const payload = (emitted.get(e.open!.emit)?.meta as
          | { gpPlugin?: Record<string, unknown> }
          | null
          | undefined)?.gpPlugin;
        if (payload) payload.closeMarker = mine;
      } else {
        const op = e.cand.kind === "boundary" ? e.cand.ops[e.index]! : null;
        const tag = op ? op.tag : (e.cand as { tag: string }).tag;
        const attrs =
          op && op.kind === "open"
            ? op.attrs
            : ((e.cand as { attrs?: Record<string, string> }).attrs ?? {});
        t.type = "plugin_block_open";
        t.nesting = 1;
        t.meta = {
          gpPlugin: {
            marker: mine,
            closeMarker: "",
            tag,
            viewAttrs: Object.keys(attrs).length > 0 ? attrs : null,
          },
        };
      }
      emitted.set(e, t);
      out.push(t);
      // Markup the transform wrote INSIDE the wrapper it just opened (the
      // alert's label span). It rides the last open the region emits, is
      // rendered like every other generated node, and serializes to nothing.
      const generated = n === list.length - 1 ? generatedOf(e.cand) : null;
      if (generated && e.role === "open") out.push(generatedToken(t, generated));
    }
  }
  return out;
}

/** The authored lines an adopted region carries. */
function markerOf(tok: Token): string {
  const payload = (tok.meta as { gpPlugin?: { marker?: unknown } } | null)?.gpPlugin;
  return typeof payload?.marker === "string" ? payload.marker : "";
}

/** The markup a candidate carries inside its last opened wrapper, if any. */
function generatedOf(cand: CoreWrapperCandidate): string | null {
  return cand.kind === "open" || cand.kind === "boundary" ? cand.generated : null;
}

/** A `gp_generated` token — shown in the view, never written back. */
function generatedToken(like: Token, html: string): Token {
  const t = wrapperToken(like);
  t.type = "gp_generated";
  t.nesting = 0;
  t.content = html;
  return t;
}

/** A further wrapper token for a boundary that emits more than one half. */
function wrapperToken(like: Token): Token {
  const Ctor = (like as unknown as { constructor: new (t: string, g: string, n: number) => Token })
    .constructor;
  const t = new Ctor("plugin_block_open", "", 1);
  t.block = true;
  return t;
}

function adoptCoreRegions(tokens: Token[], lines: string[]): Token[] {
  let out: Token[] | null = null;
  const wrapperCands: CoreWrapperCandidate[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (!hasCoreProvenance(tok)) {
      out?.push(tok);
      continue;
    }
    const stamp = coreHunkOf(tok);
    // A malformed stamp cannot be attributed, and letting the token flow on
    // would end with its synthesized content absorbed as authored HTML.
    if (!stamp) throw corePoisonError("(unknown rule)", "rewrote content whose source can't be recovered");

    let end = i;
    for (let j = i + 1; j < tokens.length; j++) {
      if (coreHunkOf(tokens[j]!)?.id === stamp.id) end = j;
    }
    const [start, stop] = stamp.range;
    for (let j = i; j <= end; j++) {
      const member = tokens[j]!;
      const map = member.map;
      const inRange = map != null && start <= map[0]! && map[1]! <= stop;
      if (coreHunkOf(member)?.id === stamp.id) {
        // Same-id member: a synthesized replacement carries no map and is
        // fine; a swallowed survivor keeps its real map beside the stamp,
        // and that map OUTSIDE the range means the stamp is too narrow —
        // the slice below would truncate the survivor's authored lines.
        if (map == null || inRange) continue;
      } else if (inRange) {
        // Unstamped survivor swallowed with the region.
        continue;
      }
      // Convert the tear to poison, then refuse immediately — defense in
      // depth for any caller that catches and re-reads the stream.
      const meta = member.meta as Record<string, unknown> | null;
      if (meta == null) {
        member.meta = { gpCorePoison: { rule: stamp.rule, reason: "rewrote content whose source can't be recovered" } };
      } else if (typeof meta === "object" && Object.isExtensible(meta) && !("gpCorePoison" in meta)) {
        meta.gpCorePoison = { rule: stamp.rule, reason: "rewrote content whose source can't be recovered" };
      }
      throw corePoisonError(stamp.rule, "rewrote content whose source can't be recovered");
    }

    const marker = lines.slice(start, stop).join("\n");
    // Classify BEFORE overwriting the token: a region whose synthesized output
    // is nothing but lone tags can become wrappers after the scan (phase 2 for
    // one tag, phase 2.5 for a close/open boundary). A region holding
    // survivors or any non-tag markup stays an opaque atom, and nothing may
    // pair across it.
    const ops = wrapperOps(tokens, i, end, stamp.id);
    tok.type = "plugin_atom";
    tok.nesting = 0;
    tok.block = true;
    tok.meta = {
      ...(tok.meta as Record<string, unknown> | null),
      gpPlugin: { marker, tag: "div", viewAttrs: null, text: marker },
    };
    if (!out) out = tokens.slice(0, i);
    out.push(tok);
    const at = out.length - 1;
    const first = ops?.ops[0];
    if (!ops || !first) {
      wrapperCands.push({ at, kind: "barrier" });
    } else if (ops.ops.length === 1 && first.kind === "open") {
      wrapperCands.push({
        at,
        kind: "open",
        tag: first.tag,
        attrs: first.attrs,
        marker,
        generated: ops.generated,
      });
    } else if (ops.ops.length === 1) {
      wrapperCands.push({ at, kind: "close", tag: first.tag, marker });
    } else {
      wrapperCands.push({ at, kind: "boundary", ops: ops.ops, marker, generated: ops.generated });
    }
    i = end;
  }
  const result = out ?? tokens;
  return wrapperCands.length > 0 ? pairCoreWrapperRegions(result, wrapperCands) : result;
}

/**
 * The wrapper halves a region's synthesized output amounts to, or null if the
 * region is not purely wrappers.
 *
 * Ground truth, not inference: these are the tags the TRANSFORM ITSELF wrote,
 * read in emission order. A region qualifies only when every member is a
 * synthesized `html_block` and every line of every member is one lone tag —
 * a survivor, a tag with text beside it (the `dc-alert` label span), or
 * anything else disqualifies the whole region.
 *
 * The order must also be every close before every open. A boundary sits at
 * ONE point in the document, so `</a></b><c><d>` describes that point exactly
 * — while `<c></a>` would need the region's authored lines split across two
 * places, and which line went where is not recorded anywhere. Those stay
 * atoms.
 */
function wrapperOps(tokens: Token[], from: number, to: number, id: number): WrapperOps | null {
  const ops: WrapperOp[] = [];
  const lines: string[] = [];
  for (let i = from; i <= to; i++) {
    const member = tokens[i]!;
    if (coreHunkOf(member)?.id !== id) return null; // a swallowed survivor
    if (member.type !== "html_block") return null;
    for (const line of member.content.split("\n")) if (line.trim()) lines.push(line);
  }
  if (lines.length === 0) return null;

  let i = 0;
  for (; i < lines.length; i++) {
    const opened = loneOpenTag(lines[i]!);
    if (opened) {
      ops.push({ kind: "open", tag: opened.tag, attrs: opened.attrs });
      continue;
    }
    const closed = loneCloseTag(lines[i]!);
    if (!closed) break;
    ops.push({ kind: "close", tag: closed });
  }
  const rest = lines.slice(i);
  if (rest.length > 0) {
    // Markup that is not a lone tag ends the wrapper run. It can only be the
    // INSIDE of what those tags just opened (an unclosed `<div>` is still
    // open, so everything after it is within it) — the `dc-alert` label span
    // is the real case. So it is kept as generated content in the first
    // wrapper, shown and never written back. That holds only while nothing
    // in the remainder closes a wrapper again: a `</div>` further down would
    // mean part of this region sits OUTSIDE the boxes, and where the author's
    // lines belong then is not recorded. Those regions stay atoms.
    if (ops.length === 0 || ops.some((o) => o.kind === "close")) return null;
    if (rest.some((l) => loneOpenTag(l) !== null || loneCloseTag(l) !== null)) return null;
  }
  const firstOpen = ops.findIndex((o) => o.kind === "open");
  if (firstOpen !== -1 && ops.slice(firstOpen).some((o) => o.kind === "close")) return null;
  return { ops, generated: rest.length > 0 ? rest.join("\n") + "\n" : null };
}

/**
 * SOURCE-COORDINATE attributes: editor/preview plumbing, not part of the
 * book's rendering, so they are stripped from the view attributes carried
 * into the editing DOM.
 *
 * `data-chapter-label` deliberately is NOT in this list, though the pipeline
 * generates it too: it is an attribute books STYLE AGAINST (the frozen
 * chapter-opener composite selects on it), so dropping it made the editor
 * render a book differently from its own print output. The test is not "did
 * the pipeline add it" but "does print lay out with it".
 */
const SOURCE_COORD_ATTRS = /^(data-source-range|data-source-line)$/;

function viewAttrsOf(tok: Token): Record<string, string> | null {
  if (!tok.attrs || tok.attrs.length === 0) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of tok.attrs) {
    if (!SOURCE_COORD_ATTRS.test(key)) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Adopt a PROJECT PLUGIN's block tokens onto the generic plugin nodes.
 *
 * Plugins are plain markdown-it plugins whose token types this product
 * cannot enumerate (CLAUDE.md §5) — but their branded markers follow the
 * marker-family shape: a block-level `X_open`/`X_close` pair, or a
 * self-closing block atom, whose authored lines this pass recovers and
 * stores verbatim on `plugin_block` / `plugin_atom` — which is ALL the
 * serializer ever writes back. Recovery sources, in order:
 *
 *   1. `token.map` — the standard carrier, when the plugin set it.
 *   2. `token.meta.gpEditorLines` — the range the plugin's own block rule
 *      actually consumed, stamped at registration by the core pipeline
 *      (`plugin-provenance.ts`). This is what frees adoption from caring
 *      how each plugin was written: house-style tokens (`meta.line`, `map`
 *      deliberately null per ADR 0009) and container-style closes (no map,
 *      pushed after the rule advanced) both recover exactly. Open markers
 *      read the range's first line; close markers read its last.
 *   3. `token.markup` — last resort; only right when the authored line IS
 *      the markup (e.g. a bare `:::`).
 *
 * Everything it cannot recover it leaves untouched, and the parser then
 * raises on the unknown type — the fail-closed guard is unchanged, it just
 * no longer fires for well-formed plugin markers. A token synthesized by a
 * core rule (`new state.Token`) passed through no block rule, carries no
 * stamp, and still fails closed. Inline unknowns are never adopted: they
 * have no authored line of their own to recover.
 */
function adoptPluginTokens(tokens: Token[], lines: string[], handled: Set<string>): Token[] {
  const stampOf = (tok: Token): [number, number] | undefined => {
    const range = (tok.meta as { gpEditorLines?: unknown } | null)?.gpEditorLines;
    return Array.isArray(range) && range.length === 2 ? (range as [number, number]) : undefined;
  };
  /**
   * One authored marker line, plus WHICH line it is when that is knowable
   * (`map`/stamp yes, bare `markup` no). `edge` picks the end of a stamped
   * range: an open marker is the first line its rule consumed, a close
   * marker the last. The index is what lets the pair handling below reason
   * about attribution instead of trusting text blindly.
   */
  const authoredRef = (
    tok: Token,
    edge: "first" | "last",
  ): { text: string; idx: number | undefined } | undefined => {
    let text: string | undefined;
    let idx: number | undefined;
    if (tok.map) {
      idx = tok.map[0];
    } else {
      const stamp = stampOf(tok);
      if (stamp) idx = edge === "first" ? stamp[0] : stamp[1] - 1;
      else text = tok.markup;
    }
    if (idx !== undefined) text = lines[idx];
    const trimmed = (text ?? "").trim();
    return trimmed ? { text: trimmed, idx } : undefined;
  };
  /** An atom's FULL authored source — its construct may span several lines. */
  const authoredBlock = (tok: Token): string | undefined => {
    const range = tok.map ?? stampOf(tok);
    const text = range ? lines.slice(range[0], range[1]).join("\n") : tok.markup;
    const trimmed = (text ?? "").trim();
    return trimmed || undefined;
  };

  const stack: Array<{ tok: Token; at: number }> = [];
  const dropped = new Set<Token>();
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (handled.has(tok.type)) continue;

    if (tok.type.endsWith("_open")) {
      stack.push({ tok, at: i });
      continue;
    }

    if (tok.type.endsWith("_close")) {
      const top = stack.pop();
      if (!top || top.tok.type.slice(0, -5) !== tok.type.slice(0, -6)) continue;
      const open = top.tok;
      const openRef = authoredRef(open, "first");
      const closeRef = authoredRef(tok, "last");
      if (!openRef || !closeRef) continue;

      if (openRef.idx !== undefined && openRef.idx === closeRef.idx) {
        // Both markers resolve to the SAME authored line: the construct is a
        // one-line pair (an empty wrapper from a single marker). Its source
        // form is that line, once — adopt it as an atom, or writing marker
        // AND closeMarker would duplicate the line on save. A one-line pair
        // that somehow holds children has no coherent source form; leave it
        // for the parser to refuse.
        if (i !== top.at + 1) continue;
        open.meta = {
          ...(open.meta as Record<string, unknown> | null),
          gpPlugin: { marker: openRef.text, tag: open.tag || "div", viewAttrs: viewAttrsOf(open), text: "" },
        };
        open.type = "plugin_atom";
        open.nesting = 0;
        dropped.add(tok);
        continue;
      }

      if (closeRef.idx !== undefined) {
        // The recovered close line must not already be owned by a child —
        // the shape an auto-closed container produces at EOF (its close
        // token's consumed range ends on the last CONTENT line, because
        // there is no terminator in the source). Writing that line as a
        // terminator would duplicate it. Ownership evidence is a child's
        // `map`, or a stamp TIGHTER than the close's own: a stamp identical
        // to the close's came from the same rule invocation (inner base
        // `_close` tokens are map-less, so the wrapper stamps them with its
        // whole range) and says nothing about the child itself.
        const ownStamp = tok.map ? undefined : stampOf(tok);
        const childRange = (child: Token): [number, number] | undefined => {
          if (child.map) return child.map;
          const stamp = stampOf(child);
          if (stamp && ownStamp && stamp[0] === ownStamp[0] && stamp[1] === ownStamp[1]) {
            return undefined;
          }
          return stamp;
        };
        const claimed = tokens.slice(top.at + 1, i).some((child) => {
          const range = childRange(child);
          return !!range && range[0] <= closeRef.idx! && closeRef.idx! < range[1];
        });
        if (claimed) continue;
      }

      open.meta = {
        ...(open.meta as Record<string, unknown> | null),
        gpPlugin: {
          marker: openRef.text,
          closeMarker: closeRef.text,
          tag: open.tag || "div",
          viewAttrs: viewAttrsOf(open),
        },
      };
      open.type = "plugin_block_open";
      tok.type = "plugin_block_close";
      continue;
    }

    if (tok.nesting === 0 && tok.block) {
      const marker = authoredBlock(tok);
      if (!marker) continue;
      tok.meta = {
        ...(tok.meta as Record<string, unknown> | null),
        gpPlugin: {
          marker,
          tag: tok.tag || "div",
          viewAttrs: viewAttrsOf(tok),
          text: tok.content || "",
        },
      };
      tok.type = "plugin_atom";
    }
  }
  return dropped.size ? tokens.filter((t) => !dropped.has(t)) : tokens;
}

/** `<div class="example">` → its tag and attributes; null if it is anything else. */
function loneOpenTag(html: string): { tag: string; attrs: Record<string, string> } | null {
  const m = /^<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*>$/.exec(
    html.trim(),
  );
  if (!m) return null;
  const attrs: Record<string, string> = {};
  const attrRe = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let a: RegExpExecArray | null;
  while ((a = attrRe.exec(m[2] ?? ""))) {
    attrs[a[1]!] = a[2] ?? a[3] ?? a[4] ?? "";
  }
  return { tag: m[1]!.toLowerCase(), attrs };
}

/** `</div>` → `div`; null if it is anything else. */
function loneCloseTag(html: string): string | null {
  const m = /^<\/([a-zA-Z][\w-]*)\s*>$/.exec(html.trim());
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Nest markdown that an author WRAPPED IN HTML, instead of flattening it.
 *
 * A book writes a component as an HTML wrapper with markdown inside:
 *
 *     <div class="example">
 *
 *     Body **markdown** here.
 *
 *     </div>
 *
 * markdown-it emits the two tags as separate `html_block` tokens with the
 * content between them as ordinary blocks (the blank lines are what make the
 * inside markdown at all). The editor modelled each tag as its own ATOM, so
 * the opening `<div>` rendered as an EMPTY element and the content became its
 * SIBLING — every style scoped to that wrapper stopped applying. Measured on
 * the design guide: text inside `div.sidebar` rendered at the body size
 * because, in the editing DOM, it was not inside `div.sidebar` at all.
 *
 * So a matched pair is adopted onto the same generic wrapper node the plugin
 * markers use: children nest inside it, the tag and its attributes drive the
 * rendered element, and the AUTHORED opening and closing lines are what the
 * serializer writes back — byte-for-byte, exactly as for a plugin marker.
 * Unmatched or exotic HTML (a self-contained element, an unbalanced tag) is
 * left as the atom it already was.
 *
 * Only AUTHORED HTML participates: both passes skip any token carrying
 * core-rule provenance (`gpCoreHunk`/`gpCorePoison`). A transform's
 * synthesized wrapper must adopt through its region (`adoptCoreRegions`) or
 * refuse — pairing it here would write the synthesized HTML into the
 * author's file as the marker, and the expansion pass's copies would drop
 * the stamp on the way.
 */
/** Tags that never have a closing partner, so they can never open a pair. */
const VOID_TAG = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;

/**
 * An authored inline HTML pair — `<a href="#ch-1">**Title**</a>` — adopted as
 * ONE mark, so the element WRAPS its text the way the printed page does.
 *
 * Without this the open tag, the text and the close tag are three siblings:
 * each raw tag is its own atom, and a nodeView setting `innerHTML` on the
 * first one produces an EMPTY `<a>` with the text beside it. Measured on the
 * field guide's contents page, that is exactly what happened — thirteen
 * entries whose `.dc-toc ol>li>a` styling matched an empty element while the
 * words next to it stayed body text.
 *
 * Pairing is nearest-unclosed by tag name, the same discipline the block
 * wrapper passes use, and every rejection falls back to today's atoms: an
 * unmatched tag, a void element, a pair with nothing between it (a mark over
 * no text would vanish, taking the author's tags with it), or a pair that
 * crosses another. The mark carries the authored strings verbatim and the
 * serializer writes those, so the bytes are unchanged either way; `tag` and
 * `attrs` exist only to build the element in the view.
 */
function adoptInlineHtmlPairs(tokens: Token[]): Token[] {
  for (const tok of tokens) {
    if (tok.type === "inline" && tok.children) pairInlineHtml(tok.children);
  }
  return tokens;
}

function pairInlineHtml(children: Token[]): void {
  const open: Array<{ tok: Token; tag: string; attrs: Record<string, string>; at: number }> = [];
  for (let i = 0; i < children.length; i++) {
    const tok = children[i]!;
    if (tok.type !== "html_inline") continue;
    const opened = loneOpenTag(tok.content);
    if (opened) {
      if (!VOID_TAG.test(opened.tag)) open.push({ tok, tag: opened.tag, attrs: opened.attrs, at: i });
      continue;
    }
    const closed = loneCloseTag(tok.content);
    if (!closed) continue;
    let pos = -1;
    for (let k = open.length - 1; k >= 0; k--) {
      if (open[k]!.tag === closed) { pos = k; break; }
    }
    if (pos === -1) continue;
    const match = open[pos]!;
    // Anything opened inside the match and never closed stays an atom.
    open.length = pos;
    if (i - match.at <= 1) continue; // nothing between — a mark would vanish
    match.tok.type = "raw_html_open";
    match.tok.nesting = 1;
    match.tok.meta = {
      ...(match.tok.meta as Record<string, unknown> | null),
      gpRawHtml: {
        tag: match.tag,
        attrs: Object.keys(match.attrs).length > 0 ? match.attrs : null,
        open: match.tok.content,
        close: tok.content,
      },
    };
    tok.type = "raw_html_close";
    tok.nesting = -1;
  }
}

function adoptHtmlWrappers(tokens: Token[]): Token[] {
  // markdown-it consumes CONSECUTIVE tag lines into one html_block, and books
  // open a component with several at once:
  //
  //     <div class="example">
  //     <div class="sidebar">
  //
  // One token cannot become two wrapper nodes, so a block that is nothing but
  // tag lines is expanded into one token per tag first. Any block with real
  // content in it is left exactly as it was.
  const expanded: Token[] = [];
  for (const tok of tokens) {
    const lines =
      tok.type === "html_block" && !hasCoreProvenance(tok)
        ? tok.content.split("\n").map((l) => l.trim()).filter(Boolean)
        : [];
    if (
      lines.length > 1 &&
      lines.every((l) => loneOpenTag(l) !== null || loneCloseTag(l) !== null)
    ) {
      for (const line of lines) {
        const copy = new (tok.constructor as new (t: string, g: string, n: number) => Token)(
          "html_block",
          "",
          0,
        );
        copy.content = `${line}\n`;
        copy.block = true;
        copy.map = tok.map;
        expanded.push(copy);
      }
      continue;
    }
    expanded.push(tok);
  }
  tokens = expanded;

  const open: Array<{ tok: Token; tag: string; attrs: Record<string, string> }> = [];
  for (const tok of tokens) {
    if (tok.type !== "html_block" || hasCoreProvenance(tok)) continue;

    const closes = loneCloseTag(tok.content);
    if (closes) {
      // Match the NEAREST unclosed tag of this name; anything opened inside
      // it never got a close, so it stays the atom it already was.
      let pos = -1;
      for (let i = open.length - 1; i >= 0; i--) {
        if (open[i]!.tag === closes) { pos = i; break; }
      }
      if (pos === -1) continue;
      const entry = open[pos]!;
      open.length = pos;

      entry.tok.type = "plugin_block_open";
      entry.tok.meta = {
        ...(entry.tok.meta as Record<string, unknown> | null),
        gpPlugin: {
          marker: entry.tok.content.trim(),
          closeMarker: tok.content.trim(),
          tag: entry.tag,
          viewAttrs: Object.keys(entry.attrs).length > 0 ? entry.attrs : null,
        },
      };
      tok.type = "plugin_block_close";
      continue;
    }

    const opened = loneOpenTag(tok.content);
    if (opened) open.push({ tok, tag: opened.tag, attrs: opened.attrs });
  }
  return tokens;
}

/** `listIsTight`, which prosemirror-markdown keeps private. */
function listIsTight(tokens: readonly Token[], i: number): boolean {
  while (++i < tokens.length) {
    const t = tokens[i]!;
    if (t.type !== "list_item_open") return t.hidden;
  }
  return false;
}

function alignOf(token: Token): string | null {
  const style = token.attrGet("style") ?? "";
  const m = /text-align:\s*(left|right|center)/.exec(style);
  return m ? m[1]! : null;
}

/**
 * A parser bound to one markdown-it instance.
 *
 * `parse()` records the source lines first so the layout specs can read back
 * the AUTHORED marker line verbatim (see `schema.ts` on why the marker cannot
 * be reconstructed from the token's attributes).
 */
export function createDocParser(md: MarkdownIt) {
  let lines: string[] = [];

  /**
   * The authored marker line, plus the classes `markers.js` derived from it.
   *
   * The class list is view-only (see `schema.ts`) — it is what lets the
   * editing surface emit the same `.page` / `.section` / author-utility DOM
   * the print path emits, so the book's own stylesheet applies unchanged.
   * Only `marker` is ever serialized back.
   */
  const marker = (tok: Token) => {
    const line = (tok.meta as { line?: number } | null)?.line;
    const viewAttrs = viewAttrsOf(tok);
    if (viewAttrs) delete viewAttrs.class;
    return {
      marker: typeof line === "number" ? (lines[line - 1] ?? "") : "",
      class: tok.attrGet("class") ?? "",
      // The author's `#id` and anything else the marker set — view-only, the
      // same as `class`; only `marker` is ever serialized back.
      viewAttrs: viewAttrs && Object.keys(viewAttrs).length > 0 ? viewAttrs : null,
    };
  };

  const specs: Record<string, ParseSpec> = {
    // ── standard markdown ────────────────────────────────────────────────
    blockquote: { block: "blockquote" },
    // Paragraph braces are block-END attrs on the LAST source line — headings
    // read their first line because they are single-line constructs. The
    // whitespace test is the binding rule: `){.x}` touches the image/link and
    // belongs to IT (that node's own `extraAttrs` already carries it), while
    // `) {.x}` belongs to the paragraph; claiming both wrote the same braces
    // twice and moved the image's class onto the paragraph.
    paragraph: {
      block: "paragraph",
      getAttrs: (tok) => {
        const line = tok.map ? lines[tok.map[1] - 1] : undefined;
        return {
          attrs: line && /\s\{[^{}]*\}\s*$/.test(line) ? authoredBlockAttrs(line) : null,
        };
      },
    },
    list_item: { block: "list_item" },
    bullet_list: {
      block: "bullet_list",
      getAttrs: (tok, tokens, i) => ({
        tight: listIsTight(tokens, i),
        // The authored bullet character — a marker change is the only thing
        // that splits adjacent lists, so it must survive the round trip
        // (see schema.ts `withBullet`).
        bullet: tok.markup === "-" || tok.markup === "+" ? tok.markup : "*",
      }),
    },
    ordered_list: {
      block: "ordered_list",
      getAttrs: (tok, tokens, i) => ({ order: +(tok.attrGet("start") ?? 1) || 1, tight: listIsTight(tokens, i) }),
    },
    // Heading and fence attrs are read from the SOURCE line, not the token:
    // a plugin's token transform may decorate tokens freely (the fixture's
    // adds `.fm-h2` to every h2), and token-derived attrs wrote that
    // decoration back into the author's file. See `authoredBlockAttrs`.
    heading: {
      block: "heading",
      getAttrs: (tok) => ({
        level: +tok.tag.slice(1),
        attrs: authoredBlockAttrs(tok.map ? lines[tok.map[0]] : undefined),
      }),
    },
    code_block: { block: "code_block", noCloseToken: true },
    fence: {
      block: "code_block",
      getAttrs: (tok) => ({
        params: tok.info || "",
        attrs: authoredBlockAttrs(tok.map ? lines[tok.map[0]] : undefined),
      }),
      noCloseToken: true,
    },
    hr: {
      node: "horizontal_rule",
      // `---{.column-break}` — a leaf line, so any braces on it are its own.
      getAttrs: (tok) => ({
        attrs: authoredBlockAttrs(tok.map ? lines[tok.map[0]] : undefined),
      }),
    },
    image: {
      node: "image",
      getAttrs: (tok) => ({
        src: tok.attrGet("src"),
        title: tok.attrGet("title") || null,
        alt: (tok.children?.[0] && tok.children[0].content) || null,
        // `{.gp-bleed}` and friends. Dropping these silently destroyed image
        // positioning in a book — see attrs.ts.
        attrs: extraAttrs(tok, "image"),
      }),
    },
    hardbreak: { node: "hard_break" },
    em: { mark: "em" },
    strong: { mark: "strong" },
    link: {
      mark: "link",
      getAttrs: (tok) => ({
        href: tok.attrGet("href"),
        title: tok.attrGet("title") || null,
        // `{target="_blank"}` / `{.external}` — see attrs.ts.
        attrs: extraAttrs(tok, "link"),
      }),
    },
    code_inline: { mark: "code", noCloseToken: true },
    s: { mark: "strikethrough" },

    // ── tables (markdown-it emits GFM tables by default) ─────────────────
    table: { block: "table" },
    thead: { block: "table_head" },
    tbody: { block: "table_body" },
    tr: { block: "table_row" },
    // `getAttrs` must return the attribute OBJECT, not a bare value. An
    // earlier `alignOf as ParseSpec["getAttrs"]` cast returned the string
    // `"right"` instead of `{ align: "right" }`, and the cast silenced the
    // type error — so every table's column alignment was dropped on save
    // (`| ---: |` came back as `| --- |`). No casts here.
    th: { block: "table_header", getAttrs: (tok) => ({ align: alignOf(tok) }) },
    td: { block: "table_cell", getAttrs: (tok) => ({ align: alignOf(tok) }) },

    // ── Gutterpress layout markers ───────────────────────────────────────
    layout_chapter: { block: "gp_chapter", getAttrs: marker },
    layout_spread: { block: "gp_spread", getAttrs: marker },
    layout_page: { block: "gp_page", getAttrs: marker },
    layout_section: { block: "gp_section", getAttrs: marker },
    layout_page_break: { node: "gp_page_break", getAttrs: marker },
    layout_column_break: { node: "gp_column_break", getAttrs: marker },

    // ── pipeline-generated content: shown, never written back ────────────
    // Retagged from a map-less `html_block` by the editor renderer's
    // `editor_tag_generated` rule — see renderer.ts on why provenance, not a
    // list of known markup, is the discriminator.
    gp_generated: {
      node: "gp_generated",
      noCloseToken: true,
      getAttrs: (tok) => ({ html: tok.content }),
    },

    // ── raw HTML, carried verbatim ───────────────────────────────────────
    html_block: { node: "html_block", noCloseToken: true, getAttrs: (tok) => ({ html: tok.content }) },
    html_inline: { node: "html_inline", noCloseToken: true, getAttrs: (tok) => ({ html: tok.content }) },
    // A PAIRED authored tag: one mark around the text it wraps (see
    // `adoptInlineHtmlPairs`), not two atoms beside it.
    raw_html: {
      mark: "raw_html",
      getAttrs: (tok) => (tok.meta as { gpRawHtml?: Record<string, unknown> }).gpRawHtml ?? {},
    },

    // ── project-plugin markers, adopted generically ──────────────────────
    // Rewritten onto these types by `adoptPluginTokens` below — only when the
    // authored open/close lines are recoverable verbatim. `getAttrs` reads
    // the payload the adoption pass stashed on the open token.
    plugin_block: { block: "gp_plugin_block", getAttrs: (tok) => pluginPayload(tok) },
    plugin_atom: { node: "gp_plugin_atom", getAttrs: (tok) => pluginPayload(tok) },
  };

  /**
   * Token types the specs above give the parser a handler for. Anything NOT
   * in this set is a candidate for plugin adoption; anything that survives
   * adoption unadopted makes the parser raise (FAIL CLOSED, unchanged).
   */
  const handled = new Set<string>(["inline", "text", "softbreak"]);
  for (const [type, spec] of Object.entries(specs)) {
    if ((spec.block || spec.mark) && !spec.noCloseToken) {
      handled.add(`${type}_open`);
      handled.add(`${type}_close`);
    } else {
      handled.add(type);
    }
  }

  // The parser tokenizes through this facade so the refusal and adoption
  // passes see every token stream — `parse()`, and nothing else, is what
  // MarkdownParser calls. The order is load-bearing: the ORPHAN poison (a
  // refusal with no token to carry it — the stream may be empty) must be
  // read from env first, token-borne poison must refuse before anything
  // adopts, and core regions must collapse to atoms before
  // `adoptHtmlWrappers` could mistake their synthesized wrappers for
  // authored HTML.
  const tokenizer = {
    parse: (src: string, env: Record<string, unknown>) => {
      const tokens = md.parse(src, env);
      raiseOnOrphanPoison(env, src, tokens);
      return adoptInlineHtmlPairs(
        adoptPluginTokens(
          adoptHtmlWrappers(adoptCoreRegions(raiseOnPoison(tokens), lines)),
          lines,
          handled,
        ),
      );
    },
  };
  const parser = new MarkdownParser(gutterpressSchema, tokenizer as unknown as MarkdownIt, specs);

  // `prosemirror-markdown` closes a mark by TYPE — `markType.removeFromSet`
  // drops EVERY mark of that type. That is right for markdown's own marks
  // (emphasis cannot nest inside emphasis) and wrong for authored HTML, which
  // nests all the time: `<span><em>x</em> and y</span>` lost the span the
  // moment `</em>` closed, and " and y" came back outside it. Closing the
  // INNERMOST one is the whole fix, and there is no way to say that in the
  // token spec, so this one handler is replaced on our own parser instance.
  // Same-type marks keep insertion order in the set, so the last is innermost.
  (parser as unknown as { tokenHandlers: Record<string, (state: unknown) => void> }).tokenHandlers
    .raw_html_close = (state: unknown) => {
    const top = (state as { top(): { marks: readonly Mark[] } }).top();
    for (let i = top.marks.length - 1; i >= 0; i--) {
      if (top.marks[i]!.type.name === "raw_html") {
        top.marks = [...top.marks.slice(0, i), ...top.marks.slice(i + 1)];
        return;
      }
    }
  };

  return {
    /**
     * Throws on any construct the schema does not model — see FAIL CLOSED.
     *
     * That includes reference definitions, which are checked HERE rather than
     * in a caller-side preflight. They are the one construct markdown-it
     * consumes without emitting a token, so the library cannot raise on them
     * — and when the check lived only in `canEditRichly`, every other path
     * into a parse (`setContent` on an external reload, `applyRangeEdit`,
     * `isFixpoint`) silently used a WEAKER predicate and would have absorbed
     * a document whose `[ref]: url` lines then vanished on save. One choke
     * point, so no layer can hold a weaker verdict than another.
     */
    parse(text: string): PMNode {
      // Typographer and linkify run BEFORE the ProseMirror doc exists, so a
      // doc model built with them on bakes their output into the author's
      // bytes on save (`doesn't` -> `doesn’t`, a bare URL -> `<url>`) — and
      // both round-trip gates are blind to it by construction: the loss is
      // stable on the second pass (fixpoint holds) and render-identical
      // (semantic gate holds). So the doc model parses with both OFF; print
      // and preview keep them on. Flipping per parse on the SHARED instance
      // is sound in markdown-it 14: `smartquotes`, `replacements`, and both
      // linkify rules re-read `state.md.options` at run time, and the
      // default preset never disables the rules at construction —
      // markdown-it's "don't modify options on the fly" note is a
      // performance remark (rules stay registered), not a correctness bar.
      // A second typographer-less instance would be worse: every consumer
      // must hold the SAME instance (`$lib/editor/project-renderer`) or the
      // preflight could accept a file the mounted editor refuses, and it
      // would apply the project's plugins twice. The `finally` is the core
      // of the fix, not hygiene: throwing is the ROUTINE path through this
      // choke point (fail-closed refusals, the reference-definition raise
      // below), and a leaked `false` on the session-long instance would
      // quietly blind every later render, semantic gates included.
      // Everything between flip and restore is synchronous — including
      // `referenceLabels`' own `md.parse`, which is why the whole body is
      // inside the try.
      const { typographer, linkify } = md.options;
      md.options.typographer = false;
      md.options.linkify = false;
      try {
        const refs = referenceLabels(md, text);
        if (refs.length) {
          throw new Error(
            `this file defines link ${refs.length === 1 ? "reference" : "references"} ` +
              `(${refs.map((r) => `[${r}]`).join(", ")}), which rich editing cannot represent`,
          );
        }
        lines = text.split(/\r\n?|\n/);
        const doc = parser.parse(text);
        if (!doc) throw new Error("markdown parse produced no document");
        return doc;
      } finally {
        md.options.typographer = typographer;
        md.options.linkify = linkify;
      }
    },
  };
}

/**
 * Whether a file can be edited richly.
 *
 * There is no separate guard list to keep in sync — we simply attempt the
 * parse, which is the single fail-closed choke point (unknown token types
 * raise in the library; reference definitions raise in `parse()` itself).
 * The reason is returned so the UI can say WHY a file opened in source mode
 * rather than silently degrading.
 */
export function canEditRichly(
  md: MarkdownIt,
  text: string,
): { ok: true } | { ok: false; reason: string } {
  try {
    createDocParser(md).parse(text);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The `[label]: url` definitions in a file.
 *
 * These are the one construct that can go missing with NOTHING to detect it
 * afterwards. markdown-it's reference rule consumes the definition line into
 * `env.references` and emits no token at all, so there is nothing for the
 * parser to raise on; the definition simply vanishes on save. Both existing
 * gates are blind to it by construction — a loss that happens once is stable
 * on the second pass, so the fixpoint holds, and a definition renders no HTML,
 * so the semantic-preservation check compares two identical strings.
 *
 * A USED reference would survive as an inline link, but distinguishing used
 * from unused means guessing which link came from which definition. Refusing
 * whenever a definition is present is the fail-closed reading, and it is free:
 * across the whole first-party corpus, no file defines one.
 */
function referenceLabels(md: MarkdownIt, text: string): string[] {
  const env: { references?: Record<string, unknown> } = {};
  md.parse(text, env);
  const found = Object.keys(env.references ?? {});
  if (found.length === 0) return [];
  // markdown-it normalizes labels to upper case; quote the author's own
  // spelling back at them so the message names something they can search for.
  const authored = new Map(
    [...text.matchAll(/^ {0,3}\[([^\]]+)\]:/gm)].map((m) => [m[1]!.toUpperCase(), m[1]!]),
  );
  return found.map((label) => authored.get(label) ?? label);
}
