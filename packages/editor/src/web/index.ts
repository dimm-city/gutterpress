/**
 * `@dimm-city/gutterpress-editor`'s adapter-backed web mount shell
 * (SFE-P1a Lane B established the shell; SFE-P2a Lane A swapped its
 * internals for the real `@vscode/markdown-editor` fork surface — see
 * `mount.ts`'s own header). Re-exported from the package root
 * (`../index.ts`) once the integrator wires it in; nothing outside this
 * package imports this barrel directly yet.
 *
 * `diff.ts`/`computeMinimalEdit` (SFE-P1a) is DELETED as of SFE-P2a: it
 * existed only to translate a `<textarea>`'s "the whole value changed"
 * input event into a minimal `SourceEdit`. The real fork surface computes
 * its own minimal edits natively (`EditorModel.onWillApplySourceEdit`,
 * converted by `../vscode-adapter/convert.ts`'s `stringEditToSourceEdit`),
 * so nothing in this package calls `computeMinimalEdit` anymore — see this
 * run's report for the search proof.
 */
export * from "./mount.ts";
