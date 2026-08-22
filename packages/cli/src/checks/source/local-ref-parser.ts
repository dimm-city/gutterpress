import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type Token from "markdown-it/lib/token.mjs";

import { createMarkdownRenderer } from "../../lib/markdown/renderer";
import type { LoadedPlugin } from "../../lib/markdown/renderer";

export type RenderedRefKind = "image" | "link";

export interface RenderedLocalRef {
  ref: string;
  kind: RenderedRefKind;
  /** One-based source line of the rendered link/image occurrence. */
  line: number;
}

/**
 * Source offset captured at the exact point markdown-it emits an inline token.
 *
 * Markdown-it intentionally gives block tokens line maps but omits inline
 * source positions. Subclassing this parser instance's State is the smallest
 * aligned extension: every shipped inline rule still owns all recognition,
 * escaping, nesting, HTML, reference, and delimiter semantics; we only attach
 * the `state.pos` it already used when it emitted the token. The WeakMap keeps
 * the metadata private and cannot collide with plugin-owned `token.meta`.
 */
function newlineOffsets(content: string): number[] {
  const offsets: number[] = [];
  for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 0x0a) offsets.push(i);
  return offsets;
}

function lineWithinInline(newlines: readonly number[], offset: number): number {
  let low = 0;
  let high = newlines.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (newlines[middle]! < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Extract only links and images the shipped Gutterpress grammar actually
 * renders, with their original source lines.
 *
 * Complexity is O(source + tokens + refs × log(lines-per-inline)). Keeping
 * correlation local to each parser-defined block is important because it
 * prevents an unmatched delimiter/comment/tag from pairing across a
 * blank/block boundary.
 * Markdown-it normalizes CRLF and lone CR to LF before building token maps, so
 * line counts remain exact for all three newline spellings.
 */
export type RenderedLocalRefCollector = (content: string) => RenderedLocalRef[];

/**
 * Build one parser-aligned collector for a validation run.
 *
 * Custom plugins are applied exactly as they are for the book renderer before
 * the inline State is instrumented. Reusing the returned closure across all
 * source files avoids loading/applying a project plugin once per chapter.
 */
export function createRenderedLocalRefCollector(
  customPlugins?: LoadedPlugin[],
): RenderedLocalRefCollector {
  const tokenOffsets = new WeakMap<Token, number>();
  const parser = createMarkdownRenderer(customPlugins);
  const BaseInlineState = parser.inline.State;

  class PositionedInlineState extends BaseInlineState {
    override push(
      ...args: Parameters<StateInline["push"]>
    ): ReturnType<StateInline["push"]> {
      const token = super.push(...args);
      tokenOffsets.set(token, this.pos);
      return token;
    }
  }

  parser.inline.State = PositionedInlineState;

  return (content: string): RenderedLocalRef[] => {
    const tokens = parser.parse(content, {});
    const refs: RenderedLocalRef[] = [];

    for (const block of tokens) {
      if (block.type !== "inline" || !block.children || !block.map) continue;
      const newlines = newlineOffsets(block.content);
      for (const child of block.children) {
        const kind: RenderedRefKind | undefined =
          child.type === "image" ? "image" : child.type === "link_open" ? "link" : undefined;
        if (!kind) continue;

        const ref = child.attrGet(kind === "image" ? "src" : "href");
        if (!ref) continue;
        const offset = tokenOffsets.get(child);
        refs.push({
          ref,
          kind,
          // Core/plugin rules can synthesize a rendered link or image after
          // inline parsing, so no State offset exists. Keep the finding rather
          // than silently dropping it and conservatively point to the parser-
          // defined inline block's first line.
          line:
            block.map[0] +
            (offset === undefined ? 0 : lineWithinInline(newlines, offset)) +
            1,
        });
      }
    }

    return refs;
  };
}
