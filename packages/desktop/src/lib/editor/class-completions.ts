/**
 * class-completions.ts
 *
 * `.class` autocomplete for the markdown source editor. Offered:
 *
 *   - on a marker line, after a `.` that starts a word:  `@section .dc-s|`
 *   - inside `{ … }` attribute braces on any element:     `![](a.png){.gp-r|}`,
 *                                                        `## Title {.dc-ch|}`
 *
 * Three sources, merged: core's `gp-*` vocabulary (`core-classes.ts`, held to
 * `GUTTERPRESS_CSS` by a drift gate), the classes each loaded plugin documents
 * in its component catalog, and the classes the book's own stylesheets use
 * (both from `api.snip.classes`, the host). A suggestion shows a one-line
 * description where the catalog has one, and where the class comes from.
 *
 * Lives next to the `@` sources (`marker-completions.ts`, `component-completions.ts`,
 * `variant-completions.ts`) and is wired beside them: Tab and Enter accept,
 * through the same `autocompletion()` instance. The triggers cannot overlap
 * theirs: those fire at a line start or on the one word after `@page`/`@chapter`/
 * `@section`, this one only after a `.`.
 */
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { ClassCatalogEntry } from "#lib/api.ts";
import { CORE_CLASSES } from "./core-classes";
import { isBlockMarkerName, parseMarkerLine } from "./block-attrs";

/** What the caret is inside, so likely classes can be listed first. */
export interface ClassContext {
  kind: "marker" | "image" | "brace";
  /** The marker's name for `marker`, else undefined. */
  marker?: string;
  /** Column where the class word starts (after its dot, when there is one). */
  from: number;
  /** A `.` was typed; without one (explicit invoke only) the dot is inserted too. */
  dot: boolean;
}

/** True when the characters before `end` leave a quote open (core's tokenizer: `"` or `'`, closed by the same one). */
function inOpenQuote(text: string, end: number): boolean {
  let quote = "";
  for (let i = 0; i < end; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    }
  }
  return quote !== "";
}

/**
 * Where a class word is being typed on this line, or null. `col` is the caret's
 * column. Pure so each context is unit-tested without an editor.
 */
export function classContextAt(lineText: string, col: number): ClassContext | null {
  const before = lineText.slice(0, col);
  if (inOpenQuote(before, before.length)) return null;

  const marker = parseMarkerLine(lineText);
  const markerName = marker && isBlockMarkerName(marker.name) ? marker.name : undefined;

  // Inside an unclosed `{ … }` (a `{{` is a snippet placeholder, not attributes).
  const open = before.lastIndexOf("{");
  if (open >= 0 && !before.includes("}", open) && before[open - 1] !== "{") {
    const inner = before.slice(open + 1);
    const word = /(?:^|\s)(\.?)([\w-]*)$/.exec(inner);
    if (word) {
      const kind = markerName ? "marker" : /!\[[^\]]*\]\([^)]*\)\s*$/.test(before.slice(0, open)) ? "image" : "brace";
      return { kind, marker: markerName, from: col - word[2]!.length, dot: word[1] === "." };
    }
    return null;
  }

  // A marker line, after a `.` that starts a word: `@section card .dc-`.
  if (markerName) {
    const word = /\s\.([\w-]*)$/.exec(before);
    if (word) return { kind: "marker", marker: markerName, from: col - word[1]!.length, dot: true };
  }
  return null;
}

/** Which source a suggestion came from, for the detail column. */
function sourceLabel(source: ClassCatalogEntry["source"] | "core"): string {
  if (source === "core") return "core";
  return source.kind === "book" ? "your stylesheet" : source.name;
}

/**
 * The suggestions for a context, most relevant first. One entry per class
 * name: core wins over a plugin's mention of the same class, a plugin over the
 * book's stylesheets. With `dot` false the dot is inserted with the class.
 */
export function classOptions(
  ctx: Pick<ClassContext, "kind" | "marker" | "dot">,
  catalog: readonly ClassCatalogEntry[],
): Completion[] {
  const seen = new Set<string>();
  const options: Completion[] = [];
  const add = (name: string, description: string | undefined, source: ClassCatalogEntry["source"] | "core", boost: number): void => {
    if (seen.has(name)) return;
    seen.add(name);
    const from = sourceLabel(source);
    options.push({
      label: name,
      type: "class",
      detail: description ? `${description} · ${from}` : from,
      boost,
      ...(ctx.dot ? {} : { apply: `.${name}` }),
    });
  };

  // On an image, core's image vocabulary leads and nothing else competes with it;
  // elsewhere a plugin's classes lead (they document the marker or element).
  const onImage = ctx.kind === "image";
  for (const c of CORE_CLASSES) {
    const likely = onImage ? c.scope === "image" : c.scope === "any";
    add(c.class, c.description, "core", likely ? 3 : 0);
  }
  for (const e of catalog) {
    if (e.source.kind === "book") continue;
    const forThis = ctx.kind === "marker" && ctx.marker !== undefined && e.appliesTo.includes(ctx.marker);
    const boost = onImage ? -1 : e.modifier ? (forThis ? 6 : 4) : forThis ? 5 : 2;
    add(e.class, e.description, e.source, boost);
  }
  for (const e of catalog) {
    if (e.source.kind === "book") add(e.class, e.description, e.source, onImage ? -2 : 1);
  }
  return options;
}

/** In a fenced block, an indented block or inline code, where a `{` is code, not attributes. */
function insideCode(state: EditorState, pos: number): boolean {
  let node = syntaxTree(state).resolveInner(pos, -1);
  for (;;) {
    if (/^(FencedCode|CodeBlock|InlineCode|CodeText)$/.test(node.name)) return true;
    if (!node.parent) return false;
    node = node.parent;
  }
}

/**
 * A completion source over whatever classes `getCatalog` returns at call time.
 * Options are rebuilt only when the catalog list or the context kind changes.
 */
export function classCompletionSource(getCatalog: () => readonly ClassCatalogEntry[]) {
  let built: readonly ClassCatalogEntry[] | null = null;
  const cache = new Map<string, Completion[]>();
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const ctx = classContextAt(line.text, context.pos - line.from);
    if (!ctx) return null;
    // Without a typed dot, only an explicit Ctrl+Space asks.
    if (!ctx.dot && !context.explicit) return null;
    if (insideCode(context.state, context.pos)) return null;

    const catalog = getCatalog();
    if (catalog !== built) {
      built = catalog;
      cache.clear();
    }
    const key = `${ctx.kind}|${ctx.marker ?? ""}|${ctx.dot}`;
    let options = cache.get(key);
    if (!options) {
      options = classOptions(ctx, catalog);
      cache.set(key, options);
    }
    return { from: line.from + ctx.from, options, validFor: /^[\w-]*$/ };
  };
}
