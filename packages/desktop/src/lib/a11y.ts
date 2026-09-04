/**
 * Shared accessibility utilities for the desktop SPA.
 * Pure DOM helpers — no Svelte state, no imports from the host.
 */

/**
 * True when a keyboard event's target is a form control or editable surface —
 * the places where keys like Escape/arrows mean "edit my text", not an app
 * command. Shared by every surface-level key handler (preview nav, the start
 * screen) so the editable-target rules can't drift between copies. The
 * `.cm-editor` check covers CodeMirror, whose content node is a
 * contenteditable DIV a tagName check alone would miss.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName ?? "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  // The paged editor's root is an EditContext host: not contenteditable, but
  // every key typed into it is text. Without this, the preview's bare
  // navigation keys (End, -, f) took keystrokes out of the author's sentence.
  return !!(el?.isContentEditable || el?.closest?.(".cm-editor, .md-editor"));
}
