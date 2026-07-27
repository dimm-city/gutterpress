/**
 * Asset inlining — the SINGLE place that turns a project's stylesheets into a
 * self-contained `<style>` block and computes the image copy plan.
 *
 * This replaces the old "declare directories in `source.assets`, copy them
 * wholesale, hope the references line up" model. The renderer already knows
 * every file the book references, because it emits every reference; this module
 * makes that knowledge load-bearing:
 *
 *   - **CSS is read, not shipped.** A `styles:` entry is a path to READ. Its
 *     text (plus any local `@import` closure) is inlined into `book.html`, so
 *     the stylesheet's own location is irrelevant to the output — which is what
 *     makes themes (`themes/<id>/theme.css`) and shared design systems
 *     (`../design-guide/styles/guide.css`) work with no copying, no flattening
 *     and no destination indirection.
 *   - **Fonts become `data:` URIs.** Verified end-to-end: Chromium's PDF writer
 *     embeds a subset of the actual font program delivered by a data URI (the
 *     `AAAAAA+` subset tag), so PDF/X font-embedding is satisfied exactly as it
 *     was by an HTTP-served font. A missing font file is now a BUILD ERROR at
 *     read time instead of a silent 404 during pagination that fell back to a
 *     system face and still passed `pdf.print.embedded-fonts`.
 *   - **Images are planned, not guessed.** Small ones inline; large ones (page
 *     art) are content-addressed into `assets/` so two different files can never
 *     collide on a basename.
 *
 * Bundle-safe (CLAUDE.md §1/§3): postcss only — no bundler, no runtime
 * `package.json` reads, no computed-path dynamic imports.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postcss, { type Declaration, type AtRule } from "postcss";
import { BuildError } from "./build-error";

/** Font files always inline — they are small and must be in the PDF. */
const FONT_EXTS = new Set([".woff2", ".woff", ".ttf", ".otf"]);

/**
 * Images at or below this size are inlined as `data:` URIs; larger ones are
 * copied and content-addressed. 512 KB keeps icons/textures in the document
 * (no extra requests, no missing-file class) while full-bleed page art — which
 * would bloat `book.html` and blow past base64's 33% overhead — stays a file.
 */
export const IMAGE_INLINE_MAX_BYTES = 512 * 1024;

/** Where content-addressed (too-large-to-inline) CSS images are written. */
const HASHED_ASSET_DIR = "assets";

/** MIME types for the file types we embed. Extension-driven, lowercased. */
const MIME_BY_EXT: Record<string, string> = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
};

/** One file the build must copy into the output directory. */
export interface AssetCopy {
  /** Absolute path of the source file. */
  from: string;
  /** Output-relative destination (POSIX separators), e.g. `images/cover.png`. */
  to: string;
}

export interface InlineStylesResult {
  /** Combined, fully-inlined CSS ready to drop into a `<style>` element. */
  css: string;
  /** Files the build must copy into `outDir` (content-addressed CSS images). */
  copies: AssetCopy[];
  /** Non-fatal notices (e.g. a remote `url()` left untouched). */
  warnings: string[];
}

/** A URL that is not a local file reference and must be left exactly as-is. */
function isNonFileUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return (
    lower.startsWith("data:") ||
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("//") ||
    lower.startsWith("#")
  );
}

/**
 * Strip a URL's query string and fragment for filesystem resolution, keeping
 * them off the resolved path. `fonts/x.woff2?v=2#iefix` — the classic
 * "bulletproof @font-face" spelling — must resolve to `fonts/x.woff2`, which is
 * exactly what the old regex-based `missing-font-refs` check got wrong.
 */
function stripUrlSuffix(url: string): string {
  return url.replace(/[?#].*$/, "");
}

/**
 * Decode percent-escapes so a CSS/markdown reference to `my%20photo.png`
 * resolves to the real file `my photo.png`. Falls back to the raw string when
 * the value is not valid percent-encoding (a literal `%` in a filename).
 */
export function decodeRef(ref: string): string {
  try {
    return decodeURIComponent(ref);
  } catch {
    return ref;
  }
}

/** POSIX-separator relative path, for use in URLs and output keys. */
function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function mimeFor(ext: string): string {
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

async function readOrThrow(
  absPath: string,
  kind: string,
  referencedFrom: string
): Promise<Buffer> {
  try {
    return await readFile(absPath);
  } catch {
    throw new BuildError(
      `Missing ${kind}: ${absPath}\n  referenced from ${referencedFrom}\n` +
        `  Check the path, or remove the reference if the file is no longer used.`,
      1
    );
  }
}

function dataUri(bytes: Buffer, ext: string): string {
  return `data:${mimeFor(ext)};base64,${bytes.toString("base64")}`;
}

/** Short content hash used to name copied (too-large-to-inline) images. */
function contentHash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/**
 * Rewrite every `url(...)` token in a declaration value, preserving the rest of
 * the value verbatim (multi-`src` `@font-face` blocks, `image-set()`, layered
 * backgrounds). Quotes are re-applied so a data URI containing `)` cannot
 * terminate the token early.
 */
async function rewriteUrls(
  value: string,
  rewrite: (url: string) => Promise<string | null>
): Promise<string> {
  const re = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
  const matches = [...value.matchAll(re)];
  if (matches.length === 0) return value;

  let out = "";
  let last = 0;
  for (const m of matches) {
    const raw = m[2] ?? "";
    const replacement = await rewrite(raw);
    out += value.slice(last, m.index);
    out += replacement === null ? m[0] : `url("${replacement}")`;
    last = (m.index ?? 0) + m[0].length;
  }
  return out + value.slice(last);
}

/** Resolve an `@import` target to an absolute path, or null if remote/dynamic. */
function importTarget(atRule: AtRule): string | null {
  const params = atRule.params.trim();
  const urlMatch = params.match(/^url\(\s*(['"]?)([^'")]*)\1\s*\)/i);
  const strMatch = params.match(/^(['"])(.*?)\1/);
  const target = urlMatch?.[2] ?? strMatch?.[2];
  if (!target || isNonFileUrl(target)) return null;
  return target;
}

/**
 * Inline one stylesheet: follow local `@import`s depth-first, embed fonts,
 * and resolve images to either a data URI or a content-addressed copy.
 *
 * `seen` guards against `@import` cycles — a self-importing stylesheet would
 * otherwise recurse forever.
 */
async function inlineOne(
  cssPath: string,
  projectDir: string,
  copies: Map<string, AssetCopy>,
  warnings: string[],
  seen: Set<string>
): Promise<string> {
  const abs = path.resolve(cssPath);
  if (seen.has(abs)) return "";
  seen.add(abs);

  const source = await readOrThrow(abs, "stylesheet", "the project manifest");
  const cssDir = path.dirname(abs);

  let root: postcss.Root;
  try {
    root = postcss.parse(source.toString("utf-8"), { from: abs });
  } catch (err) {
    throw new BuildError(
      `Could not parse CSS: ${abs}\n  ${err instanceof Error ? err.message : String(err)}`,
      1
    );
  }

  // 1. Inline local @imports in place, so the cascade order is preserved.
  const imports: Array<{ node: AtRule; target: string }> = [];
  root.walkAtRules("import", (node) => {
    const target = importTarget(node);
    if (target) imports.push({ node, target });
  });
  for (const { node, target } of imports) {
    const importedAbs = path.resolve(cssDir, stripUrlSuffix(decodeRef(target)));
    const inlined = await inlineOne(importedAbs, projectDir, copies, warnings, seen);
    node.replaceWith(postcss.parse(inlined, { from: importedAbs }));
  }

  // 2. Rewrite every url() in every declaration.
  const decls: Declaration[] = [];
  root.walkDecls((decl) => {
    if (decl.value.includes("url(")) decls.push(decl);
  });

  for (const decl of decls) {
    decl.value = await rewriteUrls(decl.value, async (raw) => {
      if (!raw || isNonFileUrl(raw)) {
        if (raw && !raw.startsWith("data:")) {
          warnings.push(
            `Remote asset left as-is (it must be reachable at print time): ${raw}`
          );
        }
        return null;
      }

      const relPath = stripUrlSuffix(decodeRef(raw));
      const absAsset = path.resolve(cssDir, relPath);
      const ext = path.extname(absAsset).toLowerCase();

      // Fonts ALWAYS inline: guarantees the byte-identical face reaches
      // Chromium, which is what guarantees PDF/X embedding.
      if (FONT_EXTS.has(ext)) {
        const bytes = await readOrThrow(absAsset, "font file", abs);
        return dataUri(bytes, ext);
      }

      const bytes = await readOrThrow(absAsset, "asset", abs);
      if (bytes.byteLength <= IMAGE_INLINE_MAX_BYTES) {
        return dataUri(bytes, ext);
      }

      // Too large to inline. An image INSIDE the project keeps its own
      // project-relative path — the same destination `planImageCopies` gives a
      // markdown reference to the same file, so a file used by both CSS and
      // markdown is copied once rather than twice under two different names.
      // Only an image from OUTSIDE the project (a shared design system) has no
      // representable relative path, and is content-addressed instead — which
      // also makes same-basename files from different trees collision-proof.
      const projectRel = path.relative(projectDir, absAsset);
      const dest =
        projectRel && !projectRel.startsWith("..") && !path.isAbsolute(projectRel)
          ? toPosix(projectRel)
          : `${HASHED_ASSET_DIR}/${contentHash(bytes)}${ext}`;
      copies.set(dest, { from: absAsset, to: dest });
      return dest;
    });
  }

  return root.toString();
}

/**
 * Inline the project's active stylesheets into one CSS string.
 *
 * `stylePaths` are project-relative (as returned by `resolveActiveStyles`) and
 * are inlined IN ORDER, so the manifest's `styles:` list keeps its cascade
 * semantics — which is what makes "theme + book override" work: list the theme
 * first, the override second.
 */
export async function inlineStyles(
  projectDir: string,
  stylePaths: string[]
): Promise<InlineStylesResult> {
  const copies = new Map<string, AssetCopy>();
  const warnings: string[] = [];
  const seen = new Set<string>();

  const parts: string[] = [];
  for (const rel of stylePaths) {
    const abs = path.resolve(projectDir, rel);
    const css = await inlineOne(abs, projectDir, copies, warnings, seen);
    if (css.trim().length > 0) {
      parts.push(`/* ${toPosix(path.relative(projectDir, abs))} */\n${css.trim()}`);
    }
  }

  return {
    css: parts.join("\n\n"),
    copies: [...copies.values()],
    warnings,
  };
}

/**
 * Turn the image references the renderer recorded into a copy plan.
 *
 * Markdown images keep their authored relative path in the output, so a project
 * folder structure the author understands is the structure that ships. A `../`
 * reference is rejected: it cannot be represented under the output root, and
 * silently relocating it is exactly the class of surprise this redesign removes.
 */
export async function planImageCopies(
  projectDir: string,
  refs: Iterable<string>
): Promise<{ copies: AssetCopy[]; errors: string[] }> {
  const copies = new Map<string, AssetCopy>();
  const errors: string[] = [];

  for (const ref of refs) {
    if (isNonFileUrl(ref)) continue;

    const cleaned = stripUrlSuffix(decodeRef(ref));
    if (path.isAbsolute(cleaned)) {
      errors.push(
        `Image reference must be relative to the project: ${ref}\n` +
          `  Copy the file into your project folder and reference it from there.`
      );
      continue;
    }

    const abs = path.resolve(projectDir, cleaned);
    const rel = path.relative(projectDir, abs);
    if (rel.startsWith("..")) {
      errors.push(
        `Image reference points outside the project: ${ref}\n` +
          `  Copy the file into your project folder and reference it from there.`
      );
      continue;
    }

    const dest = toPosix(rel);
    copies.set(dest, { from: abs, to: dest });
  }

  return { copies: [...copies.values()], errors };
}
