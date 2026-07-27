/**
 * Canonical file-extension sets shared by every asset check.
 *
 * Keeping these in ONE place prevents the divergent glob lists that previously
 * let some formats be size-checked but silently skipped by the header-reader
 * checks. Divergence here is a validation-coverage bug, so the sets and their
 * relationship are pinned by image-extension-coverage.test.ts.
 */

/**
 * Raster formats the in-process header reader (`inspectImage`) can actually
 * parse. The header-reader checks (color-space, resolution, alpha) operate
 * ONLY over these — they read embedded metadata, which requires a supported
 * parser. This set is the source of truth for inspectImage's real capability;
 * do not add a format here unless inspectImage can decode its header.
 */
export const RASTER_INSPECTABLE_EXTS = [
  "png",
  "jpg",
  "jpeg",
  "tiff",
  "tif",
] as const;

/**
 * Every image extension treated as an "image asset" for byte-level checks
 * (e.g. file size) that do not decode the header. Superset of
 * RASTER_INSPECTABLE_EXTS; the extras (webp/svg/gif) are size-checked but
 * INTENTIONALLY exempt from header inspection because inspectImage cannot
 * parse them. This exemption is the documented coverage gap — expanding it
 * requires teaching inspectImage the new format first.
 */
export const ALL_IMAGE_EXTS = [
  ...RASTER_INSPECTABLE_EXTS,
  "webp",
  "svg",
  "gif",
] as const;

/** Font file extensions shared by the approved-fonts and font-license checks. */
export const FONT_EXTS = ["woff", "woff2", "otf", "ttf", "eot"] as const;

/**
 * Directories no asset scan should ever descend into, as glob patterns.
 *
 * ONE list, applied at the GLOB level by every asset scan (images and fonts
 * alike). Doing the exclusion here rather than by choosing which directories
 * to hand the scanner is what keeps root-level files covered: a previous
 * approach swapped the project root for its subdirectories whenever an ignored
 * directory existed, which silently dropped every file sitting at the root —
 * and scanned NOTHING at all for a project whose only subdirectory was `dist`.
 *
 * `dist` is excluded because it holds the build's own copies of the author's
 * assets; scanning it would double-report every image against itself.
 */
export const ASSET_SCAN_IGNORE_GLOBS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
] as const;
