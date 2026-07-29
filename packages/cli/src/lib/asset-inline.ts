/**
 * Asset inlining — turns a project's stylesheets into a self-contained
 * `<style>` block and computes the image copy plan.
 *
 * A `styles:` entry is a path to READ, not a file to ship: its text (plus any
 * local `@import` closure) is inlined, so a stylesheet's location is irrelevant
 * to the output and themes/shared design systems need no copying. Fonts become
 * `data:` URIs — which is what guarantees the byte-identical face reaches
 * Chromium, and therefore the PDF. Small images inline; large ones are copied.
 *
 * A missing stylesheet or font is a build error here, at read time, rather than
 * a 404 during pagination that Paged.js parsed as CSS or silently replaced with
 * a system face.
 *
 * Bundle-safe (CLAUDE.md §1/§3): postcss only.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postcss, { type Declaration, type AtRule } from "postcss";
import { BuildError } from "./build-error";

/** Font files always inline — they are small and must be in the PDF. */
const FONT_EXTS = new Set([".woff2", ".woff", ".ttf", ".otf"]);

/** Inline images up to this size; copy larger ones (full-bleed page art). */
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

/**
 * The `url(...)` token grammar — ONE definition, shared by the rewrite pass and
 * the dependency scan so the two can never disagree about what a reference is.
 * Each quoted branch is delimited ONLY by its own quote, so `url("Figure
 * (1).png")` and `url("author's-photo.png")` both parse; the unquoted branch
 * stops at whitespace or the closing paren, per the CSS grammar.
 *
 * Safe to share despite the `g` flag: `String.prototype.matchAll` species-
 * constructs its own regex, so `lastIndex` is never carried between callers.
 */
const URL_TOKEN_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'"()\s]*))\s*\)/gi;

/** Every `url(...)` target in a declaration value, in order, unquoted. */
function extractCssUrls(value: string): string[] {
  return [...value.matchAll(URL_TOKEN_RE)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
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

/** `fonts/x.woff2?v=2#iefix` must resolve to `fonts/x.woff2`. */
function stripUrlSuffix(url: string): string {
  return url.replace(/[?#].*$/, "");
}

/**
 * Decode percent-escapes so `my%20photo.png` resolves to `my photo.png`.
 * Falls back to the raw string for a literal `%` in a filename.
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
 * Rewrite every `url(...)` in a declaration value, preserving the rest verbatim
 * (multi-`src` `@font-face`, `image-set()`, layered backgrounds). Quotes are
 * re-applied so a data URI containing `)` cannot terminate the token early.
 */
async function rewriteUrls(
  value: string,
  rewrite: (url: string) => Promise<string | null>
): Promise<string> {
  const matches = [...value.matchAll(URL_TOKEN_RE)];
  if (matches.length === 0) return value;

  let out = "";
  let last = 0;
  for (const m of matches) {
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    const replacement = await rewrite(raw);
    out += value.slice(last, m.index);
    out += replacement === null ? m[0] : `url("${replacement}")`;
    last = (m.index ?? 0) + m[0].length;
  }
  return out + value.slice(last);
}

/**
 * Re-apply an `@import`'s trailing conditions to the CSS it pulled in.
 *
 * `@import "screen.css" screen`, `… layer(theme)` and `… supports(...)` all
 * gate the imported rules. Splicing the rules in unconditionally would let
 * screen-only styling into the printed book and flatten cascade-layer order, so
 * each qualifier is rebuilt as the equivalent wrapping at-rule.
 */
function wrapImportConditions(node: AtRule, imported: postcss.Root): postcss.Root | postcss.AtRule {
  // Drop the target itself; what remains is the condition list.
  const rest = node.params
    .replace(/^url\(\s*(['"]?)[^'")]*\1\s*\)/i, "")
    .replace(/^(['"]).*?\1/, "")
    .trim();
  if (!rest) return imported;

  let inner: postcss.Root | postcss.AtRule = imported;
  let media = rest;

  const layer = media.match(/\blayer\(([^)]*)\)|\blayer\b/i);
  if (layer) {
    media = media.replace(layer[0], "").trim();
    inner = postcss.atRule({ name: "layer", params: (layer[1] ?? "").trim(), nodes: [inner as never] });
  }

  const supports = media.match(/\bsupports\(([\s\S]*)\)/i);
  if (supports) {
    media = media.replace(supports[0], "").trim();
    inner = postcss.atRule({ name: "supports", params: (supports[1] ?? "").trim(), nodes: [inner as never] });
  }

  if (media) {
    inner = postcss.atRule({ name: "media", params: media, nodes: [inner as never] });
  }
  return inner;
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

  // Rewrite THIS stylesheet's own url()s FIRST, while `root` still contains
  // only its own declarations. Expanding imports first would splice the child's
  // rules into this tree and the walk below would re-resolve their ALREADY
  // resolved URLs against the parent's directory — e.g. a child's
  // `../../images/bg.png`, correctly rewritten to `images/bg.png`, would then be
  // looked for at `styles/images/bg.png` and abort the build.
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

      // Fonts always inline — see the header note on PDF/X embedding.
      if (FONT_EXTS.has(ext)) {
        const bytes = await readOrThrow(absAsset, "font file", abs);
        return dataUri(bytes, ext);
      }

      const bytes = await readOrThrow(absAsset, "asset", abs);
      if (bytes.byteLength <= IMAGE_INLINE_MAX_BYTES) {
        return dataUri(bytes, ext);
      }

      // An in-project image keeps its project-relative path, so a file used by
      // both CSS and markdown lands in one place instead of two. An image from
      // outside the project has no representable relative path, so it is
      // content-addressed (which also makes same-basename files collision-proof).
      const projectRel = path.relative(projectDir, absAsset);
      // Separator-aware, same reason as planImageCopies below: a CSS asset named
      // `..hero.png` at the project root IS in-project and keeps its own path
      // instead of being needlessly content-addressed.
      const escapesProject =
        projectRel === ".." || projectRel.startsWith(`..${path.sep}`);
      const dest =
        projectRel && !escapesProject && !path.isAbsolute(projectRel)
          ? toPosix(projectRel)
          : `${HASHED_ASSET_DIR}/${contentHash(bytes)}${ext}`;
      copies.set(dest, { from: absAsset, to: dest });
      return dest;
    });
  }

  // Then expand local @imports in place, preserving cascade position — and any
  // media / supports / layer conditions the import carried, which otherwise
  // would be silently dropped and let screen-only rules into the printed book.
  const imports: Array<{ node: AtRule; target: string }> = [];
  root.walkAtRules("import", (node) => {
    const target = importTarget(node);
    if (target) imports.push({ node, target });
  });
  for (const { node, target } of imports) {
    const importedAbs = path.resolve(cssDir, stripUrlSuffix(decodeRef(target)));
    const inlined = await inlineOne(importedAbs, projectDir, copies, warnings, seen);
    node.replaceWith(wrapImportConditions(node, postcss.parse(inlined, { from: importedAbs })));
  }

  return root.toString();
}

/**
 * Inline the active stylesheets into one CSS string, IN ORDER — the manifest's
 * `styles:` list is the cascade order (theme first, override second).
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
 * Every file the active stylesheets READ: the stylesheets themselves, their
 * local `@import` closure, and every local `url()` target (fonts, images).
 * Absolute paths, deduped, in no particular order.
 *
 * This is {@link inlineStyles}'s traversal with the work removed — it resolves
 * the same references but never reads an asset's bytes, base64-encodes a font,
 * or plans a copy, so it is cheap enough to re-run whenever the manifest might
 * have changed. It is deliberately TOTAL: an unreadable stylesheet, an
 * unparseable one, and a `url()` pointing at a file that does not exist are all
 * skipped silently. The build reports those properly (as errors, with
 * locations); a watcher must not throw or it stops watching everything.
 *
 * Used by the preview watcher to follow a book's dependencies out of its own
 * folder — a shared theme's `url("../../fonts/Publisher.woff2")` is a file an
 * external design tool can replace WITHOUT touching any CSS, and until it is
 * watched, that edit leaves the "authoritative" preview stale with nothing to
 * correct it.
 */
export async function collectStyleDependencies(
  projectDir: string,
  stylePaths: string[]
): Promise<string[]> {
  const found = new Set<string>();
  const visited = new Set<string>();

  async function walk(cssPath: string): Promise<void> {
    const abs = path.resolve(cssPath);
    // Guards `@import` cycles, exactly as `inlineOne`'s `seen` does.
    if (visited.has(abs)) return;
    visited.add(abs);
    found.add(abs);

    let source: string;
    try {
      source = await readFile(abs, "utf-8");
    } catch {
      return; // Missing stylesheet — the build names it; keep watching the rest.
    }

    let root: postcss.Root;
    try {
      root = postcss.parse(source, { from: abs });
    } catch {
      return; // Mid-edit CSS is routinely unparseable; the next save re-walks.
    }

    const cssDir = path.dirname(abs);

    root.walkDecls((decl) => {
      if (!decl.value.includes("url(")) return;
      for (const raw of extractCssUrls(decl.value)) {
        if (!raw || isNonFileUrl(raw)) continue;
        found.add(path.resolve(cssDir, stripUrlSuffix(decodeRef(raw))));
      }
    });

    const imports: string[] = [];
    root.walkAtRules("import", (node) => {
      const target = importTarget(node);
      if (target) imports.push(target);
    });
    for (const target of imports) {
      await walk(path.resolve(cssDir, stripUrlSuffix(decodeRef(target))));
    }
  }

  for (const rel of stylePaths) {
    await walk(path.resolve(projectDir, rel));
  }
  return [...found];
}

/**
 * Turn the renderer's recorded image references into a copy plan. Images keep
 * their authored relative path, so the author's folder layout is what ships.
 * A `../` reference is rejected rather than silently relocated — it has no
 * representable path under the output root.
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
    // Separator-aware: a bare `startsWith("..")` also matched a legitimate
    // project-root file whose NAME begins with two dots (`..cover.png`), and
    // told the author to copy a file into a folder it was already in.
    if (rel === ".." || rel.startsWith(`..${path.sep}`)) {
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
