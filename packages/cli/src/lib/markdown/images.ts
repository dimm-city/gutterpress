import type MarkdownIt from "markdown-it";

/**
 * Markdown-it `image` renderer override that normalises every image `src`
 * to a relative `images/...` path.
 *
 * Replaces the previous post-render regex-on-HTML approach. The token-level
 * rule is scoped to markdown image tokens only — raw HTML emitted by plugins
 * (e.g. `<img src="...">`) is no longer rewritten. If a plugin needs the same
 * normalization it can call `normalizeImageSrc` directly.
 */
const PREFIX_PATTERNS = [/^(?:\.\/|\/)?temp\/images\//, /^(?:\.\/|\/)?images\//];

export function normalizeImageSrc(src: string): string {
  for (const pat of PREFIX_PATTERNS) {
    if (pat.test(src)) return src.replace(pat, "images/");
  }
  return src;
}

export function registerImageRule(md: MarkdownIt): void {
  const defaultRender =
    md.renderer.rules.image ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    const srcIdx = token.attrIndex("src");
    if (srcIdx >= 0 && token.attrs) {
      const current = token.attrs[srcIdx]![1];
      token.attrs[srcIdx]![1] = normalizeImageSrc(current);
    }
    return defaultRender(tokens, idx, options, env, self);
  };
}
