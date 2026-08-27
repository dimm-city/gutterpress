import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

/**
 * preview-mutation-protocol-characterization.test.ts (SFE-P0a, Lane B).
 *
 * `preview-interface.test.mjs` and `preview-shell-regression.test.mjs`
 * (packages/desktop/tests) already pin, against the REAL bundled scripts:
 *   - preview-interface.js's beginBlockEdit/endBlockEdit implementation and
 *     its contenteditable authoring surface (protocol v8);
 *   - preview-bridge.js forwarding blockEditRequested / blockEditFinished /
 *     blockEditStateChanged from the book iframe up to the host
 *     (preview-interface.test.mjs, "PASS bridge forwards protocol v8 edit
 *     events");
 *   - preview-shell.js holding a hot-reload swap open while
 *     blockEditStateChanged reports an edit in progress
 *     (preview-shell-regression.test.mjs, runBlockEditHoldRegression).
 *
 * See docs/plans/source-first-editor/mutation-inventory.md for the full
 * coverage map. What none of those files exercise is the OTHER relay
 * direction inside preview-shell.js: a host-originated `gutterpress:cmd`
 * message being forwarded DOWN to the active book iframe, and the
 * `cmd === 'beginBlockEdit'` special case that additionally calls
 * `active.focus()` on the shell's own iframe element (preview-shell.js's
 * "Transparent bridge relay" comment) — the focus handoff
 * `InlineEditController`'s `show()` depends on (see
 * inline-edit-controller.svelte.ts's `focusPreview` doc comment: "the shell
 * hands focus down to the active book frame as it relays beginBlockEdit").
 *
 * This is squarely inside P4a's "Lane A — Preview runtime deletion" scope
 * (remove in-flow contenteditable, begin/end block-edit commands, block-edit
 * protocol messages, and preview edit lifecycle) and P4b's search-proof
 * checklist for `beginBlockEdit`/`endBlockEdit`, so it must be pinned before
 * that code is touched.
 */

const shellSource = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "cli",
    "src",
    "assets",
    "preview",
    "scripts",
    "preview-shell.js",
  ),
  "utf8",
);

interface ShellHarness {
  /** Every message preview-shell.js relayed to the active book iframe. */
  forwarded: unknown[];
  getFocusCalls: () => number;
  /** Simulate a message arriving from the real desktop host (one level up). */
  fromHost: (data: unknown) => void;
}

/**
 * Loads the REAL preview-shell.js into a happy-dom window standing in for the
 * shell iframe, with a distinct object standing in for the actual desktop
 * host window (`window.parent`) and a spy in place of the active book
 * iframe's `contentWindow`/`focus()`.
 */
function loadShell(): ShellHarness {
  const outer = new Window({ url: "http://localhost/" });
  const document = outer.document;

  // Must be a DIFFERENT object from `outer` itself: preview-shell.js's
  // host-command relay branch is gated on `window.parent !== window`.
  const hostParent = { postMessage: () => {} };
  Object.defineProperty(outer, "parent", { configurable: true, value: hostParent });

  const active = document.createElement("iframe");
  active.id = "gutterpress-active";
  active.title = "preview";
  document.body.appendChild(active);

  const forwarded: unknown[] = [];
  const bookWindow = { postMessage: (message: unknown) => forwarded.push(message) };
  Object.defineProperty(active, "contentWindow", { configurable: true, value: bookWindow });
  let focusCalls = 0;
  active.focus = () => {
    focusCalls += 1;
  };

  // preview-shell.js unconditionally wires a change-source at load time
  // (`connectChanges`); without this stub it falls through to a real
  // WebSocket connection attempt, which this DOM cannot serve.
  (outer as unknown as { __GUTTERPRESS_INSTANCE: string }).__GUTTERPRESS_INSTANCE = "cli";
  (outer as unknown as { __GUTTERPRESS_REVISION: number }).__GUTTERPRESS_REVISION = 0;
  (outer as unknown as { __GUTTERPRESS_CHANGE_SOURCE: unknown }).__GUTTERPRESS_CHANGE_SOURCE = {
    subscribe: () => () => {},
    acknowledge: () => {},
  };

  const noDelaySetTimeout = ((cb: (...args: unknown[]) => void) => {
    cb();
    return 1;
  }) as unknown as typeof setTimeout;
  const noopClearTimeout = (() => {}) as typeof clearTimeout;
  const run = new Function("window", "document", "setTimeout", "clearTimeout", shellSource);
  run(outer, document, noDelaySetTimeout, noopClearTimeout);

  function fromHost(data: unknown): void {
    const event = new outer.Event("message");
    Object.defineProperties(event, {
      data: { value: data },
      source: { value: hostParent },
    });
    outer.dispatchEvent(event);
  }

  return { forwarded, getFocusCalls: () => focusCalls, fromHost };
}

describe("preview-shell.js host-command relay", () => {
  test("forwards an ordinary host command to the active book iframe verbatim, without focusing it", () => {
    const h = loadShell();
    const cmd = { type: "gutterpress:cmd", id: 1, cmd: "getTotalPages", args: [] };
    h.fromHost(cmd);
    expect(h.forwarded).toEqual([cmd]);
    expect(h.getFocusCalls()).toBe(0);
  });

  test("relaying a beginBlockEdit command ALSO focuses the active book iframe (the caret-seating handoff)", () => {
    // preview-shell.js's own comment: a postMessage carries no user
    // activation the book iframe could focus itself with, so the host
    // focuses this shell frame and this hands it the rest of the way down.
    // InlineEditController.show() depends on this: it calls
    // deps.focusPreview() BEFORE issuing beginBlockEdit specifically so this
    // handoff is not undone (see its own doc comment on ordering).
    const h = loadShell();
    const cmd = {
      type: "gutterpress:cmd",
      id: 2,
      cmd: "beginBlockEdit",
      args: [{ chapter: "a.md", range: [0, 1], text: "x" }],
    };
    h.fromHost(cmd);
    expect(h.forwarded).toEqual([cmd]);
    expect(h.getFocusCalls()).toBe(1);
  });

  test("relaying endBlockEdit forwards the command but does NOT focus — the handoff is one-directional, into an edit only", () => {
    const h = loadShell();
    h.fromHost({ type: "gutterpress:cmd", id: 3, cmd: "endBlockEdit", args: [{ commit: true }] });
    expect(h.getFocusCalls()).toBe(0);
  });

  test("a beginBlockEdit relay with no active iframe never throws (defensive: focus is wrapped, not load-bearing for delivery)", () => {
    const h = loadShell();
    // Two beginBlockEdit relays in a row still each focus exactly once —
    // the special case is keyed on the command name every time, not a
    // one-shot latch.
    h.fromHost({ type: "gutterpress:cmd", id: 4, cmd: "beginBlockEdit", args: [{}] });
    h.fromHost({ type: "gutterpress:cmd", id: 5, cmd: "beginBlockEdit", args: [{}] });
    expect(h.getFocusCalls()).toBe(2);
    expect(h.forwarded.length).toBe(2);
  });
});
