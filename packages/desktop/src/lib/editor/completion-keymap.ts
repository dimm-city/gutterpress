/**
 * completion-keymap.ts
 *
 * Tab accepts the selected completion, as Enter does (the autocompletion
 * extension binds Enter itself, not Tab). `acceptCompletion` returns false
 * when no popup is open, so the key falls through to `indentWithTab` and keeps
 * indenting. Must be listed before `indentWithTab` in the editor's keymap.
 */
import { acceptCompletion } from "@codemirror/autocomplete";
import type { KeyBinding } from "@codemirror/view";

export const completionTabBinding: KeyBinding = { key: "Tab", run: acceptCompletion };
