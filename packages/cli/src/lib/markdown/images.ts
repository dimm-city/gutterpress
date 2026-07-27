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
 */

/** Env slot the rule appends to. Absent when nothing referenced an image. */
export interface ImageRefEnv {
  imageRefs?: string[];
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
      }
    }
    return defaultRender(tokens, idx, options, env, self);
  };
}

/**
 * Collect `src` values from raw HTML `<img>` tags in rendered output.
 *
 * The markdown rule above only sees markdown image tokens; a plugin (or an
 * author writing HTML directly) can emit `<img src="…">` that never passes
 * through it. Scanning the assembled HTML catches those, so "referenced means
 * shipped" holds for every image in the document rather than only the
 * markdown-authored ones.
 */
export function collectHtmlImageRefs(html: string): string[] {
  const refs: string[] = [];
  const re = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const src = m[1] ?? m[2] ?? m[3];
    if (src) refs.push(src);
  }
  return refs;
}
