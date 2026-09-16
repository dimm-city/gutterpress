import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { openHarnessSession, waitForHarnessReady, type HarnessSession } from "@dimm-city/gutterpress-editor/test-harness";

/**
 * Repair round 1 — real-Chromium proof for finding "One malformed inbound
 * message permanently destroys the editing surface, while the proxy mirror
 * stays writable and the message listener does no origin filtering": no
 * suite covered the malformed-message -> webview-UI path at all before this
 * file. Delivers one, then several, malformed/unrelated payloads directly
 * to the real webview's message listener (via
 * `FakeExtensionHostSession.deliverRaw`, bypassing `SimulatedExtensionHost`'s
 * own well-formed-message-only construction — see that session's own doc
 * comment) and asserts the session SURVIVES: the mount is never disposed,
 * no fallback ever renders, and typed input keeps producing real,
 * byte-exact `apply-edit` messages afterward.
 *
 * AP-21: liveness (`editorElementCount()`/`hasEditorMounted()`) is asserted
 * BEFORE and AFTER every malformed delivery, and the closing edit is
 * checked byte-exact — a webview that silently stopped responding would
 * fail these, not merely "not crash."
 *
 * ONE shared browser session drives every case in this file
 * (`beforeAll`/`afterAll`) — see `mount.btest.ts`'s header for why.
 */

const entryPath = resolve(import.meta.dir, "support/entry.ts");

let harness: HarnessSession;
let closeHarness: () => Promise<void>;

beforeAll(async () => {
  const opened = await openHarnessSession(entryPath);
  harness = opened.session;
  closeHarness = opened.close;
  await waitForHarnessReady(harness.page);
}, 30_000);

afterAll(async () => {
  await closeHarness();
});

async function editorElementCount(): Promise<number> {
  return harness.page.evaluate(
    () => document.querySelectorAll(`${window.__gpWebview.containerSelector} .md-editor`).length,
  );
}

async function fallbackShowing(): Promise<boolean> {
  return harness.page.evaluate(() => window.__gpWebview.fallbackCategory() !== null);
}

describe("a single malformed inbound message does not destroy the session", () => {
  test("the mount survives a wrong-protocol-version message, and typed input still works afterward", async () => {
    const selector = await harness.page.evaluate((text: string) => window.__gpWebview.mount(text), "still here");
    await harness.page.waitForFunction(
      (expected: string) => window.__gpWebview.documentText() === expected,
      "still here",
      { timeout: 5_000 },
    );
    expect(await editorElementCount()).toBe(1); // AP-21 liveness
    expect(await fallbackShowing()).toBe(false);

    await harness.page.evaluate(() =>
      window.__gpWebview.deliverRaw({ type: "snapshot", protocolVersion: 999, snapshot: { text: "y", version: 1 } }),
    );
    // Give any (incorrect) teardown a moment to happen before asserting its
    // absence.
    await harness.page.waitForTimeout(150);

    expect(await editorElementCount()).toBe(1); // still mounted, not disposed
    expect(await fallbackShowing()).toBe(false); // never latched a fallback

    await harness.page.click(selector);
    await harness.page.keyboard.press("Control+End");
    await harness.page.keyboard.type("!");
    await harness.page.waitForFunction(() => window.__gpWebview.hostText() === "still here!", undefined, {
      timeout: 5_000,
    });
    const edits = await harness.page.evaluate(() => window.__gpWebview.recordedEdits());
    expect(edits.at(-1)?.insert).toBe("!");
  });
});

describe("a burst of unrelated window-message noise does not destroy the session", () => {
  test("survives arbitrary non-object, null, and shapeless payloads in a row", async () => {
    await harness.page.evaluate((text: string) => window.__gpWebview.mount(text), "noise proof");
    await harness.page.waitForFunction(
      (expected: string) => window.__gpWebview.documentText() === expected,
      "noise proof",
      { timeout: 5_000 },
    );
    expect(await editorElementCount()).toBe(1); // AP-21 liveness

    await harness.page.evaluate(() => {
      const noisy = [
        "a plain string, not even an object",
        42,
        null,
        undefined,
        { unrelated: "message from something else entirely" },
        { type: "presentation-input" }, // missing protocolVersion/mode — malformed
        { type: "apply-edit", protocolVersion: 1 }, // missing edit/base — malformed
      ];
      for (const payload of noisy) window.__gpWebview.deliverRaw(payload);
    });
    await harness.page.waitForTimeout(150);

    expect(await editorElementCount()).toBe(1);
    expect(await fallbackShowing()).toBe(false);
  });
});

describe("harness liveness", () => {
  test("the shared session produced no uncaught page errors (console warnings from the rejected messages are expected, not thrown errors)", () => {
    expect(harness.pageErrors).toEqual([]);
  });
});
