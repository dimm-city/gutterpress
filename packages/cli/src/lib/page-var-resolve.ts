/**
 * Resolve `var()` inside `@page` blocks before the CSS reaches Paged.js.
 *
 * Paged.js's `@page` declaration walker takes a longhand margin value's first
 * AST node without checking its type, so `margin-left: var(--binding-margin,
 * 0.75in)` is silently DISCARDED — not resolved, not even fallback-substituted
 * — and the page falls through to the base (unmirrored) `@page` margin. This
 * is the shipped pipeline's mirrored-binding-gutter defect, root-caused with
 * fixtures and vendored-source line references in
 * `spike/folio/MIGRATION.md`'s Step 1 section. The polyfill is vendored and
 * deliberately unforked, so the fix lives on our side of the seam: substitute
 * the custom-property values (or their fallbacks) into `@page` declarations
 * so Paged.js only ever sees literal lengths — which it handles correctly.
 *
 * Scope is deliberately narrow: ONLY declarations inside `@page` at-rules
 * (including their nested margin-box at-rules) are rewritten, and only
 * against custom properties defined on `:root`/`html` — where design tokens
 * live. A var defined on an arbitrary selector cannot be resolved statically;
 * such a declaration is left untouched, which is exactly today's behaviour
 * (Paged.js drops it), so this pass can repair but never regress.
 *
 * Bundle-safe (CLAUDE.md §1/§3): postcss only, fully synchronous.
 */
import postcss, { type AtRule, type Rule, type Declaration } from "postcss";

/** `var(--name)` / `var(--name, fallback)` substitution against a token map. */
function substituteVars(
  value: string,
  tokens: Map<string, string>,
  depth = 0,
): { value: string; resolved: boolean } {
  if (depth > 8) return { value, resolved: false };
  let out = "";
  let i = 0;
  let allResolved = true;
  while (i < value.length) {
    const start = value.indexOf("var(", i);
    if (start === -1) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, start);
    // find the matching close paren
    let d = 0;
    let j = start + 3; // at "("
    for (; j < value.length; j++) {
      if (value[j] === "(") d++;
      else if (value[j] === ")") {
        d--;
        if (d === 0) break;
      }
    }
    if (j >= value.length) return { value, resolved: false }; // unbalanced — leave whole value
    const inner = value.slice(start + 4, j);
    const comma = inner.indexOf(",");
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? undefined : inner.slice(comma + 1).trim();
    const token = tokens.get(name);
    if (token !== undefined) {
      const sub = substituteVars(token, tokens, depth + 1);
      if (!sub.resolved) allResolved = false;
      out += sub.value;
    } else if (fallback !== undefined) {
      const sub = substituteVars(fallback, tokens, depth + 1);
      if (!sub.resolved) allResolved = false;
      out += sub.value;
    } else {
      allResolved = false;
      out += value.slice(start, j + 1); // keep the var() as written
    }
    i = j + 1;
  }
  return { value: out, resolved: allResolved };
}

/** Is this rule a `:root` / `html` token holder? */
function isTokenRule(rule: Rule): boolean {
  if (rule.parent?.type !== "root") return false;
  return rule.selectors.some((s) => {
    const t = s.trim();
    return t === ":root" || t === "html" || t === "html:root" || t === ":root, html";
  });
}

/** Collect `:root`/`html` custom properties from one CSS string. */
function collectTokens(css: string, into: Map<string, string>): void {
  let root;
  try {
    root = postcss.parse(css);
  } catch {
    return;
  }
  root.walkRules((rule) => {
    if (!isTokenRule(rule)) return;
    rule.walkDecls((d) => {
      if (d.prop.startsWith("--")) into.set(d.prop, d.value);
    });
  });
}

/**
 * Rewrite every `var()` inside `@page` blocks of one CSS string to the
 * `:root`/`html` token value (or the var's own fallback). Declarations whose
 * vars cannot be statically resolved are left exactly as written.
 * `extraTokens` lets a caller supply tokens gathered from OTHER stylesheets
 * (a theme block separate from the block holding the `@page` rules); tokens
 * defined in `css` itself win over them.
 */
export function resolvePageVarsInCss(css: string, extraTokens?: Map<string, string>): string {
  let root;
  try {
    root = postcss.parse(css);
  } catch {
    return css; // not this pass's job to report parse errors
  }
  const tokens = new Map<string, string>(extraTokens);
  root.walkRules((rule) => {
    if (!isTokenRule(rule)) return;
    rule.walkDecls((d) => {
      if (d.prop.startsWith("--")) tokens.set(d.prop, d.value);
    });
  });

  let changed = false;
  root.walkAtRules("page", (page: AtRule) => {
    // every declaration in the @page block, including nested margin-box
    // at-rules (@top-left, @bottom-center, …)
    page.walkDecls((decl: Declaration) => {
      if (!decl.value.includes("var(")) return;
      const sub = substituteVars(decl.value, tokens);
      if (sub.resolved && sub.value !== decl.value) {
        decl.value = sub.value;
        changed = true;
      }
    });
  });
  return changed ? root.toString() : css;
}

/**
 * Apply {@link resolvePageVarsInCss} to every `<style>` block in an HTML
 * string. Tokens are collected from ALL `<style>` blocks first, so a theme's
 * `:root` block and the `@page` rules may live in different blocks. Linked
 * stylesheets are not read — the build pipeline inlines all project CSS into
 * `<style data-project-css>` before pagination, so `<style>` blocks are where
 * `@page` rules live by the time HTML reaches Paged.js.
 */
export function resolvePageVarsInHtml(html: string): string {
  const styleRe = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;
  const tokens = new Map<string, string>();
  for (const m of html.matchAll(styleRe)) {
    const css = m[2];
    if (css !== undefined && css.includes("--")) collectTokens(css, tokens);
  }
  return html.replace(styleRe, (whole, open: string, css: string, close: string) => {
    if (!css.includes("@page") || !css.includes("var(")) return whole;
    return open + resolvePageVarsInCss(css, tokens) + close;
  });
}
