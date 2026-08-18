/**
 * Line provenance for project-plugin block tokens — recorded by the HOST at
 * rule registration, never demanded of the plugin.
 *
 * ## The gap
 *
 * The rich editor can only round-trip a plugin's block markers if it can
 * recover each marker's AUTHORED LINE verbatim. markdown-it has two
 * conventional carriers — `token.map` and `token.markup` — but neither is
 * required by the plugin contract (CLAUDE.md §5: plugins are plain
 * markdown-it plugins), and the house marker style (markers.js, ADR 0009)
 * deliberately leaves `map` null. Requiring particular token shapes made
 * rich editing depend on how each plugin happened to be written — brittle,
 * and unenforceable for npm plugins we do not control.
 *
 * ## The fix: observe the tokenizer, not the plugin
 *
 * While `applyPlugins` runs, every BLOCK RULE a plugin registers is wrapped.
 * On each successful non-silent invocation the wrapper records the exact
 * line range the rule consumed — `[startLine, state.line)` — and stamps it
 * as `token.meta.gpEditorLines` on every token the invocation pushed
 * without a `map`. That is ground truth from the tokenizer itself:
 *
 *  - the range's FIRST line is where the construct began — the open
 *    marker's authored line, whatever the rule's internal style;
 *  - the range's LAST line is the final line the rule consumed — the close
 *    marker's authored line, for wrapper rules that advance past the
 *    terminator before pushing the close token (markdown-it-container
 *    style) AND for standalone one-line closer rules (marker style). Both
 *    real styles land on the same answer; a per-`push` `state.line`
 *    snapshot is off by one for one style or the other, which is why the
 *    stamp is per-invocation, not per-push.
 *
 * Nested constructs need no special casing: inner rules stamp their own
 * tokens first (tighter ranges), and the pass never overwrites an existing
 * stamp or a real `map`.
 *
 * ## What deliberately gets NO stamp
 *
 *  - Tokens from the BASE pipeline (paragraphs, headings, footnote /
 *    deflist, markers.js): those rules are registered before `applyPlugins`
 *    runs, so unmodelled base constructs still refuse rich editing (the
 *    schema decision in CLAUDE.md §5) instead of being absorbed as
 *    anonymous plugin blocks.
 *  - Tokens synthesized OUTSIDE a block rule: a core-rule
 *    `new state.Token(...)` injection consumed no source lines and has no
 *    authored source, so it must fail closed — the same provenance rule as
 *    the editor's `editor_drop_generated`.
 *
 * The print path carries the stamp too (one assembly, one dialect); nothing
 * in it reads the key. Like `data-source-range` it is host-internal
 * metadata: never author-facing, never emitted into the DOM.
 */
import type MarkdownIt from "markdown-it";

/** The meta key. Consumed by the desktop editor's `adoptPluginTokens`. */
export const GP_EDITOR_LINES = "gpEditorLines";

interface BlockStateLike {
  line: number;
  tokens: Array<{ map: [number, number] | null; meta: unknown }>;
}

type BlockRule = (
  state: BlockStateLike,
  startLine: number,
  endLine: number,
  silent: boolean,
) => boolean;

function stampingRule(fn: BlockRule): BlockRule {
  return function (this: unknown, state, startLine, endLine, silent) {
    const before = state.tokens.length;
    const ok = fn.call(this, state, startLine, endLine, silent);
    // `state.line > startLine`: a successful rule that consumed nothing has
    // no range to attribute (and would hang markdown-it regardless).
    if (ok && !silent && state.line > startLine) {
      for (let i = before; i < state.tokens.length; i++) {
        const token = state.tokens[i]!;
        if (token.map) continue;
        const meta = token.meta;
        if (meta == null) {
          token.meta = { [GP_EDITOR_LINES]: [startLine, state.line] };
        } else if (
          typeof meta === "object" &&
          !(GP_EDITOR_LINES in meta) &&
          Object.isExtensible(meta)
        ) {
          // Alongside the plugin's own meta (e.g. the marker-style
          // `meta.line`), never replacing it. A frozen meta is skipped —
          // a missing stamp degrades to fail-closed, never to a throw in
          // the middle of a book render.
          (meta as Record<string, unknown>)[GP_EDITOR_LINES] = [startLine, state.line];
        }
      }
    }
    return ok;
  };
}

/** `(name, fn)` methods take the rule at index 1; `(anchor, name, fn)` at 2. */
const REGISTRATION_METHODS: ReadonlyArray<readonly [string, number]> = [
  ["push", 1],
  ["at", 1],
  ["before", 2],
  ["after", 2],
];

/**
 * Run `apply` (the plugin-registration phase) with `md.block.ruler`'s
 * registration methods intercepted, so every block rule registered during it
 * is wrapped with the provenance stamp. The methods are restored afterwards
 * — rules registered outside the window (base pipeline before, host rules
 * after) stay untouched.
 */
export function withBlockRuleProvenance(md: MarkdownIt, apply: () => void): void {
  const ruler = md.block.ruler as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  const saved = REGISTRATION_METHODS.map(([name]) => [name, ruler[name]] as const);
  for (const [name, fnIndex] of REGISTRATION_METHODS) {
    const original = ruler[name]!.bind(ruler);
    ruler[name] = (...args: unknown[]) => {
      if (typeof args[fnIndex] === "function") {
        args[fnIndex] = stampingRule(args[fnIndex] as BlockRule);
      }
      return original(...args);
    };
  }
  try {
    apply();
  } finally {
    for (const [name, fn] of saved) ruler[name] = fn!;
  }
}
