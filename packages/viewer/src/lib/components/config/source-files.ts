/**
 * source-files.ts — pure model for the project-settings "Source files" list
 * (the drag-and-drop include/exclude editor that replaced the manifest
 * textarea).
 *
 * The manifest's `sourceFiles` field is EITHER null/absent ("include every
 * markdown file, natural order") OR an ordered list of the included files.
 * The editor works on a richer view: every markdown file in the project,
 * ordered, each row included or excluded — `toManifestFiles` collapses that
 * back to the manifest shape, preserving the "null = all files" default when
 * the selection is equivalent to it.
 *
 * Pure functions + plain types only (no Svelte, no DOM) so the whole model is
 * unit-testable in bun — the component wires them to drag events.
 */

export interface SourceFileEntry {
  /** Project-relative path (e.g. "01-intro.md"). */
  path: string;
  /** Whether the file is part of the book. */
  included: boolean;
  /** True for a manifest entry whose file no longer exists on disk. */
  missing?: boolean;
}

/** Natural ("2 before 10") case-insensitive filename order — the render
 * pipeline's default chapter order when the manifest lists no files. */
export function naturalOrder(files: string[]): string[] {
  return [...files].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

/**
 * Build the editable list from the project's markdown files plus the
 * manifest's `sourceFiles` (null/empty = all included, natural order).
 * Manifest order leads; files not in the manifest follow, excluded, in
 * natural order. Manifest entries missing from disk are kept (flagged) so
 * saving doesn't silently drop them.
 */
export function buildSourceList(
  allFiles: string[],
  manifestFiles: string[] | null | undefined,
): SourceFileEntry[] {
  const all = naturalOrder(allFiles);
  const manifest = (manifestFiles ?? []).map((f) => f.trim()).filter((f) => f.length > 0);
  if (manifest.length === 0) {
    return all.map((path) => ({ path, included: true }));
  }
  const known = new Set(all);
  const inManifest = new Set(manifest);
  const included: SourceFileEntry[] = manifest.map((path) => ({
    path,
    included: true,
    ...(known.has(path) ? {} : { missing: true }),
  }));
  const excluded: SourceFileEntry[] = all
    .filter((path) => !inManifest.has(path))
    .map((path) => ({ path, included: false }));
  return [...included, ...excluded];
}

/** Reorder: move the entry at `from` to position `to` (both clamped). */
export function moveEntry(
  entries: SourceFileEntry[],
  from: number,
  to: number,
): SourceFileEntry[] {
  const n = entries.length;
  if (n === 0) return entries;
  const f = Math.max(0, Math.min(n - 1, from));
  const t = Math.max(0, Math.min(n - 1, to));
  if (f === t) return entries;
  const next = [...entries];
  const [moved] = next.splice(f, 1);
  next.splice(t, 0, moved!);
  return next;
}

/** Include/exclude the entry at `index`. */
export function setIncluded(
  entries: SourceFileEntry[],
  index: number,
  included: boolean,
): SourceFileEntry[] {
  return entries.map((e, i) => (i === index ? { ...e, included } : e));
}

/**
 * Collapse the editable list back to the manifest field: the included paths
 * in list order — or null when that selection is exactly "every file on disk
 * in natural order", the manifest's default (so an untouched project keeps
 * its blank manifest instead of pinning a redundant list).
 */
export function toManifestFiles(
  entries: SourceFileEntry[],
  allFiles: string[],
): string[] | null {
  const included = entries.filter((e) => e.included).map((e) => e.path);
  const all = naturalOrder(allFiles);
  const isDefault =
    included.length === all.length && included.every((path, i) => path === all[i]);
  return isDefault ? null : included;
}
