/**
 * PublishWizard's PDF/Website format radio group (#221 phase 3 D8, hardened
 * for C8 — a code-review finding).
 *
 * The radio group's `checked={...}` attribute is a plain one-way binding
 * derived from the controller's saved format. If `selectFormat()` throws
 * (e.g. the underlying `setConfig` call fails), nothing the controller
 * exposes actually changes — so a binding derived ONLY from controller state
 * has no reactive dependency that changes either, and never re-runs to
 * correct the browser's own optimistic "I was just clicked" checked state on
 * the DOM radio. The UI then visually disagrees with reality (the clicked
 * option stays checked) until some unrelated re-render happens to touch it.
 *
 * The fix: the wizard tracks an explicit, per-provider "in-flight optimistic
 * pick" that ALWAYS clears once the attempt settles — success or failure
 * alike (see `chooseFormat` in PublishWizard.svelte) — and is itself read
 * directly inside the `checked` expression. That guarantees Svelte tracks it
 * as a real dependency and reapplies `checked` on every settle, so the
 * displayed value is either "what the author just picked, and is still
 * waiting to be saved" or "what the controller actually has saved" — never
 * "what was clicked, but silently failed to save."
 */
export function displayedFormat<F extends string>(pendingChoice: F | undefined, actualFormat: F): F {
  return pendingChoice ?? actualFormat;
}
