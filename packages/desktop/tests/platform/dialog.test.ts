/**
 * Unit tests for the shared `dialogBehavior` action (src/lib/dialog.ts) — the
 * one modal-dialog a11y primitive the desktop's dialog shells now share.
 *
 * TDD Stage 1: these fail until src/lib/dialog.ts exists.
 *
 * Covers the contract every dialog used to re-implement by hand:
 *   1. ARIA — sets role="dialog", aria-modal="true", tabindex, aria-labelledby.
 *   2. Focus-on-open — moves focus to the first focusable descendant (or the
 *      container when asked).
 *   3. Escape-closes — a keydown Escape inside the dialog invokes onClose (and
 *      is consumed so it doesn't leak to the page).
 *   4. Focus-restore — on destroy, focus returns to the injected triggerEl
 *      (falling back to whatever was focused when the dialog opened).
 *
 * DOM is provided by happy-dom (an explicit `new Window()` — the same harness
 * tests/preview-bridge.test.mjs uses). happy-dom does no layout, so we avoid
 * assertions that depend on geometry (offsetParent / Tab focus-wrap).
 */
import { describe, test, expect } from "bun:test";
import { Window } from "happy-dom";
import {
  dialogBehavior,
  guardedClose,
  requestInlineConfirm,
  cancelInlineConfirm,
  type InlineConfirmState,
} from "../../src/lib/dialog";

/** Flush the queueMicrotask the action uses to defer initial focus. */
const tick = () =>
  new Promise<void>((r) => queueMicrotask(() => queueMicrotask(() => r())));

function setup() {
  const win = new Window();
  const doc = win.document as unknown as Document;
  // Make the constructed nodes' events see the happy-dom globals the action
  // relies on (queueMicrotask is a bun global, so nothing extra needed).
  const trigger = doc.createElement("button");
  trigger.textContent = "Open";
  doc.body.appendChild(trigger);
  trigger.focus();

  const dialog = doc.createElement("div");
  const title = doc.createElement("h2");
  title.id = "dlg-title";
  title.textContent = "Title";
  const first = doc.createElement("button");
  first.textContent = "First";
  const second = doc.createElement("button");
  second.textContent = "Second";
  dialog.append(title, first, second);
  doc.body.appendChild(dialog);

  const key = (k: string) =>
    new win.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });

  return { win, doc, trigger, dialog, first, second, key };
}

describe("dialogBehavior action", () => {
  test("owns the ARIA contract on the dialog root", () => {
    const { dialog } = setup();
    const handle = dialogBehavior(dialog, {
      onClose: () => {},
      labelledBy: "dlg-title",
    });
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("tabindex")).toBe("-1");
    expect(dialog.getAttribute("aria-labelledby")).toBe("dlg-title");
    handle?.destroy?.();
  });

  test("update() clears aria-labelledby when a later update omits it", () => {
    const { dialog } = setup();
    const handle = dialogBehavior(dialog, {
      onClose: () => {},
      labelledBy: "dlg-title",
    });
    expect(dialog.getAttribute("aria-labelledby")).toBe("dlg-title");
    // A reactive update that no longer supplies labelledBy must clear the
    // attribute, not leave it pointing at a stale/wrong label element.
    handle?.update?.({ onClose: () => {} });
    expect(dialog.hasAttribute("aria-labelledby")).toBe(false);
    handle?.destroy?.();
  });

  test("does not clobber an explicit tabindex", () => {
    const { dialog } = setup();
    dialog.setAttribute("tabindex", "0");
    const handle = dialogBehavior(dialog, { onClose: () => {} });
    expect(dialog.getAttribute("tabindex")).toBe("0");
    handle?.destroy?.();
  });

  test("moves focus to the first focusable descendant on open", async () => {
    const { doc, dialog, first } = setup();
    const handle = dialogBehavior(dialog, { onClose: () => {} });
    await tick();
    expect(doc.activeElement).toBe(first);
    handle?.destroy?.();
  });

  test("focusContainer focuses the dialog root instead of a descendant", async () => {
    const { doc, dialog } = setup();
    const handle = dialogBehavior(dialog, {
      onClose: () => {},
      focusContainer: true,
    });
    await tick();
    expect(doc.activeElement).toBe(dialog);
    handle?.destroy?.();
  });

  test("initialFocus selector picks a specific descendant", async () => {
    const { doc, dialog, second } = setup();
    second.classList.add("wanted");
    const handle = dialogBehavior(dialog, {
      onClose: () => {},
      initialFocus: ".wanted",
    });
    await tick();
    expect(doc.activeElement).toBe(second);
    handle?.destroy?.();
  });

  test("Escape invokes onClose and is consumed (does not reach the page)", () => {
    const { dialog, first, key } = setup();
    let closed = 0;
    let leaked = 0;
    dialog.ownerDocument.addEventListener("keydown", () => leaked++);
    const handle = dialogBehavior(dialog, { onClose: () => closed++ });
    const ev = key("Escape");
    first.dispatchEvent(ev);
    expect(closed).toBe(1);
    expect(leaked).toBe(0);
    handle?.destroy?.();
  });

  test("non-Escape keys do not invoke onClose", () => {
    const { dialog, first, key } = setup();
    let closed = 0;
    const handle = dialogBehavior(dialog, { onClose: () => closed++ });
    first.dispatchEvent(key("a"));
    first.dispatchEvent(key("Tab"));
    expect(closed).toBe(0);
    handle?.destroy?.();
  });

  test("restores focus to triggerEl on destroy", () => {
    const { doc, dialog, trigger, first } = setup();
    const handle = dialogBehavior(dialog, {
      onClose: () => {},
      triggerEl: trigger,
    });
    first.focus();
    expect(doc.activeElement).toBe(first);
    handle?.destroy?.();
    expect(doc.activeElement).toBe(trigger);
  });

  test("falls back to the previously-focused element when no triggerEl given", () => {
    const { doc, dialog, trigger, first } = setup();
    // `trigger` had focus at mount time (setup focuses it).
    const handle = dialogBehavior(dialog, { onClose: () => {} });
    first.focus();
    handle?.destroy?.();
    expect(doc.activeElement).toBe(trigger);
  });

  test("update() swaps in a newer triggerEl for the restore target", () => {
    const { doc, dialog, trigger, first, second } = setup();
    const handle = dialogBehavior(dialog, {
      onClose: () => {},
      triggerEl: trigger,
    });
    // A later render passes a different trigger (e.g. reactive $state changed).
    handle?.update?.({ onClose: () => {}, triggerEl: second });
    first.focus();
    handle?.destroy?.();
    expect(doc.activeElement).toBe(second);
  });
});

describe("guardedClose (M19 — mid-operation dismissal guard)", () => {
  test("invokes onClose when not blocked", () => {
    let closed = 0;
    const close = guardedClose(() => closed++, () => false);
    close();
    expect(closed).toBe(1);
  });

  test("is a no-op while blocked", () => {
    let closed = 0;
    const close = guardedClose(() => closed++, () => true);
    close();
    close();
    expect(closed).toBe(0);
  });

  test("re-reads the blocked getter on every call (reactive, not captured once)", () => {
    let closed = 0;
    let blocked = true;
    const close = guardedClose(() => closed++, () => blocked);
    close();
    expect(closed).toBe(0);
    blocked = false;
    close();
    expect(closed).toBe(1);
  });
});

describe("requestInlineConfirm / cancelInlineConfirm (L2 / M25 — two-step destructive confirm)", () => {
  test("first request arms the key without confirming", () => {
    const { state, confirmed } = requestInlineConfirm({}, "a");
    expect(confirmed).toBe(false);
    expect(state).toEqual({ a: true });
  });

  test("second request while armed confirms and clears the key", () => {
    const armed: InlineConfirmState = { a: true };
    const { state, confirmed } = requestInlineConfirm(armed, "a");
    expect(confirmed).toBe(true);
    expect(state).toEqual({});
  });

  test("keys are independent — arming one does not confirm another", () => {
    const armed: InlineConfirmState = { a: true };
    const { state, confirmed } = requestInlineConfirm(armed, "b");
    expect(confirmed).toBe(false);
    expect(state).toEqual({ a: true, b: true });
  });

  test("does not mutate the input state object", () => {
    const armed: InlineConfirmState = { a: true };
    requestInlineConfirm(armed, "a");
    expect(armed).toEqual({ a: true });
  });

  test("cancelInlineConfirm disarms a key", () => {
    const state = cancelInlineConfirm({ a: true, b: true }, "a");
    expect(state).toEqual({ b: true });
  });

  test("cancelInlineConfirm is a no-op (same reference) when the key isn't armed", () => {
    const state: InlineConfirmState = { b: true };
    expect(cancelInlineConfirm(state, "a")).toBe(state);
  });
});
