/**
 * Shared modal-dialog behavior for the viewer SPA.
 *
 * `dialogBehavior` is a Svelte `use:` action that owns the a11y contract every
 * dialog shell in the app used to re-implement by hand:
 *
 *   - the ARIA wiring (`role="dialog"`, `aria-modal`, `tabindex`, and an
 *     optional `aria-labelledby`),
 *   - Escape-to-close (consumed so it doesn't leak to page-level handlers),
 *   - initial focus placement on open,
 *   - focus trapping while open (WCAG 2.1.2, delegated to {@link trapFocus}),
 *   - and restoring focus to the triggering element when the dialog unmounts.
 *
 * It is pure DOM — no Svelte state, no host imports — so it stays PWA-clean
 * (CLAUDE.md §8 / ADR 0004) and is unit-testable against a bare DOM. All
 * dependencies (the close callback, the trigger element, focus targets) are
 * injected through the action's options object.
 *
 * Usage:
 *   <div use:dialogBehavior={{ onClose: close, triggerEl, labelledBy: "x-title" }}>
 *     …dialog content…
 *   </div>
 *
 * The dialog markup must live inside an `{#if open}` block: closing the dialog
 * (flipping `open` to false) unmounts the node, which fires the action's
 * `destroy` and restores focus. `onClose` should flip that flag; the backdrop
 * click handler should call the same function.
 */
import { trapFocus } from "$lib/a11y";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogOptions {
  /**
   * Invoked when the user presses Escape. Wire this to the same handler the
   * backdrop click uses; it should flip the `open` flag to false. Focus
   * restoration is handled by the action, so `onClose` must NOT re-focus the
   * trigger itself.
   */
  onClose: () => void;
  /**
   * The element focus is returned to when the dialog unmounts (typically the
   * button that opened it). When omitted, focus falls back to whatever element
   * had focus at the moment the dialog opened.
   */
  triggerEl?: HTMLElement | null;
  /**
   * CSS selector for the element to focus on open. When omitted, the first
   * focusable descendant is focused.
   */
  initialFocus?: string;
  /** Focus the dialog container itself on open instead of a descendant. */
  focusContainer?: boolean;
  /** id of the element that labels the dialog (sets `aria-labelledby`). */
  labelledBy?: string;
}

export function dialogBehavior(node: HTMLElement, options: DialogOptions) {
  let opts = options;
  const doc = node.ownerDocument;
  const previouslyFocused = doc.activeElement as HTMLElement | null;

  // Own the ARIA contract so individual dialogs no longer re-declare it.
  node.setAttribute("role", "dialog");
  node.setAttribute("aria-modal", "true");
  if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
  if (opts.labelledBy) node.setAttribute("aria-labelledby", opts.labelledBy);

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      // Consume it: a modal dialog must not let Escape reach page-level
      // handlers behind it.
      e.stopPropagation();
      opts.onClose();
      return;
    }
    trapFocus(e, node);
  }
  node.addEventListener("keydown", onKeydown);

  // Defer initial focus one microtask so snippet/children content has mounted.
  queueMicrotask(() => {
    if (opts.focusContainer) {
      node.focus();
      return;
    }
    const target = opts.initialFocus
      ? node.querySelector<HTMLElement>(opts.initialFocus)
      : node.querySelector<HTMLElement>(FOCUSABLE);
    (target ?? node).focus();
  });

  return {
    update(next: DialogOptions) {
      opts = next;
      // Keep aria-labelledby in sync with the option in BOTH directions: a
      // later update that omits labelledBy must clear a previously-set value,
      // or the dialog would point at a stale/wrong label element.
      if (opts.labelledBy)
        node.setAttribute("aria-labelledby", opts.labelledBy);
      else node.removeAttribute("aria-labelledby");
    },
    destroy() {
      node.removeEventListener("keydown", onKeydown);
      const restore = opts.triggerEl ?? previouslyFocused;
      restore?.focus?.();
    },
  };
}
