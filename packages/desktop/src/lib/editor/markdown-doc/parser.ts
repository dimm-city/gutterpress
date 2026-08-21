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
import type { Node as PMNode } from "prosemirror-model";
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
type CoreWrapperCandidate =
  | { at: number; kind: "open"; tag: string; attrs: Record<string, string>; marker: string }
  | { at: number; kind: "close"; tag: string; marker: string };

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
function pairCoreWrapperRegions(tokens: Token[], cands: CoreWrapperCandidate[]): void {
  const stack: Array<Extract<CoreWrapperCandidate, { kind: "open" }>> = [];
  for (const cand of cands) {
    if (cand.kind === "open") {
      stack.push(cand);
      continue;
    }
    let pos = -1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]!.tag === cand.tag) { pos = i; break; }
    }
    if (pos === -1) continue;
    const open = stack[pos]!;
    // Anything opened inside the match and never closed stays an atom.
    stack.length = pos;

    if (cand.at - open.at <= 1) continue; // empty pair — block+ needs content
    let depth = 0;
    let balanced = true;
    for (let i = open.at + 1; i < cand.at; i++) {
      depth += tokens[i]!.nesting;
      if (depth < 0) { balanced = false; break; }
    }
    if (!balanced || depth !== 0) continue;

    const openTok = tokens[open.at]!;
    const closeTok = tokens[cand.at]!;
    openTok.type = "plugin_block_open";
    openTok.nesting = 1;
    openTok.meta = {
      ...(openTok.meta as Record<string, unknown> | null),
      gpPlugin: {
        marker: open.marker,
        closeMarker: cand.marker,
        tag: open.tag,
        viewAttrs: Object.keys(open.attrs).length > 0 ? open.attrs : null,
      },
    };
    closeTok.type = "plugin_block_close";
    closeTok.nesting = -1;
  }
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
    // Classify BEFORE overwriting the token: a single-member region whose
    // synthesized content is one lone tag may pair up after the scan
    // (phase 2). Multi-member regions (span-paired alerts, swallowed
    // survivors, multi-tag synthesis) always stay atoms.
    const lone = end === i && tok.type === "html_block";
    const opened = lone ? loneOpenTag(tok.content) : null;
    const closed = lone && !opened ? loneCloseTag(tok.content) : null;
    tok.type = "plugin_atom";
    tok.nesting = 0;
    tok.block = true;
    tok.meta = {
      ...(tok.meta as Record<string, unknown> | null),
      gpPlugin: { marker, tag: "div", viewAttrs: null, text: marker },
    };
    if (!out) out = tokens.slice(0, i);
    out.push(tok);
    if (opened) {
      wrapperCands.push({ at: out.length - 1, kind: "open", tag: opened.tag, attrs: opened.attrs, marker });
    } else if (closed) {
      wrapperCands.push({ at: out.length - 1, kind: "close", tag: closed, marker });
    }
    i = end;
  }
  const result = out ?? tokens;
  if (wrapperCands.length > 0) pairCoreWrapperRegions(result, wrapperCands);
  return result;
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
      return adoptPluginTokens(
        adoptHtmlWrappers(adoptCoreRegions(raiseOnPoison(tokens), lines)),
        lines,
        handled,
      );
    },
  };
  const parser = new MarkdownParser(gutterpressSchema, tokenizer as unknown as MarkdownIt, specs);

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
