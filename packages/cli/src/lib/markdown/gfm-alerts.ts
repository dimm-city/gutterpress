import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type { RuleCore } from "markdown-it/lib/parser_core.mjs";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";

/**
 * GFM-style `> [!NOTE]` alert blockquotes (#237).
 *
 * Bundled, OPT-IN markdown feature (`BUILTIN_OPTIONAL_PLUGINS` in
 * `renderer.ts`, `RECOMMENDED_PLUGINS` in `plugin-manager.ts` under the
 * "Callouts" label) — NOT applied unconditionally. A project that never lists
 * `gutterpress-gfm-alerts` in its manifest renders `> [!NOTE]` exactly as it
 * always has: a literal blockquote whose first line of text is `[!NOTE]`.
 * That is the backward-compatibility contract this file exists to protect —
 * see the header comment on `renderer.ts`'s `BUILTIN_OPTIONAL_PLUGINS` map.
 *
 * Supported types are the GitHub set only — `NOTE`, `TIP`, `IMPORTANT`,
 * `WARNING`, `CAUTION` — matched case-insensitively (non-technical authors
 * should not be tripped up by `[!Note]` vs `[!NOTE]`). Anything else
 * (`[!DANGER]`, a typo, a project's own branded extension) does not match and
 * is left as an ordinary blockquote, unstyled — exactly today's behavior.
 * That is deliberate, not a missing feature: per CLAUDE.md §0/§0-boundary-
 * ruling, core owns only the broadly-useful, standards-defined primitive;
 * branded or bespoke callout types (Dimm City's `[!DM]`/`[!VIBE]`/`[!ORIGIN]`
 * among them) are exactly the kind of project/plugin-layer extension that
 * belongs OUTSIDE core, layered on top of `.gp-alert` (see the class-naming
 * note below).
 *
 * SYNTAX (the actual GFM alert spec, not a looser dialect): the marker must
 * be alone on the first line of the blockquote's first paragraph —
 * `> [!NOTE]` on its own line, then the body on the following line(s). A
 * marker sharing its line with other text (`> [!NOTE] extra words`) does
 * NOT match, matching GitHub's own renderer; that shape can still be
 * authored as a project-layer convenience (a `@callout` marker, say) but is
 * not part of this core primitive.
 *
 * DOM emitted, matching the issue's suggested shape (and, where the two
 * agree, the Dimm City plugin's `dc_alerts` transform this was checked
 * against — see the issue for the pointer):
 *
 * ```html
 * <div class="gp-alert gp-alert-note">
 *   <p class="gp-alert-title">Note</p>
 *   <p>Body content, in the author's own paragraphs/lists/etc.</p>
 * </div>
 * ```
 *
 * Standard HTML+CSS only (CLAUDE.md — "author-facing vocabulary is fine when
 * it emits standard CSS"): no engine-private behavior, nothing here that a
 * future browser feature could not replace. Styling is NOT this plugin's
 * job — the minimal `:where()` defaults live in `gutterpress-css.ts`
 * (`GUTTERPRESS_CSS`) alongside the rest of the `gp-*` author vocabulary
 * (CLAUDE.md §6: the split between `markers.js` and `gutterpress-css.ts` is
 * by ROLE, not by which file emits the DOM — this is authored-component
 * vocabulary, not the `@marker` structural family, so its CSS belongs with
 * the utility vocabulary, not in MARKER_CSS). Every class emitted here
 * (`gp-alert`, the five `gp-alert-<type>` variants, `gp-alert-title`) is
 * registered in `GP_CLASSES` so the `unknown_gp_class` diagnostic (#226)
 * neither warns on correct authored use of these names elsewhere nor stays
 * silent on a typo of one.
 *
 * MECHANICS — a plain markdown-it core-rule transform, the same shape any
 * third-party plugin author would write (CLAUDE.md §5: no Gutterpress-
 * specific plugin API). Registered with `core.ruler.after('block', ...)` —
 * BEFORE the standard `inline` rule runs, exactly like `markers.js`'s own
 * `layout_transform` — so this rule can mutate a token's raw `.content` and
 * let the standard `inline` core rule parse it into `.children` afterward,
 * with no manual re-invocation of the inline parser needed.
 *
 * Wrapper tokens deliberately do NOT carry `token.map` (see `openChapter` in
 * markers.js for the identical precedent and its full rationale): a synthetic
 * wrapper div with a `.map` would get `data-source-line` stamped onto it by
 * `markdown-it-source-map` (applied unconditionally, early, in
 * `renderer.ts`), and a wrapper that is reflowed by the live-preview
 * pagination engine can then mis-resolve scroll-sync (ADR 0009). The line is
 * threaded instead via `token.meta.line`, which `source-range.ts`'s
 * `data-source-range` rule (registered unconditionally, LAST, after this
 * plugin has already run) reads as its documented second-priority range
 * source — so the alert wrapper still gets a correct `data-source-range` for
 * editor click-to-source, just not through `.map`. The RETAINED body tokens
 * (any paragraph/list/etc. that was not the marker line) keep their original
 * `.map` untouched — they are ordinary, single-instance content, not a
 * cloned-per-page wrapper, so the ADR 0009 hazard does not apply to them.
 */

/** The five GitHub alert types this primitive recognizes, and their display label. */
const ALERT_LABELS: Readonly<Record<string, string>> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

/**
 * The alert marker: one of the five known types, alone on its line (trailing
 * whitespace only). Case-insensitive — see the header comment. Anchored at
 * both ends so `[!NOTE] extra text` and `not [!NOTE]` both correctly fail to
 * match.
 */
const ALERT_MARKER = /^\[!(note|tip|important|warning|caution)\]\s*$/i;

function isFiniteMap(map: unknown): map is [number, number] {
  return Array.isArray(map) && map.length === 2 && Number.isFinite(map[0]) && Number.isFinite(map[1]);
}

/** `new state.Token(type, tag, nesting)`, `.block = true`, one call site. */
function blockToken(state: StateCore, type: string, tag: string, nesting: 1 | -1): Token {
  const token = new state.Token(type, tag, nesting);
  token.block = true;
  return token;
}

/**
 * The core-rule transform. A single forward pass over `state.tokens`
 * rebuilding the array — the same shape as `markers.js`'s `layout_transform`
 * and (per the issue's pointer) Dimm City's `dc_alerts`: non-matching tokens
 * are pushed through by reference, unchanged.
 */
const gfmAlertsRule: RuleCore = (state) => {
  const tokens = state.tokens;
  const newTokens: Token[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.type !== "blockquote_open") {
      newTokens.push(tok);
      continue;
    }

    // Find this blockquote's own matching close, tracking nesting depth so a
    // quote nested inside the alert doesn't end the scan early.
    let depth = 0;
    let closeIdx = -1;
    for (let j = i; j < tokens.length; j++) {
      const jt = tokens[j]!;
      if (jt.type === "blockquote_open") depth++;
      else if (jt.type === "blockquote_close") {
        depth--;
        if (depth === 0) {
          closeIdx = j;
          break;
        }
      }
    }

    // The alert marker must be the blockquote's very first child: a plain
    // paragraph (not a list, heading, nested quote, ...) whose first line is
    // the marker. Anything else is an ordinary blockquote, left untouched.
    const markerParaOpen = tokens[i + 1];
    const markerInline = tokens[i + 2];
    const markerParaClose = tokens[i + 3];
    const hasMarkerParagraph =
      closeIdx !== -1 &&
      markerParaOpen?.type === "paragraph_open" &&
      markerInline?.type === "inline" &&
      markerParaClose?.type === "paragraph_close";

    if (!hasMarkerParagraph) {
      newTokens.push(tok);
      continue;
    }

    const content = markerInline!.content;
    const newlineIdx = content.indexOf("\n");
    const firstLine = newlineIdx === -1 ? content : content.slice(0, newlineIdx);
    const match = ALERT_MARKER.exec(firstLine);
    if (!match) {
      newTokens.push(tok);
      continue;
    }

    const type = match[1]!.toLowerCase();
    const label = ALERT_LABELS[type]!;
    // 1-based marker line, threaded via `.meta.line` — see the header
    // comment on why this is NOT `token.map`.
    const markerLine = isFiniteMap(tok.map) ? tok.map[0] + 1 : undefined;

    const alertOpen = blockToken(state, "gp_alert_open", "div", 1);
    alertOpen.attrSet("class", `gp-alert gp-alert-${type}`);
    if (markerLine !== undefined) alertOpen.meta = { line: markerLine };
    newTokens.push(alertOpen);

    const titleOpen = blockToken(state, "gp_alert_title_open", "p", 1);
    titleOpen.attrSet("class", "gp-alert-title");
    if (markerLine !== undefined) titleOpen.meta = { line: markerLine };
    newTokens.push(titleOpen);

    // Plain-text label, no markdown syntax to honor — content is enough; the
    // standard `inline` core rule (which runs immediately after this one,
    // since this rule is registered `.after('block', ...)`) parses it into
    // `.children` the same way it would any other inline token. That rule
    // parses INTO `tok.children` rather than creating the array itself
    // (mirroring markdown-it's own paragraph rule, the only other producer
    // of `inline` tokens here) — an inline token whose creator forgot this
    // crashes the standard rule with a null-`.length` TypeError, not a quiet
    // no-op, so this is intentionally not skippable.
    const titleInline = new state.Token("inline", "", 0);
    titleInline.content = label;
    titleInline.children = [];
    newTokens.push(titleInline);

    newTokens.push(blockToken(state, "gp_alert_title_close", "p", -1));

    // Whatever followed the marker's own line, if anything, is body text
    // that shared the marker's paragraph (e.g. no blank line before it).
    const rest = newlineIdx === -1 ? "" : content.slice(newlineIdx + 1);
    if (rest.trim() !== "") {
      // Keep this paragraph as the alert's first body paragraph, minus the
      // consumed marker line. Advance its map past that line so an editor
      // still points at the body text, not the already-rendered label.
      markerInline!.content = rest;
      if (isFiniteMap(markerParaOpen!.map)) {
        markerParaOpen!.map = [markerParaOpen!.map![0] + 1, markerParaOpen!.map![1]];
      }
      newTokens.push(markerParaOpen!, markerInline!, markerParaClose!);
    }
    // else: the marker paragraph was ONLY the marker (the common case, most
    // often with a blank line before the body) — fully consumed by the
    // title above, dropped instead of copied through.

    // Copy the rest of the blockquote's content — the real body — through
    // unchanged, maps and all.
    for (let j = i + 4; j < closeIdx; j++) {
      newTokens.push(tokens[j]!);
    }

    newTokens.push(blockToken(state, "gp_alert_close", "div", -1));

    i = closeIdx; // resume scanning after the original blockquote_close
  }

  state.tokens = newTokens;
};

/**
 * The plugin export — a plain `(md) => void` markdown-it plugin (CLAUDE.md
 * §5), registered by name from `BUILTIN_OPTIONAL_PLUGINS` when a project
 * lists `gutterpress-gfm-alerts` in its manifest.
 */
export default function gfmAlerts(md: MarkdownIt): void {
  md.core.ruler.after("block", "gp_gfm_alerts", gfmAlertsRule);
}
