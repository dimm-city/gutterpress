import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type Token from "markdown-it/lib/token.mjs";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AssistiveMmlHandler } from "mathjax-full/js/a11y/assistive-mml.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { DEFAULT_SPANS, gpTable, type SpanScanner } from "./table";

/**
 * LaTeX math — `$…$` in a line, `$$…$$` on its own lines — typeset by
 * MathJax (`mathjax-full`, the same engine arXiv and Wikipedia print with).
 *
 * Bundled, OPT-IN markdown feature (`gutterpress-math` in
 * `BUILTIN_OPTIONAL_PLUGINS`, renderer.ts; "Math" in
 * `RECOMMENDED_EXTENSIONS`, extension-manager.ts), exactly like the Callouts
 * feature: a book that never lists it renders `$` as the character it is.
 *
 * WHY SVG. Each formula is written as a drawing of its own glyphs, so the
 * PDF needs no math font on the machine that builds it, no stylesheet and
 * no font files in the project, prints the same everywhere, and is laid
 * out when the Markdown is rendered — so the live preview paginates exactly
 * like the printed PDF (docs/native-parity-gate.md). The MathML and HTML
 * outputs of KaTeX and MathJax fail one or other of those: measured on a
 * machine with no math font, KaTeX's MathML printed broken fractions, and
 * its HTML output needs ~20 font files copied into every book.
 *
 * The `$` grammar is Pandoc's, as every markdown-it math plugin implements
 * it (ported from markdown-it-katex, MIT, Copyright (c) 2016 Waylon Flinn,
 * via markdown-it-mathjax3): an opening `$` is not followed by a space, a
 * closing one is not preceded by a space and not followed by a digit. That
 * is what keeps "$5 and $10" prose. It lives here rather than in a
 * dependency because the table rule (table.ts) must know where a formula
 * ends, so a `|` inside one does not split the cell — one scanner, two users.
 *
 * ERRORS are never silent: a formula MathJax cannot typeset renders in red,
 * as MathJax does, AND is reported on `env.layoutWarnings` (`math_error`,
 * with the line), the channel the marker parser uses, so the Problems panel
 * and `gutterpress validate` name the mistake — "Missing close brace",
 * "Undefined control sequence \fraction". MathJax's `noerrors` and
 * `noundefined` packages, which would swallow exactly those, are left out.
 *
 * `\newcommand` definitions persist for the rest of the book's render and no
 * further: the TeX state is created per renderer, so one build cannot see
 * another's macros. Styling is in `GUTTERPRESS_CSS` (gutterpress-css.ts),
 * MathJax's own rules for its output.
 */

/** Index of the `$` that closes the inline formula opened at `start`; -1 when
 * it opens none; -2 for an empty `$$`, which is never inline math. */
export function findInlineMathEnd(src: string, start: number, max: number): number {
  // An opening `$` is not followed by a space.
  const after = src.charCodeAt(start + 1);
  if (after === 0x20 || after === 0x09) return -1;

  let match = start + 1;
  while ((match = src.indexOf("$", match)) !== -1 && match < max) {
    // Skip a `$` escaped by an odd number of backslashes.
    let pos = match - 1;
    while (src.charCodeAt(pos) === 0x5c /* \ */) pos--;
    if ((match - pos) % 2 === 1) break;
    match++;
  }
  if (match === -1 || match >= max) return -1;
  if (match === start + 1) return -2;

  // A closing `$` is not preceded by a space and not followed by a digit.
  const before = src.charCodeAt(match - 1);
  const next = src.charCodeAt(match + 1);
  if (before === 0x20 || before === 0x09 || (next >= 0x30 && next <= 0x39)) return -1;
  return match;
}

/** The formula as a span for the table rule: resume after it, or after the `$`(s) that opened nothing. */
const scanInlineMath: SpanScanner = (src, start, max) => {
  const end = findInlineMathEnd(src, start, max);
  return end >= 0 ? end + 1 : end === -2 ? start + 2 : start + 1;
};

function mathInline(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x24 /* $ */) return false;
  const end = findInlineMathEnd(state.src, state.pos, state.posMax);
  if (end < 0) {
    // A `$` that opens no formula is the character itself.
    const literal = end === -2 ? "$$" : "$";
    if (!silent) state.pending += literal;
    state.pos += literal.length;
    return true;
  }
  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.markup = "$";
    token.content = state.src.slice(state.pos + 1, end);
  }
  state.pos = end + 1;
  return true;
}

function mathBlock(state: StateBlock, start: number, end: number, silent: boolean): boolean {
  let pos = state.bMarks[start]! + state.tShift[start]!;
  let max = state.eMarks[start]!;
  if (pos + 2 > max) return false;
  if (state.src.slice(pos, pos + 2) !== "$$") return false;
  pos += 2;
  let firstLine = state.src.slice(pos, max);
  if (silent) return true;

  let found = false;
  let lastLine = "";
  if (firstLine.trim().slice(-2) === "$$") {
    // Single line expression
    firstLine = firstLine.trim().slice(0, -2);
    found = true;
  }
  let next = start;
  while (!found) {
    next++;
    if (next >= end) break;
    pos = state.bMarks[next]! + state.tShift[next]!;
    max = state.eMarks[next]!;
    if (pos < max && state.tShift[next]! < state.blkIndent) {
      // non-empty line with negative indent should stop the list:
      break;
    }
    if (state.src.slice(pos, max).trim().slice(-2) === "$$") {
      const lastPos = state.src.slice(0, max).lastIndexOf("$$");
      lastLine = state.src.slice(pos, lastPos);
      found = true;
    }
  }
  state.line = next + 1;
  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content =
    (firstLine && firstLine.trim() ? firstLine + "\n" : "") +
    state.getLines(start + 1, next, state.tShift[start]!, true) +
    (lastLine && lastLine.trim() ? lastLine : "");
  token.map = [start, state.line];
  token.markup = "$$";
  return true;
}

interface WarningEnv {
  layoutWarnings?: Array<{ line: number; type: string; message: string }>;
}

/** One adaptor and handler for the process; the TeX state is per renderer. */
let adaptor: ReturnType<typeof liteAdaptor> | null = null;
function getAdaptor() {
  if (!adaptor) {
    adaptor = liteAdaptor();
    AssistiveMmlHandler(RegisterHTMLHandler(adaptor));
  }
  return adaptor;
}

const PACKAGES = AllPackages.filter((name) => name !== "noerrors" && name !== "noundefined");

export default function gpMath(md: MarkdownIt): void {
  const html = getAdaptor();
  let errors: string[] = [];
  const tex = new TeX({
    packages: PACKAGES,
    formatError: (jax: TeX<unknown, unknown, unknown>, err: { message: string }) => {
      errors.push(err.message);
      return jax.formatError(err as never);
    },
  });
  const document = mathjax.document("", { InputJax: tex, OutputJax: new SVG({ fontCache: "none" }) });

  const typeset = (token: Token, display: boolean, env: WarningEnv): string => {
    errors = [];
    const out = html.outerHTML(document.convert(token.content, { display }));
    for (const message of errors) {
      if (!env.layoutWarnings) env.layoutWarnings = [];
      env.layoutWarnings.push({
        line: (token.meta as { line?: number } | null)?.line ?? (token.map?.[0] ?? 0) + 1,
        type: "math_error",
        message: `This formula could not be typeset: ${message}. It prints in red until it is fixed.`,
      });
    }
    return display ? out + "\n" : out;
  };

  md.inline.ruler.after("escape", "math_inline", mathInline);
  md.block.ruler.after("blockquote", "math_block", mathBlock, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  // An inline token knows no line of its own; take the paragraph's, so a
  // warning can say where the formula is.
  md.core.ruler.after("inline", "math_lines", (state) => {
    for (const token of state.tokens) {
      if (token.type !== "inline" || !token.children || !token.map) continue;
      for (const child of token.children) {
        if (child.type === "math_inline") child.meta = { line: token.map[0] + 1 };
      }
    }
  });
  md.renderer.rules.math_inline = (tokens, idx, _options, env) => typeset(tokens[idx]!, false, env as WarningEnv);
  md.renderer.rules.math_block = (tokens, idx, _options, env) => typeset(tokens[idx]!, true, env as WarningEnv);
  // A `|` inside a formula no longer splits a table cell.
  md.use(gpTable, { spans: { ...DEFAULT_SPANS, 0x24: scanInlineMath } });
}
