/**
 * syntax.ts — the editor's language and syntax colours, shared by the
 * source editor (MarkdownEditor) and the Version history file compare, so
 * a file reads the same in both and there is one highlighter.
 *
 * Every colour is a `--cm-*` custom property set on the editor's own root
 * (`.cm-editor`) by {@link syntaxPalette}: each is defined once with
 * `light-dark()`, so it flips with the app theme (theme.css sets
 * `color-scheme` from [data-theme]) with no second editor and no rebuild.
 * The tokens stay private to CodeMirror (theme.css's admission rule keeps
 * them out of the global palette); CM6 tooltips mount inside `.cm-editor`,
 * so they resolve them too. (CodeMirror's light-tuned defaultHighlightStyle
 * renders as low-contrast mush on the dark background.)
 */
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { EditorLanguage } from "./css-editor.ts";

/** The CodeMirror language extension for a resolved language mode. */
export function languageExtension(lang: EditorLanguage): Extension {
  if (lang === "css") return css();
  if (lang === "markdown") return markdown({ codeLanguages: languages });
  if (lang === "yaml") return yaml();
  return [];
}

const gutterpressHighlight = HighlightStyle.define([
  { tag: [t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: "var(--cm-heading)", fontWeight: "700" },
  { tag: t.strong, color: "var(--cm-strong)", fontWeight: "700" },
  { tag: t.emphasis, color: "var(--cm-em)", fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--cm-link)", textDecoration: "underline" },
  { tag: t.quote, color: "var(--cm-quote)", fontStyle: "italic" },
  // Markdown structural markers (##, *, -, >, |, ```), kept subtle but visible.
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--cm-marker)" },
  { tag: [t.list, t.labelName], color: "var(--cm-marker)" },
  // Inline / fenced code + embedded languages.
  { tag: [t.monospace], color: "var(--cm-code)" },
  { tag: [t.string, t.special(t.string), t.attributeValue], color: "var(--cm-string)" },
  { tag: [t.number, t.atom, t.bool, t.special(t.variableName)], color: "var(--cm-number)" },
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: "var(--cm-keyword)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--cm-comment)", fontStyle: "italic" },
  // Embedded HTML (common in Gutterpress covers/layout blocks) + CSS.
  { tag: [t.tagName, t.angleBracket], color: "var(--cm-tag)" },
  { tag: [t.attributeName], color: "var(--cm-attr)" },
  { tag: [t.propertyName], color: "var(--cm-property)" },
  { tag: [t.className, t.typeName, t.namespace], color: "var(--cm-class)" },
  { tag: [t.variableName, t.definition(t.variableName)], color: "var(--cm-text)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--cm-function)" },
  { tag: [t.punctuation, t.separator, t.bracket], color: "var(--cm-punct)" },
  { tag: t.invalid, color: "var(--cm-invalid)" },
]);

/**
 * The `--cm-*` palette on the editor root. Tuned for contrast: markers
 * visible-but-subtle, code tokens clearly differentiated, body text
 * high-contrast.
 */
const syntaxPalette = EditorView.theme({
  "&": {
    "--cm-text": "light-dark(#1f2328, #d8dee9)",
    "--cm-heading": "light-dark(#6639ba, #c8a8ff)",
    "--cm-strong": "light-dark(#1f2328, #f2f4f8)",
    "--cm-em": "light-dark(#1f2328, #d8dee9)",
    "--cm-link": "light-dark(#0969da, #5cb3ff)",
    "--cm-quote": "light-dark(#57606a, #9aa5b1)",
    "--cm-marker": "light-dark(#6e7781, #8195b5)",
    "--cm-code": "light-dark(#953800, #f0cf94)",
    "--cm-string": "light-dark(#0a7d33, #b6dc9c)",
    "--cm-number": "light-dark(#953800, #ffb88a)",
    "--cm-keyword": "light-dark(#cf222e, #c792ea)",
    "--cm-comment": "light-dark(#6e7781, #7c8590)",
    "--cm-tag": "light-dark(#116329, #ff8f8f)",
    "--cm-attr": "light-dark(#0550ae, #ffcb6b)",
    "--cm-property": "light-dark(#0550ae, #82aaff)",
    "--cm-class": "light-dark(#953800, #ffcb6b)",
    "--cm-function": "light-dark(#8250df, #82aaff)",
    "--cm-punct": "light-dark(#57606a, #9aa5b1)",
    "--cm-invalid": "light-dark(#cf222e, #ff6b6b)",
    "--cm-unusual-char": "light-dark(#bf8700, #e3b341)",
    "--cm-problem-error": "light-dark(rgba(207, 34, 46, 0.08), rgba(255, 107, 107, 0.12))",
    "--cm-problem-warning": "light-dark(rgba(191, 135, 0, 0.1), rgba(227, 179, 65, 0.12))",
    "--cm-problem-info": "light-dark(rgba(9, 105, 218, 0.08), rgba(92, 179, 255, 0.12))",
    "--cm-selection": "light-dark(rgba(9, 105, 218, 0.18), rgba(92, 179, 255, 0.28))",
    "--cm-active-line": "light-dark(rgba(27, 31, 36, 0.045), rgba(255, 255, 255, 0.05))",
    "--cm-gutter-bg": "var(--app-surface)",
    "--cm-gutter-text": "var(--app-text-muted)",
    "--cm-bracket-bg": "light-dark(rgba(9, 105, 218, 0.14), rgba(92, 179, 255, 0.18))",
    "--cm-bracket-outline": "light-dark(rgba(9, 105, 218, 0.45), rgba(92, 179, 255, 0.5))",
  },
});

/** The palette and the highlight style that reads it: what both editors install. */
export const syntaxColours: Extension = [syntaxPalette, syntaxHighlighting(gutterpressHighlight, { fallback: true })];
