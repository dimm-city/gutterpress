/**
 * Unit tests for PreviewClient's postMessage origin/source validation (M31,
 * 2026-07-10 UX review).
 *
 * Before this fix, PreviewClient accepted a message from ANY origin (only
 * checking `data.type`/shape) and posted outgoing commands with targetOrigin
 * `'*'` — while the same component (PreviewFrame) is also used in
 * URL-preview mode, where the iframe loads an arbitrary third-party page.
 * That page could spoof `gutterpress:reply`/`gutterpress:event` messages to drive render
 * state, page counts, and success toasts.
 *
 * Covers:
 *   1. call() never posts with targetOrigin '*' — only the pinned origin.
 *   2. call() refuses to send at all until an origin has been pinned.
 *   3. Incoming messages are accepted ONLY when e.source === the attached
 *      window AND e.origin === the pinned origin (either alone is rejected).
 *   4. lockDown() makes attach() a permanent no-op (URL-preview mode never
 *      wires the bridge up at all).
 *
 * DOM is provided by happy-dom (an explicit `new Window()` promoted to the
 * ambient global for the duration of each test — the same technique
 * tests/platform/dialog.test.ts uses locally, extended here because
 * PreviewClient listens on the AMBIENT `window`, not an injected one, since
 * that's what it has access to in the real app).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { PreviewClient } from "../../src/lib/preview-client";

let win: InstanceType<typeof Window>;
let savedWindow: unknown;
let savedMessageEvent: unknown;

beforeEach(() => {
  win = new Window({ url: "http://localhost/" });
  savedWindow = (globalThis as Record<string, unknown>).window;
  savedMessageEvent = (globalThis as Record<string, unknown>).MessageEvent;
  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).MessageEvent = win.MessageEvent;
});

afterEach(() => {
  (globalThis as Record<string, unknown>).window = savedWindow;
  (globalThis as Record<string, unknown>).MessageEvent = savedMessageEvent;
});

/** Stands in for `iframe.contentWindow` — postMessage is the only thing PreviewClient calls on it. */
function fakeFrameWindow() {
  const calls: Array<{ msg: unknown; targetOrigin: string }> = [];
  return {
    postMessage: (msg: unknown, targetOrigin: string) => {
      calls.push({ msg, targetOrigin });
    },
    calls,
  };
}

/** Dispatches a synthetic "message" event on the ambient window with a chosen origin/source. */
function dispatchMessage(data: unknown, origin: string, source: unknown) {
  const ev = new (globalThis as Record<string, unknown> as { MessageEvent: typeof MessageEvent })
    .MessageEvent("message", { data, origin } as MessageEventInit);
  Object.defineProperty(ev, "source", { value: source, configurable: true });
  win.dispatchEvent(ev as unknown as Event);
}

describe("PreviewClient postMessage origin/source validation (M31)", () => {
  test("call() posts only to the pinned origin, never '*'", () => {
    const c = new PreviewClient();
    const frameWin = fakeFrameWindow();
    c.setExpectedOrigin("http://127.0.0.1:3579/some/book/");
    c.attach(frameWin as unknown as Window);
    // Deliberately left pending (never replied to) and not awaited — this
    // test only cares about what was posted, not the call's eventual
    // settlement. Swallow so it doesn't surface as an unhandled rejection.
    c.call("getOutline").catch(() => {});
    expect(frameWin.calls.length).toBe(1);
    expect(frameWin.calls[0]!.targetOrigin).toBe("http://127.0.0.1:3579");
    expect(frameWin.calls[0]!.targetOrigin).not.toBe("*");
    c.detach();
  });

  test("call() refuses to send until an origin has been pinned", async () => {
    const c = new PreviewClient();
    const frameWin = fakeFrameWindow();
    c.attach(frameWin as unknown as Window); // no setExpectedOrigin
    await expect(c.call("getOutline")).rejects.toThrow(/not attached/i);
    expect(frameWin.calls.length).toBe(0);
    c.detach();
  });

  test("setBgColor / injectStyles are no-ops until an origin is pinned", () => {
    const c = new PreviewClient();
    const frameWin = fakeFrameWindow();
    c.attach(frameWin as unknown as Window);
    c.setBgColor("#333");
    c.injectStyles("x", "body{}");
    expect(frameWin.calls.length).toBe(0);
    c.detach();
  });

  test("accepts a gutterpress:event message only when BOTH origin and source match", () => {
    const c = new PreviewClient();
    const frameWin = fakeFrameWindow();
    c.setExpectedOrigin("http://127.0.0.1:3579/");
    c.attach(frameWin as unknown as Window);

    const received: unknown[] = [];
    c.on((e) => received.push(e));

    // Right source, wrong origin (a spoofing page in the same window slot) → rejected.
    dispatchMessage({ type: "gutterpress:event", name: "ready", detail: {} }, "http://evil.example", frameWin);
    expect(received.length).toBe(0);

    // Right origin, wrong source (a different frame claiming the trusted origin) → rejected.
    dispatchMessage(
      { type: "gutterpress:event", name: "ready", detail: {} },
      "http://127.0.0.1:3579",
      fakeFrameWindow(),
    );
    expect(received.length).toBe(0);

    // Right origin AND right source → accepted.
    dispatchMessage({ type: "gutterpress:event", name: "ready", detail: {} }, "http://127.0.0.1:3579", frameWin);
    expect(received.length).toBe(1);

    c.detach();
  });

  test("accepts a gutterpress:reply only when BOTH origin and source match", () => {
    const c = new PreviewClient();
    const frameWin = fakeFrameWindow();
    c.setExpectedOrigin("http://127.0.0.1:3579/");
    c.attach(frameWin as unknown as Window);

    const p = c.call("getOutline").catch((e) => e);
    const id = 1; // first call() in a fresh client always gets id 1

    // Spoofed reply from the wrong origin must not resolve the pending call.
    dispatchMessage({ type: "gutterpress:reply", id, ok: true, result: ["spoofed"] }, "http://evil.example", frameWin);
    // Genuine reply resolves it.
    dispatchMessage({ type: "gutterpress:reply", id, ok: true, result: ["real"] }, "http://127.0.0.1:3579", frameWin);

    c.detach();
    return p.then((result) => {
      expect(result).toEqual(["real"]);
    });
  });

  test("lockDown() makes attach() a permanent no-op — URL-preview mode never wires the bridge", async () => {
    const c = new PreviewClient();
    const frameWin = fakeFrameWindow();
    c.lockDown();
    c.setExpectedOrigin("http://example.com/"); // also inert once locked
    c.attach(frameWin as unknown as Window);

    await expect(c.call("getOutline")).rejects.toThrow(/not attached/i);
    expect(frameWin.calls.length).toBe(0);

    const received: unknown[] = [];
    c.on((e) => received.push(e));
    dispatchMessage({ type: "gutterpress:event", name: "ready", detail: {} }, "http://example.com", frameWin);
    expect(received.length).toBe(0);
  });
});

/**
 * Bridge protocol v4 (docs/inline-editing-plan.md §3.4): getContextTargetAt()
 * command wrapper + the contextMenuRequested event round-trip through
 * PreviewClient, following the M31 origin/source-gated pattern above.
 */
describe("PreviewClient context-menu bridge (protocol v4)", () => {
  test("getContextTargetAt() sends the command with its point argument", () => {
    const c = new PreviewClient();
    const frameWin = fakeFrameWindow();
    c.setExpectedOrigin("http://127.0.0.1:3579/");
    c.attach(frameWin as unknown as Window);

    c.getContextTargetAt({ x: 12, y: 34 }).catch(() => {});
    expect(frameWin.calls.length).toBe(1);
    const sent = frameWin.calls[0]!.msg as { cmd: string; args: unknown[] };
    expect(sent.cmd).toBe("getContextTargetAt");
    expect(sent.args).toEqual([{ x: 12, y: 34 }]);

    c.detach();
  });

  test("getContextTargetAt() resolves with the reply's ContextTarget payload", async () => {
    const c = new PreviewClient();
    const frameWin = fakeFrameWindow();
    c.setExpectedOrigin("http://127.0.0.1:3579/");
    c.attach(frameWin as unknown as Window);

    const payload = {
      kind: "block" as const,
      chapter: "a.md",
      range: [4, 5] as [number, number],
      blockTag: "p",
      split: false,
      ref: "p-ref",
      rect: { top: 1, left: 2, width: 3, height: 4 },
      image: null,
      link: null,
      selection: null,
    };
    const p = c.getContextTargetAt({ x: 1, y: 1 });
    const id = 1; // first call() in a fresh client always gets id 1
    dispatchMessage(
      { type: "gutterpress:reply", id, ok: true, result: payload },
      "http://127.0.0.1:3579",
      frameWin,
    );

    c.detach();
    await expect(p).resolves.toEqual(payload);
  });

  test("a genuine contextMenuRequested event round-trips through on() with its full detail", () => {
    const c = new PreviewClient();
    const frameWin = fakeFrameWindow();
    c.setExpectedOrigin("http://127.0.0.1:3579/");
    c.attach(frameWin as unknown as Window);

    const received: unknown[] = [];
    c.on((e) => received.push(e));

    const detail = {
      kind: "selection",
      chapter: "a.md",
      range: [2, 3],
      blockTag: "p",
      split: false,
      ref: "p-ref",
      rect: { top: 10, left: 20, width: 30, height: 40 },
      image: null,
      link: null,
      selection: { text: "Hello", withinSingleBlock: true, range: [2, 3], chapter: "a.md" },
      x: 100,
      y: 200,
      via: "mouse",
    };

    // Spoofed event from the wrong origin must not reach listeners (M31 still applies).
    dispatchMessage(
      { type: "gutterpress:event", name: "contextMenuRequested", detail },
      "http://evil.example",
      frameWin,
    );
    expect(received.length).toBe(0);

    dispatchMessage(
      { type: "gutterpress:event", name: "contextMenuRequested", detail },
      "http://127.0.0.1:3579",
      frameWin,
    );
    expect(received.length).toBe(1);
    expect(received[0]).toEqual({ name: "contextMenuRequested", detail });

    c.detach();
  });
});
