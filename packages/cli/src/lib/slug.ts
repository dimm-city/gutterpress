/**
 * Shared slug helper — turn a human name / URL into a safe, lowercase,
 * hyphen-separated id usable as a folder or filename stem.
 *
 * One implementation, two historical call sites (DRY): the theme manager
 * (`themes/<id>/`) and project scaffolding (project folder / output filename).
 * They differed only in the empty-input fallback, so that is the single
 * parameter — everything else (NFKD normalise, diacritic strip, collapse
 * non-alphanumerics to single hyphens, trim edge hyphens) is identical.
 *
 * Bundle-safe (CLAUDE.md §1/§3): pure string work, no deps.
 */

/**
 * Slugify `name`. When the input contains no usable characters the result is
 * `fallback` (defaults to `""` — callers that need a placeholder pass one, e.g.
 * theme ids pass `"theme"`).
 */
export function slugify(name: string, fallback = ""): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // strip diacritics
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}
