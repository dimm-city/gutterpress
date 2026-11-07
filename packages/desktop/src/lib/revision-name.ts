/**
 * What a typed revision name becomes: trimmed, with spaces turned into hyphens.
 * The lib's `revisionNameFrom` does the same when the revision is made; the SPA
 * never value-imports the lib (CLAUDE.md §8), so the new-revision field mirrors it
 * to preview the name.
 */
export function revisionNameFrom(input: string): string {
  return input.trim().replace(/\s+/g, "-");
}

/**
 * The revisions the list shows: those with `find` in their name (ignoring
 * case), the open one first and the rest as given (the lib lists them by name).
 */
export function revisionsShown<T extends { name: string; current: boolean }>(revisions: T[], find: string): T[] {
  const needle = find.trim().toLowerCase();
  return revisions
    .filter((r) => r.name.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.current) - Number(a.current));
}

/**
 * A draft's name as people read it: the stored name is made usable as a
 * git name (spaces become hyphens), so it is shown with spaces again, and the
 * book's first draft ("main") is the "Main draft".
 */
export function draftName(name: string): string {
  if (name === "main" || name === "master") return "Main draft";
  return name.replace(/-+/g, " ").trim() || name;
}
