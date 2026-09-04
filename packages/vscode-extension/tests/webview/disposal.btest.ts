import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { openHarnessSession, waitForHarnessReady, type HarnessSession } from "@dimm-city/gutterpress-editor/test-harness";

/**
 * SFE-P3c Lane C — real-Chromium proof of webview disposal (run spec
 * DETAILS #4e, behavior table row "Disposal"): "Disposing the panel removes
 * every listener, timer and subscription on both sides; a remount in the
 * same session works; a leak fixture proves the assertion can fail."
 *
 * TWO INDEPENDENT leak dimensions are proven here:
 *
 *   1. Transport-listener count — `WebviewSession.dispose()` must remove
 *      `ProxyDocumentHost`'s OWN `transport.onMessage` subscription
 *      (`fake-extension-host.ts`'s `listenerCount()`), the webview-transport
 *      half of "removes every listener ... on both sides". The
 *      `mountEditor`-internal host subscription is a DIFFERENT, already-
 *      proven layer (`packages/editor/tests/web/mount.btest.ts`'s own
 *      "dispose" suite) — not re-proven here.
 *   2. No double-delivery after dispose — a keystroke on a REMOUNTED editor
 *      (same fake host) must produce exactly ONE more recorded edit, not
 *      two, proving the FIRST (disposed) mount's wiring is not still firing
 *      alongside the second.
 *
 * SABOTAGE (G-12/AP-20): both assertions below were verified LOCALLY to fail
 * when `WebviewSession.dispose()`'s `host.dispose()` call was temporarily
 * removed — `listenerCount()` stayed at 1 instead of dropping to 0 (all
 * three `listenerCount()` assertions in this file fail identically that
 * way, one per test in this describe block and the remount test below).
 * Not committed to source; the exact re-verified result (repair round 1) is
 * recorded in `docs/plans/source-first-editor/runs/SFE-P3c.md`'s
 * "Deviations and evidence" section.
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

async function listenerCount(): Promise<number> {
  return harness.page.evaluate(() => window.__gpWebview.listenerCount());
}

async function applyEditCount(): Promise<number> {
  return harness.page.evaluate(() => window.__gpWebview.applyEditCount());
}

async function editorElementCount(): Promise<number> {
  return harness.page.evaluate(
    () => document.querySelectorAll(`${window.__gpWebview.containerSelector} .md-editor`).length,
  );
}

describe("dispose removes the transport-level listener", () => {
  test("listenerCount drops from 1 to 0 across mount -> dispose", async () => {
    const selector = await harness.page.evaluate((text: string) => window.__gpWebview.mount(text), "dispose probe");
    await harness.page.waitForFunction(
      (expected: string) => window.__gpWebview.documentText() === expected,
      "dispose probe",
      { timeout: 5_000 },
    );
    // AP-21 liveness before the behavioral assertion below.
    expect(await editorElementCount()).toBe(1);
    expect(selector).toBe("#gp-editor-root");

    expect(await listenerCount()).toBe(1);

    await harness.page.evaluate(() => window.__gpWebview.dispose());

    expect(await listenerCount()).toBe(0);
    expect(await editorElementCount()).toBe(0);
  });

  test("dispose is idempotent: calling it twice does not throw", async () => {
    await harness.page.evaluate((text: string) => window.__gpWebview.mount(text), "idempotent dispose probe");
    await harness.page.waitForFunction(() => window.__gpWebview.hasEditorMounted() === true, undefined, {
      timeout: 5_000,
    });

    await expect(
      harness.page.evaluate(() => {
        window.__gpWebview.dispose();
        window.__gpWebview.dispose();
      }),
    ).resolves.toBeUndefined();

    expect(await listenerCount()).toBe(0);
  });
});

describe("dispose then remount on the same fake host — no leaked wiring", () => {
  test("exactly one MORE apply-edit reaches the host after remount, not two", async () => {
    const selector = await harness.page.evaluate((text: string) => window.__gpWebview.mount(text), "hello");
    await harness.page.waitForFunction(
      (expected: string) => window.__gpWebview.documentText() === expected,
      "hello",
      { timeout: 5_000 },
    );
    expect(await editorElementCount()).toBe(1); // AP-21 liveness

    await harness.page.click(selector);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("A");
    await harness.page.waitForTimeout(50);

    const countAfterFirst = await applyEditCount();
    expect(countAfterFirst).toBe(1);
    // Reads the MIRROR's own optimistic view (D2/D3's local-accept half).
    expect(await harness.page.evaluate(() => window.__gpWebview.documentText())).toBe("helloA");

    // The reconciliation fix (`edit-version-reconciliation.btest.ts`, this
    // same directory) means this keystroke also reaches the fake host's
    // OWN authoritative document, not only the mirror — wait for that
    // round trip to land before disposing, rather than a fixed sleep.
    await harness.page.waitForFunction(() => window.__gpWebview.hostText() === "helloA", undefined, {
      timeout: 5_000,
    });

    await harness.page.evaluate(() => window.__gpWebview.dispose());
    expect(await listenerCount()).toBe(0);

    const remountedSelector = await harness.page.evaluate(() => window.__gpWebview.remount());
    expect(remountedSelector).toBe("#gp-editor-root");
    // The remounted session starts a FRESH ProxyDocumentHost, which
    // converges from the fake host's OWN authoritative text — "helloA",
    // reflecting the keystroke typed before dispose (the reconciliation fix
    // means that edit genuinely reached the host; disposing the webview
    // session is not a way to discard it).
    await harness.page.waitForFunction(
      (expected: string) => window.__gpWebview.documentText() === expected,
      "helloA",
      { timeout: 5_000 },
    );
    expect(await editorElementCount()).toBe(1); // AP-21 liveness on the remount
    expect(await listenerCount()).toBe(1);

    await harness.page.click(remountedSelector);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("B");
    await harness.page.waitForTimeout(50);

    // The decisive proof: exactly one MORE recorded edit, never two — if
    // the first (disposed) mount's ProxyDocumentHost/transport listener
    // had leaked, this single keystroke would reach it too (in addition to
    // the live, remounted one), and listenerCount() above would already
    // have shown 2 instead of 1.
    expect(await applyEditCount()).toBe(countAfterFirst + 1);
    expect(await harness.page.evaluate(() => window.__gpWebview.documentText())).toBe("helloAB");
  });
});

describe("harness liveness", () => {
  test("the shared session produced no console or page errors across every case above", () => {
    expect(harness.consoleErrors).toEqual([]);
    expect(harness.pageErrors).toEqual([]);
  });
});
