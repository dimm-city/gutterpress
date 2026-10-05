/**
 * chapterPath (inline-editing plan §4.8) — joins a project directory with a
 * `data-chapter-src` value into an absolute, OS-native file path.
 *
 * `data-chapter-src` values are canonical forward-slash project-relative ids
 * (§2.2 of the plan); `EditorBuffer.filePath` / the open project directory are
 * absolute OS-native paths (backslash-separated on Windows). BOTH
 * `EditorPreviewSyncController.followChapterInEditor` and the commit engine
 * (`commit-engine.ts`) use this one separator-aware join, so they can't
 * drift.
 *
 * Callers MUST compare the result with `===`, never `endsWith` — an
 * `endsWith` check is wrong on Windows (a `/`-joined chapter id never
 * string-suffix-matches a `\`-joined absolute path) and is ambiguous for two
 * same-named files in different folders.
 *
 * Pure string operation — no `node:path` (PWA-clean, CLAUDE.md §8).
 */
export function chapterPath(dir: string, chapter: string): string {
  const d = dir.replace(/[\\/]+$/, "");
  const sep = d.includes("\\") ? "\\" : "/";
  return `${d}${sep}${chapter.replaceAll("/", sep)}`;
}

/** Validate an untrusted project-relative chapter id before joining it. */
export function isSafeChapterId(chapter: string): boolean {
  if (!chapter || chapter.startsWith("/") || chapter.includes("\\") || chapter.includes(":")) {
    return false;
  }
  return chapter.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
