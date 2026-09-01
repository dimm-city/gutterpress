/**
 * Media IPC handlers for the "project-config" capability (SFE-P5c2). Ports
 * `src/routes/api/media/{list-images,inspect,thumbnail,import-image}/
 * +server.ts` verbatim — same scanning bounds, same thumbnail cache, same
 * picked-file capability check on `media:importImage`'s outside-project
 * `src`.
 *
 * Payload shape (run note): none of these four routes ever moved raw image
 * BYTES over the wire as an upload — `media:importImage`'s `src` is always
 * an absolute HOST PATH (from a native file dialog or already on disk); the
 * route/handler does the file copy itself with `node:fs`, never reading the
 * bytes into the request/response body. `media:thumbnail` is the one place
 * bytes cross the boundary, and only as a `data:` URL STRING (base64 inside
 * JSON) — `getMediaHooks().createThumbnail` and the SVG/tiny-file fallback
 * both return `string | null`, never a `Buffer`. IPC's structured clone
 * would happily carry a raw `Buffer`/`ArrayBuffer` instead (avoiding the
 * ~33% base64 inflation), but that would change the payload shape every
 * caller (`MediaPanel.svelte`'s `<img src>` binding) already depends on —
 * this port keeps the exact `string | null` data-URL shape rather than
 * "improving" it as a side effect of the transport change (run rule 2).
 */
import { readFile, stat, readdir } from "node:fs/promises";
import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { isWithinRootCanonical } from "../server-bridge/fs-guard";
import { getMediaHooks } from "../server-bridge/media-hooks";
import { getPickedFilesHooks } from "../server-bridge/picked-files";
import type { MediaImageDetails, MediaImageEntry } from "../../src/lib/platform/dtos";
import { loadLib } from "./lib-loader";
import { requireAbsolute, requireWithinProjectRoot } from "./validation";

/** Image extensions surfaced in the Media panel (lowercase, no dot). */
const MEDIA_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "tif", "tiff", "avif"]);
/** Directories never scanned for project images. */
const MEDIA_SKIP_DIRS = new Set(["node_modules", "dist", "out", "build", "output", ".svelte-kit"]);
const MEDIA_SCAN_MAX_DEPTH = 6;
const MEDIA_SCAN_MAX_FILES = 2000;

/** List every image under the open project (recursive, bounded). */
export async function mediaListImages(rawProjectDir: unknown): Promise<MediaImageEntry[]> {
  const projectDir = await requireWithinProjectRoot(
    requireAbsolute(rawProjectDir, "media:listImages"),
    "media:listImages",
  );

  const results: MediaImageEntry[] = [];
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (depth > MEDIA_SCAN_MAX_DEPTH || results.length >= MEDIA_SCAN_MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= MEDIA_SCAN_MAX_FILES) return;
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      const relChild = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (MEDIA_SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        await walk(abs, relChild, depth + 1);
      } else if (entry.isFile()) {
        const ext = entry.name.slice(entry.name.lastIndexOf(".") + 1).toLowerCase();
        if (!MEDIA_IMAGE_EXTS.has(ext)) continue;
        try {
          const s = await stat(abs);
          results.push({ name: entry.name, relPath: relChild, path: abs, size: s.size, mtimeMs: s.mtimeMs });
        } catch {
          // raced deletion — skip
        }
      }
    }
  };

  await walk(projectDir, "", 0);
  results.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return results;
}

/** Inspect an image file — file size + header metadata (dimensions, DPI, alpha, color space). */
export async function mediaInspect(rawImagePath: unknown): Promise<MediaImageDetails | null> {
  if (!rawImagePath || typeof rawImagePath !== "string") {
    throw new Error("'imagePath' string is required");
  }
  const imagePath = await requireWithinProjectRoot(
    requireAbsolute(rawImagePath, "media:inspect"),
    "media:inspect",
  );
  let s;
  try {
    s = await stat(imagePath);
  } catch {
    return null;
  }
  const lib = await loadLib();
  const info = await lib.inspectImage(imagePath);
  return { fileSize: s.size, info };
}

const THUMB_MAX_PX = 192;
const THUMB_CACHE_MAX = 300;
const THUMB_FALLBACK_MAX_BYTES = 512 * 1024;
const thumbCache = new Map<string, { mtimeMs: number; dataUrl: string | null }>();

const MEDIA_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  avif: "image/avif",
};

/** Generate a small (<=192px) thumbnail data URL for an image. Returns null when unavailable. */
export async function mediaThumbnail(rawImagePath: unknown): Promise<string | null> {
  if (!rawImagePath || typeof rawImagePath !== "string") {
    throw new Error("'imagePath' string is required");
  }
  const filePath = await requireWithinProjectRoot(
    requireAbsolute(rawImagePath, "media:thumbnail"),
    "media:thumbnail",
  );

  let s;
  try {
    s = await stat(filePath);
  } catch {
    return null;
  }

  const cached = thumbCache.get(filePath);
  if (cached && cached.mtimeMs === s.mtimeMs) {
    thumbCache.delete(filePath);
    thumbCache.set(filePath, cached);
    return cached.dataUrl;
  }

  const ext = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
  let dataUrl: string | null = null;
  try {
    if (ext === "svg") {
      if (s.size <= THUMB_FALLBACK_MAX_BYTES) {
        const buf = await readFile(filePath);
        dataUrl = `data:image/svg+xml;base64,${buf.toString("base64")}`;
      }
    } else {
      const hooks = getMediaHooks();
      if (!hooks) throw new Error("Media hooks not registered");
      dataUrl = await hooks.createThumbnail(filePath, THUMB_MAX_PX);
      if (!dataUrl && s.size <= THUMB_FALLBACK_MAX_BYTES && MEDIA_MIME[ext]) {
        const buf = await readFile(filePath);
        dataUrl = `data:${MEDIA_MIME[ext]};base64,${buf.toString("base64")}`;
      }
    }
  } catch {
    dataUrl = null;
  }

  thumbCache.set(filePath, { mtimeMs: s.mtimeMs, dataUrl });
  while (thumbCache.size > THUMB_CACHE_MAX) {
    const oldest = thumbCache.keys().next().value;
    if (oldest === undefined) break;
    thumbCache.delete(oldest);
  }
  return dataUrl;
}

/** True if `p` exists (any type), false on any stat error (including ENOENT). */
async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find a basename that doesn't already exist in `destDir` — appends `-2`,
 * `-3`, … before the extension so importing two different sources sharing a
 * name never silently overwrites the earlier one.
 */
async function uniqueBasename(destDir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  let n = 2;
  while (await pathExists(path.join(destDir, candidate))) {
    candidate = `${stem}-${n}${ext}`;
    n++;
  }
  return candidate;
}

/**
 * The ONE place that decides how an author-picked image file (from ANYWHERE
 * on disk, via the native file dialog) becomes a project-relative markdown
 * `src` (UX review M10). `src` outside the project must be a one-time
 * "picked-file" capability (`electron/server-bridge/picked-files.ts`),
 * registered ONLY by `dialog:pickImageFile[s]` when the native dialog itself
 * returns a path, and consumed here on first use.
 */
export async function mediaImportImage(rawProjectDir: unknown, rawSrc: unknown): Promise<{ src: string; copied: boolean }> {
  const projectDir = await requireWithinProjectRoot(
    requireAbsolute(rawProjectDir, "media:importImage"),
    "media:importImage",
  );
  // `src` is not confined to the open project (same policy as the deleted
  // fs/copy-file's `src`): it may point anywhere on disk. Shape only here;
  // the picked-file capability check below enforces the "meant to come from
  // a native dialog" half of the contract.
  const src = requireAbsolute(rawSrc, "media:importImage");

  const projectRoot = path.resolve(projectDir);
  const srcResolved = path.resolve(src);

  // Already inside the project: no copy, just the project-relative src.
  if (await isWithinRootCanonical(srcResolved, projectRoot)) {
    const rel = path.relative(projectRoot, srcResolved).split(path.sep).join("/");
    return { src: rel, copied: false };
  }

  // Outside the project: require a one-time picked-file capability, consumed
  // here — only a `src` a recent native dialog itself returned (via
  // dialog:pickImageFile[s]) can be copied in.
  if (!getPickedFilesHooks()?.consume(srcResolved)) {
    throw new Error("media:importImage: src was not returned by a recent file picker");
  }

  // Destination policy: prefer an EXISTING top-level `images/` directory,
  // otherwise `assets/` (created on demand).
  let destName = "assets";
  try {
    const entries = await readdir(projectRoot, { withFileTypes: true });
    if (entries.some((e) => e.isDirectory() && e.name === "images")) destName = "images";
  } catch {
    // Project root unreadable — fall through to the assets/ default.
  }
  // `destDir` is assembled AFTER the initial validation, so it needs its own
  // containment check: if the project's `assets/`/`images/` is a symlink
  // aliasing a directory OUTSIDE the project, an unchecked mkdir/copyFile
  // here would silently write outside the project tree (PR #98 review).
  const destDir = await requireWithinProjectRoot(path.join(projectRoot, destName), "media:importImage");
  await mkdir(destDir, { recursive: true });

  const uniqueName = await uniqueBasename(destDir, path.basename(srcResolved));
  const destPath = path.join(destDir, uniqueName);
  // Re-check the exact computed write target too: a DANGLING symlink at
  // `destDir/uniqueName` would `stat` as ENOENT (indistinguishable from
  // "free") and then have `copyFile` follow it outside the project on write
  // (PR #98 finding #6b) — `requireWithinProjectRoot` resolves through the
  // symlink (dangling or not) and rejects before `copyFile` ever runs.
  await requireWithinProjectRoot(destPath, "media:importImage");
  await copyFile(srcResolved, destPath);
  return { src: `${destName}/${uniqueName}`, copied: true };
}
