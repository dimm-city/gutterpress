/**
 * media.ts (#47) — pure helpers for the Media panel.
 *
 * Zero platform/host imports (CLAUDE.md §8): everything here is plain math and
 * string formatting over the `MediaImageDetails` payload the host returns, so
 * it is unit-testable with bun:test and PWA-clean by construction.
 */
// Relative import (not $lib) so the module loads under bare `bun test` too.
import type { MediaImageDetails } from "./platform/dtos";

/** File extensions the Media panel surfaces (mirrors main's MEDIA_IMAGE_EXTS). */
export const MEDIA_IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|tiff?)$/i;

/**
 * The print width (inches) the "full page width" guidance assumes: a US-letter
 * page with typical 0.75in margins → ~7in of content width. Guidance only — a
 * gentle heuristic for non-technical authors, not a hard validation.
 */
export const FULL_WIDTH_INCHES = 7;
/** Target print resolution the guidance steers authors toward. */
export const TARGET_DPI = 300;
/** Pixel width that reaches TARGET_DPI at FULL_WIDTH_INCHES (= 2100). */
export const TARGET_FULL_WIDTH_PX = TARGET_DPI * FULL_WIDTH_INCHES;

/** "1.2 MB" / "640 KB" / "312 B" — human-readable file size. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/** Author-friendly color-space label. */
export function describeColorSpace(cs: "srgb" | "gray" | "cmyk" | ""): string {
  switch (cs) {
    case "srgb":
      return "sRGB (color)";
    case "gray":
      return "Grayscale";
    case "cmyk":
      return "CMYK (print color)";
    default:
      return "Unknown";
  }
}

export interface MediaWarning {
  level: "ok" | "info" | "warn";
  text: string;
}

/**
 * The DPI this image prints at when placed across the full content width.
 * Computed from pixel width (NOT the file's embedded DPI metadata, which only
 * states intent) — `width / FULL_WIDTH_INCHES`, rounded.
 */
export function dpiAtFullWidth(widthPx: number): number {
  return Math.round(widthPx / FULL_WIDTH_INCHES);
}

/**
 * Plain-language print-readiness notes for one image, ordered most-important
 * first. `ext` is the lowercase file extension WITHOUT a dot ("png").
 * `details` may be null (stat failed) — returns a single "unavailable" note.
 */
export function buildPrintWarnings(
  details: MediaImageDetails | null,
  ext: string,
): MediaWarning[] {
  if (ext === "svg") {
    return [
      {
        level: "ok",
        text: "Vector image — stays crisp at any print size.",
      },
    ];
  }
  if (!details) {
    return [{ level: "info", text: "Could not read this image's details." }];
  }
  const info = details.info;
  if (!info) {
    return [
      {
        level: "info",
        text: "Print details aren't available for this image type. PNG, JPEG, or TIFF images show full print guidance.",
      },
    ];
  }

  const warnings: MediaWarning[] = [];
  const effDpi = dpiAtFullWidth(info.width);
  if (effDpi >= 280) {
    warnings.push({
      level: "ok",
      text: `Sharp in print — about ${effDpi} DPI at full page width.`,
    });
  } else if (effDpi >= 180) {
    warnings.push({
      level: "warn",
      text: `May look slightly soft in print — about ${effDpi} DPI at full page width; aim for ${TARGET_DPI} DPI (about ${TARGET_FULL_WIDTH_PX} pixels wide). Fine at smaller sizes.`,
    });
  } else {
    warnings.push({
      level: "warn",
      text: `This image may look blurry in print — about ${effDpi} DPI at full page width; aim for ${TARGET_DPI} DPI (about ${TARGET_FULL_WIDTH_PX} pixels wide).`,
    });
  }

  if (info.colorSpace === "cmyk") {
    warnings.push({
      level: "ok",
      text: "CMYK color — ready for professional offset printing.",
    });
  } else if (info.colorSpace === "srgb") {
    warnings.push({
      level: "info",
      text: "sRGB color — great for digital and home printing; offset print shops may prefer CMYK.",
    });
  }

  if (info.hasAlpha) {
    warnings.push({
      level: "info",
      text: "Has transparency — whatever is behind it on the page will show through.",
    });
  }

  return warnings;
}

/** "cover.png" → "cover" — default alt text for inserted images. */
export function defaultAltText(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

/** Markdown snippet for inserting an image (used for drag-and-drop payloads). */
export function imageMarkdown(relPath: string, alt: string): string {
  return `![${alt}](${relPath})`;
}
