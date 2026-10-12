/**
 * variant-completions.ts
 *
 * `@` autocomplete for the words that follow `@page`, `@chapter` and
 * `@section`: the variants core and the book's enabled plugins declare
 * (`api.snip.variants` — core's `@page blank | full-bleed`, a plugin's
 * `page: { variants: { intro: '…' } }`). Offered after the marker and a space;
 * picking one inserts the word only — the author adds classes after it. The
 * words are suggestions: any other name is still valid (`@page my-name`).
 *
 * Reuses nothing from the marker sources on purpose: they own the line-start
 * `@name` position, this owns the one word after it.
 */
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { LocationVariant } from "$lib/api";

// `@page ` / `@chapter ` / `@section `, then the (possibly empty) word being typed.
const VARIANT_WORD = /^(\s*@(page|chapter|section))[ \t]+([\w-]*)$/;

function toCompletion(v: LocationVariant): Completion {
  const source = v.source.kind === "core" ? "core" : v.source.name;
  return {
    label: v.word,
    type: "keyword",
    detail: v.label ? `${v.label} · ${source}` : `${v.kind} variant · ${source}`,
  };
}

/** A completion source over whatever variants `getVariants` returns at call
 *  time. Options are rebuilt only when that list changes. */
export function variantCompletionSource(getVariants: () => readonly LocationVariant[]) {
  let built: readonly LocationVariant[] | null = null;
  let byKind: Record<string, Completion[]> = {};
  return (context: CompletionContext): CompletionResult | null => {
    const variants = getVariants();
    if (variants.length === 0) return null;
    const line = context.state.doc.lineAt(context.pos);
    const match = VARIANT_WORD.exec(line.text.slice(0, context.pos - line.from));
    if (!match) return null;
    if (variants !== built) {
      built = variants;
      byKind = {};
      for (const v of variants) (byKind[v.kind] ??= []).push(toCompletion(v));
    }
    const options = byKind[match[2]!];
    if (!options?.length) return null;
    return { from: context.pos - match[3]!.length, options, validFor: /^[\w-]*$/ };
  };
}
