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
