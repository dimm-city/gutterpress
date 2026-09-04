import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { openHarnessSession, waitForHarnessReady, type HarnessSession } from "@dimm-city/gutterpress-editor/test-harness";
import type { Diagnostic } from "@dimm-city/gutterpress-editor/core";
import { createEditorProjection } from "gutterpress/render";
import { pluginsUntrustedDiagnostic } from "../../src/protocol/diagnostics.ts";

/**
 * SFE-P3c Lane C — real-Chromium proof of D9's required trust explanation
 * (repair round 1, finding "D9's required trust explanation is not
 * implemented"): the behavior table's Trust-gate row requires that an
 * untrusted workspace with a real project "renders plugin regions as source
 * or safe placeholders WITH A TRUST EXPLANATION" — not silently. Before this
 * fix, `EDITOR_PLUGIN_UNTRUSTED` had zero producers and `onTrustChange` had
 * zero consumers (confirmed by the review); `../../src/protocol/diagnostics.ts`'s
 * `pluginsUntrustedDiagnostic` and `../../src/project/projection.ts`'s
 * `resolveEditorProjectionPayload` are the HOST-side half (proven by
 * `../../tests/project/projection.test.ts` and
 * `../../tests/project/provider-projection.test.ts`, both Node-side/no
 * browser needed); THIS file proves the other half — that the message
 * actually reaching a real webview produces VISIBLE, on-screen text, and
 * that granting trust actually removes it, in a real browser, not merely
 * that a `Diagnostic` object with the right shape was constructed somewhere.
 *
 * `../../src/webview/index.ts`'s `updateNotices`/`renderNoticeBanner` are
 * exercised through the SAME `presentation-input`-resend path
 * `projection-upgrade.btest.ts` already proves the projection-upgrade half
 * of (`sendProjectionUpdate` on the fake host) — this file adds the
 * `diagnostic` field that file never populates, and a NEW
 * `sendTrustState` passthrough (`support/fake-extension-host.ts`) for the
 * later, standalone `trust-state` message a real trust grant sends before
 * its own `presentation-input` resend follows (`../../src/provider.ts`'s
 * `onDidGrantWorkspaceTrust` handler — see that method's own two-statement
 * body).
 *
 * TWO INDEPENDENT clearing mechanisms named in
 * `../../src/webview/index.ts`'s own comments are each proven on their own,
 * not only in combination — a bug that broke either one alone (e.g. the
 * `onTrustChange` optimistic clear firing but `updateNotices` never
 * actually clearing on a diagnostic-free resend, or vice versa) would
 * survive a test that only ever exercised them together:
 *
 *   1. `onTrustChange` — an OPTIMISTIC clear the instant a `trust-state`
 *      message alone arrives, before any `presentation-input` resend.
 *   2. `updateNotices` — the AUTHORITATIVE clear driven purely by a later
 *      `presentation-input` resend that stops carrying the diagnostic, with
 *      NO `trust-state` message ever sent in that test, so it cannot be
 *      passing merely because mechanism 1 already did the work.
 *
 * Each test below mounts its OWN fresh session (mirrors every other file in
 * this directory — see `mount.btest.ts`'s own describe blocks) rather than
 * building on a previous test's leftover DOM state, so reordering or
 * running a single test in isolation (`bun test -t "..."`) never changes
 * the outcome.
 *
 * SABOTAGE (G-12/AP-20): every assertion below was verified locally to fail
 * against a deliberately broken build — see
 * `docs/plans/source-first-editor/runs/SFE-P3c.md`'s "Deviations and
 * evidence" section for the exact commands and results.
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

async function noticeCategories(): Promise<readonly string[]> {
  return harness.page.evaluate(() => window.__gpWebview.noticeCategories());
}

async function noticeBannerHidden(): Promise<boolean | null> {
  return harness.page.evaluate(() => window.__gpWebview.noticeBannerHidden());
}

async function chipCount(): Promise<number> {
  return harness.page.evaluate(() => window.__gpWebview.chipCount());
}

async function documentText(): Promise<string | null> {
  return harness.page.evaluate(() => window.__gpWebview.documentText());
}

async function recordedEditCount(): Promise<number> {
  return harness.page.evaluate(() => window.__gpWebview.applyEditCount());
}

/**
 * Mounts a fresh untrusted session over `text`, then sends the
 * diagnostic-carrying `presentation-input` resend a real, untrusted
 * `resolveEditorProjectionPayload({..}, project, false, ...)` call would
 * produce (`../../src/project/projection.ts`'s own `!trusted && project`
 * branch), and waits for the notice banner to actually become visible
 * (AP-21) before returning. Used by every test below that needs to start
 * from "the banner is genuinely showing," so each test's own body can focus
 * on the ONE clearing mechanism it exists to prove.
 */
async function mountWithUntrustedNotice(text: string): Promise<Diagnostic> {
  await harness.page.evaluate(
    (initialText: string) => window.__gpWebview.mount(initialText, { trusted: false }),
    text,
  );
  await harness.page.waitForFunction(
    (expected: string) => window.__gpWebview.documentText() === expected,
    text,
    { timeout: 5_000 },
  );

  const stamp = await harness.page.evaluate(() => window.__gpWebview.hostStamp());
  const projection = createEditorProjection(text, { sourceVersion: stamp });
  expect(projection.blocks.length).toBeGreaterThan(0); // AP-21: a real block exists

  const diagnostic = pluginsUntrustedDiagnostic();
  await harness.page.evaluate(
    (args) => window.__gpWebview.sendProjectionUpdate({ projection: args.projection, diagnostic: args.diagnostic }),
    { projection, diagnostic },
  );

  await harness.page.waitForFunction(() => window.__gpWebview.noticeBannerHidden() === false, undefined, {
    timeout: 5_000,
  });
  return diagnostic;
}

describe("D9 trust explanation: an untrusted project's withheld plugins show a visible notice", () => {
  test("a presentation-input resend carrying EDITOR_PLUGIN_UNTRUSTED renders the diagnostic's message and safe action in the notice banner", async () => {
    const diagnostic = await mountWithUntrustedNotice("@page splash\n\nHello world.\n");

    // Two independent signals that the banner is genuinely showing: the
    // element's own `hidden` IDL property, and its rendered content.
    expect(await noticeBannerHidden()).toBe(false);
    expect(await noticeCategories()).toEqual(["EDITOR_PLUGIN_UNTRUSTED"]);
    const shownText = await harness.page.evaluate(() => window.__gpWebview.noticeText());
    expect(shownText).toBe(`${diagnostic.message} ${diagnostic.safeAction}`);

    // The projection-upgrade half still composes with the notice: the
    // resend that carries the diagnostic ALSO carries the (base-pipeline)
    // projection `resolveEditorProjectionPayload` returns for this branch
    // (`../../src/project/projection.ts`'s own doc comment) — the editor is
    // genuinely usable, not blanked, while the notice explains what is
    // missing from it.
    expect(await chipCount()).toBeGreaterThan(0);
  });

  test("mechanism 1 — a standalone trust-state message alone (no presentation-input resend) optimistically clears the banner", async () => {
    await mountWithUntrustedNotice("@page splash\n\nHello world.\n");
    expect(await noticeCategories()).toEqual(["EDITOR_PLUGIN_UNTRUSTED"]); // AP-21: genuinely showing first

    // No `sendProjectionUpdate` call anywhere below this line in this test
    // — if the clear only ever worked via a resend, this would time out.
    await harness.page.evaluate(() => window.__gpWebview.sendTrustState(true));

    await harness.page.waitForFunction(() => window.__gpWebview.noticeBannerHidden() === true, undefined, {
      timeout: 5_000,
    });
    expect(await noticeBannerHidden()).toBe(true);
    expect(await noticeCategories()).toEqual([]);
  });

  test("mechanism 2 — a later presentation-input resend with no diagnostic authoritatively clears the banner, independent of any trust-state message", async () => {
    const text = "@page splash\n\nHello world.\n";
    await mountWithUntrustedNotice(text);
    expect(await noticeCategories()).toEqual(["EDITOR_PLUGIN_UNTRUSTED"]); // AP-21: genuinely showing first

    // The trusted resend a real `sendProjection()` re-run would produce once
    // `resolveEditorProjectionPayload`'s `trusted && project` branch is
    // taken: same shape, no `diagnostic` field this time. No
    // `sendTrustState` call anywhere in this test — if this clear only ever
    // worked via mechanism 1, this assertion would time out.
    const freshStamp = await harness.page.evaluate(() => window.__gpWebview.hostStamp());
    const trustedProjection = createEditorProjection(text, { sourceVersion: freshStamp });
    await harness.page.evaluate(
      (p) => window.__gpWebview.sendProjectionUpdate({ projection: p }),
      trustedProjection,
    );

    await harness.page.waitForFunction(() => window.__gpWebview.noticeBannerHidden() === true, undefined, {
      timeout: 5_000,
    });
    expect(await noticeBannerHidden()).toBe(true);
    expect(await noticeCategories()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SFE-P3d-sweep Lane A gap closure -- scenario 18 ("untrusted VS Code
// workspace fallback"). Every case above proves the trust GATE: the notice
// banner appears with the right message/category and clears through both
// its independent mechanisms. None of them ever click into the mounted
// editor and type -- so D9's actual requirement ("standard Markdown rich
// editing remains available" in an untrusted workspace) was proven only for
// the NOTICE half, never the EDITING half. This closes that gap: a real
// keystroke, typed while the untrusted notice is genuinely showing on
// screen, must still reach the host.
// ---------------------------------------------------------------------------

describe("D9 untrusted workspace: standard rich editing keeps working while the trust notice is showing (SFE-P3d-sweep gap closure, scenario 18)", () => {
  test("a real keystroke typed into the mounted, untrusted-projection editor reaches the host, byte-exact, with the notice banner still visible throughout", async () => {
    const text = "@page splash\n\nHello world.\n";
    await mountWithUntrustedNotice(text);

    // AP-21 liveness: the untrusted notice is genuinely showing (not merely
    // "trusted: false" was passed at construction) before this test relies
    // on that being the state editing happens under.
    expect(await noticeBannerHidden()).toBe(false);
    expect(await noticeCategories()).toEqual(["EDITOR_PLUGIN_UNTRUSTED"]);
    expect(await chipCount()).toBeGreaterThan(0);

    const editsBefore = await recordedEditCount();
    const helloOffset = text.indexOf("Hello world.");
    const withinBlock = "Hello world.".length; // caret lands at the end of the paragraph

    // The paragraph block is the SECOND rendered block (the "@page splash"
    // marker/chip is the first) -- same nth-child convention every other
    // btest.ts file in this workspace uses. `#gp-editor-root` is this
    // package's fixed container id (`support/entry.ts`'s own
    // `CONTAINER_ID`/`containerSelector`), not returned by
    // `mountWithUntrustedNotice` (it resolves to the sent `Diagnostic`) --
    // hardcoded the same way `edit-version-reconciliation.btest.ts` and
    // `disposal.btest.ts` both assert it verbatim.
    await harness.page.click("#gp-editor-root .md-document > .md-block:nth-child(2)");
    await harness.page.keyboard.press("Home");
    for (let i = 0; i < withinBlock; i++) await harness.page.keyboard.press("ArrowRight");
    await harness.page.keyboard.type("!");
    await harness.page.waitForTimeout(120);

    // Byte-exact proof via the fake host's own RECORDED wire message (mirrors
    // `edit-version-reconciliation.btest.ts`'s own technique) -- more precise
    // than comparing rendered `.md-document` text, which (for a
    // Gutterpress-projected mount) also carries the chip's own kind-label
    // and attribute badge text, not a byte-mirror of the raw source.
    const expectedOffset = helloOffset + withinBlock;
    const edits = await harness.page.evaluate(() => window.__gpWebview.recordedEdits());
    expect(edits.length).toBe(editsBefore + 1);
    expect(edits[edits.length - 1]).toEqual({
      from: expectedOffset,
      to: expectedOffset,
      insert: "!",
      expectedVersion: expect.any(Number),
    });
    expect(await recordedEditCount()).toBe(editsBefore + 1);
    // Sanity check on the rendered side too: the typed text is visibly
    // present (not asserting exact equality -- the chip's own label/badge
    // text is also part of `.md-document`'s textContent).
    expect(await documentText()).toContain("Hello world.!");

    // The notice is still showing throughout -- editing did not silently
    // grant trust, and the trust gate did not silently block editing either.
    expect(await noticeBannerHidden()).toBe(false);
    expect(await noticeCategories()).toEqual(["EDITOR_PLUGIN_UNTRUSTED"]);
  });
});

describe("harness liveness", () => {
  test("the shared session produced no console or page errors across every case above", () => {
    expect(harness.consoleErrors).toEqual([]);
    expect(harness.pageErrors).toEqual([]);
  });
});
