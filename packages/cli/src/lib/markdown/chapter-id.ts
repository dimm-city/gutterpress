/**
 * Canonical chapter identity.
 *
 * A chapter is identified by ONE canonical string everywhere it crosses a
 * boundary: project-root-relative, forward slashes, no `./` prefix, no
 * duplicate slashes. This single form is used by:
 *
 *   - preview source wrappers' `data-chapter-src` tagging
 *     (lib/markdown/assemble.ts assembleBookHtml — index.ts's renderChapters
 *     is now just the thin node:fs wrapper around it)
 *   - preview source inspection and chapter-scoped scroll restoration
 *     (preview/file-watcher.ts)
 *   - the desktop's editor↔preview sync scoping
 *     (packages/desktop +page.svelte editorChapter)
 *
 * WHY: manifest `source.files` entries are author-written and arrive in many
 * spellings (`./chapters/03.md`, `chapters\03.md` on Windows, `chapters//03.md`),
 * while the watcher broadcasts `path.relative(inputPath, file)`. Before this
 * helper the build tagged the manifest string VERBATIM, so any `./`-prefixed
 * or backslashed manifest entry made source-attribution and scroll-restoration
 * lookups miss every `data-chapter-src` in the live DOM (and the desktop's
 * editor↔preview chapter scoping silently broke the same way).
 */
export function canonicalChapterId(p: string): string {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/\/{2,}/g, "/");
  while (s.startsWith("./")) s = s.slice(2);
  return s;
}
