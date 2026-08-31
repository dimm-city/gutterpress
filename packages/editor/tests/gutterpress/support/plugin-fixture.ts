/**
 * SFE-P2c Lane C — shared "@@aside" project-plugin fixture, reused by both
 * `../provider.test.ts` (DOM-free unit coverage) and `./plugin-entry.ts`
 * (the real-Chromium `../plugin-region.btest.ts` driver).
 *
 * Mirrors `packages/cli/src/lib/markdown/editor-projection-plugins.test.ts`'s
 * OWN `asideMarkerPlugin` fixture byte-for-byte (same core-rule
 * registration point, same consumed/replaced token shape, same
 * `keepEvidence` toggle) rather than inventing a second one — that file's
 * own header already establishes it as "a realistic project-plugin core
 * rule shaped like a REAL registered markdown-it rule", exactly the test
 * plan's own instruction (`docs/plans/source-first-editor/runs/SFE-P2c.md`:
 * "A realistic plugin fixture shaped like a real registered markdown-it
 * rule (not a toy)... `packages/open-design-plugin` is the in-repo
 * reference for realistic shape" — that package ships no markdown-it rule
 * of its own to study, so Lane A's own fixture is the concrete in-repo
 * reference this one follows).
 *
 * NOT imported directly: `editor-projection-plugins.test.ts` lives in
 * `packages/cli/src/...`, unreachable from `packages/editor` without
 * pulling `renderer.ts`'s markdown-it-plugin imports into this package's
 * isolated DOM-aware typecheck program (`../../../src/gutterpress/
 * tsconfig.json`) — see `../limits.btest.ts`'s header for the identical
 * reasoning, already established by SFE-P2b Lane C. So this is a
 * deliberate, small, verified-identical PORT (pr158-lessons.md §12.4: cite
 * the source, keep the behavior, drop the cross-package import), not a
 * relative cross-package import.
 *
 * Typed ENTIRELY through `gutterpress/render`'s own public type exports
 * (`GutterpressPlugin`, `LoadedPlugin`) — no `import ... from "markdown-it"`
 * anywhere in this file. That specifier would fail to resolve here:
 * `packages/editor` never lists `markdown-it` as a dependency (verified: no
 * `packages/editor/node_modules/markdown-it`, no root-hoisted copy either —
 * `packages/cli` and `packages/desktop` each vendor their own). It resolves
 * anyway for the TYPE this file actually uses, because `GutterpressPlugin`'s
 * own `md: MarkdownIt` parameter type is declared in
 * `packages/cli/dist/lib/markdown/renderer.d.ts`, which carries its own
 * `import MarkdownIt from "markdown-it"` line — TypeScript resolves THAT
 * specifier relative to the declaring file's own location (inside
 * `packages/cli`, where `markdown-it` genuinely is a dependency), not
 * relative to whichever package re-exports or consumes the type. Verified
 * live by this file's own successful typecheck under `bun run typecheck`'s
 * third program (`src/gutterpress/tsconfig.json`), not merely asserted.
 */
import type { GutterpressPlugin, LoadedPlugin } from "gutterpress/render";

/** Matches one `@@aside <label>` paragraph line — `<label>` (the rest of the line) becomes `data-aside-label` on the emitted `plugin_aside_open` token. */
export const ASIDE_RE = /^@@aside\s+(.+)$/;

/**
 * A project-plugin CORE rule, registered exactly where a real project
 * plugin loaded via `applyPlugins` runs (`after("layout_transform", ...)`
 * — `renderer.ts` applies custom plugins after `md.use(gutterpressMarkers)`,
 * see `editor-projection-plugins.test.ts`'s own header for the full
 * rationale). Walks the flat block-level token array exactly once, consumes
 * a recognized paragraph (the standard `paragraph_open`/`inline`/
 * `paragraph_close` triple markdown-it's own paragraph rule produces),
 * replaces it with a single `plugin_aside_open`/`plugin_aside_close` pair
 * carrying the label as `data-aside-label`, and pushes every OTHER token
 * through UNCHANGED by the same object reference — the exact
 * survivor-preservation shape `markers.js`'s own `out.push(tok)` establishes
 * for content it does not touch.
 *
 * `keepEvidence` selects which of this run's two required shapes the
 * emitted open token gets:
 *   - `true` — copies `token.map` from the consumed `paragraph_open`'s own
 *     map (some plugins preserve it) — the evidence-bearing case
 *     `editor-projection.ts` classifies directly as `plugin-region`.
 *   - `false` — emits the open token with NO map/meta at all, mirroring
 *     markers.js's OWN chapter-opener token (`new state.Token(...)`, no
 *     evidence) — the case `editor-projection.ts` can only refuse (Lane B's
 *     origin-recovery integration point, unbuilt as of this run).
 */
export function asideMarkerPlugin(keepEvidence: boolean): LoadedPlugin {
  const plugin: GutterpressPlugin = (md) => {
    md.core.ruler.after("layout_transform", "aside_plugin_transform", (state) => {
      const out: typeof state.tokens = [];
      for (let i = 0; i < state.tokens.length; i++) {
        const tok = state.tokens[i]!;
        const next = state.tokens[i + 1];
        const closer = state.tokens[i + 2];
        const match =
          tok.type === "paragraph_open" && next?.type === "inline" && closer?.type === "paragraph_close"
            ? ASIDE_RE.exec(next.content)
            : null;
        if (!match) {
          out.push(tok);
          continue;
        }
        const open = new state.Token("plugin_aside_open", "aside", 1);
        open.attrSet("data-aside-label", match[1]!);
        if (keepEvidence) open.map = tok.map;
        out.push(open);
        out.push(new state.Token("plugin_aside_close", "aside", -1));
        i += 2; // consumed paragraph_open + inline + paragraph_close
      }
      state.tokens = out;
    });
  };
  return {
    name: keepEvidence ? "aside-plugin-with-evidence" : "aside-plugin-no-evidence",
    plugin,
    options: {},
  };
}
