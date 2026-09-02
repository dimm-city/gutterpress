/**
 * Pure (node-free) book-HTML assembly.
 *
 * §1/§8 / ADR 0004: imports ONLY the pure render core (`renderer.ts`,
 * Gutterpress's marker parser (`markers.js`), and `chapter-id.ts`) — NO
 * `node:*`, NO `fs`/`path`. The
 * caller injects an async `readText(relPath)` so the SAME assembly runs:
 *   - on the CLI / preview server with a `node:fs/promises`-backed reader
 *     (see `renderChapters` in `./index.ts`); and
 *   - in the browser (the PWA WebAdapter, #33) with a File System Access reader.
 *
 * This is the "fix the core primitive" split (CLAUDE.md §0/§6): the file-reading
 * wrapper is the ONLY node-coupled part of the old `renderChapters`, so the pure
 * markdown→HTML→book.html work lives here and the wrapper just supplies inputs.
 */
import { MARKER_CSS } from "./markers.js";
import { GUTTERPRESS_CSS } from "./gutterpress-css.ts";
import { canonicalChapterId } from "./chapter-id";
import { createMarkdownRenderer, type LoadedPlugin } from "./renderer";
import { collectHtmlImageRefs, type ImageRefEnv } from "./images";

/** Reader injected by the host: resolve a project-root-relative file → its text. */
export type ReadText = (relPath: string) => Promise<string>;

/**
 * One author-mistake warning emitted by Gutterpress's marker parser (ARCH finding #4).
 * Mirrors the shape `markers.js`'s `warn()` pushes onto
 * `env.layoutWarnings` — see that file's header comment for the warning
 * `type`s (`ambiguous_marker_token`, `unrecognized_marker_token`,
 * `extra_bare_marker_token`, `unknown_marker`, `nested_spread`,
 * `continue_without_section`, `spread_without_pages`, `spread_eof_close`,
 * `page_outside_spread`, `pin_outside_page`, `unknown_gp_class` — the last
 * emitted by `gp-pin-scope.js`'s `gp_pin_scope_check`, same as
 * `pin_outside_page`, see #226).
 *
 * `section_without_page` and `implicit_page` were REMOVED 2026-08-12: a
 * @section with no open @page is valid authoring (audited, 17/17 false
 * positives across two real books), and the `implicitPage` option that
 * produced the latter was unreachable and latently broken.
 */
export interface LayoutWarning {
  line: number;
  type: string;
  message: string;
  marker?: unknown;
}

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
   * SHIM — spec gap #152. Output-relative hrefs of the images the project's
   * stylesheets staged (`inlineStyles`'s copy plan, verbatim), each emitted as
   * one `<link rel="preload" as="image">`.
   *
   * Chromium reaches an `@page`-only `url()` lazily, during the print, and the
   * print path CDP drives never waits for a pending resource — so the sheet
   * comes back with its background colour alone, no error, a valid PDF of
   * blank paper (docs/known-limitations.md §3; mechanism in
   * PR #187's `docs/analysis/why-page-background-drops.md`).
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
   * WHAT PROVES IT IS STILL NEEDED: the expiry canary,
   * `engine/compiler/page-background-chromium-bug.canary.test.ts`. The day it
   * goes red, Chromium has fixed the bug — delete this option, the `.map()`
   * that feeds it in `markdown/index.ts`, and the canary.
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
  /**
   * Wrap each source file in `<div class="gutterpress-chapter"
   * data-chapter-src="<file>">`. Used only by incremental preview so one
   * source can be paginated and replaced independently. Off by default; build
   * output is unaffected.
   */
  wrapChapters?: boolean;
  /** Add a layout-neutral source-file id to source-mapped preview blocks. */
  annotateSourceChapters?: boolean;
  /**
   * ARCH finding #4: per-chapter callback receiving any `env.layoutWarnings`
   * Gutterpress's marker parser computed while rendering `file` (only called
   * when that chapter produced at least one). `file` is the same canonical
   * chapter id used for `data-chapter-src`, so a host can attribute a warning
   * to the exact source file. Additive/optional — omitting it reproduces the
   * prior throwaway-env behavior exactly, so this cannot change output for
   * existing callers (e.g. the desktop's WebAdapter, which still gets a plain
   * `Promise<string>` back).
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
 * CSS hrefs) is supplied by the caller. Mirrors the exact `<head>`/body/CSS
 * emission the old `renderChapters` produced, so the CLI output is byte-identical
 * for identical inputs.
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
    // Thread a per-chapter env through md.render (ARCH #4): previously this was
    // a bare `md.render(content)`, so every marker warning computed into
    // `env.layoutWarnings` landed in markdown-it's own throwaway internal env and was
    // discarded the instant this call returned. Passing our own env here is the
    // ONLY change needed to make ~150 lines of already-written, already-tested
    // author-mistake diagnostics (§6: the marker parser still owns computing them)
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
    if (opts.wrapChapters) {
      const safe = chapterId.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      bodyContent += `<div class="gutterpress-chapter" data-chapter-src="${safe}">\n${rendered}\n</div>\n`;
    } else {
      bodyContent += rendered + "\n";
    }
  }

  // Raw HTML <img> (author-written or plugin-emitted) never passes through the
  // markdown image rule, so scan the assembled body for it too.
  if (opts.onImageRefs) {
    for (const ref of collectHtmlImageRefs(bodyContent)) imageRefs.add(ref);
    opts.onImageRefs([...imageRefs]);
  }

  // Inject built-in + user-plugin CSS as a single <style> block.
  //
  // Cascade order (#227): core's two blocks are wrapped in cascade layers —
  // `@layer gp.marker, gp.vocab;` declares the order, then each block gets
  // its own named layer. Per the CSS Cascade Layers spec, unlayered CSS
  // ALWAYS wins over layered CSS regardless of selector specificity, so
  // user plugin CSS and the author's own project stylesheets — both left
  // UNLAYERED below, along with any `engineStyles.native` sheet (already
  // folded into `projectCss` by `resolveActiveStyles`/manifest.ts before it
  // reaches here) — win over core's two layers "by construction" rather
  // than by outrunning them on specificity or injection order. This
  // replaces source-order + `:where()` as the mechanism that makes "author
  // wins" true; `:where()` stays inside MARKER_CSS's own break/orphan rules
  // because those still need to lose to an author's UNLAYERED rule at ANY
  // specificity too (an author-declared layer is a separate concern — see
  // the styling guide's cascade-layers section for the recommended book
  // convention).
  // The two core blocks stay separate by ownership: MARKER_CSS supports the
  // marker-generated DOM, while gutterpress-css.ts owns the broader `gp-*`
  // author vocabulary.
  const inlineCss = [
    "@layer gp.marker, gp.vocab;",
    `/* gutterpress markers */\n@layer gp.marker {\n${MARKER_CSS.trim()}\n}`,
    `/* gutterpress */\n@layer gp.vocab {\n${GUTTERPRESS_CSS.trim()}\n}`,
    pluginCss ? `/* user plugin css */\n${pluginCss.trim()}` : null,
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
