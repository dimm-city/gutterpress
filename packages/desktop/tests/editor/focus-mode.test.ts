import { describe, expect, test } from "bun:test";
import {
  FOCUS_BAR_IDLE_MS,
  createIdleReveal,
  escapeExitsFocus,
} from "../../src/lib/routes/focus-mode";

const noOverlay = { querySelector: () => null };
const overlayOpen = { querySelector: () => ({}) };

describe("escapeExitsFocus", () => {
  test("Esc with nothing else open exits", () => {
    expect(escapeExitsFocus({ key: "Escape", defaultPrevented: false }, noOverlay)).toBe(true);
  });

  test("other keys never exit", () => {
    expect(escapeExitsFocus({ key: "Enter", defaultPrevented: false }, noOverlay)).toBe(false);
  });

  test("an Esc some handler already consumed (editor, find bar, context menu) does not exit", () => {
    expect(escapeExitsFocus({ key: "Escape", defaultPrevented: true }, noOverlay)).toBe(false);
  });

  test("an open dialog/menu/popover keeps Esc", () => {
    expect(escapeExitsFocus({ key: "Escape", defaultPrevented: false }, overlayOpen)).toBe(false);
  });

  test("state owned outside the DOM (the find bar) keeps Esc", () => {
    expect(escapeExitsFocus({ key: "Escape", defaultPrevented: false }, noOverlay, true)).toBe(false);
  });
});

describe("createIdleReveal", () => {
  function harness() {
    let now = 0;
    const timers = new Map<number, { at: number; fn: () => void }>();
    let nextId = 1;
    const changes: boolean[] = [];
    const reveal = createIdleReveal((v) => changes.push(v), FOCUS_BAR_IDLE_MS, {
      set: (fn, ms) => {
        const id = nextId++;
        timers.set(id, { at: now + ms, fn });
        return id;
      },
      clear: (id) => void timers.delete(id as number),
    });
    const advance = (ms: number) => {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    };
    return { reveal, advance, changes, pending: () => timers.size };
  }

  test("starts visible and fades after the idle delay", () => {
    const h = harness();
    expect(h.changes).toEqual([true]);
    h.advance(FOCUS_BAR_IDLE_MS - 1);
    expect(h.changes).toEqual([true]);
    h.advance(1);
    expect(h.changes).toEqual([true, false]);
  });

  test("reveal brings it back and restarts the countdown", () => {
    const h = harness();
    h.advance(FOCUS_BAR_IDLE_MS);
    h.reveal.reveal();
    expect(h.changes).toEqual([true, false, true]);
    h.advance(FOCUS_BAR_IDLE_MS - 1);
    expect(h.changes.at(-1)).toBe(true);
    h.advance(1);
    expect(h.changes.at(-1)).toBe(false);
  });

  test("reveal while visible only restarts the clock (no duplicate notifications)", () => {
    const h = harness();
    h.advance(2000);
    h.reveal.reveal();
    h.advance(2000);
    expect(h.changes).toEqual([true]);
    h.advance(1000);
    expect(h.changes).toEqual([true, false]);
  });

  test("a held bar (hover / keyboard focus) never fades, and releasing restarts the countdown", () => {
    const h = harness();
    h.reveal.hold(true);
    h.advance(FOCUS_BAR_IDLE_MS * 5);
    expect(h.changes).toEqual([true]);
    h.reveal.hold(false);
    h.advance(FOCUS_BAR_IDLE_MS);
    expect(h.changes).toEqual([true, false]);
  });

  test("holding a faded bar (Tab onto it) shows it", () => {
    const h = harness();
    h.advance(FOCUS_BAR_IDLE_MS);
    h.reveal.hold(true);
    expect(h.changes).toEqual([true, false, true]);
  });

  test("dispose cancels the pending fade", () => {
    const h = harness();
    h.reveal.dispose();
    expect(h.pending()).toBe(0);
  });
});
