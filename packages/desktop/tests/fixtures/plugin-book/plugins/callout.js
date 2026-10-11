/**
 * callout.js (SFE-P3e, Lane A) — a REAL, standard markdown-it plugin:
 * `(md, options) => void` with a default export, loaded through
 * gutterpress's REAL plugin loader
 * (`packages/cli/src/lib/markdown/plugins.ts`'s `loadPlugin`) via this
 * fixture's own `manifest.yaml` (`plugins: - ./plugins/callout.js`) — no
 * receipt, no vendoring, no network: a local-file plugin resolves with a
 * plain `resolve(baseDir, config.path)` + dynamic `import()` (see
 * `loadPlugin`'s own path-handling code).
 *
 * Recognizes a `@@callout <label>` paragraph and replaces it with a single
 * `plugin_callout_open`/`plugin_callout_close` pair — a branded component
 * marker (CLAUDE.md §5: "project plugins may add branded component markers
 * such as `@sidebar` or `@callout`"). Double-`@` so it never collides with
 * markers.js's own single-`@` structural marker vocabulary
 * (`@chapter`/`@page`/`@section`/...).
 *
 * Registered as a core rule anchored `after("layout_transform", ...)` — the
 * exact position a real project plugin loaded via `applyPlugins` runs at
 * (`renderer.ts`'s `createMarkdownRenderer` applies custom plugins after
 * `md.use(gutterpressMarkers)`) — and it always preserves the consumed
 * `paragraph_open` token's own `token.map` on the emitted open token, so
 * `createEditorProjection` (`gutterpress/render`) can attribute it a real,
 * evidence-backed source range (D6/G-05). A well-behaved plugin always does
 * this; the DELIBERATE no-evidence counter-example used to exercise D6's
 * fail-closed refusal path lives only in this fixture's test-only
 * `../support.ts` (`noEvidenceCalloutPlugin`) — never here, since a real
 * plugin file has no reason to drop its own evidence.
 */

const CALLOUT_RE = /^@@callout\s+(.+)$/;

/** @type {import("gutterpress/render").GutterpressPlugin} */
export default function callout(md) {
  md.core.ruler.after("layout_transform", "callout_plugin_transform", (state) => {
    const out = [];
    for (let i = 0; i < state.tokens.length; i++) {
      const tok = state.tokens[i];
      const next = state.tokens[i + 1];
      const closer = state.tokens[i + 2];
      const match =
        tok.type === "paragraph_open" && next?.type === "inline" && closer?.type === "paragraph_close"
          ? CALLOUT_RE.exec(next.content)
          : null;
      if (!match) {
        out.push(tok);
        continue;
      }
      const open = new state.Token("plugin_callout_open", "div", 1);
      open.attrSet("class", "gp-callout");
      open.attrSet("data-callout-label", match[1]);
      open.map = tok.map;
      out.push(open);
      out.push(new state.Token("plugin_callout_close", "div", -1));
      i += 2; // consumed paragraph_open + inline + paragraph_close
    }
    state.tokens = out;
  });
}

/** Surfaced in load-time log lines (renderer.ts's `applyPlugins`) — matches this fixture's documentary manifest name. */
export const metadata = {
  name: "gutterpress-plugin-callout",
  version: "1.0.0",
  description: 'Turns "@@callout <label>" paragraphs into a styled callout region.',
};

/**
 * Injected into the rendered document's `<head>` (collectPluginCss,
 * gutterpress/render) and, via `buildHostEditorProjection`
 * (`packages/desktop/electron/editor-projection.ts`), into the rich
 * editor's `extraCss` — proves this fixture's plugin genuinely declares CSS
 * of its own, not just markup, exercised by
 * `editor-projection-host.test.ts`.
 */
export const css = `
.gp-callout {
  border-left: 3px solid currentColor;
  padding: 0.5em 1em;
  margin: 1em 0;
}
`;
