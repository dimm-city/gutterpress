/**
 * support.ts (SFE-P3d-parity, Lane E) — shared plugin + fixture-loading code
 * for `packages/desktop/tests/editor/real-book-plugin-*.test.ts`.
 *
 * Lives inside `packages/desktop/tests/fixtures/plugin-book/**` (this
 * lane's write ownership covers the whole tree, not just markdown/yaml), so
 * the three `real-book-plugin-*.test.ts` files can share ONE plugin
 * definition and ONE chapter loader instead of each re-deriving the plugin's
 * core-rule logic (unlike the sibling `real-book-*.test.ts` files, which
 * duplicate a plain 25-item literal array across files — cheap to repeat;
 * this fixture's plugin is nontrivial parsing logic, where duplicating it
 * three times would itself become a drift risk the run's own "clean code"
 * guidance argues against).
 *
 * ## Why this project has no example under `examples/` (this lane's own gap,
 * named directly per the run spec's DETAILS section)
 *
 * `real-book-byte-identity.test.ts` (Lane B, already committed) verified
 * that no manifest under `examples/` declares a `plugins:` key. Condition 3
 * is an editing-fidelity claim about REAL author content containing a real
 * plugin region, not a request for new product surface — so this fixture is
 * a small, genuinely book-shaped project (`manifest.yaml` + three chapters)
 * committed as TEST DATA under `packages/desktop/tests/fixtures/`, never
 * published as an example book.
 *
 * ## Why the plugin is authored here rather than loaded via `loadPlugins`
 *
 * `packages/cli/src/lib/markdown/plugins.ts`'s `loadPlugins` (CLAUDE.md §5)
 * resolves the PUBLIC npm registry, verifies tarballs, vendors a full nested
 * dependency tree under a project directory, and writes a schema-v2
 * receipt — the real "gutterpress plugin add" installation pipeline. It has
 * deliberately no lightweight/offline test mode (by design: "Reinstall
 * always fetches fresh bytes"), and building a fake receipt+vendor tree by
 * hand to route around that would be exactly the "hand-constructing a
 * projection object no real pipeline produced" failure the run spec warns
 * against, aimed one layer lower (a hand-constructed FAKE VENDOR TREE
 * instead of a hand-constructed fake projection). This is the "desktop
 * package genuinely cannot build a plugin-aware projection without
 * host-side plugin loading it does not have" case the run spec's escape
 * hatch names — see the report this lane returns for the honest statement
 * in full.
 *
 * What IS reachable, and what this file does: `createEditorProjection`
 * (`gutterpress/render`) accepts any REAL configured `MarkdownIt` instance
 * via `opts.md` — "the SAME configured `MarkdownIt` instance the render
 * path uses ... e.g. one built by `createMarkdownRenderer(projectPlugins)`"
 * (that option's own doc comment). `createMarkdownRenderer` is the exact
 * production factory `renderer.ts` exports and the CLI build/preview path
 * calls; the ONLY thing this file supplies by hand is the `LoadedPlugin`
 * array that function's own signature has always accepted as a plain
 * caller-supplied argument — never a vendored/installed one at that API
 * layer. SFE-P2c's own acceptance tests
 * (`packages/cli/src/lib/markdown/editor-projection-plugins.test.ts`)
 * establish this exact pattern — "a realistic plugin fixture shaped like a
 * REAL registered markdown-it rule" — as the sanctioned way to exercise
 * plugin-region projection without going through `loadPlugins`.
 * `calloutMarkerPlugin` below follows that established shape: a single core
 * rule anchored `after("layout_transform", ...)` (the exact position a real
 * project plugin loaded via `applyPlugins` runs at — `renderer.ts` applies
 * custom plugins after `md.use(gutterpressMarkers)`), walking the flat
 * block-token array once, consuming a recognized
 * `paragraph_open`/`inline`/`paragraph_close` triple, and pushing every
 * OTHER token through unchanged by the same object reference (the
 * survivor-preservation shape `markers.js`'s own `out.push(tok)`
 * establishes). This plugin genuinely FIRES on real parse calls (verified
 * directly via `md.parse()` in every test file that uses it, independent of
 * `createEditorProjection` — AP-21) and its emitted tokens are genuinely
 * walked by the real, unmodified `createEditorProjection` production code —
 * this is a real plugin producing a real plugin-region, not a fabricated
 * projection object.
 *
 * `@@callout` (double-`@`) mirrors P2c's own `@@aside` fixture precisely
 * because it matters: a single-`@` line is markers.js's OWN reserved marker
 * syntax (`@chapter`/`@page`/`@section`/...), so a project plugin's marker
 * vocabulary must not collide with it. `@@callout` is exactly the kind of
 * "branded component marker" CLAUDE.md §5 names as project-plugin territory
 * ("project plugins may add branded component markers such as `@sidebar` or
 * `@callout`").
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMarkdownRenderer, type GutterpressPlugin, type LoadedPlugin } from "gutterpress/render";

/**
 * `MarkdownIt`'s own type, derived structurally from `GutterpressPlugin`
 * (`gutterpress/render`) rather than imported directly from the
 * `markdown-it` package: `@types/markdown-it` is a `packages/cli`
 * devDependency, not a `packages/desktop` one — `gutterpress/render`'s own
 * compiled `.d.ts` resolves it fine (relative to `packages/cli`'s own
 * `node_modules`, exactly like every other desktop file that already
 * imports `MarkdownIt`-shaped types through `gutterpress/render` without
 * issue), but a DIRECT `import MarkdownIt from "markdown-it"` from a
 * `packages/desktop` file cannot — `packages/desktop/tsconfig.json` (which
 * `svelte-check` also runs against, unlike `bun run typecheck`'s
 * electron-only scope) has no path to that package's declaration file.
 * Deriving the type this way sidesteps that gap entirely rather than adding
 * a new devDependency this lane's write ownership does not cover.
 */
type MarkdownItInstance = Parameters<GutterpressPlugin>[0];

// `import.meta.dir` is Bun-only and unrecognized by `packages/desktop`'s own
// TS lib (svelte-check's tsconfig has no Bun ambient types) — `import.meta
// .url` + `fileURLToPath` is the portable equivalent, valid under both the
// Bun test runtime and plain `tsc`/svelte-check.
export const PLUGIN_BOOK_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN_BOOK_MANIFEST_PATH = path.join(PLUGIN_BOOK_ROOT, "manifest.yaml");

export interface PluginBookChapter {
  readonly id: string;
  readonly path: string;
  readonly text: string;
}

/** The manifest's own `source.files` list, verbatim (see manifest.yaml). */
export const PLUGIN_BOOK_CHAPTER_FILES = [
  "01-introduction.md",
  "02-field-notes.md",
  "03-checklist.md",
] as const;

/** Reads every chapter fresh from disk — AP-25: committed fixtures are only ever `readFileSync`'d, never written. */
export function loadPluginBookChapters(): readonly PluginBookChapter[] {
  return PLUGIN_BOOK_CHAPTER_FILES.map((f) => {
    const p = path.join(PLUGIN_BOOK_ROOT, f);
    return { id: f, path: p, text: readFileSync(p, "utf8") };
  });
}

const CALLOUT_RE = /^@@callout\s+(.+)$/;

/**
 * A realistic project-plugin core rule matching the shape SFE-P2c's own
 * `asideMarkerPlugin` established (see this file's header). Recognizes a
 * `@@callout <label>` paragraph and replaces it with a single
 * `plugin_callout_open`/`plugin_callout_close` pair carrying the label as a
 * `data-callout-label` attribute and a `gp-callout` class — mirroring a
 * real branded-component plugin's own view-attribute vocabulary (CLAUDE.md
 * §6: "Everything Gutterpress emits or styles is `gp-` prefixed"; a project
 * plugin naming its OWN class this way is exactly the kind of thing a
 * `@dimm-city`-style project plugin does).
 *
 * `keepEvidence` selects which of D6/G-05's two real shapes the emitted
 * open token gets — SAME contract as `asideMarkerPlugin`'s own doc comment:
 *   - `true`: copies `token.map` from the consumed `paragraph_open`'s own
 *     map (a well-behaved plugin that preserves evidence) — the case this
 *     lane's byte-identity/locality tests exercise as a genuine
 *     `plugin-region` block.
 *   - `false`: emits the open token with NO map/meta at all (a plugin that
 *     does not preserve evidence, mirroring markers.js's OWN chapter-opener
 *     token) — the case `createEditorProjection` can only refuse
 *     (`EDITOR_UNSUPPORTED_PROJECTION`), used by this lane's locality test
 *     for the "edit inside a refused/unsupported region" case.
 */
export function calloutMarkerPlugin(keepEvidence: boolean): LoadedPlugin {
  // Contextually typed against `GutterpressPlugin` rather than an explicit
  // `(md: MarkdownIt) =>` annotation — see `MarkdownItInstance`'s own
  // comment above for why.
  const plugin: GutterpressPlugin = (md) => {
    md.core.ruler.after("layout_transform", "callout_plugin_transform", (state) => {
      const out: typeof state.tokens = [];
      for (let i = 0; i < state.tokens.length; i++) {
        const tok = state.tokens[i]!;
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
        open.attrSet("data-callout-label", match[1]!);
        if (keepEvidence) open.map = tok.map;
        out.push(open);
        out.push(new state.Token("plugin_callout_close", "div", -1));
        i += 2; // consumed paragraph_open + inline + paragraph_close
      }
      state.tokens = out;
    });
  };
  return {
    name: keepEvidence ? "gutterpress-plugin-callout" : "gutterpress-plugin-callout-no-evidence",
    plugin,
    options: {},
  };
}

/**
 * The SAME production factory the CLI build/preview path calls
 * (`renderer.ts`'s `createMarkdownRenderer`, re-exported from
 * `gutterpress/render`), configured with `calloutMarkerPlugin` — G-03: "one
 * resolved presentation context", never a parallel parser config.
 */
export function pluginBookRenderer(keepEvidence: boolean): MarkdownItInstance {
  return createMarkdownRenderer([calloutMarkerPlugin(keepEvidence)]);
}
