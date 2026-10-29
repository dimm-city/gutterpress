/**
 * What a typed revision name becomes: trimmed, with spaces turned into hyphens.
 * The lib's `revisionNameFrom` does the same when the revision is made; the SPA
 * never value-imports the lib (CLAUDE.md §8), so the new-revision field mirrors it
 * to preview the name.
 */
export function revisionNameFrom(input: string): string {
  return input.trim().replace(/\s+/g, "-");
}
