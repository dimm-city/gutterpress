/**
 * component-completions.ts
 *
 * `@` autocomplete for the open project's PLUGIN components — the markers its
 * enabled plugins declare (`export const markers`), listed by the host
 * (`api.snip.components`). Picking one inserts the component's example
 * snippet, so the author starts from the structure the component expects.
 * Each variant is offered too (`@name <variant>`) and lands on the snippet's
 * marker line.
 *
 * Kept apart from `marker-completions.ts`, whose table is core-only by rule;
 * this source reuses its line-start trigger and pair insert so plugin
 * components behave exactly like core markers.
 */
import { EditorSelection } from "@codemirror/state";
import {
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { MarkerComponent } from "$lib/api";
import { markerCompletionFrom, markerPairApply, type MarkerCompletion } from "./marker-completions";
import { firstVariable } from "./snippet-vars";

/**
 * Put `variant` after `@name` on the snippet's first marker line (a variant
 * only adds a class, so every variant shares the one snippet). When the first
 * non-blank line does not start with `@name`, the snippet is returned as is.
 */
function withVariant(body: string, name: string, variant: string): string {
  const lines = body.split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  const marker = new RegExp(`^(\\s*@${name})(?=\\s|$)`);
  if (first === -1 || !marker.test(lines[first]!)) return body;
  lines[first] = lines[first]!.replace(marker, `$1 ${variant}`);
  return lines.join("\n");
}

/**
 * Insert a snippet body, selecting its first `{{variable}}` so typing
 * replaces it (the snippet picker is the route that prompts for every
 * variable); without one, the caret goes to the end.
 */
function snippetApply(body: string): MarkerCompletion["apply"] {
  const insert = body.trimEnd();
  const variable = firstVariable(insert);
  return (view, completion, from, to) => {
    view.dispatch({
      changes: { from, to, insert },
      selection: variable
        ? EditorSelection.range(from + variable.from, from + variable.to)
        : EditorSelection.cursor(from + insert.length),
      annotations: pickedCompletion.of(completion),
    });
  };
}

/** `@name` (variant undefined) or `@name <variant>`: the component's snippet
 *  with the variant on its marker line, else a bare marker pair. */
function toCompletion(component: MarkerComponent, variant?: string): Completion {
  const marker = variant ? `@${component.name} ${variant}` : `@${component.name}`;
  return {
    label: marker,
    type: "keyword",
    detail: `component · ${component.source.name}`,
    apply: component.snippet
      ? snippetApply(variant ? withVariant(component.snippet, component.name, variant) : component.snippet)
      : markerPairApply(marker, `@end-${component.name}`),
  };
}

/** A completion source over whatever components `getComponents` returns at call time.
 *  Options are rebuilt only when that list changes. */
export function componentCompletionSource(getComponents: () => readonly MarkerComponent[]) {
  let built: readonly MarkerComponent[] | null = null;
  let options: Completion[] = [];
  return (context: CompletionContext): CompletionResult | null => {
    const components = getComponents();
    if (components.length === 0) return null;
    const from = markerCompletionFrom(context);
    if (from === null) return null;
    if (components !== built) {
      built = components;
      options = components.flatMap((c) => [
        toCompletion(c),
        ...c.variants.map((variant) => toCompletion(c, variant)),
      ]);
    }
    return { from, options, validFor: /^@[\w-]*$/ };
  };
}
