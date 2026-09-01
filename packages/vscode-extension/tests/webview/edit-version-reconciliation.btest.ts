import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { openHarnessSession, waitForHarnessReady, type HarnessSession } from "@dimm-city/gutterpress-editor/test-harness";

/**
 * SFE-P3c integration lane D — real-Chromium proof of the RECONCILIATION
 * ADDENDUM's fix (run spec "Amendment — reconciliation addendum and
 * integration lane D", DELIVERABLES #1): every keystroke a real webview
 * session accepts must actually reach the extension host's authoritative
 * document, or the webview must be told it was rejected — never silently
 * diverge. This file previously lived as `known-issue-edit-version-reconciliation.btest.ts`,
 * the committed RED reproduction of the confirmed defect the addendum
 * fixes (`ProxyDocumentHost` sent its LOCAL mirror version as
 * `ApplyEditMessage.expectedVersion`, and `DocumentGateway` compared it
 * against ITS OWN, unrelated version space — a comparison that only ever
 * coincided by accident, and in practice never did after the first real
 * edit). It is renamed now that the fix — a host-assigned base stamp
 * (`SnapshotMessage.baseStamp`/`ApplyEditMessage.base`, `../../src/protocol/messages.ts`)
 * plus a bounded one-in-flight send queue (`ProxyDocumentHost`,
 * `../../src/webview-host/proxy-document-host.ts`) — makes every case
 * below pass, and stays wired into `package.json`'s `test:browser` chain as
 * a permanent regression guard.
 *
 * THREE cases, each proving a distinct part of the addendum's design:
 *
 *   (a) a single keystroke — the original committed reproduction, now
 *       green. Proves the basic base-stamp fix: an ordinary, accepted-
 *       looking edit reaches the host's real document.
 *   (b) burst typing — three rapid keystrokes with genuine in-flight
 *       latency — proves the bounded send queue: later keystrokes queue
 *       (rather than racing multiple concurrent apply-edit messages) and
 *       each is sent only once the previous authoritative reply confirms,
 *       landing all three byte-exactly at the fake host.
 *   (c) an external change racing a queued edit — proves the addendum's
 *       own "no rebasing" fail-closed rule: a reply that diverges from
 *       what the mirror expected discards the whole send queue along with
 *       the replacement, converging byte-identically to the host's real
 *       text rather than guessing which queued edits might still be valid.
 *
 * AP-21: every case polls for the mirror's own optimistic view before
 * asserting on the host's authoritative side, and (for (b)/(c)) polls for
 * convergence rather than assuming a fixed delay — the fake host's reply
 * timing is real, latency-bearing async work, not instant.
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

async function documentText(): Promise<string | null> {
  return harness.page.evaluate(() => window.__gpWebview.documentText());
}

async function hostText(): Promise<string> {
  return harness.page.evaluate(() => window.__gpWebview.hostText());
}

describe("(a) a single accepted keystroke reaches the host's authoritative document", () => {
  test("hostText moves to reflect the edit after one real keystroke", async () => {
    const selector = await harness.page.evaluate((text: string) => window.__gpWebview.mount(text), "reg text");
    await harness.page.waitForFunction(
      (expected: string) => window.__gpWebview.documentText() === expected,
      "reg text",
      { timeout: 5_000 },
    );
    // AP-21 liveness before the behavioral assertion below.
    expect(
      await harness.page.evaluate(
        () => document.querySelectorAll(`${window.__gpWebview.containerSelector} .md-editor`).length,
      ),
    ).toBe(1);

    await harness.page.click(selector);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("!");
    await harness.page.waitForTimeout(150);

    // The mirror's OWN optimistic view already shows the edit as applied —
    // this half was never the defect.
    expect(await documentText()).toBe("reg text!");

    // THE FIX (D2/D3): the edit reaches the host's real authoritative text,
    // not only the optimistic mirror.
    await harness.page.waitForFunction(() => window.__gpWebview.hostText() === "reg text!", undefined, {
      timeout: 5_000,
    });
    expect(await hostText()).toBe("reg text!");
    expect(await harness.page.evaluate(() => window.__gpWebview.hostVersion())).toBe(1);
  });
});

describe("(b) burst typing: three rapid keystrokes with in-flight latency land all three byte-exactly at the fake host", () => {
  test("the bounded send queue delivers every keystroke, in order, none dropped or duplicated", async () => {
    // A comfortably large FIXED round-trip so three rapid keystrokes are
    // GUARANTEED to overlap the first one's still-outstanding reply — see
    // ProxyDocumentHost's own header, "AT MOST ONE apply-edit in flight."
    // Without genuine overlap, this case would only ever exercise the
    // immediate-send path (a) already covers, never the queue itself.
    const selector = await harness.page.evaluate(
      (text: string) => window.__gpWebview.mount(text, { latencyMs: 80 }),
      "burst",
    );
    await harness.page.waitForFunction(
      (expected: string) => window.__gpWebview.documentText() === expected,
      "burst",
      { timeout: 5_000 },
    );
    // AP-21 liveness.
    expect(
      await harness.page.evaluate(
        () => document.querySelectorAll(`${window.__gpWebview.containerSelector} .md-editor`).length,
      ),
    ).toBe(1);

    await harness.page.click(selector);
    await harness.page.keyboard.press("End");
    // keyboard.type() submits one keystroke at a time, well inside the
    // 80ms round trip above — genuinely overlapping, in-flight submissions.
    await harness.page.keyboard.type("123");

    // The mirror's own optimistic view shows all three immediately.
    await harness.page.waitForFunction(
      (expected: string) => window.__gpWebview.documentText() === expected,
      "burst123",
      { timeout: 5_000 },
    );

    // Convergence: the queue drains one entry per authoritative reply —
    // poll until the host's own text has caught all the way up.
    await harness.page.waitForFunction(() => window.__gpWebview.hostText() === "burst123", undefined, {
      timeout: 5_000,
    });
    expect(await hostText()).toBe("burst123");
    expect(await documentText()).toBe("burst123");

    // Byte-exact, in order — the decisive proof run spec DETAILS #4b asks
    // for, applied to all three queued edits, not only the first.
    const edits = await harness.page.evaluate(() => window.__gpWebview.recordedEdits());
    expect(edits).toEqual([
      { from: 5, to: 5, insert: "1", expectedVersion: 1 },
      { from: 6, to: 6, insert: "2", expectedVersion: 2 },
      { from: 7, to: 7, insert: "3", expectedVersion: 3 },
    ]);
  });
});

describe("(c) an external change racing a queued edit discards the queue and converges byte-identically", () => {
  test("the queued (not-yet-sent) keystroke is dropped, not guessed at; the mirror ends up byte-identical to the host's real, externally-changed text", async () => {
    const selector = await harness.page.evaluate(
      (text: string) => window.__gpWebview.mount(text, { latencyMs: 80 }),
      "race seed",
    );
    await harness.page.waitForFunction(
      (expected: string) => window.__gpWebview.documentText() === expected,
      "race seed",
      { timeout: 5_000 },
    );
    // AP-21 liveness.
    expect(
      await harness.page.evaluate(
        () => document.querySelectorAll(`${window.__gpWebview.containerSelector} .md-editor`).length,
      ),
    ).toBe(1);

    await harness.page.click(selector);
    await harness.page.keyboard.press("End");
    // Two rapid keystrokes: the FIRST goes in flight immediately; the
    // SECOND queues (still well inside the 80ms round trip above).
    await harness.page.keyboard.type("XY");
    await harness.page.waitForFunction(
      (expected: string) => window.__gpWebview.documentText() === expected,
      "race seedXY",
      { timeout: 5_000 },
    );

    // An UNRELATED external change races in while the first edit is still
    // in flight and the second is still queued (unsent) — e.g. another
    // extension's edit, or undo/redo from outside this session.
    await harness.page.evaluate(() => window.__gpWebview.externalChange("EXTERNALLY CHANGED"));

    // Convergence: the mirror ends up byte-identical to the host's real,
    // externally-changed text — never a guessed merge of "race seedXY" and
    // the external change.
    await harness.page.waitForFunction(
      (expected: string) => window.__gpWebview.documentText() === expected,
      "EXTERNALLY CHANGED",
      { timeout: 5_000 },
    );
    expect(await hostText()).toBe("EXTERNALLY CHANGED");
    expect(await documentText()).toBe("EXTERNALLY CHANGED");

    // The addendum's own "no rebasing" rule, made concrete: the SECOND
    // keystroke ("Y") was still queued — never sent — at the moment the
    // external change arrived, so only ONE apply-edit message (the first,
    // "X") ever reached the fake host at all.
    const edits = await harness.page.evaluate(() => window.__gpWebview.recordedEdits());
    expect(edits).toHaveLength(1);
    expect(edits[0]?.insert).toBe("X");
  });
});

describe("harness liveness", () => {
  test("the shared session produced no console or page errors across every case above", () => {
    expect(harness.consoleErrors).toEqual([]);
    expect(harness.pageErrors).toEqual([]);
  });
});
