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
/**
 * CSS selector for "things a user can Tab to" — exported so the one
 * remaining non-modal caller (EditorToolbar's plain-disclosure popups, which
 * intentionally do NOT use `dialogBehavior` — see its own comments) can reuse
 * this selector for "focus the first focusable child on open" instead of
 * hand-rolling its own copy (ARCH #42 found EditorToolbar's image dialog
 * doing exactly that).
 */
export const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap keyboard focus inside a dialog element (WCAG 2.1.2).
 *
 * The browser does not enforce focus containment for `aria-modal` dialogs on
 * keyboard-only navigation, so this must be wired to the dialog container's
 * `onkeydown` event. `dialogBehavior` is the only legitimate caller — every
 * dialog shell in the app goes through the action now (ARCH #42), so this
 * stays a private implementation detail of this module rather than a
 * separately-exported utility other components could hand-wire again.
 */
function trapFocus(
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

/**
 * Wrap a close handler so it is a no-op while `blocked` is true — the shared
 * guard behind a dialog's mid-operation dismissal rule (UX review M19): the
 * backdrop click, the header close button, AND Escape (routed through
 * `dialogBehavior`'s `onClose`) all funnel through the SAME wrapped function,
 * so a dialog can't be dismissed by any of the three gestures while e.g. a
 * create/connect/clone is in flight. Promotes the pattern GitHubDialog
 * already used ad hoc (`closeBlocked`) so NewProjectWizard and other
 * connect-style dialogs don't each hand-roll their own copy.
 *
 * `blocked` is a getter (not a plain boolean) so callers can pass a reactive
 * accessor (e.g. `() => creating`) and always guard against the CURRENT
 * value, not the value captured when the dialog opened.
 */
export function guardedClose(
  onClose: () => void,
  blocked: () => boolean,
): () => void {
  return () => {
    if (!blocked()) onClose();
  };
}

/** A keyed set of "armed" (awaiting a confirming second click) ids. */
export type InlineConfirmState = Readonly<Record<string, true>>;

/**
 * Two-step inline-confirm state transition for a destructive per-row action
 * (Disconnect, Delete, …), extracted from the pattern CrashRecoveryDialog
 * pioneered for its Discard button: the first call arms `key` (the button's
 * label swaps to "Really …?" in place — no second element appears, so
 * focus is never lost); a second call while `key` is already armed reports
 * `confirmed: true` so the caller runs the actual destructive action, and
 * clears the armed state.
 *
 * Pure and state-shape-only — the caller owns the actual `$state` and reacts
 * to `confirmed`. Kept in `dialog.ts` (not duplicated per-dialog) so
 * ConnectionsSettings' Remove (L2) and SnippetPicker's delete (M25)
 * share one tested implementation.
 */
export function requestInlineConfirm(
  state: InlineConfirmState,
  key: string,
): { state: InlineConfirmState; confirmed: boolean } {
  if (state[key]) {
    const { [key]: _armed, ...rest } = state;
    return { state: rest, confirmed: true };
  }
  return { state: { ...state, [key]: true }, confirmed: false };
}

/** Disarm `key` without confirming (e.g. its "Cancel" button, or re-opening the dialog). */
export function cancelInlineConfirm(
  state: InlineConfirmState,
  key: string,
): InlineConfirmState {
  if (!state[key]) return state;
  const { [key]: _armed, ...rest } = state;
  return rest;
}
