/**
 * support.ts (SFE-P3d-parity, then SFE-P3e Lane A) — shared fixture-loading
 * code for `packages/desktop/tests/editor/real-book-plugin-*.test.ts` and
 * `editor-projection-host.test.ts`.
 *
 * Lives inside `packages/desktop/tests/fixtures/plugin-book/**` (this
 * lane's write ownership covers the whole tree, not just markdown/yaml), so
 * every test file that needs this fixture's chapters or its real projection
 * shares ONE loader instead of each re-deriving it.
 *
 * ## History — why this file used to hand-build a plugin, and why it no longer does
 *
 * SFE-P3d-parity found that `+page.svelte`'s `buildRichProjection` never
 * passed `md`/`trusted` to `createEditorProjection`, so the desktop's own
 * plugin-loading wiring did not exist yet — that lane's run spec permitted
 * proving `createEditorProjection`'s OWN plugin-awareness with a hand-built
 * `MarkdownIt` instance instead (`calloutMarkerPlugin`, `pluginBookRenderer`
 * below in the pre-SFE-P3e version of this file), and this fixture's
 * `manifest.yaml` named an uninstalled npm package the real loader could
 * never load — see git history for that version's full reasoning.
 *
 * SFE-P3e closes that exact gap: `packages/desktop/electron/editor-
 * projection.ts`'s `buildHostEditorProjection` is now the desktop's real
 * host-side pipeline — the exact function the `api:editorProjection` IPC
 * handler calls — real `loadManifestWithPath`/`resolveConfig`, plugins
 * loaded through `gutterpress/plugins`' `loadPluginsWithCss` (the SAME
 * degrade-and-report loader the live preview uses — D11 pre-approved this
 * subpath, and `editor-projection.ts` is its first real consumer; there is
 * no second, narrower loader), real `createMarkdownRenderer`, real
 * `createEditorProjection(..., { trusted: true })`. This fixture's manifest
 * now names a REAL local-file plugin (`./plugins/callout.js` — a standard
 * `(md, options) => void` markdown-it plugin with a default export; see
 * that file's own header), so {@link buildRealPluginBookProjection} below
 * drives that real pipeline end to end instead of standing in for it.
 *
 * `plugins/callout.js` is now the SOLE definition of the callout core rule
 * — nothing in this file duplicates its logic. The one thing that DOES
 * remain here, {@link noEvidenceCalloutPlugin}, is a deliberate NEGATIVE
 * counter-example a real, well-behaved plugin file has no reason to
 * exercise on itself: it drops `token.map` on purpose, reproducing exactly
 * the D6/G-05 fail-closed "insufficient evidence" shape
 * `real-book-plugin-locality.test.ts`'s "edit inside a refused/unsupported
 * region" cases need. This is not a second copy of the real plugin — it is
 * a different plugin, testing a different (refusal) code path.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMarkdownRenderer, type GutterpressPlugin, type LoadedPlugin } from "gutterpress/render";
import {
  buildHostEditorProjection,
  type EditorProjectionHostResult,
} from "../../../electron/editor-projection";

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
/** The real local-file plugin `manifest.yaml` names — see that file's own header. */
export const PLUGIN_BOOK_PLUGIN_PATH = path.join(PLUGIN_BOOK_ROOT, "plugins", "callout.js");

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

/**
 * Build a plugin-aware, trusted projection for `content` through the desktop
 * host pipeline — `buildHostEditorProjection`
 * (`packages/desktop/electron/editor-projection.ts`), the exact function
 * `main.ts`'s `api:editorProjection` IPC handler calls. `PLUGIN_BOOK_ROOT`
 * IS this fixture's project directory (where `manifest.yaml` lives), so
 * this resolves and loads `./plugins/callout.js` for real, from disk, via
 * `gutterpress/plugins`' `loadPluginsWithCss` — no hand-built `md`, no
 * injected plugin function; the tests that call this exercise the file the
 * manifest names.
 */
export function buildRealPluginBookProjection(
  content: string,
  sourceVersion: number,
): Promise<EditorProjectionHostResult> {
  return buildHostEditorProjection({ projectDir: PLUGIN_BOOK_ROOT, content, sourceVersion });
}

const CALLOUT_RE = /^@@callout\s+(.+)$/;

/**
 * A DELIBERATE no-evidence counter-example (see this file's header) — the
 * `@@callout` core rule, but the emitted open token's `token.map` is left
 * `null` on purpose, mirroring markers.js's OWN chapter-opener token (ADR
 * 0009) and reproducing the ONE real shape D6/G-05 requires
 * `createEditorProjection` to refuse rather than guess at:
 * `EDITOR_UNSUPPORTED_PROJECTION`, no `ProjectedBlock`. `plugins/callout.js`
 * — the real plugin file this fixture's manifest actually names — always
 * preserves this evidence; this variant exists only to prove the refusal
 * path, never as a competing definition of the real rule.
 */
export function noEvidenceCalloutPlugin(): LoadedPlugin {
  // Contextually typed against `GutterpressPlugin` rather than an explicit
  // `(md: MarkdownIt) =>` annotation — see `MarkdownItInstance`'s own
  // comment above for why.
  const plugin: GutterpressPlugin = (md) => {
    md.core.ruler.after("layout_transform", "callout_plugin_transform_no_evidence", (state) => {
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
        // Deliberately NO `open.map = tok.map` — the no-evidence shape.
        //
        // And deliberately unrecoverable: the origin mechanism can bound a
        // consumed run from the tokens around it, so a map-less token is not
        // refused merely for being map-less. Stripping the consumed `inline`
        // token's own range leaves a removed token that carries no evidence
        // and is not a structural closer — genuinely partial evidence, one of
        // the six shapes `plugin-origin.ts` refuses by name, and what this
        // fixture needs to keep being: the REFUSED region other tests edit
        // inside of.
        next.map = null;
        out.push(open);
        out.push(new state.Token("plugin_callout_close", "div", -1));
        i += 2; // consumed paragraph_open + inline + paragraph_close
      }
      state.tokens = out;
    });
  };
  return { name: "gutterpress-plugin-callout-no-evidence", plugin, options: {} };
}

/**
 * The SAME production factory the CLI build/preview path calls
 * (`renderer.ts`'s `createMarkdownRenderer`, re-exported from
 * `gutterpress/render`), configured ONLY with {@link noEvidenceCalloutPlugin}
 * — used exclusively to build the deliberately-refused region fixture in
 * `real-book-plugin-locality.test.ts`. Every OTHER (evidence-bearing) use
 * across this lane's tests goes through {@link buildRealPluginBookProjection}
 * instead — G-03: "one resolved presentation context", never a parallel
 * parser config standing in for the real one.
 */
export function noEvidenceCalloutRenderer(): MarkdownItInstance {
  return createMarkdownRenderer([noEvidenceCalloutPlugin()]);
}
