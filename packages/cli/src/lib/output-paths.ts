/**
 * Output location + artifact naming, by convention rather than configuration.
 *
 * A book builds to `<manifestDir>/dist/<title-slug>/`, and its artifacts are
 * `<title-slug>-<format>.pdf`. This replaces the manifest's `output.dir` /
 * `output.filename` / `output.html` block: the slug keeps several books in one
 * tree apart, and the format is in the artifact name because the extension
 * cannot tell a PDF from a PDF/X one (they previously shared a single
 * configured filename, so building both left only the last).
 *
 * `--out` remains for per-invocation placement (CI, one-offs).
 */

import path from "node:path";
import { slugify } from "./slug.ts";

export const DIST_DIRNAME = "dist";

/** The rendered book document. Fixed: the desktop and index.html load it by name. */
export const BOOK_HTML = "book.html";

/** Slug identifying one book. Falls back to `book` for an unsluggable title. */
export function bookSlug(title: string | undefined): string {
  return slugify(title ?? "", "book");
}

/**
 * A book's output directory. Anchored on the MANIFEST's directory, not the CWD,
 * so building several projects from one working directory cannot collide.
 */
export function resolveOutputDir(manifestDir: string, title: string | undefined): string {
  return path.resolve(manifestDir, DIST_DIRNAME, bookSlug(title));
}

export function artifactName(title: string | undefined, format: "pdf" | "pdfx"): string {
  return `${bookSlug(title)}-${format}.pdf`;
}
