/**
 * variant-completions.test.ts
 *
 * Words after `@page ` / `@chapter ` / `@section `, from the book's declared
 * variants; nothing offered anywhere else. Plus the Tab-accepts binding.
 */
import { test, expect } from "bun:test";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import type { LocationVariant } from "../../src/lib/api";
import { variantCompletionSource } from "../../src/lib/editor/variant-completions";
import { completionTabBinding } from "../../src/lib/editor/completion-keymap";

const ext = { kind: "extension" as const, ref: "./plugins/dc", name: "Dimm City" };
const core = { kind: "core" as const };
const variants: LocationVariant[] = [
  { kind: "page", word: "blank", class: "gp-page-blank", source: core },
  { kind: "page", word: "intro", class: "dc-page-intro", source: ext, label: "Intro page" },
  { kind: "chapter", word: "rules", class: "dc-chapter-rules", source: ext },
  { kind: "section", word: "panel", class: "dc-section-panel", source: ext },
];

function complete(doc: string, list: readonly LocationVariant[] = variants) {
  const state = EditorState.create({ doc });
  return variantCompletionSource(() => list)(new CompletionContext(state, doc.length, false));
}
const labels = (doc: string) => complete(doc)?.options.map((o) => o.label);

test("@page offers page variants only, right after the space", () => {
  expect(labels("@page ")).toEqual(["blank", "intro"]);
  expect(complete("@page ")!.from).toBe(6);
});
test("@chapter and @section offer their own kind", () => {
  expect(labels("@chapter ")).toEqual(["rules"]);
  expect(labels("@section ")).toEqual(["panel"]);
});
test("a partly typed word starts the replace range at the word", () => {
  const r = complete("  @page in")!;
  expect(r.from).toBe(8);
  expect(r.options.map((o) => o.label)).toEqual(["blank", "intro"]);
});
test("detail names the declaring plugin, with the label when declared", () => {
  const opts = complete("@page ")!.options;
  expect(opts[0]!.detail).toBe("page variant · core");
  expect(opts[1]!.detail).toBe("Intro page · Dimm City");
});
test("nothing new elsewhere", () => {
  expect(complete("@page")).toBeNull();
  expect(complete("@")).toBeNull();
  expect(complete("@pages ")).toBeNull();
  expect(complete("@columns ")).toBeNull();
  expect(complete("@page intro ")).toBeNull();
  expect(complete("@page .cls")).toBeNull();
  expect(complete("text @page ")).toBeNull();
  expect(complete("hello ")).toBeNull();
  expect(complete("@page ", [])).toBeNull();
  expect(complete("@chapter ", [variants[0]!])).toBeNull();
});
test("inserts the word only (no apply override)", () => {
  expect(complete("@page ")!.options.every((o) => o.apply === undefined)).toBe(true);
});

test("Tab is bound to a command that does nothing when no popup is open", () => {
  expect(completionTabBinding.key).toBe("Tab");
  const view = { state: EditorState.create({ doc: "@page " }) } as never;
  expect(completionTabBinding.run!(view)).toBe(false);
});
