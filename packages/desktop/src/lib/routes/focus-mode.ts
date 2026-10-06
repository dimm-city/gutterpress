/**
 * Focus — pure logic behind the Focus toggle (PWA-clean: no host code).
 *
 * Focus is NOT a workspace mode. It is a session-only boolean that sits on top
 * of Edit or Read and hides the chrome (left panel, status bar, editor
 * toolbar, app toolbar). Nothing here is persisted; leaving Focus restores
 * exactly what was visible because entering it never touched the persisted
 * mode or left-panel setting.
 */

/** Selector for UI that owns Escape while it is open (dialogs, menus, popovers). */
const ESCAPE_OWNERS =
  '[aria-modal="true"], dialog[open], [role="dialog"], [role="menu"], [role="listbox"], details[open], .cm-tooltip';

/**
 * Whether an Escape keydown should leave Focus. Only when nothing else wants
 * it: the event is not already handled (CodeMirror, the find bar and context
 * menu call preventDefault), and no dialog/menu/popover is open. Dialogs
 * stopPropagation so they never reach the window listener anyway; the DOM
 * check is the belt to that suspender.
 */
export function escapeExitsFocus(
  e: { key: string; defaultPrevented: boolean },
  doc: Pick<Document, "querySelector">,
  ownedElsewhere = false,
): boolean {
  if (e.key !== "Escape" || e.defaultPrevented || ownedElsewhere) return false;
  return !doc.querySelector(ESCAPE_OWNERS);
}

/** Idle time before the minimal bar tucks away. */
export const FOCUS_BAR_IDLE_MS = 3000;

export interface IdleReveal {
  /** Show the bar now and restart the idle countdown. */
  reveal(): void;
  /** While held (pointer over the bar, focus inside it) it never tucks away. */
  hold(held: boolean): void;
  dispose(): void;
}

/**
 * The bar's show/tuck state machine, separate from the DOM so it is testable
 * with an injected scheduler. Starts visible; tucks away `delay` ms after the last
 * reveal unless held.
 */
export function createIdleReveal(
  onChange: (visible: boolean) => void,
  delay = FOCUS_BAR_IDLE_MS,
  sched: {
    set: (fn: () => void, ms: number) => unknown;
    clear: (id: unknown) => void;
  } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  },
): IdleReveal {
  let visible = true;
  let held = false;
  let timer: unknown = null;

  const stop = () => {
    if (timer !== null) sched.clear(timer);
    timer = null;
  };
  const arm = () => {
    stop();
    if (held) return;
    timer = sched.set(() => {
      timer = null;
      visible = false;
      onChange(false);
    }, delay);
  };
  const show = () => {
    if (!visible) {
      visible = true;
      onChange(true);
    }
  };

  onChange(true);
  arm();
  return {
    reveal() {
      show();
      arm();
    },
    hold(next) {
      held = next;
      if (next) {
        show();
        stop();
      } else arm();
    },
    dispose: stop,
  };
}
