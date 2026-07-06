/**
 * Shared accessibility utilities for the viewer SPA.
 * Pure DOM helpers — no Svelte state, no imports from the host.
 */

/**
 * Trap keyboard focus inside a dialog element (WCAG 2.1.2).
 *
 * The browser does not enforce focus containment for `aria-modal` dialogs on
 * keyboard-only navigation, so this function must be wired to the dialog
 * container's `onkeydown` event.
 *
 * Usage:
 *   <div bind:this={dialogEl} onkeydown={(e) => trapFocus(e, dialogEl)}>
 *
 * @param e        The keyboard event from the dialog container.
 * @param dialogEl The dialog's root element (may be null/undefined while closed).
 */
export function trapFocus(
  e: KeyboardEvent,
  dialogEl: HTMLElement | null | undefined,
): void {
  if (e.key !== "Tab" || !dialogEl) return;
  const items = Array.from(
    dialogEl.querySelectorAll<HTMLElement>(
      'button, [href], input, select, summary, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
  if (items.length === 0) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = dialogEl.ownerDocument.activeElement as HTMLElement | null;
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

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
  return !!(el?.isContentEditable || el?.closest?.(".cm-editor"));
}
