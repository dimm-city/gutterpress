/**
 * Book CSS for the desktop's rich editor (the vendored vscode markdown
 * editor). The editor mounts the document inside the app's own DOM, so the
 * book's stylesheets cannot be injected as-is: `body`/`:root` rules would
 * restyle the app and page-level at-rules mean nothing on screen. This
 * module turns the SAME CSS layers the print path assembles
 * (`assemble.ts`: markers, utilities, plugin CSS, the author's inlined
 * stylesheets) into one `@scope`d block rooted at the editor document:
 *
 *   - `@font-face`, `@import`, `@keyframes` are hoisted to the top level
 *     (they are not valid inside `@scope`);
 *   - `@page` rules are hoisted intact — inert on screen, but they carry the
 *     page geometry the editor's own paginator reads back out;
 *   - `:root`/`html`/`body` selectors are rewritten to `:scope`, so theme
 *     custom properties and body typography land on the editor document
 *     instead of the app.
 *
 * Everything else is left byte-for-byte: the author's `h1`, `.section.lede`,
 * `.gp-columns-2` rules match the editor's real `<h1>`/`div.section` DOM.
 */
import postcss, { type AtRule, type ChildNode, type Root } from "postcss";
import { MARKER_CSS } from "./markdown/markers.js";
import { GUTTERPRESS_CSS } from "./markdown/gutterpress-css.ts";

export interface ComposeEditorCssOptions {
  /** Selector of the element that plays the book's `body`/`:root` (the editor document). */
  scopeSelector: string;
  /** Concatenated plugin CSS (load order), as `loadPluginsWithCss` returns it. */
  pluginCss?: string;
  /** The author's fully-inlined stylesheets (`inlineStyles(...).css`). */
  projectCss?: string;
}

/**
 * Hoisted to the top level, unchanged. `@page` is here for a load-bearing
 * reason: it is inert on screen, but `gutterpress/viewer`'s `extract()`
 * reads THIS stylesheet's text to build the page-geometry model the editor
 * paginates with — dropping `@page` would leave the editor with no page
 * size, margins or margin boxes at all. Its nested margin-box at-rules
 * (`@top-center`, …) ride along inside it.
 */
const HOISTED_AT_RULES = new Set([
  "font-face",
  "import",
  "keyframes",
  "-webkit-keyframes",
  "layer",
  "property",
  "page",
]);
const DOCUMENT_ROOT_SELECTOR = /^(?::root|html|body)(?:\s+(?:html|body))*(?![-\w])/;

function rewriteSelector(selector: string): string {
  const trimmed = selector.trim();
  return DOCUMENT_ROOT_SELECTOR.test(trimmed) ? trimmed.replace(DOCUMENT_ROOT_SELECTOR, ":scope") : trimmed;
}

function rewriteTree(nodes: readonly ChildNode[], hoisted: ChildNode[]): void {
  for (const node of [...nodes]) {
    if (node.type === "atrule") {
      const at = node as AtRule;
      if (HOISTED_AT_RULES.has(at.name)) {
        at.remove();
        hoisted.push(at);
        continue;
      }
      if (at.nodes) rewriteTree(at.nodes, hoisted);
      continue;
    }
    if (node.type === "rule") {
      node.selectors = node.selectors.map(rewriteSelector);
      if (node.nodes) rewriteTree(node.nodes, hoisted);
    }
  }
}

/** Scope one stylesheet to `scopeSelector` (see the module header). Exported for tests. */
export function scopeCssToEditor(css: string, scopeSelector: string): string {
  const root: Root = postcss.parse(css);
  const hoisted: ChildNode[] = [];
  rewriteTree(root.nodes, hoisted);
  const scoped = postcss.atRule({ name: "scope", params: `(${scopeSelector})` });
  scoped.append(root.nodes.map((n) => n.clone()));
  const out = postcss.root();
  out.append(hoisted);
  out.append(scoped);
  return out.toString();
}

/** The full editor stylesheet: markers + utilities + plugin CSS + the author's CSS, scoped. */
export function composeEditorCss(opts: ComposeEditorCssOptions): string {
  const layers = [
    `/* gutterpress markers */\n${MARKER_CSS.trim()}`,
    `/* gutterpress */\n${GUTTERPRESS_CSS.trim()}`,
    opts.pluginCss?.trim() ? `/* user plugin css */\n${opts.pluginCss.trim()}` : null,
    opts.projectCss?.trim() ? `/* project css */\n${opts.projectCss.trim()}` : null,
  ].filter((layer): layer is string => layer !== null);
  return scopeCssToEditor(layers.join("\n\n"), opts.scopeSelector);
}
