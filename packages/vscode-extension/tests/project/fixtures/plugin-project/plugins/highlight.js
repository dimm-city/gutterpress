/**
 * highlight.js — SFE-P3c Lane B test-only fixture plugin (mirrors
 * packages/desktop/tests/fixtures/plugin-book/plugins/callout.js's proven
 * shape exactly, under a distinct marker/class name so this fixture is
 * never confused with that one). A REAL, standard markdown-it plugin:
 * `(md, options) => void` with a default export, loaded through
 * gutterpress's real plugin loader (packages/cli/src/lib/markdown/plugins.ts's
 * loadPlugin) via this fixture's own manifest.yaml
 * (plugins: - ./plugins/highlight.js).
 *
 * Recognizes an "@@highlight <label>" paragraph and replaces it with a
 * single plugin_highlight_open/plugin_highlight_close pair, always
 * preserving the consumed paragraph_open token's own token.map on the
 * emitted open token so createEditorProjection (gutterpress/render) can
 * attribute it a real, evidence-backed source range (D6/G-05).
 */

const HIGHLIGHT_RE = /^@@highlight\s+(.+)$/;

/** @type {import("gutterpress/render").GutterpressPlugin} */
export default function highlight(md) {
  md.core.ruler.after("layout_transform", "highlight_plugin_transform", (state) => {
    const out = [];
    for (let i = 0; i < state.tokens.length; i++) {
      const tok = state.tokens[i];
      const next = state.tokens[i + 1];
      const closer = state.tokens[i + 2];
      const match =
        tok.type === "paragraph_open" && next?.type === "inline" && closer?.type === "paragraph_close"
          ? HIGHLIGHT_RE.exec(next.content)
          : null;
      if (!match) {
        out.push(tok);
        continue;
      }
      const open = new state.Token("plugin_highlight_open", "div", 1);
      open.attrSet("class", "gp-highlight");
      open.attrSet("data-highlight-label", match[1]);
      open.map = tok.map;
      out.push(open);
      out.push(new state.Token("plugin_highlight_close", "div", -1));
      i += 2; // consumed paragraph_open + inline + paragraph_close
    }
    state.tokens = out;
  });
}

/** Surfaced in load-time log lines (renderer.ts's applyPlugins). */
export const metadata = {
  name: "gutterpress-vscode-test-plugin-highlight",
  version: "1.0.0",
  description: 'Turns "@@highlight <label>" paragraphs into a styled highlight region (test fixture only).',
};

/** Proves the projection's pluginCss is genuinely sourced from the loaded
 *  plugin, not a hand-rolled stand-in — checked, not asserted vacuously. */
export const css = `
.gp-highlight {
  background: yellow;
}
`;
