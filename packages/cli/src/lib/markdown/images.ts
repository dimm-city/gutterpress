import type MarkdownIt from "markdown-it";

/**
 * Markdown-it `image` renderer rule that RECORDS every image reference the
 * document emits, on `env.imageRefs`.
 *
 * This replaces the previous `normalizeImageSrc` rewriter, which collapsed
 * `temp/images/…` and `./images/…` to `images/…`. That rewrite had zero
 * producers anywhere in the codebase or its history, and it silently broke any
 * author who kept art in a folder literally named `temp/images/` — the HTML
 * pointed at `images/<file>`, which no code path ever created, and adding the
 * folder to the old `source.assets` list could not fix it.
 *
 * Recording instead of rewriting is what lets the build copy exactly the files
 * the book references (`lib/asset-inline.ts` → `planImageCopies`), so the
 * author's own folder layout is the layout that ships. Paths are emitted
 * verbatim; the build resolves them against the project root, which is the
 * frame `book.html` is served from.
 *
 * One render-time ADDITION (not a src rewrite): an image carrying the
 * `.gp-shape` class gets an inline `--gp-shape: url("<src>")` custom
 * property, mirroring the src byte-for-byte. MARKER_CSS's `img.gp-shape`
 * rule reads it for `shape-outside` — CSS cannot reference an element's own
 * src in a url() context (attr() is blocked there), so the pipeline is the
 * only place the mirror can happen. Authors only ever type the class.
 * Raw-HTML `<img>` tags are not touched — `.gp-shape` is a markdown-image
 * feature; raw HTML authors write the style attribute themselves.
 */

/** Env slot the rule appends to. Absent when nothing referenced an image. */
export interface ImageRefEnv {
  imageRefs?: string[];
}

const isSrcsetSpace = (char: string | undefined): boolean =>
  char === "\t" || char === "\n" || char === "\f" || char === "\r" || char === " ";

/**
 * Extract URL candidates with the same important boundaries as the HTML
 * Standard's srcset parser.
 *
 * A comma is legal inside a URL (most visibly in `data:image/...,...`), so a
 * `split(",")` invents bogus local assets from payload text. The browser first
 * consumes a URL through ASCII whitespace, then parses descriptors until the
 * candidate-separating comma. A trailing comma on a descriptor-less URL is
 * the separator and is removed; earlier commas remain part of the URL.
 */
export interface SrcsetUrlCandidate {
  url: string;
  /** Half-open offsets of the URL itself (separators/descriptors excluded). */
  start: number;
  end: number;
}

export function parseSrcsetUrlCandidates(input: string): SrcsetUrlCandidate[] {
  const candidates: SrcsetUrlCandidate[] = [];
  let position = 0;

  while (position < input.length) {
    while (
      position < input.length &&
      (isSrcsetSpace(input[position]) || input[position] === ",")
    ) {
      position++;
    }
    if (position >= input.length) break;

    const urlStart = position;
    while (position < input.length && !isSrcsetSpace(input[position])) position++;
    let urlEnd = position;

    // With no descriptor, the separator is attached to the URL token. Strip
    // only trailing separators: payload/filename commas remain untouched.
    if (input[urlEnd - 1] === ",") {
      while (urlEnd > urlStart && input[urlEnd - 1] === ",") urlEnd--;
      if (urlEnd > urlStart) {
        candidates.push({
          url: input.slice(urlStart, urlEnd),
          start: urlStart,
          end: urlEnd,
        });
      }
      continue;
    }

    // Descriptor tokens can contain parentheses. A comma inside them is not
    // a candidate boundary until the matching close, mirroring the standard's
    // "in parens" state. We need no descriptor validation here; Chromium owns
    // candidate selection and this pass only plans the candidate URLs.
    let parenDepth = 0;
    while (position < input.length) {
      const char = input[position]!;
      if (char === "(") parenDepth++;
      else if (char === ")" && parenDepth > 0) parenDepth--;
      else if (char === "," && parenDepth === 0) {
        position++;
        break;
      }
      position++;
    }
    if (urlEnd > urlStart) {
      candidates.push({
        url: input.slice(urlStart, urlEnd),
        start: urlStart,
        end: urlEnd,
      });
    }
  }

  return candidates;
}

export function registerImageRule(md: MarkdownIt): void {
  const defaultRender =
    md.renderer.rules.image ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    const srcIdx = token.attrIndex("src");
    if (srcIdx >= 0 && token.attrs) {
      const src = token.attrs[srcIdx]![1];
      if (src) {
        const bucket = (env as ImageRefEnv | undefined) ?? {};
        (bucket.imageRefs ??= []).push(src);

        const cls = token.attrGet("class");
        if (cls && cls.split(/\s+/).includes("gp-shape")) {
          // CSS-escape for a double-quoted url() token; newlines can't
          // appear in a markdown image src token, so \ and " cover it.
          const cssUrl = src.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
          const decl = `--gp-shape:url("${cssUrl}")`;
          const existing = token.attrGet("style");
          // Ours first, author's style last — later declarations win, so an
          // author-supplied {style="--gp-shape:…"} still overrides.
          token.attrSet("style", existing ? `${decl}; ${existing}` : decl);
        }
      }
    }
    return defaultRender(tokens, idx, options, env, self);
  };
}

/**
 * Collect local image references from raw HTML in rendered output.
 *
 * Covers `src` on `<img>` AND every candidate in a `srcset` (on `<img>` or on
 * `<source>` inside `<picture>`). A responsive image's candidates are real files
 * the browser may choose: the preview serves them straight from the project so
 * they look fine, but the build only ships what the copy plan names — so a
 * candidate that never entered the plan 404s during pagination and drops out of
 * the PDF silently. Scanning only `src` was exactly that gap.
 */
export function collectHtmlImageRefs(html: string): string[] {
  const refs: string[] = [];

  // Scan actual tags rather than searching the whole HTML for `src`. Besides
  // keeping examples/scripts opaque, this makes the attribute-name boundary
  // exact: `data-src` and `data-srcset` are lazy-loading metadata, not files
  // the browser will request from the authored `src`/`srcset` slot.
  const tags: string[] = [];
  const collectTags = (active: string): void => {
    for (const match of active.matchAll(/<(?:"[^"]*"|'[^']*'|[^'">])*>/g)) {
      if (/^<(?:img|source)\b/i.test(match[0])) tags.push(match[0]);
    }
  };
  const protectedRegion =
    /<!--[\s\S]*?-->|<(script|style|pre|code|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  let last = 0;
  for (const match of html.matchAll(protectedRegion)) {
    const index = match.index ?? 0;
    collectTags(html.slice(last, index));
    last = index + match[0].length;
  }
  collectTags(html.slice(last));

  const attr = (tag: string, name: "src" | "srcset"): string | undefined => {
    const match = new RegExp(
      `[\\t\\n\\f\\r ]${name}[\\t\\n\\f\\r ]*=[\\t\\n\\f\\r ]*(?:"([^"]*)"|'([^']*)'|([^\\t\\n\\f\\r >]+))`,
      "i",
    ).exec(tag);
    return match?.[1] ?? match?.[2] ?? match?.[3];
  };

  for (const tag of tags) {
    if (!/^<img\b/i.test(tag)) continue;
    const src = attr(tag, "src");
    if (src) refs.push(src);
  }

  // Parse with browser-shaped URL/descriptor boundaries. In particular, URL
  // commas are data, not automatically candidate separators.
  for (const tag of tags) {
    const list = attr(tag, "srcset") ?? "";
    refs.push(...parseSrcsetUrlCandidates(list).map((candidate) => candidate.url));
  }

  return refs;
}
