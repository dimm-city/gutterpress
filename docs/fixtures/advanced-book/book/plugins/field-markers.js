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
`;
