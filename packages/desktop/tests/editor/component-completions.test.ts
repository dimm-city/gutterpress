/**
 * component-completions.test.ts
 *
 * `@` autocomplete for the project's plugin components: same line-start
 * trigger as core markers, snippet expansion with the first `{{variable}}`
 * selected, and the `@name` / `@end-name` pair when there is no snippet.
 */
import { test, expect } from "bun:test";
import { EditorState, EditorSelection, type Transaction } from "@codemirror/state";
import { CompletionContext, type Completion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import type { MarkerComponent } from "../../src/lib/api";
import { componentCompletionSource } from "../../src/lib/editor/component-completions";

function makeMockView(docStr: string): EditorView {
  let state = EditorState.create({ doc: docStr, selection: EditorSelection.cursor(docStr.length) });
  const view = {
    get state() { return state; },
    dispatch(...specs: Array<Transaction | Parameters<EditorView["dispatch"]>[0]>) {
      for (const spec of specs) {
        state = spec && typeof spec === "object" && "state" in spec
          ? (spec as Transaction).state
          : state.update(spec as Parameters<EditorState["update"]>[0]).state;
      }
    },
    focus() {},
  };
  return view as unknown as EditorView;
}

const source = { kind: "extension" as const, ref: "./plugins/boxes", name: "Boxes" };
const components: MarkerComponent[] = [
  { name: "term-box", source, snippet: '@term-box label="{{label}}"\n\n{{body}}\n\n@end-term-box\n' },
  { name: "plain", source, snippet: "@plain\nText\n@end-plain\n" },
  { name: "bare", source },
];

function complete(doc: string, list: MarkerComponent[] = components) {
  const state = EditorState.create({ doc });
  return componentCompletionSource(() => list)(new CompletionContext(state, doc.length, false));
}

function applyOption(doc: string, label: string) {
  const result = complete(doc)!;
  const option = result.options.find((o) => o.label === label)!;
  const view = makeMockView(doc);
  (option.apply as (v: EditorView, c: Completion, from: number, to: number) => void)(
    view, option, result.from, doc.length,
  );
  const sel = view.state.selection.main;
  return { doc: view.state.doc.toString(), sel: [sel.from, sel.to] as const, view };
}

test("offers each component at a line start, labelled with its extension", () => {
  const result = complete("Intro\n@te");
  expect(result?.from).toBe("Intro\n".length);
  expect(result?.options.map((o) => [o.label, o.detail])).toEqual([
    ["@term-box", "component · Boxes"],
    ["@plain", "component · Boxes"],
    ["@bare", "component · Boxes"],
  ]);
});

test("never triggers mid-sentence, and offers nothing when the project has no components", () => {
  expect(complete("email me @te")).toBeNull();
  expect(complete("@te", [])).toBeNull();
});

test("expands a component's snippet and selects its first {{variable}}", () => {
  const { doc, sel } = applyOption("@te", "@term-box");
  expect(doc).toBe('@term-box label="{{label}}"\n\n{{body}}\n\n@end-term-box');
  expect(doc.slice(sel[0], sel[1])).toBe("{{label}}");
});

test("a snippet with no variables leaves the caret at its end", () => {
  const { doc, sel } = applyOption("@pl", "@plain");
  expect(doc).toBe("@plain\nText\n@end-plain");
  expect(sel).toEqual([doc.length, doc.length]);
});

test("a component without a snippet inserts its marker pair with the caret between", () => {
  const { doc, sel } = applyOption("@ba", "@bare");
  expect(doc).toBe("@bare\n\n@end-bare");
  expect(sel).toEqual(["@bare\n".length, "@bare\n".length]);
});
