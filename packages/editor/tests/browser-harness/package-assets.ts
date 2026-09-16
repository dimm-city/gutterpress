import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SFE-P1b Lane A — resolves the REAL, installed `@vscode/markdown-editor`
 * CSS assets the harness serves alongside the bundled test entry (harness
 * requirement: "with the package's editor.css + themes/default.css inlined").
 *
 * This is TEST-ONLY infrastructure (`packages/editor/tests/browser-harness/`
 * — scripts/check-browser-purity.mjs scans `src/`, not `tests/`, so Node
 * built-ins here do not violate D4's "no ... node:fs ... imports", which
 * governs `packages/editor/src/**` only), so `node:fs`/`node:path`/`node:url`
 * are fine here even though they would not be in `src/`.
 */
export interface HarnessCssAssets {
  /** `@vscode/markdown-editor`'s base editor chrome CSS. */
  readonly editorCss: string;
  /** `@vscode/markdown-editor`'s default theme CSS (`classNames:
   * ['md-theme-default']` scopes to this). */
  readonly defaultThemeCss: string;
  /** The find-widget CSS `editor.css` itself `@import`s (`../contrib/find/find.css`,
   * relative to `editor.css`'s own directory) — not a package-exported
   * subpath, so it is read by a plain filesystem path derived from the
   * already-resolved `editor.css` location, not a module resolution. */
  readonly findCss: string;
  /** The codicon icon font's CSS, `@import`ed by `editor.css` as the bare
   * specifier `@vscode/codicons/dist/codicon.css`. */
  readonly codiconCss: string;
  /** The codicon icon font binary (`codicon.ttf`) `codiconCss` itself
   * references via a relative `url(./codicon.ttf?...)`. */
  readonly codiconFont: Buffer;
}

/**
 * Resolves and reads every CSS/font asset `editor.css`'s own `@import`
 * chain needs, so the harness page can serve them without 404s (a 404'd
 * icon font degrades to raw glyph characters rendering as visible text
 * inside editor chrome — harmless to this run's cases 1/1b/2/3, which
 * assert on `EditorDocumentHost` source text and targeted DOM queries, not
 * whole-container `textContent`, but still worth avoiding as console noise
 * a liveness check could otherwise misinterpret).
 *
 * `@vscode/codicons` is `@vscode/markdown-editor`'s own direct dependency,
 * not a direct OR hoisted dependency of `packages/editor` — bun's isolated
 * linker deliberately does not expose a package's transitive dependencies
 * to a consumer that never declared them (a "phantom dependency" this repo
 * does not want `packages/editor` to grow just to satisfy a test-only CSS
 * asset). Resolving it FROM `@vscode/markdown-editor`'s own installed
 * directory (`Bun.resolveSync(specifier, markdownEditorPkgRoot)`) reuses
 * markdown-editor's real, already-installed dependency graph instead —
 * verified live against the exact pinned 0.0.2-87 runtime (dist/index.js byte-identical to 0.0.2-85) — so this harness
 * adds ZERO new devDependencies to `packages/editor/package.json` for CSS
 * loading (package.json wiring note: "add needed devDeps ONLY if truly
 * required").
 */
export async function loadMarkdownEditorCssAssets(): Promise<HarnessCssAssets> {
  const editorCssPath = fileURLToPath(import.meta.resolve("@dimm-city/vscode-markdown-editor/editor.css"));
  const defaultThemeCssPath = fileURLToPath(
    import.meta.resolve("@dimm-city/vscode-markdown-editor/themes/default.css"),
  );

  // editorCssPath = "<pkgRoot>/src/view/editor.css" -- three `dirname`
  // calls (editor.css -> src/view -> src -> pkgRoot) reach the package
  // root without depending on bun's store hashing scheme.
  const markdownEditorPkgRoot = dirname(dirname(dirname(editorCssPath)));

  // `editor.css`'s own `@import '../contrib/find/find.css'` is relative to
  // its OWN directory (`src/view/`), so this mirrors that exact relative
  // navigation against the resolved absolute path rather than guessing.
  const findCssPath = join(dirname(editorCssPath), "..", "contrib", "find", "find.css");

  const codiconCssPath = Bun.resolveSync(
    "@vscode/codicons/dist/codicon.css",
    markdownEditorPkgRoot,
  );
  const codiconFontPath = Bun.resolveSync(
    "@vscode/codicons/dist/codicon.ttf",
    markdownEditorPkgRoot,
  );

  const [editorCss, defaultThemeCss, findCss, codiconCss, codiconFont] = await Promise.all([
    readFile(editorCssPath, "utf8"),
    readFile(defaultThemeCssPath, "utf8"),
    readFile(findCssPath, "utf8"),
    readFile(codiconCssPath, "utf8"),
    readFile(codiconFontPath),
  ]);

  return { editorCss, defaultThemeCss, findCss, codiconCss, codiconFont };
}
