/**
 * Classes an author wrote in markdown that no stylesheet mentions.
 *
 * `{.hilite}`, `@section .pannel`: a class is a promise that some CSS styles
 * it, and a typo breaks that promise silently, because an unmatched class is
 * simply a no-op. This finds them by comparing the classes the markdown
 * carries with every class any selector in play names: Gutterpress's own CSS,
 * the loaded plugins' CSS and the book's stylesheets (local `@import`s
 * followed). Nothing is rendered or measured; it is two set lookups.
 *
 * `gp-*` classes are NOT judged here: the marker pipeline's `unknown_gp_class`
 * diagnostic already checks them against `GP_CLASSES`, and a book's own CSS
 * must not be able to make a misspelt core class look known.
 */
import postcss from "postcss";
import type Token from "markdown-it/lib/token.mjs";

/**
 * Classes the pipeline itself puts on tokens, so the author never typed them
 * and no stylesheet needs to mention them: the four structural wrappers, the
 * `.chapter-N` counter class every page inherits from its chapter, and
 * markdown-it-footnote's own.
 */
const EMITTED = new Set([
  "chapter", "spread", "page", "section",
  "footnotes", "footnotes-sep", "footnote-ref", "footnote-item", "footnote-backref",
]);

/** One class as the markdown uses it: where it first appears, and how often. */
export interface ClassUse {
  line: number;
  count: number;
}

/** The author-written classes the tokens carry (`gp-*` and pipeline-emitted ones left out), keyed by class. */
export function classesInTokens(tokens: readonly Token[]): Map<string, ClassUse> {
  const uses = new Map<string, ClassUse>();
  const note = (token: Token, line: number): void => {
    const cls = token.attrGet("class");
    if (!cls) return;
    for (const c of cls.split(/\s+/)) {
      if (!c || c.startsWith("gp-") || EMITTED.has(c) || /^chapter-\d+$/.test(c)) continue;
      const seen = uses.get(c);
      if (seen) seen.count++;
      else uses.set(c, { line, count: 1 });
    }
  };
  for (const token of tokens) {
    const meta = token.meta as { line?: unknown } | null;
    const line = token.map ? token.map[0] + 1 : typeof meta?.line === "number" ? meta.line : 0;
    note(token, line);
    for (const child of token.children ?? []) note(child, line);
  }
  return uses;
}

// A class in a selector: `.name`, with `\`-escapes. Attribute selectors and
// strings are removed first so `[href$=".pdf"]` does not name a class.
const CLASS_RE = /\.((?:[\w -￿-]|\\.)+)/g;

function addSelectorClasses(selector: string, into: Set<string>): void {
  const bare = selector
    .replace(/\[(?:[^\]"']|"[^"]*"|'[^']*')*\]/g, "")
    .replace(/"[^"]*"|'[^']*'/g, "");
  for (const m of bare.matchAll(CLASS_RE)) {
    const name = m[1]!.replace(/\\(.)/g, "$1");
    if (!/^\d/.test(name)) into.add(name);
  }
}

/** Add every class a selector in `css` names to `into`. Unparseable CSS contributes what a text scan finds. */
export function addCssClasses(css: string, into: Set<string>): void {
  try {
    postcss.parse(css).walk((node) => {
      if (node.type === "rule") addSelectorClasses((node as postcss.Rule).selector, into);
      else if (node.type === "atrule") {
        const at = node as postcss.AtRule;
        if (/^(scope|container)$/i.test(at.name)) addSelectorClasses(at.params, into);
      }
    });
  } catch {
    addSelectorClasses(css.replace(/\/\*[\s\S]*?\*\//g, ""), into);
  }
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** The known class `cls` is most likely a typo of, or null: one edit for short names, two for longer ones. */
export function nearestKnownClass(cls: string, known: ReadonlySet<string>): string | null {
  const limit = cls.length >= 6 ? 2 : 1;
  let best: string | null = null;
  let bestDistance = limit + 1;
  for (const candidate of known) {
    if (Math.abs(candidate.length - cls.length) > limit) continue;
    const d = editDistance(cls, candidate);
    if (d > 0 && d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}
