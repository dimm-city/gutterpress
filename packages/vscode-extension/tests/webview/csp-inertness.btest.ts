import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { openHarnessSession, waitForHarnessReady, type HarnessSession } from "@dimm-city/gutterpress-editor/test-harness";

/**
 * SFE-P3c Lane C — real-Chromium proof that the webview's CSP makes
 * unauthorized scripts inert (run spec DETAILS #4c, behavior table row "CSP
 * and inertness"): "a script payload in the document's markdown does NOT
 * execute (assert via a window sentinel that stays unset)".
 *
 * See `support/csp-entry.ts`'s header for exactly which of the run spec's
 * two offered proof strategies this suite uses (inject a reconstructed CSP
 * into the harness page) and why, and for the complementary string-pin
 * suite (`tests/provider.test.ts`) that proves the OTHER half (the real
 * `renderWebviewHtml` emits that exact recipe).
 *
 * ONE shared browser session drives every case in this file
 * (`beforeAll`/`afterAll`) — see `mount.btest.ts`'s header for why.
 */

const entryPath = resolve(import.meta.dir, "support/csp-entry.ts");

let harness: HarnessSession;
let closeHarness: () => Promise<void>;

beforeAll(async () => {
  const opened = await openHarnessSession(entryPath);
  harness = opened.session;
  closeHarness = opened.close;
  await waitForHarnessReady(harness.page);
  // AP-21 liveness for the WHOLE file: the real mount rendered its seeded
  // text despite the CSP being active — proves style-src: unsafe-inline
  // does not silently blank mountEditor's own un-nonced <style> injection
  // (renderWebviewHtml's own documented rationale for that directive),
  // before any script-execution assertion below runs.
  await harness.page.waitForFunction(
    () => document.querySelector("#gp-editor-root .md-document")?.textContent === "hello CSP",
    undefined,
    { timeout: 5_000 },
  );
}, 30_000);

afterAll(async () => {
  await closeHarness();
});

async function sentinel(name: "__gpCspNoncedRan" | "__gpCspUnnoncedRan" | "__gpCspOnerrorRan"): Promise<boolean> {
  return harness.page.evaluate((n) => Boolean((window as unknown as Record<string, unknown>)[n]), name);
}

async function violationCount(): Promise<number> {
  return harness.page.evaluate(() => window.__gpCsp.violations().length);
}

describe("liveness: the mount rendered under an active CSP", () => {
  test("exactly one .md-editor is present", async () => {
    const count = await harness.page.evaluate(
      () => document.querySelectorAll(`${window.__gpCsp.containerSelector} .md-editor`).length,
    );
    expect(count).toBe(1);
  });
});

describe("positive control: a nonced script executes", () => {
  test("a <script> carrying the CSP's own nonce runs and sets its sentinel", async () => {
    expect(await sentinel("__gpCspNoncedRan")).toBe(false);
    await harness.page.evaluate(() => window.__gpCsp.runNoncedScript());
    await harness.page.waitForFunction(() => (window as unknown as Record<string, unknown>).__gpCspNoncedRan === true, undefined, {
      timeout: 2_000,
    });
    expect(await sentinel("__gpCspNoncedRan")).toBe(true);
  });
});

describe("negative: an un-nonced <script> element is inert", () => {
  test("simulates a script payload landing in rendered markdown/generated HTML — sentinel stays unset, a CSP violation is reported", async () => {
    expect(await sentinel("__gpCspUnnoncedRan")).toBe(false);
    const violationsBefore = await violationCount();

    await harness.page.evaluate(() => window.__gpCsp.runUnnoncedScript());
    // No sentinel to wait ON here (it must NEVER appear) — wait for the
    // browser's own CSP violation report instead, which is the positive
    // signal that this attempt was actually evaluated and rejected.
    await harness.page.waitForFunction(
      (before: number) => window.__gpCsp.violations().length > before,
      violationsBefore,
      { timeout: 2_000 },
    );

    expect(await sentinel("__gpCspUnnoncedRan")).toBe(false);
  });
});

describe("negative: an inline onerror=\"...\" payload is inert", () => {
  test("simulates a common plugin/generated-HTML XSS vector — sentinel stays unset, a CSP violation is reported", async () => {
    expect(await sentinel("__gpCspOnerrorRan")).toBe(false);
    const violationsBefore = await violationCount();

    await harness.page.evaluate(() => window.__gpCsp.triggerOnerrorPayload());
    await harness.page.waitForFunction(
      (before: number) => window.__gpCsp.violations().length > before,
      violationsBefore,
      { timeout: 2_000 },
    );

    expect(await sentinel("__gpCspOnerrorRan")).toBe(false);
  });
});

describe("harness liveness", () => {
  test("the shared session produced no unexpected console/page errors (CSP violation reports are expected and are not thrown errors)", () => {
    expect(harness.pageErrors).toEqual([]);
  });
});
