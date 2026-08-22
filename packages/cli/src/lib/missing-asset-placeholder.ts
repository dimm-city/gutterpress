import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { parseSrcsetUrlCandidates } from "./markdown/images";

/**
 * A visible stand-in for an image the book references but does not have.
 *
 * WHY THIS EXISTS: a missing image used to abort the whole build
 * (`Could not copy asset … ENOENT`). For a non-technical author that is the
 * worst possible failure mode — one stale image path in a 273-page book and
 * nothing renders at all, with a filesystem error as the only explanation.
 * Worse, it makes the book unbuildable by anyone who does not already have
 * the missing file, which is exactly the state the dc-op-manual field guide
 * was in: two chapters referenced art that exists nowhere in the repo, so
 * every tool and every reviewer had to hand-patch placeholders in to build
 * it at all.
 *
 * The fix is NOT to substitute something invisible. A silently-blank image
 * is how a missing illustration ships to print. This paints an unmistakable
 * magenta/black checkerboard: the build completes, the author is warned by
 * path, and the hole is impossible to miss when flipping through the PDF.
 *
 * FORMAT: a hand-encoded PNG, because the alternative — embedding a fixture
 * file — cannot adapt its dimensions, and a wrongly-shaped placeholder
 * distorts the surrounding layout while the author is trying to judge it.
 * PNG is the only format written. The staging pipeline writes it to the
 * dedicated `.png` path returned by {@link placeholderOutputPath} and rewrites
 * every rendered reference to that path, so a missing `.jpg`/`.webp`/etc. can
 * never turn this loud fallback into a browser broken-image icon.
 */

/**
 * Collision-resistant, output-relative path for a missing image's PNG.
 *
 * Keeping placeholders under one engine-owned directory avoids overwriting an
 * author's real file (which an appended `.missing.png` sibling name could do),
 * while hashing the original output path keeps repeat references deterministic.
 */
export function placeholderOutputPath(missingOutputPath: string): string {
  const hash = createHash("sha256").update(missingOutputPath).digest("hex").slice(0, 16);
  return `assets/gutterpress-missing/${hash}.png`;
}

/** Decode the small entity set that can occur inside an HTML URL attribute. */
function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Rewrite missing local image URLs in rendered HTML to their real PNG paths.
 *
 * Covers ordinary `src`, every `srcset` candidate, and CSS `url()` tokens in
 * actual `<style>` blocks / `style` attributes. The structural boundary is
 * load-bearing: prose examples and scripts may legitimately contain the same
 * `url("missing.jpg")` text and must remain byte-for-byte authored. The CSS
 * pass is required for `.gp-shape`: its mirrored `--gp-shape` URL must point
 * at the same staged PNG before `inlineShapeUrls()` reads and embeds it.
 */
export function rewriteMissingImageReferences(
  html: string,
  replacements: ReadonlyMap<string, string>,
): string {
  if (replacements.size === 0) return html;

  const replacementFor = (raw: string): string | undefined =>
    replacements.get(raw) ?? replacements.get(decodeHtmlAttribute(raw));

  const cssUrl = /url\(\s*(?:"([^"]*)"|'([^']*)'|&quot;((?:(?!&quot;).)*)&quot;|([^'"()\s]*))\s*\)/giy;
  const rewriteCssUrls = (css: string): string => {
    let out = "";
    let copiedThrough = 0;
    let index = 0;
    while (index < css.length) {
      // CSS strings and comments are opaque. A regex-only pass rewrote
      // documentation such as content:'url("missing.jpg")' and comments,
      // even though neither URL is fetched by the browser.
      if (css.startsWith("/*", index)) {
        const end = css.indexOf("*/", index + 2);
        index = end < 0 ? css.length : end + 2;
        continue;
      }
      const char = css[index];
      if (char === '"' || char === "'") {
        const quote = char;
        index++;
        while (index < css.length) {
          if (css[index] === "\\") {
            index += 2;
            continue;
          }
          const current = css[index++];
          if (current === quote) break;
        }
        continue;
      }

      const previous = index > 0 ? css[index - 1]! : "";
      if (!/[a-z0-9_-]/i.test(previous) && css.slice(index, index + 3).toLowerCase() === "url") {
        cssUrl.lastIndex = index;
        const match = cssUrl.exec(css);
        if (match) {
          const raw = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
          const replacement = replacementFor(raw);
          if (replacement) {
            out += css.slice(copiedThrough, index);
            out += match[3] !== undefined
              ? `url(&quot;${replacement}&quot;)`
              : `url("${replacement}")`;
            index = cssUrl.lastIndex;
            copiedThrough = index;
            continue;
          }
        }
      }
      index++;
    }
    return copiedThrough === 0 ? css : out + css.slice(copiedThrough);
  };

  const rewriteTag = (tag: string): string => {
    let out = tag;
    if (/^<img\b/i.test(tag)) {
      out = out.replace(
        /(\s+src\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
        (
          whole,
          prefix: string,
          double: string | undefined,
          single: string | undefined,
          bare: string | undefined,
        ) => {
          const raw = double ?? single ?? bare ?? "";
          const replacement = replacementFor(raw);
          if (!replacement) return whole;
          if (double !== undefined) return `${prefix}"${replacement}"`;
          if (single !== undefined) return `${prefix}'${replacement}'`;
          return `${prefix}${replacement}`;
        },
      );
    }

    if (/^<(?:img|source)\b/i.test(tag)) {
      out = out.replace(
        /(\s+srcset\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
        (whole, prefix: string, double: string | undefined, single: string | undefined, bare: string | undefined) => {
          const value = double ?? single ?? bare ?? "";
          let rewritten = "";
          let copiedThrough = 0;
          let changed = false;
          for (const candidate of parseSrcsetUrlCandidates(value)) {
            const replacement = replacementFor(candidate.url);
            if (!replacement) continue;
            rewritten += value.slice(copiedThrough, candidate.start) + replacement;
            copiedThrough = candidate.end;
            changed = true;
          }
          if (!changed) return whole;
          rewritten += value.slice(copiedThrough);
          if (double !== undefined) return `${prefix}"${rewritten}"`;
          if (single !== undefined) return `${prefix}'${rewritten}'`;
          return `${prefix}${rewritten}`;
        },
      );
    }

    out = out.replace(
      /(\s+style\s*=\s*)(["'])(.*?)\2/gi,
      (whole, prefix: string, quote: string, value: string) => {
        const rewritten = rewriteCssUrls(value);
        return rewritten === value ? whole : `${prefix}${quote}${rewritten}${quote}`;
      },
    );
    return out;
  };

  const rewriteActiveHtml = (active: string): string =>
    active.replace(/<(?:"[^"]*"|'[^']*'|[^'">])*>/g, (tag) => rewriteTag(tag));

  // HTML raw-text / literal-content elements and comments are opaque to the
  // tag pass. Style bodies get their one intentional CSS-url pass here, while
  // remaining opaque to markup rewriting: CSS strings/comments can contain
  // tag-looking examples that are not real HTML. Other protected regions stay
  // byte-for-byte authored.
  const protectedRegion =
    /<!--[\s\S]*?-->|<(script|style|pre|code|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  let out = "";
  let last = 0;
  for (const match of html.matchAll(protectedRegion)) {
    out += rewriteActiveHtml(html.slice(last, match.index));
    if (match[1]?.toLowerCase() === "style") {
      const style = /^(<style\b[^>]*>)([\s\S]*)(<\/style\s*>)$/i.exec(match[0]);
      out += style
        ? `${rewriteTag(style[1]!)}${rewriteCssUrls(style[2]!)}${style[3]!}`
        : match[0];
    } else {
      out += match[0];
    }
    last = (match.index ?? 0) + match[0].length;
  }
  out += rewriteActiveHtml(html.slice(last));
  return out;
}

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(data.length + 8, crc32(out.subarray(4, data.length + 8)));
  return out;
}

/**
 * Encode a checkerboard PNG of `width`×`height` at `cell` pixels per square.
 * Truecolor (8-bit RGB, no alpha) with filter byte 0 per scanline — the
 * simplest encoding that every decoder handles, and small enough that the
 * deflate cost is irrelevant next to a book build.
 */
export function placeholderPng(width = 640, height = 480, cell = 32): Uint8Array {
  const A = [0xd9, 0x46, 0xef]; // magenta — reads as "wrong", never as art
  const B = [0x1a, 0x1a, 0x1a];

  const raw = new Uint8Array(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const c = (((x / cell) | 0) + ((y / cell) | 0)) % 2 === 0 ? A : B;
      raw[p++] = c[0]!;
      raw[p++] = c[1]!;
      raw[p++] = c[2]!;
    }
  }

  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  // 10..12: compression, filter, interlace — all 0

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];

  const total = parts.reduce((n, x) => n + x.length, 0);
  const png = new Uint8Array(total);
  let o = 0;
  for (const part of parts) {
    png.set(part, o);
    o += part.length;
  }
  return png;
}
