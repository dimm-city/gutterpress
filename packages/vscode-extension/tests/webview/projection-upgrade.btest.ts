import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { openHarnessSession, waitForHarnessReady, type HarnessSession } from "@dimm-city/gutterpress-editor/test-harness";
import type { SourceEdit } from "@dimm-city/gutterpress-editor/core";
import { createEditorProjection } from "gutterpress/render";

/**
 * SFE-P3c integration lane D — real-Chromium proof of the reconciliation
 * addendum's PROJECTION UPGRADE (run spec DELIVERABLES #3, "WEBVIEW WIRING"):
 * `mountGutterpressWebview` (`../../src/webview/index.ts`) mounts plain
 * (`mountEditor`) on the session's initial `presentation-input` decision,
 * then disposes-and-remounts to `mountGutterpressEditor` the moment a LATER
 * `presentation-input` resend (the reconciliation addendum's message merge
 * — no separate "projection" message type exists anymore) carries a
 * projection with at least one marker block.
 *
 * AP-21 (liveness before behavior), TWICE over:
 *   1. The PRE-upgrade mount is asserted plain FIRST — zero chips, exactly
 *      one `.md-editor` — before the projection is ever sent. A webview
 *      that mounted `mountGutterpressEditor` from the very start (no real
 *      upgrade happening at all) would otherwise pass this file's later
 *      "a chip renders" assertion vacuously.
 *   2. The seeded projection is itself asserted to contain at least one
 *      projected block before being sent — an empty/no-op projection would
 *      make "the chip renders" assertion meaningless.
 *
 * The projection is built with the REAL, production `createEditorProjection`
 * (`gutterpress/render`) against real Gutterpress marker syntax — never a
 * hand-typed `GutterpressProjection` object, which would risk silently
 * drifting from the real schema `PresentationInputMessage.projection`
 * (`../../src/protocol/messages.ts`) actually carries.
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

async function requireDocumentText(expected: string): Promise<void> {
  const text = await harness.page.evaluate(() => window.__gpWebview.documentText());
  expect(text).toBe(expected);
}

async function editorElementCount(): Promise<number> {
  return harness.page.evaluate(
    () => document.querySelectorAll(`${window.__gpWebview.containerSelector} .md-editor`).length,
  );
}

async function chipCount(): Promise<number> {
  return harness.page.evaluate(() => window.__gpWebview.chipCount());
}

async function recordedEdits(): Promise<readonly SourceEdit[]> {
  return harness.page.evaluate(() => window.__gpWebview.recordedEdits());
}

async function hostText(): Promise<string> {
  return harness.page.evaluate(() => window.__gpWebview.hostText());
}

describe("reconciliation addendum: presentation-input upgrade to mountGutterpressEditor", () => {
  test("mounts plain first (zero chips), upgrades to render a chip once a projection-bearing resend arrives, and an edit after the upgrade still lands byte-exactly at the fake host", async () => {
    const text = "@page splash\n\nHello world.\n";

    await harness.page.evaluate((initialText: string) => window.__gpWebview.mount(initialText), text);
    await harness.page.waitForFunction(
      (expected: string) => window.__gpWebview.documentText() === expected,
      text,
      { timeout: 5_000 },
    );

    // AP-21 liveness #1: the PRE-upgrade mount is genuinely plain.
    expect(await editorElementCount()).toBe(1);
    expect(await chipCount()).toBe(0);
    await requireDocumentText(text);

    const projection = createEditorProjection(text, { sourceVersion: 1 });
    // AP-21 liveness #2: the fixture itself actually carries a marker
    // block, so a chip rendering below is real evidence of the upgrade,
    // not a coincidence.
    expect(projection.blocks.length).toBeGreaterThan(0);

    await harness.page.evaluate(
      (p) => window.__gpWebview.sendProjectionUpdate({ projection: p }),
      projection,
    );

    // The upgrade is a dispose-then-remount — poll rather than assume a
    // fixed delay.
    await harness.page.waitForFunction(() => window.__gpWebview.chipCount() > 0, undefined, { timeout: 5_000 });

    // Exactly one editor mounted throughout — the upgrade REPLACED the
    // plain mount, it did not add a second one alongside it.
    expect(await editorElementCount()).toBe(1);
    expect(await chipCount()).toBeGreaterThan(0);
    // The underlying SOURCE survived the remount unchanged — a chip's
    // rendered view is a visual representation of the marker (kind,
    // attributes), not a reproduction of the raw markdown text, so this
    // checks the fake host's own authoritative source rather than
    // `.md-document`'s now-chip-bearing textContent.
    expect(await hostText()).toBe(text);

    // An edit AFTER the upgrade still lands byte-exactly at the fake host —
    // proves the reconciliation fix and the projection upgrade compose:
    // the upgraded mount is over the SAME ProxyDocumentHost/fake host, not
    // a fresh, disconnected one.
    const lastBlockIndex = (await harness.page.evaluate(() => window.__gpWebview.blockCount())) - 1;
    expect(lastBlockIndex).toBeGreaterThanOrEqual(0); // AP-21: a block to click actually exists
    const center = await harness.page.evaluate(
      (index: number) => window.__gpWebview.blockCenter(index),
      lastBlockIndex,
    );
    await harness.page.mouse.click(center.x, center.y);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("!");
    await harness.page.waitForTimeout(100);

    // The wire message itself, independent of what the chip-bearing DOM
    // now renders (which, per the note above, is not a reproduction of raw
    // source once a chip is showing) — run spec DETAILS #4b's own "byte-
    // exact" proof technique, applied here to the POST-upgrade mount.
    const edits = await recordedEdits();
    expect(edits).toHaveLength(1);
    expect(edits[0]?.insert).toBe("!");

    const expectedAfterEdit = `${text.slice(0, edits[0]?.from ?? 0)}!${text.slice(edits[0]?.to ?? 0)}`;
    await harness.page.waitForFunction(
      (expected: string) => window.__gpWebview.hostText() === expected,
      expectedAfterEdit,
      { timeout: 5_000 },
    );
    expect(await hostText()).toBe(expectedAfterEdit);
  });
});

describe("harness liveness", () => {
  test("the shared session produced no console or page errors", () => {
    expect(harness.consoleErrors).toEqual([]);
    expect(harness.pageErrors).toEqual([]);
  });
});
