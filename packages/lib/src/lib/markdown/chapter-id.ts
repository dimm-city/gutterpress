/**
 * Canonical chapter identity.
 *
 * A chapter is identified by ONE canonical string everywhere it crosses a
 * boundary: project-root-relative, forward slashes, no `./` prefix, no
 * duplicate slashes. This single form is used by:
 *
 *   - the build's `.pmd-chapter` `data-chapter-src` tagging
 *     (lib/markdown/index.ts renderChapters)
 *   - the file-watcher's `content-update` broadcast
 *     (preview/file-watcher.ts)
 *   - the preview shell's live-view chapter lookup
 *     (assets/preview/scripts/preview-shell.js — inline copy of the same
 *     normalization; the shell is plain embedded JS and cannot import this)
 *   - the viewer's editor↔preview sync scoping
 *     (packages/viewer +page.svelte editorChapter)
 *
 * WHY: manifest `source.files` entries are author-written and arrive in many
 * spellings (`./chapters/03.md`, `chapters\03.md` on Windows, `chapters//03.md`),
 * while the watcher broadcasts `path.relative(inputPath, file)`. Before this
 * helper the build tagged the manifest string VERBATIM, so any `./`-prefixed
 * or backslashed manifest entry made the broadcast string miss every
 * `data-chapter-src` in the live DOM — the incremental splice degraded to a
 * full re-render on EVERY edit (and the viewer's editor↔preview chapter
 * scoping silently broke the same way).
 */
export function canonicalChapterId(p: string): string {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/\/{2,}/g, "/");
  while (s.startsWith("./")) s = s.slice(2);
  return s;
}
