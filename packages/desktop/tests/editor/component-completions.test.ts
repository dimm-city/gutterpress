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
  { name: "term-box", source, variants: [], snippet: '@term-box label="{{label}}"\n\n{{body}}\n\n@end-term-box\n' },
  { name: "plain", source, variants: [], snippet: "@plain\nText\n@end-plain\n" },
  { name: "bare", source, variants: [] },
];
const skill: MarkerComponent = {
  name: "skill",
  source,
  variants: ["highlight", "muted"],
  snippet: '@skill label="{{label}}"\n\n{{body}}\n\n@end-skill\n',
};
const withVariants = [...components, skill];

function complete(doc: string, list: MarkerComponent[] = components) {
  const state = EditorState.create({ doc });
  return componentCompletionSource(() => list)(new CompletionContext(state, doc.length, false));
}

function applyOption(doc: string, label: string, list: MarkerComponent[] = components) {
  const result = complete(doc, list)!;
  const option = result.options.find((o) => o.label === label)!;
  const view = makeMockView(doc);
  // A string `apply` is CodeMirror's plain replace-the-typed-prefix insert.
  if (typeof option.apply === "string") {
    view.dispatch({ changes: { from: result.from, to: doc.length, insert: option.apply } });
  } else {
    (option.apply as (v: EditorView, c: Completion, from: number, to: number) => void)(
      view, option, result.from, doc.length,
    );
  }
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

test("offers @name plus one @name <variant> option per variant, all matching the typed prefix", () => {
  const result = complete("@sk", withVariants);
  expect(result?.options.filter((o) => o.label.startsWith("@skill")).map((o) => [o.label, o.detail])).toEqual([
    ["@skill", "component · Boxes"],
    ["@skill highlight", "component · Boxes"],
    ["@skill muted", "component · Boxes"],
  ]);
  expect(result?.options.length).toBe(components.length + 3);
});

test("a variant goes after @name on the snippet's marker line, keeping the first-{{variable}} selection", () => {
  const { doc, sel } = applyOption("@sk", "@skill highlight", withVariants);
  expect(doc).toBe('@skill highlight label="{{label}}"\n\n{{body}}\n\n@end-skill');
  expect(doc.slice(sel[0], sel[1])).toBe("{{label}}");
});

test("a variant on a bare marker line is appended after @name; leading blank lines are skipped", () => {
  const list: MarkerComponent[] = [
    { name: "note", source, variants: ["warn"], snippet: "\n@note\nText\n@end-note\n" },
  ];
  const { doc, sel } = applyOption("@no", "@note warn", list);
  expect(doc).toBe("\n@note warn\nText\n@end-note");
  expect(sel).toEqual([doc.length, doc.length]);
});

test("a snippet whose first line is not the marker is inserted unchanged for a variant", () => {
  const list: MarkerComponent[] = [
    { name: "note", source, variants: ["warn"], snippet: "Intro\n@note\nText\n@end-note\n" },
    { name: "notebook", source, variants: ["warn"], snippet: "@notebook-x\n@end-notebook\n" },
  ];
  expect(applyOption("@no", "@note warn", list).doc).toBe("Intro\n@note\nText\n@end-note");
  // `@notebook-x` is a different word from `@notebook`, so it is not rewritten.
  expect(applyOption("@no", "@notebook warn", list).doc).toBe("@notebook-x\n@end-notebook");
});

test("a selfClosing component without a snippet inserts the bare marker, with no closing pair", () => {
  const list: MarkerComponent[] = [{ name: "tape", source, variants: ["wide"], selfClosing: true }];
  expect(applyOption("@ta", "@tape", list).doc).toBe("@tape");
  expect(applyOption("@ta", "@tape wide", list).doc).toBe("@tape wide");
});

test("a variant without a snippet inserts `@name <variant>` / `@end-name` with the caret between", () => {
  const list: MarkerComponent[] = [{ name: "box", source, variants: ["wide"] }];
  const { doc, sel } = applyOption("@bo", "@box wide", list);
  expect(doc).toBe("@box wide\n\n@end-box");
  expect(sel).toEqual(["@box wide\n".length, "@box wide\n".length]);
});

test("options are rebuilt only when the component list changes", () => {
  const source1 = componentCompletionSource(() => withVariants);
  const state = EditorState.create({ doc: "@s" });
  const a = source1(new CompletionContext(state, 2, false))!;
  const b = source1(new CompletionContext(state, 2, false))!;
  expect(b.options).toBe(a.options);
});
