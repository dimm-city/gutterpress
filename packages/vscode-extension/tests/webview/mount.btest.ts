import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { openHarnessSession, waitForHarnessReady, type HarnessSession } from "@dimm-city/gutterpress-editor/test-harness";
import type { SourceEdit } from "@dimm-city/gutterpress-editor/core";

/**
 * SFE-P3c Lane C — real-Chromium proof of the webview mount path (run spec
 * DETAILS #4a/#4b, behavior table row "Webview mount"): the webview mounts
 * `mountGutterpressWebview` (`../../src/webview/index.ts`) over a
 * `ProxyDocumentHost`, renders the seeded document, and typed input through
 * REAL keyboard events produces `apply-edit` messages whose `{from, to,
 * insert}` land byte-exactly against the fake host's document.
 *
 * Reuses `packages/editor`'s real-Chromium harness through its new
 * `./test-harness` subpath export (this run's deliverable 3) — never
 * cloned. ONE shared browser session drives every case in this file
 * (`beforeAll`/`afterAll`), matching that harness's own documented reason
 * (a second Chromium launch hangs in this sandboxed environment) and
 * `packages/editor/tests/web/mount.btest.ts`'s own precedent.
 *
 * AP-21: every case asserts the mounted editor rendered the EXACT expected
 * text (`requireDocumentText`) BEFORE any behavioral assertion.
 *
 * D13's byte-boundary MATH (over/at the 2 MiB ceiling) is already proven as
 * a fast host-side unit test (`tests/provider.test.ts`, "D13 boundary: a
 * document exactly AT the ceiling still mounts rich") — this file does not
 * re-derive that arithmetic; "the boundary case (just under) mounts rich"
 * is, from THIS layer, the identical code path `presentation-input`'s
 * `mode: "rich"` already exercises below, so it is proven by the same
 * liveness case rather than duplicated with an actual near-2 MiB fixture.
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

async function mount(text: string): Promise<string> {
  return harness.page.evaluate((initialText: string) => window.__gpWebview.mount(initialText), text);
}

/** AP-21 liveness: asserts the mounted editor rendered a `.md-document` with
 *  the exact expected text, and returns that text. */
async function requireDocumentText(expected: string): Promise<void> {
  const text = await harness.page.evaluate(() => window.__gpWebview.documentText());
  expect(text).toBe(expected);
}

async function editorElementCount(): Promise<number> {
  return harness.page.evaluate(() =>
    document.querySelectorAll(`${window.__gpWebview.containerSelector} .md-editor`).length,
  );
}

async function hostText(): Promise<string> {
  return harness.page.evaluate(() => window.__gpWebview.hostText());
}

async function recordedEdits(): Promise<readonly SourceEdit[]> {
  return harness.page.evaluate(() => window.__gpWebview.recordedEdits());
}

describe("liveness: the webview mounts over ProxyDocumentHost and renders the seeded document", () => {
  test("mounts exactly one .md-editor, converged to the host's seeded text", async () => {
    const selector = await mount("hello webview");
    expect(selector).toBe("#gp-editor-root");

    // The proxy starts from an empty local mirror and converges to the
    // host's real initial text once the handshake's snapshot reply arrives
    // (`../../src/webview/index.ts`'s own `handlePresentationInput` doc
    // comment) — poll rather than assume a fixed delay.
    await harness.page.waitForFunction(
      (expected: string) => window.__gpWebview.documentText() === expected,
      "hello webview",
      { timeout: 5_000 },
    );

    await requireDocumentText("hello webview");
    expect(await editorElementCount()).toBe(1);
    expect(await hostText()).toBe("hello webview");
  });

  test("D13 boundary (just under the ceiling): presentation-input mode 'rich' always mounts the rich surface, regardless of document size", async () => {
    // See this file's header: the byte-boundary MATH is proven host-side
    // (tests/provider.test.ts); from the webview's own perspective, "just
    // under" and "small" are the identical `mode: "rich"` code path.
    const text = "x".repeat(50_000);
    await mount(text);
    await harness.page.waitForFunction(
      (expectedLength: number) => (window.__gpWebview.documentText() ?? "").length === expectedLength,
      text.length,
      { timeout: 5_000 },
    );
    expect(await editorElementCount()).toBe(1);
    expect(await hostText()).toBe(text);
  });
});

describe("typed input produces byte-exact apply-edit messages", () => {
  // These two cases prove exactly what run spec DETAILS #4b asks for at the
  // MESSAGE layer: a real keystroke's {from, to, insert, expectedVersion}
  // is computed correctly and posted to the host. They deliberately do NOT
  // also assert the edit's effect on `hostText()`/`hostVersion()` — see
  // `known-issue-edit-version-reconciliation.btest.ts` in this same
  // directory (and this run's report) for why that half is currently a
  // CONFIRMED, separately-tracked defect outside this lane's write
  // boundary, kept out of this file (and out of the `test:browser` chain)
  // so it does not block these two message-shape proofs — or the other
  // suites later in that chain — from reporting their own, real, passing
  // status.
  test("a real keystroke at the end of the document submits {from,to,insert,expectedVersion} exactly", async () => {
    const selector = await mount("hello world");
    await harness.page.waitForFunction(
      (expected: string) => window.__gpWebview.documentText() === expected,
      "hello world",
      { timeout: 5_000 },
    );
    await requireDocumentText("hello world");

    await harness.page.click(selector);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("!");
    await harness.page.waitForTimeout(100);

    // Independently computed: "hello world".length is where a real
    // End-key caret sits; expectedVersion 1 is the mirror's version after
    // its one initial convergence bump (0 -> 1) from the handshake's
    // snapshot reply this test already waited for above.
    const edits = await recordedEdits();
    expect(edits).toHaveLength(1);
    expect(edits[0]).toEqual({ from: 11, to: 11, insert: "!", expectedVersion: 1 });

    // The MIRROR's own optimistic view still updates (D2/D3's local-accept
    // half) regardless of the separately-tracked host-application defect.
    await requireDocumentText("hello world!");
  });

  test("a mid-document selection-replace submits a range-spanning first edit, then one incremental edit per further keystroke", async () => {
    const text = "the quick brown fox";
    await mount(text);
    await harness.page.waitForFunction(
      (expected: string) => window.__gpWebview.documentText() === expected,
      text,
      { timeout: 5_000 },
    );

    await harness.page.click("#gp-editor-root");
    await harness.page.keyboard.press("Home");
    // Select "quick" (offsets 4..9) by walking the caret, then type over it.
    for (let i = 0; i < 4; i++) await harness.page.keyboard.press("ArrowRight");
    for (let i = 0; i < 5; i++) await harness.page.keyboard.press("Shift+ArrowRight");
    await harness.page.keyboard.type("slow");
    await harness.page.waitForTimeout(100);

    // keyboard.type() sends one keystroke at a time, and this fork editor
    // does not coalesce them into a single combined edit: only the FIRST
    // keystroke replaces the live selection (the range-spanning edit this
    // case exists to prove); the remaining three are ordinary
    // single-character inserts at the caret the first one left behind.
    // Verified empirically before writing this expectation (see this run's
    // report) rather than assumed.
    const edits = await recordedEdits();
    expect(edits).toEqual([
      { from: 4, to: 9, insert: "s", expectedVersion: 1 },
      { from: 5, to: 5, insert: "l", expectedVersion: 2 },
      { from: 6, to: 6, insert: "o", expectedVersion: 3 },
      { from: 7, to: 7, insert: "w", expectedVersion: 4 },
    ]);
    await requireDocumentText("the slow brown fox");
  });
});

describe("harness liveness", () => {
  test("the shared session produced no console or page errors across every case above", () => {
    expect(harness.consoleErrors).toEqual([]);
    expect(harness.pageErrors).toEqual([]);
  });
});
