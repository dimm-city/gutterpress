/**
 * Pure (node-free) book-HTML assembly.
 *
 * §1/§8: imports ONLY the pure render core (`renderer.ts`,
 * Gutterpress's marker parser (`markers.js`), and `chapter-id.ts`) — NO
 * `node:*`, NO `fs`/`path`. The
 * caller injects an async `readText(relPath)` so the SAME assembly runs:
 *   - on the CLI / preview server with a `node:fs/promises`-backed reader
 *     (see `renderChapters` in `./index.ts`); and
 *   - in a future browser build, with a reader over whatever file access it
 *     has (none ships today — see `render.ts`).
 *
 * The file-reading wrapper is the ONLY node-coupled part of `renderChapters`,
 * so the pure markdown→HTML→book.html work lives here and the wrapper just
 * supplies inputs.
 */
import { MARKER_CSS } from "./markers.js";
import { GUTTERPRESS_CSS } from "./gutterpress-css.ts";
import { canonicalChapterId } from "./chapter-id";
import { createMarkdownRenderer, type LoadedPlugin } from "./renderer";
import { collectHtmlImageRefs, type ImageRefEnv } from "./images";

/** Reader injected by the host: resolve a project-root-relative file → its text. */
export type ReadText = (relPath: string) => Promise<string>;

/**
 * One author-mistake warning emitted by Gutterpress's marker parser.
 * Mirrors the shape `markers.js`'s `warn()` pushes onto
 * `env.layoutWarnings` — see that file's header comment for the warning
 * `type`s (`ambiguous_marker_token`, `unrecognized_marker_token`,
 * `extra_bare_marker_token`, `unknown_marker`, `nested_spread`,
 * `continue_without_section`, `spread_without_pages`, `spread_eof_close`,
 * `page_outside_spread`, `pin_outside_page`, `unknown_gp_class` — the last
 * emitted by `gp-pin-scope.js`'s `gp_pin_scope_check`, same as
 * `pin_outside_page`, see #226).
 *
 * #240 (declarative container components) adds three more, all emitted by
 * `markers.js`'s `layout_transform`/`scanForUnknownDeclaredMarkers` for a
 * plugin-DECLARED marker: `deprecated_marker` (a `{ deprecated: "…" }`
 * marker, or its `@end-` form, was used), `declared_marker_close_without_open`
 * (an `@end-<name>` with nothing of that kind open — the declared-marker
 * twin of `continue_without_section`), and `declared_marker_eof_close` (an
 * open declared container reached EOF without `autoCloseAt: ["eof"]` — the
 * declared-marker twin of `spread_eof_close`). `unknown_marker` above is
 * reused, not duplicated: a typo close to a DECLARED name warns through the
 * same type, via a second, unconditional check modeled on `unknown_gp_class`
 * rather than the core-only `scanForMistypedMarkers`.
 *
 * A declared marker's opt-in `validate` adds two more: `component_invalid`
 * (one problem the validator reported — the only warning that may carry a
 * `severity`) and `component_validate_failed` (the validator threw or
 * returned something unusable).
 *
 * `unknown_variant` is emitted for a declared marker (container or
 * `section: true`) whose bare word is not one of its declared `variants`.
 *
 * There is deliberately no `section_without_page`: a @section with no open
 * @page is valid authoring (17/17 false positives across two real books).
 */
export interface LayoutWarning {
  line: number;
  type: string;
  message: string;
  marker?: unknown;
  /** Set only by a component's `validate`; absent means `"warning"`. */
  severity?: "error" | "warning" | "info";
}

/**
 * The Chromium milestone that paints a `@page { background: url() }` image
 * with no other reference to it (spec gap #152). Measured 2026-09-03: Chrome
 * for Testing 152.0.7977.54 and the CI runner's Chrome stable both paint it;
 * Chrome 151.0.7922.75 dropped it (docs/known-limitations.md §3). The
 * `preloadImages` shim below expires when the engine's floor
 * (`REQUIRED_MILESTONE`, engine/shared/cdp.ts) reaches this — the canary in
 * engine/compiler/page-background-chromium-bug.canary.test.ts enforces that.
 */
export const PAGE_BACKGROUND_FIXED_MILESTONE = 152;

export interface AssembleBookHtmlOptions {
  /** Ordered list of project-root-relative `.md` files to concatenate. */
  files: string[];
  /** Async reader the assembler uses to fetch each file's contents. */
  readText: ReadText;
  /**
   * Fully-inlined project CSS (fonts already embedded as `data:` URIs by
   * `lib/asset-inline.ts`). Emitted as a `<style data-project-css>` block —
   * NOT as `<link href>`.
   *
   * Inlining is what makes a stylesheet's location irrelevant to the output, so
   * themes (`themes/<id>/theme.css`) and shared design systems
   * (`../design-guide/styles/guide.css`) need no copying, no flattening and no
   * destination indirection. The assembled document therefore has one
   * deterministic CSS payload, with no output-relative stylesheet links to
   * relocate or lose during staging.
   */
  projectCss?: string;
  /**
   * SHIM — spec gap #152, fixed upstream in Chromium
   * {@link PAGE_BACKGROUND_FIXED_MILESTONE}. Output-relative hrefs of the
   * images the project's stylesheets staged (`inlineStyles`'s copy plan,
   * verbatim), each emitted as one `<link rel="preload" as="image">`.
   *
   * Chromium reaches an `@page`-only `url()` lazily, during the print, and the
   * print path CDP drives never waits for a pending resource — so the sheet
   * comes back with its background colour alone, no error, a valid PDF of
   * blank paper (docs/known-limitations.md §3; mechanism analysis in
   * PR #187).
   *
   * What the preload buys is that the fetch STARTS during document load
   * instead of during the print. That is not a timing guarantee: a response
   * slow enough still loses (measured — held 1500 ms server-side, the preload
   * row drops too). On the PDF path the asset is a local file staged beside
   * `book.html`, so there is no server to be slow; a published `--format html`
   * bundle read over a slow network can still lose the race.
   *
   * A second ELEMENT reference is not an alternative. Any `[src]` naming the
   * URL drops the page box (measured 12/12, with or without a preload, in
   * either document order) — which is why `asset-inline.ts` content-addresses
   * every CSS image so no element can name one.
   *
   * WHEN IT GOES: Chromium fixed the bug in milestone
   * {@link PAGE_BACKGROUND_FIXED_MILESTONE} (measured 2026-09-03: Chrome 152
   * paints the sole-referenced image, 151 dropped it). The preload changes
   * nothing on a fixed Chromium, and it still protects every Chromium the
   * engine accepts below that (`REQUIRED_MILESTONE` in `engine/shared/cdp.ts`,
   * 148 — what Electron 42 ships), so it stays until the floor reaches the
   * fix. The expiry canary,
   * `engine/compiler/page-background-chromium-bug.canary.test.ts`, goes red
   * the day the floor is raised that far — delete this option, the `.map()`
   * that feeds it in `markdown/index.ts`, the constant, and the canary.
   *
   * The copy plan is the source, NOT a scan of the assembled CSS: `pluginCss`
   * never passes through `inlineStyles`, so a `url()` inside it is never
   * staged and a scan would emit a `<link>` to a file that does not exist.
   * The plan is already deduped (keyed by destination), already excludes fonts
   * (inlined) and remote urls (left alone), and already covers the
   * `--paper: url()` + `var(--paper)` shape, because `walkDecls` sees custom
   * properties like any other declaration.
   */
  preloadImages?: string[];
  title?: string;
  plugins?: LoadedPlugin[];
  pluginCss?: string;
  /** Add a layout-neutral source-file id to source-mapped preview blocks. */
  annotateSourceChapters?: boolean;
  /**
   * Per-chapter callback receiving any `env.layoutWarnings`
   * Gutterpress's marker parser computed while rendering `file` (only called
   * when that chapter produced at least one). `file` is the same canonical
   * chapter id used for `data-chapter-src`, so a host can attribute a warning
   * to the exact source file. Optional, and it never changes output.
   */
  onChapterWarnings?: (file: string, warnings: LayoutWarning[]) => void;
  /**
   * Every image reference the assembled document emits, deduped and in document
   * order — markdown image tokens (recorded by `registerImageRule`) plus raw
   * HTML `<img src>` found by scanning the output.
   *
   * This is what makes "referenced means shipped" true: the build turns these
   * into its copy plan (`planImageCopies`), so no author-maintained directory
   * list can drift from what the book actually uses.
   */
  onImageRefs?: (refs: string[]) => void;
}

/**
 * Assemble a single `book.html` string from the given markdown files.
 *
 * Pure: every input (the file list, their contents via `readText`, the resolved
 * CSS hrefs) is supplied by the caller, so the output is byte-identical for
 * identical inputs.
 */
export async function assembleBookHtml(opts: AssembleBookHtmlOptions): Promise<string> {
  const title = opts.title ?? "Document";
  const projectCss = opts.projectCss ?? "";
  const pluginCss = opts.pluginCss ?? "";
  const files = opts.files;

  if (files.length === 0) {
    throw new Error("No markdown files to render");
  }

  const md = createMarkdownRenderer(opts.plugins);

  // Build source files concatenate directly into the body. Incremental preview
  // adds one file-level wrapper so each source can be page-isolated. @chapter is
  // a core Gutterpress marker (parsed + wrapped + labeled by `markers.js`'s
  // `openChapter`, not any project-specific plugin —
  // see CLAUDE.md's "frozen chapter-opener" note) that owns author-facing
  // chapter wrappers and IDs; the preview wrapper is internal-only.
  let bodyContent = "";
  const imageRefs = new Set<string>();
  for (const file of files) {
    // ONE canonical identity per chapter (see chapter-id.ts): the same
    // normalized string is used to resolve the file AND as the data-chapter-src
    // tag used by preview source inspection and chapter-scoped scroll restore.
    const chapterId = canonicalChapterId(file);
    let content: string;
    try {
      content = await opts.readText(chapterId);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read file ${file}: ${errorMsg}`);
    }
    // Thread a per-chapter env through md.render: a bare `md.render(content)`
    // would compute every marker warning into markdown-it's own throwaway
    // internal env and discard it the instant this call returned. Passing our
    // own env is what makes the marker parser's author-mistake diagnostics
    // observable to a caller.
    const env: { layoutWarnings?: LayoutWarning[]; sourceChapter?: string } & ImageRefEnv = {};
    if (opts.annotateSourceChapters) env.sourceChapter = chapterId;
    // Always use the public render path: standard markdown-it plugins may
    // legitimately wrap md.render(), and preview/build must both observe it.
    const rendered = md.render(content, env);
    if (env.layoutWarnings && env.layoutWarnings.length > 0) {
      opts.onChapterWarnings?.(chapterId, env.layoutWarnings);
    }
    for (const ref of env.imageRefs ?? []) imageRefs.add(ref);
    bodyContent += rendered + "\n";
  }

  // Raw HTML <img> (author-written or plugin-emitted) never passes through the
  // markdown image rule, so scan the assembled body for it too.
  if (opts.onImageRefs) {
    for (const ref of collectHtmlImageRefs(bodyContent)) imageRefs.add(ref);
    opts.onImageRefs([...imageRefs]);
  }

  // Inject built-in + extension + project CSS as a single <style> block.
  //
  // Cascade order (#227): core's two blocks are wrapped in cascade layers —
  // `@layer gp.marker, gp.vocab;` declares the order, then each block gets
  // its own named layer. `pluginCss` (index.ts) follows, one `ext.<name>`
  // layer per extension in `extensions:` list order — declared after core's,
  // so every extension beats core and later extensions beat earlier ones.
  // Per the CSS Cascade Layers spec, unlayered CSS ALWAYS wins over layered
  // CSS regardless of selector specificity, so the author's own project
  // stylesheets — left UNLAYERED below — win over core and every extension
  // "by construction" rather than by outrunning them on specificity or
  // injection order. `:where()` stays inside MARKER_CSS's own break/orphan
  // rules because those still need to lose to an author's UNLAYERED rule at
  // ANY specificity too (an author-declared layer is a separate concern —
  // see the styling guide's cascade-layers section).
  // The two core blocks stay separate by ownership: MARKER_CSS supports the
  // marker-generated DOM, while gutterpress-css.ts owns the broader `gp-*`
  // author vocabulary.
  const inlineCss = [
    "@layer gp.marker, gp.vocab;",
    `/* gutterpress markers */\n@layer gp.marker {\n${MARKER_CSS.trim()}\n}`,
    `/* gutterpress */\n@layer gp.vocab {\n${GUTTERPRESS_CSS.trim()}\n}`,
    pluginCss ? `/* extension css */\n${pluginCss.trim()}` : null,
    projectCss ? `/* project css */\n${projectCss.trim()}` : null,
  ].filter(Boolean).join("\n\n");

  // SHIM — spec gap #152; see `preloadImages` above for why and when to delete.
  const preloadTags = (opts.preloadImages ?? [])
    .map((href) => `\n  <link rel="preload" as="image" href="${href}">`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>${preloadTags}
  <style data-project-css>\n${inlineCss}\n</style>
</head>
<body>
${bodyContent}
</body>
</html>`;
}
