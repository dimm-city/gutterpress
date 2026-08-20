/**
 * field-markers — the fixture's project plugin, written the way a REAL
 * Gutterpress project plugin is written (CLAUDE.md §5, user guide ch. 5):
 *
 *   - a plain markdown-it plugin: `export default function (md) { … }`
 *   - branded component markers (`@sidebar`, `@callout`, `@stamp`) built on
 *     block rules, mirroring the shape of the DC Field Guide plugin
 *   - an INLINED copy of the marker-line parser (plugins must not import
 *     from `gutterpress` — the compiled binary has no node_modules for
 *     plugin code to resolve against)
 *   - a token TRANSFORM (core rule) that decorates existing tokens — the
 *     kind of thing large plugins do constantly, and exactly the kind of
 *     thing that must NOT leak back into the author's markdown on save
 *   - a CONSUMING core-ruler transform (`field_markers_transform`) in the
 *     DC Field Guide's own idiom: a forward pass over the finished token
 *     stream that consumes marker paragraphs and whole constructs,
 *     synthesizes map-less `html_block` wrappers, and pushes survivors by
 *     reference. The editor round-trips these via the core-rule provenance
 *     stamps (`plugin-provenance.ts`), never by reading this code.
 *   - shipped component CSS via `export const css`
 *
 * The token shapes are deliberately varied so the editor's generic plugin
 * handling is proven against every recovery path:
 *
 *   - `@sidebar` open/close tokens carry `map` (line numbers) — the
 *     standard-carrier style
 *   - `@callout` tokens carry NEITHER map nor markup — only the plugin's
 *     own `meta.line`, the HOUSE convention (markers.js leaves `map` null
 *     on purpose, ADR 0009). The editor never reads `meta.line`; these
 *     tokens round-trip via the line ranges the core pipeline stamps at
 *     rule registration (`plugin-provenance.ts`).
 *   - `@stamp` is a self-closing atom with map and markup
 *
 * The transform's own vocabulary (all consumed at CORE stage — the block
 * rule above never sees them, so bare-pipeline parses read them as plain
 * paragraphs):
 *
 *   - `@brief` / `@end-brief` — two consumed marker paragraphs replaced by
 *     lone-tag wrapper `html_block`s, prose between surviving by reference
 *   - `@verdict "Label"` — one consumed marker paragraph replaced by one
 *     complete synthesized element
 *   - `> [!KIND] …` — the GFM-alert shape: `blockquote_open` removed in one
 *     place, its close removed in a separate later place, the interior
 *     surviving by reference, the lead `inline` replaced by a synthesized
 *     `new state.Token('inline', …)` with freshly re-parsed children
 *   - `@track "Label"` + ordered list + lazy `@end-track` tail — the
 *     terminator was lazily absorbed into the last list item (no marker
 *     paragraph of its own), so the marker paragraph and the list's
 *     open/close tokens are removed at separate sites, the items survive
 *     by reference, and the tail is stripped from the last item's inline
 */

/** Inlined marker-line parser (subset): `@name .class key=value "Label"`. */
function parseLine(line) {
  const m = /^@([a-z][a-z0-9-]*)\s*(.*)$/.exec(line.trim());
  if (!m) return null;
  const name = m[1];
  const rest = m[2].trim();
  const classes = [];
  let label = "";
  for (const tok of rest.match(/"[^"]*"|\S+/g) ?? []) {
    if (tok.startsWith(".")) classes.push(tok.slice(1));
    else if (tok.startsWith('"')) label = tok.slice(1, -1);
    else if (!tok.includes("=")) label = tok;
  }
  return { name, classes, label };
}

const WRAPPERS = new Map([
  ["sidebar", { tag: "aside", base: "fm-sidebar" }],
  ["callout", { tag: "div", base: "fm-callout" }],
]);

export const metadata = {
  name: "field-markers",
  description: "Adds @sidebar / @callout wrapped blocks and the @stamp atom",
};

export default function fieldMarkers(md) {
  md.block.ruler.before("paragraph", "field_markers", (state, startLine, _endLine, silent) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const line = state.src.slice(pos, max);
    const parsed = parseLine(line);
    if (!parsed) return false;

    const { name, classes, label } = parsed;

    // ── closers ─────────────────────────────────────────────────────────
    const closing = /^end-(sidebar|callout)$/.exec(name);
    if (closing) {
      if (silent) return true;
      const kind = closing[1];
      const t = state.push(`${kind}_close`, WRAPPERS.get(kind).tag, -1);
      if (kind === "sidebar") {
        t.markup = line.trim();
        t.map = [startLine, startLine + 1];
      } else {
        // @callout: house convention — meta.line only (see header).
        t.meta = { line: startLine + 1 };
      }
      state.line = startLine + 1;
      return true;
    }

    // ── wrappers ────────────────────────────────────────────────────────
    if (WRAPPERS.has(name)) {
      if (silent) return true;
      const { tag, base } = WRAPPERS.get(name);
      const t = state.push(`${name}_open`, tag, 1);
      t.attrs = [["class", [base, ...classes].join(" ")]];
      if (label) t.attrs.push(["data-label", label]);
      if (name === "sidebar") {
        t.markup = line.trim();
        t.map = [startLine, startLine + 1];
      } else {
        // @callout: house convention — meta.line only (see header).
        t.meta = { line: startLine + 1 };
      }
      state.line = startLine + 1;
      return true;
    }

    // ── the @stamp atom ─────────────────────────────────────────────────
    if (name === "stamp") {
      if (silent) return true;
      const t = state.push("stamp", "div", 0);
      t.attrs = [["class", ["fm-stamp", ...classes].join(" ")]];
      t.markup = line.trim();
      t.map = [startLine, startLine + 1];
      t.content = label || "APPROVED";
      state.line = startLine + 1;
      return true;
    }

    return false;
  });

  // Render rules for the print path. The editor never runs these — it maps
  // the tokens into its document model instead.
  md.renderer.rules.stamp = (tokens, idx, _opts, _env, self) =>
    `<div ${self.renderAttrs(tokens[idx])}>${md.utils.escapeHtml(tokens[idx].content)}</div>\n`;

  // ── token transform ───────────────────────────────────────────────────
  // Decorate every h2 with a class the component CSS styles. Real plugins do
  // this kind of rewriting all the time; the round-trip must treat it as
  // RENDERING, never as authored source — saving a file must not write
  // `{.fm-h2}` into markdown the author never typed.
  md.core.ruler.push("field_markers_decorate", (state) => {
    for (const tok of state.tokens) {
      if (tok.type === "heading_open" && tok.tag === "h2") {
        tok.attrJoin("class", "fm-h2");
      }
    }
  });

  // ── consuming core-ruler transform ────────────────────────────────────
  // The DC Field Guide idiom (see the header): a single forward pass that
  // consumes marker paragraphs and container tokens, synthesizes map-less
  // html_block wrappers, and pushes every survivor by reference. The lines
  // it consumes are recoverable only through the core-rule provenance
  // stamps the host applies around this rule.
  md.core.ruler.push("field_markers_transform", (state) => {
    // parseInline re-enters the core chain with a single inline token; the
    // pass below is block-shaped, so it must not run there.
    if (state.inlineMode) return;
    const toks = state.tokens;
    const out = [];
    let inBrief = false;
    let pendingTrack = false;
    let alertDepth = 0;
    let leadPending = false;

    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i];

      // A single-line paragraph is the transform's marker carrier.
      const marker =
        tok.type === "paragraph_open" &&
        toks[i + 1]?.type === "inline" &&
        !toks[i + 1].content.includes("\n") &&
        toks[i + 2]?.type === "paragraph_close"
          ? parseLine(toks[i + 1].content)
          : null;

      if (marker && marker.name === "brief") {
        out.push(makeHtml('<div class="fm-brief">\n'));
        inBrief = true;
        i += 2;
        continue;
      }
      if (marker && marker.name === "end-brief" && inBrief) {
        out.push(makeHtml("</div>\n"));
        inBrief = false;
        i += 2;
        continue;
      }
      if (marker && marker.name === "verdict") {
        out.push(
          makeHtml(
            `<div class="fm-verdict">${md.utils.escapeHtml(marker.label || "NO FINDING")}</div>\n`,
          ),
        );
        i += 2;
        continue;
      }
      if (marker && marker.name === "track") {
        // Nothing is emitted HERE — the wrapper opens at the list itself.
        // When prose separates the marker from its list this becomes an
        // isolated consumed-to-nothing site, which the provenance differ
        // poisons so the editor refuses rather than guesses.
        pendingTrack = true;
        i += 2;
        continue;
      }

      // The counted drill: an ordered list whose `@end-track` terminator was
      // lazily absorbed into the last item. The list's open/close tokens are
      // consumed, the items survive by reference, and the tail is stripped
      // from the surviving inline (content AND children) so the terminator
      // never renders.
      if (pendingTrack && tok.type === "ordered_list_open") {
        let close = -1;
        for (let j = i, depth = 0; j < toks.length; j++) {
          if (toks[j].type === "ordered_list_open") depth++;
          else if (toks[j].type === "ordered_list_close" && --depth === 0) {
            close = j;
            break;
          }
        }
        let tail = null;
        for (let j = close - 1; j > i; j--) {
          if (toks[j].type === "inline") {
            tail = toks[j];
            break;
          }
        }
        if (close !== -1 && tail && /(^|\n)@end-track\s*$/.test(tail.content)) {
          tail.content = tail.content.replace(/\n?@end-track\s*$/, "");
          const kids = tail.children || [];
          if (
            kids.length >= 2 &&
            kids[kids.length - 1].type === "text" &&
            kids[kids.length - 1].content.trim() === "@end-track" &&
            kids[kids.length - 2].type === "softbreak"
          ) {
            tail.children = kids.slice(0, -2);
          }
          out.push(makeHtml('<div class="fm-track">\n<ol>\n'));
          for (let j = i + 1; j < close; j++) out.push(toks[j]);
          out.push(makeHtml("</ol>\n</div>\n"));
          pendingTrack = false;
          i = close;
          continue;
        }
      }

      // GFM-style alerts: `> [!KIND] …`. The blockquote's open and close are
      // removed at two separate sites; everything between survives by
      // reference except the lead inline, which is replaced by a synthesized
      // token with freshly re-parsed children.
      if (
        alertDepth === 0 &&
        tok.type === "blockquote_open" &&
        toks[i + 1]?.type === "paragraph_open" &&
        toks[i + 2]?.type === "inline" &&
        /^\[!([A-Z]+)\]/.test(toks[i + 2].content)
      ) {
        const kind = /^\[!([A-Z]+)\]/.exec(toks[i + 2].content)[1].toLowerCase();
        out.push(makeHtml(`<div class="fm-alert fm-alert-${kind}">\n`));
        alertDepth = 1;
        leadPending = true;
        continue;
      }
      if (alertDepth > 0) {
        if (tok.type === "blockquote_open") {
          alertDepth++;
        } else if (tok.type === "blockquote_close") {
          alertDepth--;
          if (alertDepth === 0) {
            out.push(makeHtml("</div>\n"));
            continue;
          }
        } else if (leadPending && tok.type === "inline") {
          const rest = tok.content.replace(/^\[![A-Z]+\]\s*/, "");
          const lead = new state.Token("inline", "", 0);
          lead.content = rest;
          lead.level = tok.level;
          lead.children = [];
          state.md.inline.parse(rest, state.md, state.env, lead.children);
          out.push(lead);
          leadPending = false;
          continue;
        }
      }

      out.push(tok);
    }
    state.tokens = out;
  });
}

/**
 * Synthesized-token factory in the real plugin's own shape: a plain object
 * literal, `map: null` — NOT `new state.Token` — because that is what the
 * plugin this fixture mirrors ships, and the pipeline must cope with both.
 */
function makeHtml(content) {
  return {
    type: "html_block",
    tag: "",
    attrs: null,
    map: null,
    nesting: 0,
    level: 0,
    children: null,
    content,
    markup: "",
    info: "",
    meta: null,
    block: true,
    hidden: false,
  };
}

export const css = `
/* field-markers component chrome (plugin-shipped CSS). */
.fm-sidebar {
  float: right;
  width: 42%;
  margin: 0 0 0.6em 1em;
  padding: 0.6em 0.8em;
  background: #f2ede3;
  border-left: 3px solid #8a6d3b;
  font-size: 0.9em;
  break-inside: avoid;
}
.fm-sidebar > :first-child { margin-top: 0; }
.fm-sidebar > :last-child { margin-bottom: 0; }

.fm-callout {
  margin: 1em 0;
  padding: 0.7em 0.9em;
  border: 1px solid #b8c4bd;
  border-radius: 2pt;
  background: #eef3f0;
  break-inside: avoid;
}
.fm-callout.warning { border-color: #b3595f; background: #f7ecec; }
.fm-callout::before {
  content: attr(data-label);
  display: block;
  font-weight: bold;
  font-size: 0.8em;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 0.35em;
}

.fm-stamp {
  display: inline-block;
  padding: 0.2em 0.7em;
  border: 2px solid #8a2f2f;
  color: #8a2f2f;
  font-weight: bold;
  letter-spacing: 0.15em;
  transform: rotate(-3deg);
  text-transform: uppercase;
}

h2.fm-h2 { border-bottom: 1px solid #cccccc; padding-bottom: 0.15em; }

/* Transform chrome (field_markers_transform). Deliberately fragmentation-
   neutral: plain block divs — margins, padding, borders — no floats, no
   break-* rules, so preview↔print parity is untouched. */
.fm-brief {
  margin: 1em 0;
  padding: 0.7em 0.9em;
  border-left: 3px solid #4a5a6a;
  background: #eef1f4;
}
.fm-brief > :first-child { margin-top: 0; }
.fm-brief > :last-child { margin-bottom: 0; }

.fm-verdict {
  margin: 1em 0;
  padding: 0.3em 0.8em;
  border: 1px solid #3f6d4e;
  color: #3f6d4e;
  font-weight: bold;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.fm-alert {
  margin: 1em 0;
  padding: 0.7em 0.9em;
  border: 1px solid #7d8ba1;
  background: #eef0f6;
}
.fm-alert > p:first-child { font-weight: bold; margin-top: 0; }
.fm-alert > :last-child { margin-bottom: 0; }
.fm-alert-tip { border-color: #6a8f5f; background: #eff5ec; }

.fm-track {
  margin: 1em 0;
  padding: 0.7em 0.9em;
  border: 1px dashed #8a6d3b;
  background: #f7f3ea;
}
.fm-track > ol { margin: 0; }
`;
