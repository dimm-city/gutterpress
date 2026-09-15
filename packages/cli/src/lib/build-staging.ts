import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";
import { getAssetPath } from "./embedded-assets";
import { inlineShapeUrls, planImageCopies, type AssetCopy } from "./asset-inline";
import {
  decodeHtmlAttribute,
  placeholderOutputPath,
  placeholderPng,
  rewriteActiveHtml,
  rewriteMissingImageReferences,
} from "./missing-asset-placeholder";
import { BuildError } from "./build-error";

/**
 * `--format html`: ship the self-contained `book.html` (already fully
 * inlined — see `lib/asset-inline.ts`) alongside a copy of the native engine's
 * viewer bundle, with one `<script src="engine/gutterpress-viewer.js">`
 * injected before `</head>`. The viewer paginates the document in the
 * browser on load — no headless Chromium at build time, no DOM
 * serialization (see the "Not snapshotting the viewer's fragmented DOM" note
 * in the migration plan).
 */
export async function shipViewerHtml(
  htmlFile: string,
  outDir: string
): Promise<void> {
  await fsp.mkdir(path.join(outDir, "engine"), { recursive: true });
  await fsp.copyFile(
    await getAssetPath("engine/gutterpress-viewer.js"),
    path.join(outDir, "engine/gutterpress-viewer.js")
  );
  const tag = '  <script src="engine/gutterpress-viewer.js"></script>\n';
  const html = await fsp.readFile(htmlFile, "utf-8");
  await fsp.writeFile(
    htmlFile,
    /<\/head>/i.test(html) ? html.replace(/<\/head>/i, tag + "</head>") : tag + html,
    "utf-8"
  );
}

/** The copy plan, handed to `onPlan` before a single byte is written. */
export interface StagingPlan {
  /** Refs that name no in-project file at all (absolute, or outside the book). */
  unresolved: string[];
  /** How many files the staging is about to copy. */
  copyCount: number;
}

/** What `stageBookAssets` could not stage, for the caller to report. */
export interface StagedAssets {
  /** Output-relative paths whose source file does not exist; a placeholder shipped. */
  missing: string[];
}

/**
 * Turn a freshly rendered `book.html` plus its reported asset references into a
 * COMPLETE, self-contained staged book in `outDir` — the exact document both
 * renderers must paginate.
 *
 * THE one implementation: `renderBook` (every real build/export) and the
 * preview/print parity gate both call this, so the gate can never measure a
 * document the build would not have produced. It previously hand-rolled a bare
 * `copyFile` loop, which (a) hard-crashed with a raw `ENOENT` on any book
 * carrying a stale image path — i.e. the tool that enforces preview↔print
 * parity could not run on the real books that need it — and (b) skipped
 * `inlineShapeUrls`, so `.gp-shape` wrapping silently differed from the build.
 *
 * A missing image is NOT fatal: the same magenta placeholder the build ships
 * (see missing-asset-placeholder.ts) is substituted and every reference
 * rewritten to it, so the staged layout matches the build's. What could not be
 * staged is returned, never swallowed — callers decide how loud to be.
 *
 * A ref that resolves to no in-project file at all is a different matter, and
 * the two callers disagree about it: a real build refuses to ship (it throws
 * from `onPlan`, before any bytes are copied), while the gate reports it and
 * measures the book anyway. That is why the plan is handed out rather than
 * judged here.
 */
export async function stageBookAssets(options: {
  /** Project dir every image ref resolves against. */
  renderDir: string;
  /** Directory the staged book is being assembled in. */
  outDir: string;
  /** The rendered `book.html`, rewritten in place. */
  htmlFile: string;
  /** Image `src` values the render reported. */
  imageRefs: Iterable<string>;
  /** CSS images too large to inline, already planned by the render. */
  cssAssets: AssetCopy[];
  /** Called once with the copy plan; throw here to abort before copying. */
  onPlan?: (plan: StagingPlan) => void;
  /**
   * Strip every relative `<a href>` from the staged book — for print
   * artifacts only, where no relative target can be opened (see
   * {@link dropRelativeLinkHrefs}). Off by default: `--format html` ships its
   * images beside `book.html` and keeps every href.
   */
  dropRelativeLinks?: boolean;
}): Promise<StagedAssets> {
  const { renderDir, outDir, htmlFile, imageRefs, cssAssets, onPlan, dropRelativeLinks } =
    options;
  const { copies: imageCopies, errors, destinations } = await planImageCopies(
    renderDir,
    imageRefs,
  );

  const copies = [...cssAssets, ...imageCopies];
  onPlan?.({ unresolved: errors, copyCount: copies.length });
  const missingPlaceholders = copies.length
    ? await copyReferencedAssets(copies, outDir)
    : new Map<string, string>();

  // .gp-shape images: inline the mirrored --gp-shape URLs as data: URIs so
  // shape-outside works when the staged book is loaded via file:// (opaque
  // origins block its pixel reads; the http preview needs no such help) —
  // see inlineShapeUrls' doc comment. After the copy step so the staged
  // files are what get inlined.
  const rendered = await fsp.readFile(htmlFile, "utf8");
  let staged = rendered;
  if (missingPlaceholders.size > 0) {
    // CSS assets already use their output-relative destination in the inlined
    // <style>; prose images may preserve an authored spelling such as
    // `./images/a.jpg` or a percent-escaped path. Cover both from the one copy
    // plan, then rewrite src/srcset/CSS URLs before Chromium sees the document.
    const rewrites = new Map(missingPlaceholders);
    for (const [ref, dest] of destinations) {
      const placeholder = missingPlaceholders.get(dest);
      if (placeholder) rewrites.set(ref, placeholder);
    }
    staged = rewriteMissingImageReferences(staged, rewrites);
  }
  if (dropRelativeLinks) staged = dropRelativeLinkHrefs(staged);
  if (staged.includes("--gp-shape:")) staged = await inlineShapeUrls(staged, outDir);
  if (staged !== rendered) await fsp.writeFile(htmlFile, staged, "utf8");

  return { missing: [...missingPlaceholders.keys()].sort() };
}

/**
 * Copy the planned assets into `outDir`, preserving each one's output-relative
 * path. Parallel because these are independent file copies and a book's image
 * set is routinely in the hundreds — the old serial `copyDir` walked every
 * asset directory one `copyFile` at a time.
 */
async function copyReferencedAssets(
  copies: AssetCopy[],
  outDir: string
): Promise<Map<string, string>> {
  const dirs = new Set(
    copies.map((c) => path.dirname(path.resolve(outDir, c.to)))
  );
  await Promise.all([...dirs].map((d) => fsp.mkdir(d, { recursive: true })));

  // A missing image substitutes a loud placeholder instead of aborting the
  // book — see missing-asset-placeholder.ts for why. Any OTHER copy failure
  // (permissions, a directory where a file should be, a full disk) still
  // throws: those are environment faults the author cannot fix by editing
  // their markdown, and silently papering over them would hide real damage.
  const missing = new Map<string, string>();
  await Promise.all(
    copies.map(async (c) => {
      const dest = path.resolve(outDir, c.to);
      try {
        await fsp.copyFile(c.from, dest);
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
          const placeholder = placeholderOutputPath(c.to);
          const placeholderDest = path.resolve(outDir, placeholder);
          await fsp.mkdir(path.dirname(placeholderDest), { recursive: true });
          await fsp.writeFile(placeholderDest, placeholderPng());
          missing.set(c.to, placeholder);
          return;
        }
        throw new BuildError(
          `Could not copy asset ${c.from} → ${c.to}: ` +
            (err instanceof Error ? err.message : String(err)),
          1
        );
      }
    })
  );

  return missing;
}

/**
 * Can a PDF reader follow this href? Only an in-document `#fragment` (a GoTo
 * destination) or a URL with a scheme other than `file:`. Everything else —
 * a relative or absolute path, `file:`, and the shapes that name no asset to
 * copy (empty, `?query`, `//host`) — Chromium resolves against the staged
 * document's `file://` base URL, which is dead for every reader.
 */
export function isPrintResolvableHref(href: string): boolean {
  const value = href.trim();
  if (value.startsWith("#")) return true;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  return scheme !== undefined && scheme !== "file";
}

/**
 * Remove the `href` of every `<a>` that {@link isPrintResolvableHref}
 * rejects, keeping the element and its text. Print-production tooling
 * (permanent, not a shim).
 *
 * The staged `book.html` is printed from a `file://` URL in a per-build temp
 * dir (engine/compiler/build.ts navigates `pathToFileURL(input)`), and
 * Chromium writes the ABSOLUTE resolved URL of every relative `href` into
 * the PDF's link annotation: `file:///tmp/gutterpress-build-<random>/docs/
 * constitution.md`. That leaks the build machine's layout, is dead for every
 * reader, and makes two builds of the same sources differ in bytes (#263).
 * A PDF has no files beside it, so NO relative target is openable from one —
 * not a same-book chapter file, not even an image the build copied into the
 * work dir. The href is therefore dropped rather than rewritten.
 * `source.links.dangling` tells the author which links this affects before
 * the build.
 *
 * Comments and raw-text / literal-content elements (a `<pre>` showing HTML)
 * stay untouched — see {@link rewriteActiveHtml}.
 */
export function dropRelativeLinkHrefs(html: string): string {
  const hrefAttr = /\s+href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
  return rewriteActiveHtml(html, (tag) => {
    if (!/^<a(?=[\s/>])/i.test(tag)) return tag;
    const m = hrefAttr.exec(tag);
    if (!m) return tag;
    const href = decodeHtmlAttribute(m[1] ?? m[2] ?? m[3] ?? "");
    return isPrintResolvableHref(href) ? tag : tag.replace(hrefAttr, "");
  });
}

/**
 * Create a unique scratch directory under the OS temp dir. Used only for
 * PDF/X intermediates (`raw.pdf`, Ghostscript work files) — never for staging
 * assets. Must not be resolved against `process.cwd()`: `runBuild` is exported
 * and called by the desktop host, so writing scratch dirs into the caller's
 * directory is a hidden side effect. Callers remove it in a `finally`.
 */
export async function createStageRoot(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), "gutterpress-stage-"));
}
