import { error } from '@sveltejs/kit';

/**
 * Validate a single path SEGMENT (a bare file/folder name — never a path).
 * Used by the tree CRUD routes (create-file, create-folder, rename) so
 * `path.join(dir, name)` can never escape `dir` via `../` or an absolute
 * override, and so path-joining stays host-side (Node `path.join`) rather
 * than the renderer hand-building paths with `/` (the exact renderer-side
 * path-math mistake UX review M10 flagged for the image-import flows).
 *
 * Throws the standard 400 via `error()`; returns the trimmed name otherwise.
 */
export function requireSegment(value: unknown, label: string): string {
  if (typeof value !== 'string') error(400, `${label} is required`);
  const trimmed = value.trim();
  if (!trimmed) error(400, `${label} is required`);
  if (trimmed === '.' || trimmed === '..') error(400, `${label} is not a valid name`);
  if (/[\\/]/.test(trimmed)) error(400, `${label} must be a single name, not a path`);
  return trimmed;
}
