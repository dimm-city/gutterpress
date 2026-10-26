/**
 * Pure (node-free) book-HTML assembly.
 *
 * §1/§8: imports ONLY the pure render core (`renderer.ts`,
 * Gutterpress's marker parser (`markers.js`), `chapter-id.ts` and the string
 * helper `slug.ts`) — NO `node:*`, NO `fs`/`path`. The
 * caller injects an async `readText(relPath)` so the SAME assembly runs:
 *   - on the CLI / preview server with a `node:fs/promises`-backed reader
 *     (see `renderChapters` in `./index.ts`); and
 *   - in a future browser build, with a reader over whatever file access it
 *     has (none ships today — see `render.ts`).
 *
 * The file-reading wrapper is the ONLY node-coupled part of `renderChapters`,
 * so the pure markdown→HTML→book.html work lives here and the wrapper just
 * supplies inputs.
 *
 * The page-size default (#415) reads the assembled CSS with the engine's own
 * `@page` reader (`engine/shared/gcpm-extract.ts`: no imports, node-free) —
 * NOT `lib/page-size.ts`'s postcss one, which is host-side (`node:fs`) and
 * would drag Node into the `gutterpress/render` graph. The engine's reader is
 * also the right one on its merits: what `defaultPageSizeCss` decides from is
 * exactly what the viewer's and the compiler's `resolvePage` will read from
 * this same `<style>`, so the three cannot disagree about whether a size is set.
 */
import { MARKER_CSS } from "./markers.js";
import { GUTTERPRESS_CSS } from "./gutterpress-css.ts";
import { TWO_VERSIONS_CSS } from "./two-versions.ts";
import { TABLE_ALIGN_CSS } from "./table-align";
import { canonicalChapterId } from "./chapter-id";
import { slugify } from "../slug";
import { createMarkdownRenderer, type LoadedPlugin } from "./renderer";
import { collectHtmlImageRefs, type ImageRefEnv } from "./images";
import { lastPageMode, type PrintPadding } from "../../engine/shared/synthesis.ts";
import {
  formatPageSize,
  isPositivePoints,
  printAreaMeta,
  type PrintAreaSource,
} from "../../engine/shared/print-area.ts";
import { extract, resolvePage } from "../../engine/shared/gcpm-extract.ts";

/** Reader injected by the host: resolve a project-root-relative file → its text. */
export type ReadText = (relPath: string) => Promise<string>;

/**
 * One author-mistake warning, most emitted by Gutterpress's marker parser.
 * Mirrors the shape `markers.js`'s `warn()` pushes onto
 * `env.layoutWarnings` — see that file's header comment for the warning
 * `type`s (`ambiguous_marker_token`, `unrecognized_marker_token`,
 * `extra_bare_marker_token`, `unknown_marker`, `nested_spread`,
 * `continue_without_section`, `spread_without_pages`, `spread_eof_close`,
 * `page_outside_spread`, `pin_outside_page`, `unknown_gp_class`, `flush_art` —
 * the last two emitted by `gp-pin-scope.js`'s `gp_pin_scope_check`, same as
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
 * `section: true`) whose bare word is not one of its declared `variants`, and
 * for an `@page` / `@section` word that is a near-miss of a declared page /
 * section variant (any other word there is a free name and stays silent).
 *
 * Two come from outside the marker parser: `table_extra_cells` (a table
 * row with more cells than the header, `table.ts`) and `math_error` (a
 * formula MathJax could not typeset, `math.ts`).
 *
 * There is deliberately no `section_without_page`: a @section with no open
 * @page is valid authoring (17/17 false positives across two real books).
 */
export interface LayoutWarning {
  line: number;
  type: string;
  message: string;
  marker?: unknown;
  /** Set by a component's `validate` and by `flush_art`; absent means `"warning"`. */
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
  /** The book's BCP 47 language tag (manifest `language`); `en` when absent. */
  language?: string;
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
  /**
   * The manifest's `print` padding, written on `<html>` as
   * `data-gp-signature` / `data-gp-last-page` so the viewer shows the
   * blank pages the PDF build appends (`signaturePadding` in
   * engine/shared/synthesis.ts) and the two page counts agree.
   */
  print?: PrintPadding;
  /**
   * The project's print area — the resolved manifest's `page` block plus its
   * preset id and printer spec — written as `<meta name="gp-print-area">`
   * (engine/shared/print-area.ts) into EVERY assembled book, preview, build
   * and publish alike: the preview's print overlays judge the ink against it,
   * and both engines place pinned art on its art-safe line. Metadata only,
   * with one exception: its `width` x `height` is also the page size the book
   * prints at when no stylesheet sets one — see {@link defaultPageSizeCss}.
   */
  printArea?: PrintAreaSource;
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
 * The plain `@page { size }` a book prints at when none of its CSS sets one
 * (#415), or `null` when one is set or there is no page geometry to supply.
 *
 * `page.width` x `page.height` in the manifest (or the preset's) is what every
 * check and the preview's print overlays judge against, but what Chromium
 * prints is the stylesheet's plain `@page { size }` — and a book whose author
 * wrote `@page { margin }` alone, or replaced the scaffolded sheet, had none,
 * so it printed at Letter while everything else assumed the manifest's size.
 * Supplying that size as standard CSS, BEFORE the extensions' and the book's
 * own sheets, makes the print path, the preview and the checks agree on one
 * size; an author's own `size` still wins by the cascade, because this rule
 * is only written when there is none to lose to.
 *
 * "Set" means what the engine means: a plain `@page` rule — no name, no
 * `:first`/`:left`… — anywhere in `css` (inside `@media print` or an
 * extension's `@layer` included) sets `size`, i.e. `resolvePage`'s base page
 * has one; a named page's size is its own, not the book's geometry. `extract`
 * throws only for a geometry `var()` it cannot resolve; the engine reports
 * that, in its own words, when it reads this same CSS, so here it counts as
 * set and nothing is added.
 */
function defaultPageSizeCss(css: string, page: PrintAreaSource | undefined): string | null {
  if (!page || !isPositivePoints(page.width) || !isPositivePoints(page.height)) return null;
  try {
    if (resolvePage(extract(css)).decls.size !== undefined) return null;
  } catch {
    return null;
  }
  // The same spelling Book settings writes into a stylesheet: one size, one form.
  return `@page { size: ${formatPageSize(page)}; }`;
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

  const md = createMarkdownRenderer(opts.plugins, { language: opts.language });

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
    const env: ImageRefEnv & {
      layoutWarnings?: LayoutWarning[];
      sourceChapter?: string;
      /**
       * markdown-it-footnote numbers each render from 1 and names its ids
       * after the number (`fn1`, `fnref1`), so two files with notes would
       * share every id and a backlink could land in the other file. With a
       * `docId` it prefixes them (`fn-<docId>-1`); the chapter id, slugified
       * so it is legal in an HTML id and a URL fragment, keeps them apart.
       */
      docId: string;
    } = { docId: slugify(chapterId) };
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
  // author vocabulary. One more core block, the table column alignment
  // (table-align.ts), is deliberately UNLAYERED, with attribute specificity:
  // it replaces an inline style, which beat plugin CSS (layered) and a book's
  // generic `th { text-align }`, so it must still beat both, while a book rule
  // that is at least as specific and later can override it.
  const pageSize = defaultPageSizeCss(`${pluginCss}\n${projectCss}`, opts.printArea);
  const inlineCss = [
    "@layer gp.marker, gp.vocab;",
    // The two-versions box (two-versions.ts) rides in the marker layer: it
    // styles DOM only core emits, exactly like the marker wrappers.
    `/* gutterpress markers */\n@layer gp.marker {\n${MARKER_CSS.trim()}\n${TWO_VERSIONS_CSS.trim()}\n}`,
    `/* gutterpress */\n@layer gp.vocab {\n${GUTTERPRESS_CSS.trim()}\n}`,
    // The manifest's page size, only when no extension or book CSS sets one
    // (defaultPageSizeCss). Unlayered — `@page` stays out of cascade layers —
    // and ahead of every sheet that could have set it, so its place says what
    // it is: the default.
    pageSize ? `/* page size (manifest) */\n${pageSize}` : null,
    pluginCss ? `/* extension css */\n${pluginCss.trim()}` : null,
    // Unlayered, before the project CSS (equal specificity: the book's rule,
    // coming later, wins).
    `/* column alignment */\n${TABLE_ALIGN_CSS.trim()}`,
    projectCss ? `/* project css */\n${projectCss.trim()}` : null,
  ].filter(Boolean).join("\n\n");

  // SHIM — spec gap #152; see `preloadImages` above for why and when to delete.
  const preloadTags = (opts.preloadImages ?? [])
    .map((href) => `\n  <link rel="preload" as="image" href="${href}">`)
    .join("");

  const lastPage = opts.print && lastPageMode(opts.print);
  const printAttrs =
    (opts.print?.signature && opts.print.signature > 1 ? ` data-gp-signature="${opts.print.signature}"` : "") +
    (lastPage ? ` data-gp-last-page="${lastPage}"` : "");

  return `<!DOCTYPE html>
<html lang="${opts.language ?? "en"}"${printAttrs}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">${opts.printArea ? `\n  ${printAreaMeta(opts.printArea)}` : ""}
  <title>${title}</title>${preloadTags}
  <style data-project-css>\n${inlineCss}\n</style>
</head>
<body>
${bodyContent}
</body>
</html>`;
}
