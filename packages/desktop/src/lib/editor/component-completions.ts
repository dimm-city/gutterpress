/**
 * component-completions.ts
 *
 * `@` autocomplete for the open project's PLUGIN components — the markers its
 * enabled plugins declare (`export const markers`), listed by the host
 * (`api.snip.components`). Picking one inserts the component's example
 * snippet, so the author starts from the structure the component expects.
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

function toCompletion(component: MarkerComponent): Completion {
  const marker = `@${component.name}`;
  return {
    label: marker,
    type: "keyword",
    detail: `component · ${component.source.name}`,
    apply: component.snippet
      ? snippetApply(component.snippet)
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
      options = components.map(toCompletion);
    }
    return { from, options, validFor: /^@[\w-]*$/ };
  };
}
