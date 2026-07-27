/**
 * Output location + artifact naming — by CONVENTION, not configuration.
 *
 * Every book writes to `<manifestDir>/dist/<title-slug>/`, and its artifacts are
 * named `<title-slug>-<format>.<ext>`. That single rule replaces the manifest's
 * old `output.dir` / `output.filename` / `output.html` block:
 *
 *   - **Multi-book trees separate themselves.** Several manifests anchored in
 *     one tree (a book plus its companion design guide, a series) each get their
 *     own subdirectory with no configuration and no collision.
 *   - **`pdf` and `pdfx` stop overwriting each other.** They were previously two
 *     formats sharing ONE `output.filename`, so building both left only the
 *     last one — the very collision the config field appeared to prevent.
 *   - **The shop-facing filename is right by default.** The Save dialog, the
 *     publish upload and a plain file browse all see `dragon-heist-pdfx.pdf`
 *     with no name derivation logic at any of those edges.
 *
 * `--out` remains the per-invocation escape hatch (CI staging, one-offs); it is
 * an invocation concern, which is why it lives on the command line and not in
 * the manifest.
 */

import path from "node:path";
import { slugify } from "./slug.ts";

/** Directory name holding every book's output under a project root. */
export const DIST_DIRNAME = "dist";

/** The rendered book document. Fixed: the viewer and index.html load it by name. */
export const BOOK_HTML = "book.html";

/**
 * Slug identifying one book, derived from its title. Falls back to `"book"` for
 * a title that contains no slug-able characters (e.g. only punctuation), so the
 * output path is always well-formed.
 */
export function bookSlug(title: string | undefined): string {
  return slugify(title ?? "", "book");
}

/**
 * The output directory for a book: `<manifestDir>/dist/<slug>/`.
 *
 * Anchored on the MANIFEST's directory rather than the CWD so building several
 * projects from one working directory cannot collide — the same reasoning that
 * previously applied to `config.output.dir`.
 */
export function resolveOutputDir(manifestDir: string, title: string | undefined): string {
  return path.resolve(manifestDir, DIST_DIRNAME, bookSlug(title));
}

/**
 * Artifact filename for a book + format.
 *
 * The format is part of the NAME because the extension cannot distinguish a
 * plain PDF from a PDF/X one, and both are legitimate deliverables of the same
 * book — a print shop wants `-pdfx`, a storefront wants `-pdf`.
 */
export function artifactName(title: string | undefined, format: "pdf" | "pdfx"): string {
  return `${bookSlug(title)}-${format}.pdf`;
}
