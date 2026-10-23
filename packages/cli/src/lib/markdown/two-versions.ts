/**
 * `two_versions` — renders a passage the converge merge left with TWO
 * versions as two labelled boxes instead of broken markdown.
 *
 * After a sync that found a passage edited both here and online, the file
 * holds both versions inside the marker family `two-versions-markers.ts`
 * spells out. Those lines are valid markdown — `=======` is a setext
 * underline, `>>>>>>>` seven nested blockquotes — so until this rule the
 * preview showed the author's paragraph as a chapter-sized heading, listed
 * `<<<<<<< your version` in the outline, and gave no way to read either
 * version as it would print. The `source.sync.merge-markers` check still
 * reports every block as an error, so a build never ships one; this rule
 * only decides what the LIVE PREVIEW shows while the author chooses.
 *
 * The output is plain HTML + CSS: a `div.gp-two-versions` holding two
 * `div.gp-version`s (`-yours`, `-online`), each labelled through
 * `data-label` and each parsed as ordinary block markdown, so a heading or
 * a list inside a version renders as one. No viewer or print code reads
 * these classes; `TWO_VERSIONS_CSS` is the whole styling. Matching is as
 * exact as the check's: the three fixed lines, at the start of a line, in
 * order; anything else (a bare `=======`, a half-deleted family) is left
 * to markdown as before.
 */
import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import {
  TWO_VERSIONS_CLOSE,
  TWO_VERSIONS_OPEN,
  TWO_VERSIONS_SEPARATOR,
} from "../two-versions-markers.ts";

/** The styling for the block above — injected by assemble.ts with MARKER_CSS. */
export const TWO_VERSIONS_CSS = `
.gp-two-versions {
  margin: 1em 0;
  border: 2px dashed #b7791f;
  border-radius: 6px;
  break-inside: avoid;
}
.gp-two-versions > .gp-version {
  padding: 0.5em 0.9em;
}
.gp-two-versions > .gp-version + .gp-version {
  border-top: 2px dashed #b7791f;
}
.gp-two-versions > .gp-version > .gp-version-text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 0.85em;
}
.gp-two-versions > .gp-version::before {
  content: attr(data-label);
  display: block;
  margin-bottom: 0.35em;
  font-family: system-ui, sans-serif;
  font-size: 0.7em;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #b7791f;
}
`;

function lineText(state: StateBlock, line: number): string {
  return state.src.slice(state.bMarks[line]! + state.tShift[line]!, state.eMarks[line]!);
}

/** A structural marker line (`@section`, `@end-section`, `@page`, `@chapter`, …). */
const MARKER_LINE = /^@[a-z]/;

/**
 * A version that carries a marker line is shown as plain text, not parsed.
 * The marker parser (markers.js) keeps one open-block stack for the whole
 * document, so a `@section` opened inside a version and closed after the
 * block, or the reverse, would close the wrong element and nest the online
 * box inside the yours box. Verbatim text keeps the page well-formed and
 * shows the author exactly what each version says.
 */
function hasMarkerLine(state: StateBlock, from: number, to: number): boolean {
  for (let line = from; line < to; line++) {
    if (MARKER_LINE.test(lineText(state, line))) return true;
  }
  return false;
}

function pushVerbatim(state: StateBlock, from: number, to: number): void {
  const raw = state.getLines(from, to, 0, false);
  const token = state.push("html_block", "", 0);
  token.map = [from, to];
  token.block = true;
  token.content = `<pre class="gp-version-text">${state.md.utils.escapeHtml(raw)}</pre>\n`;
}

/** Parse one version's lines as block markdown inside its own labelled div. */
function pushVersion(
  state: StateBlock,
  which: "yours" | "online",
  label: string,
  from: number,
  to: number,
): void {
  const open = state.push("two_version_open", "div", 1);
  open.attrSet("class", `gp-version gp-version-${which}`);
  open.attrSet("data-label", label);
  open.map = [from, to];
  open.block = true;
  if (hasMarkerLine(state, from, to)) {
    pushVerbatim(state, from, to);
  } else {
    // The same fence markdown-it-container puts around nested content: the
    // inner rules may not read past this version's last line.
    state.parentType = "container" as StateBlock["parentType"];
    state.lineMax = to;
    state.md.block.tokenize(state, from, to);
  }
  const close = state.push("two_version_close", "div", -1);
  close.block = true;
}

function twoVersions(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine]! - state.blkIndent >= 4) return false;
  if (state.src.charCodeAt(state.bMarks[startLine]! + state.tShift[startLine]!) !== 0x3c /* < */) return false;
  if (lineText(state, startLine) !== TWO_VERSIONS_OPEN) return false;
  let separator = -1;
  let closer = -1;
  for (let line = startLine + 1; line < endLine; line++) {
    const text = lineText(state, line);
    if (separator < 0 && text === TWO_VERSIONS_SEPARATOR) separator = line;
    else if (text === TWO_VERSIONS_CLOSE) {
      closer = line;
      break;
    } else if (text === TWO_VERSIONS_OPEN) return false;
  }
  if (separator < 0 || closer < 0) return false;
  if (silent) return true;

  const oldParent = state.parentType;
  const oldLineMax = state.lineMax;
  const open = state.push("two_versions_open", "div", 1);
  open.attrSet("class", "gp-two-versions");
  open.map = [startLine, closer + 1];
  open.block = true;
  pushVersion(state, "yours", "Your version", startLine + 1, separator);
  pushVersion(state, "online", "Online version", separator + 1, closer);
  const close = state.push("two_versions_close", "div", -1);
  close.block = true;
  state.parentType = oldParent;
  state.lineMax = oldLineMax;
  state.line = closer + 1;
  return true;
}

/**
 * markdown-it plugin. Before `html_block` so the `<` opener is ours first;
 * listed as a paragraph terminator so a block that starts right under a
 * line of prose (as the merge writes it) still opens.
 */
export default function gpTwoVersions(md: MarkdownIt): void {
  md.block.ruler.before("html_block", "two_versions", twoVersions, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
}
