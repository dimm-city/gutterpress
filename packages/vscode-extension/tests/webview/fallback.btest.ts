import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { openHarnessSession, waitForHarnessReady, type HarnessSession } from "@dimm-city/gutterpress-editor/test-harness";
import { fileTooLargeDiagnostic, hostDisconnectedDiagnostic } from "../../src/protocol/diagnostics.ts";

/**
 * SFE-P3c Lane C — real-Chromium proof of the webview's honest fallback
 * rendering (run spec DETAILS #4d, behavior table rows "Oversized file" and
 * "Host disconnection"): `mountGutterpressWebview`
 * (`../../src/webview/index.ts`) renders "plain, honest text in
 * #gp-editor-root with the D14 category and safe next action" — never a
 * blank container, never a silently-stuck loading state — for D13's
 * oversized/source-fallback decision AND for a live
 * `EDITOR_HOST_DISCONNECTED` diagnostic arriving mid-session.
 *
 * Reuses the SAME `Diagnostic` constructors production code uses
 * (`../../src/protocol/diagnostics.ts`'s `fileTooLargeDiagnostic`/
 * `hostDisconnectedDiagnostic`) rather than hardcoding expected strings —
 * if those constructors' wording ever changes, this suite changes with
 * them instead of silently pinning stale text.
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

async function hasEditorMounted(): Promise<boolean> {
  return harness.page.evaluate(() => window.__gpWebview.hasEditorMounted());
}

async function fallback(): Promise<{
  category: string | null;
  message: string | null;
  action: string | null;
}> {
  return harness.page.evaluate(() => ({
    category: window.__gpWebview.fallbackCategory(),
    message: window.__gpWebview.fallbackMessage(),
    action: window.__gpWebview.fallbackAction(),
  }));
}

describe("D13 oversized file: presentation-input mode 'source-fallback' renders honest fallback text, never a mount", () => {
  test("shows the EDITOR_FILE_TOO_LARGE category, message, and safe action; no editor mounts", async () => {
    const diagnostic = fileTooLargeDiagnostic();
    await harness.page.evaluate(
      (diag) => window.__gpWebview.mount("irrelevant seeded text", { mode: "source-fallback", diagnostic: diag }),
      diagnostic,
    );

    // AP-21 liveness: the fallback DOM actually appeared before asserting
    // its content.
    await harness.page.waitForFunction(() => window.__gpWebview.fallbackCategory() !== null, undefined, {
      timeout: 5_000,
    });

    const shown = await fallback();
    expect(shown.category).toBe(diagnostic.category);
    expect(shown.message).toBe(diagnostic.message);
    expect(shown.action).toBe(diagnostic.safeAction ?? null);

    expect(await hasEditorMounted()).toBe(false);
    // No editor exists to type into, so no edit can ever reach the host —
    // the strongest available proof that source-fallback mode never mounts
    // an editable surface here.
    expect(await harness.page.evaluate(() => window.__gpWebview.applyEditCount())).toBe(0);
  });
});

describe("EDITOR_HOST_DISCONNECTED: a live disconnect tears down the mount and renders honest fallback text", () => {
  test("a mounted rich editor disposes and shows the disconnect category/message/action once the host disconnects", async () => {
    const selector = await harness.page.evaluate((text: string) => window.__gpWebview.mount(text), "before disconnect");
    expect(selector).toBe("#gp-editor-root");

    await harness.page.waitForFunction(
      (expected: string) => window.__gpWebview.documentText() === expected,
      "before disconnect",
      { timeout: 5_000 },
    );
    expect(await hasEditorMounted()).toBe(true);

    await harness.page.evaluate(() => window.__gpWebview.disconnectHost());

    await harness.page.waitForFunction(() => window.__gpWebview.hasEditorMounted() === false, undefined, {
      timeout: 5_000,
    });

    const expected = hostDisconnectedDiagnostic("document-closed");
    const shown = await fallback();
    expect(shown.category).toBe(expected.category);
    expect(shown.message).toBe(expected.message);
    expect(shown.action).toBe(expected.safeAction ?? null);
    expect(await hasEditorMounted()).toBe(false);
  });
});

describe("harness liveness", () => {
  test("the shared session produced no console or page errors across every case above", () => {
    expect(harness.consoleErrors).toEqual([]);
    expect(harness.pageErrors).toEqual([]);
  });
});
