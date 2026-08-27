import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  openHarnessSession,
  waitForHarnessReady,
  type HarnessSession,
} from "../browser-harness/index.ts";
import type { CustomBlockHookCall, CustomViewMountOptions } from "../vscode-adapter/custom-view/support/entry.ts";
// Via the "gutterpress/render" package subpath -- matching how
// `../../src/gutterpress/{mount,provider,match,plan}.ts` (Lane B's real
// production consumer, read above) import `GutterpressProjection` -- NOT a
// relative path into `packages/cli/src/**`. A relative source import pulls
// `renderer.ts`'s markdown-it-plugin imports into THIS package's isolated
// DOM-aware typecheck program (`src/gutterpress/tsconfig.json`), which has
// no visibility into `packages/cli/src/markdown-shims.d.ts`'s ambient
// module declarations for those untyped packages (that .d.ts is only
// in-scope for packages/cli's OWN "include": ["src"] program) and fails
// with implicit-`any` errors that have nothing to do with this file's own
// logic. The built package export (`gutterpress/dist/render.d.ts`) is
// self-contained and carries none of that.
import { createEditorProjection } from "gutterpress/render";

/**
 * SFE-P2b Lane C — real-Chromium proof of D13's fail-closed CONSUMER
 * contract: "a limit-flagged projection mounted... renders NO chips
 * (fail-closed to plain editing) and the document stays editable" (run spec
 * table row "Ambiguity"/D13; `docs/plans/source-first-editor/runs/
 * SFE-P2b.md`'s BROWSER instruction).
 *
 * WHY THIS DRIVES THE FORK'S `renderCustomBlock` SEAM DIRECTLY, NOT
 * `mountGutterpressEditor`/`createGutterpressBlockProvider`
 * (`../../src/gutterpress/{mount,provider}.ts`, Lane B's real production
 * deliverable for this SAME run): those modules exist in the tree (read
 * before writing this file) and are exactly the intended integration point
 * — but wiring them into a REAL browser page needs a bundled entry file
 * that imports them, and this lane's write ownership for SFE-P2b is
 * EXACTLY three files (`docs/plans/source-first-editor/runs/SFE-P2b.md`'s
 * lane table): this file, plus two files in `packages/cli`. Adding a new
 * `tests/gutterpress/support/entry.ts` is out of bounds. So this file
 * reuses the ALREADY-COMMITTED, already-proven P1b2 harness
 * (`../vscode-adapter/custom-view/support/entry.ts`'s `window.__gpc`,
 * proven live by `fork-hook.btest.ts`) — the exact fork seam
 * `createGutterpressBlockProvider.renderCustomBlock` itself wraps
 * (`provider.ts`'s own doc comment names `BlockViewOptions.renderCustomBlock`
 * as the seam) — and drives it with the D13-mandated decision rule a
 * limit-aware consumer must apply: a `limited: true` projection declines
 * EVERY block (`chipFor: []`, this harness's proven "hook consulted on
 * every call, always declines" fallback path), falling through to the
 * fork's own default (non-chip) rendering for the whole document.
 *
 * INTEGRATOR ITEM found while wiring this test (not fixed here — out of
 * this lane's write ownership, `packages/editor/src/gutterpress/**` is
 * Lane B's): `match.ts`'s `projectionNeedsRefresh` (consulted by
 * `provider.ts`'s `isStale` gate, in turn wired unconditionally into
 * `mount.ts`'s `mountGutterpressEditor`) currently compares ONLY
 * `projection.sourceVersion !== currentVersion` — it does not check
 * `projection.limited`. As shipped today, mounting a `limited: true`
 * projection through the REAL `mountGutterpressEditor` would still attempt
 * to match/render chips for every block that DID make it under the cap
 * (only the version check gates rendering, and a freshly-built limited
 * projection's `sourceVersion` matches the live document). The run spec
 * anticipated exactly this ("if their staleness path keys on sourceVersion
 * only, note the integration item rather than editing their code") — this
 * comment is that note. The fix is small: `mountGutterpressEditor`'s
 * internal `isStale` (`mount.ts`) or `projectionNeedsRefresh` itself should
 * also return `true` whenever `options.projection.limited` is `true`.
 *
 * AP-21: every case asserts real liveness (`requireBlockCount`, a nonzero
 * `customBlockHookCalls().length`) before any behavioral assertion — a
 * limited projection producing "no chips" must be shown to come from a hook
 * that WAS consulted and declined, not from a mount that silently rendered
 * nothing at all.
 */

const entryPath = resolve(import.meta.dir, "../vscode-adapter/custom-view/support/entry.ts");

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

async function mount(text: string, options?: CustomViewMountOptions): Promise<string> {
  await harness.page.evaluate(
    ({ text, options }) => window.__gpc.mount(text, options),
    { text, options },
  );
  // Matches fork-hook.btest.ts's own settle wait (this file's header cites
  // it as the proven pattern) -- layout/measurement can be one frame behind
  // mount()'s return.
  await harness.page.waitForTimeout(50);
  return harness.page.evaluate(() => window.__gpc.containerSelector);
}

async function blockCount(): Promise<number> {
  return harness.page.evaluate(() => window.__gpc.documentBlockCount());
}

async function block(index: number) {
  return harness.page.evaluate((i) => window.__gpc.blockInfo(i), index);
}

async function customBlockHookCalls(): Promise<readonly CustomBlockHookCall[]> {
  return harness.page.evaluate(() => window.__gpc.customBlockHookCalls());
}

async function chipElementCount(selector: string): Promise<number> {
  return harness.page.evaluate(
    (sel: string) => document.querySelectorAll(`${sel} .gpc-custom-chip`).length,
    selector,
  );
}

async function hostText(): Promise<string> {
  return harness.page.evaluate(() => window.__gpc.getHostText());
}

async function hostVersion(): Promise<number> {
  return harness.page.evaluate(() => window.__gpc.getHostVersion());
}

/** AP-21 liveness: requires the mounted container really has `expected` `.md-block` elements before any test proceeds to behavioral assertions. */
async function requireBlockCount(expected: number): Promise<void> {
  expect(await blockCount()).toBe(expected);
}

// Reused verbatim from fork-hook.btest.ts's own proven fixture (that file's
// own `PARAGRAPH_CHIP_PROBE_TEXT`) -- known, independently-verified block
// boundaries: block 0 = "Lead text.\n\n", block 1 = "@page splash\n\n"
// (a real Gutterpress marker line -- exactly the shape
// `createGutterpressBlockProvider` would match against a projected "page"
// block), block 2 = "Trail text.".
const PROBE_TEXT = ["Lead text.", "", "@page splash", "", "Trail text."].join("\n");

describe("sanity: the projections this suite's decision rule is driven by are real (not asserted, computed)", () => {
  test("10,001 @page-break markers really do produce a limited: true projection (D13's own boundary-exact test lives in packages/cli; this just confirms the premise this file's decision rule depends on)", () => {
    const bigSource = "@page-break\n".repeat(10_001);
    const bigProjection = createEditorProjection(bigSource, { sourceVersion: 1 });
    expect(bigProjection.limited).toBe(true);
    expect(bigProjection.diagnostics.some((d) => d.category === "EDITOR_PROJECTION_LIMIT")).toBe(true);
  });

  test("PROBE_TEXT's own @page marker, well under every D13 cap, produces a NOT-limited projection with a real projectable \"page\" block", () => {
    const smallProjection = createEditorProjection(PROBE_TEXT, { sourceVersion: 1 });
    expect(smallProjection.limited).toBeUndefined();
    expect(smallProjection.blocks.some((b) => b.kind === "page")).toBe(true);
  });
});

describe("a limited: true projection: fail-closed to plain editing", () => {
  test("mounting with the limited-projection decision rule (chipFor: []) renders NO chips anywhere in the document, even though the hook was genuinely consulted", async () => {
    const selector = await mount(PROBE_TEXT, {
      // D13/G-11's decision rule this test proves: `bigProjection.limited`
      // (computed above, real) is `true`, so the CONSUMER must decline
      // every block -- `chipFor: []` is this harness's exact "hook
      // consulted on every call, always declines" fallback (see
      // `support/entry.ts`'s own `chipFor` doc comment).
      customBlock: { label: "GP-LIMITED", mode: "label", chipFor: [] },
    });
    await requireBlockCount(3);

    // Liveness FIRST (AP-21): the hook really was called for real blocks in
    // this document -- "no chips" below is a genuine decline, not a mount
    // that never consulted the hook at all.
    const calls = await customBlockHookCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.sourceText.includes("@page splash"))).toBe(true);

    // The actual fail-closed assertion: zero chip elements anywhere in the
    // mounted document.
    expect(await chipElementCount(selector)).toBe(0);
    for (let i = 0; i < 3; i++) {
      const info = await block(i);
      expect(info.className).not.toContain("gpc-custom-chip");
    }

    // Every block fell through to the fork's own DEFAULT rendering -- the
    // marker line's real text is plainly visible, not a chip label.
    const markerBlock = await block(1);
    expect(markerBlock.textContent).toContain("@page splash");
    expect(markerBlock.textContent).not.toBe("GP-LIMITED:paragraph");
  });

  test("the document stays fully editable: a real keystroke on the (chip-free) marker block reaches the host", async () => {
    const selector = await mount(PROBE_TEXT, {
      customBlock: { label: "GP-LIMITED", mode: "label", chipFor: [] },
    });
    await requireBlockCount(3);
    expect(await chipElementCount(selector)).toBe(0); // re-confirm fail-closed before editing it

    const originalHostText = await hostText();
    expect(originalHostText).toBe(PROBE_TEXT);
    const markerStart = PROBE_TEXT.indexOf("@page splash");
    expect(markerStart).toBe(12);

    // No "activate a chip" step needed -- there is no chip to begin with;
    // this is ordinary plain-text editing from the start, which IS the
    // fail-closed guarantee this test proves.
    await harness.page.click(`${selector} .md-document > .md-block:nth-child(1)`);
    await harness.page.keyboard.press("Home");
    await harness.page.keyboard.press("ArrowDown");
    await harness.page.keyboard.type("X");
    await harness.page.waitForTimeout(50);

    const editedHostText = await hostText();
    const expectedEditedText =
      originalHostText.slice(0, markerStart) + "X" + originalHostText.slice(markerStart);
    expect(editedHostText).toBe(expectedEditedText);
    expect(editedHostText).toContain("X@page splash");
    expect(await hostVersion()).toBe(1);
    // Still no chips after the edit -- the document did not re-acquire
    // chip rendering mid-session.
    expect(await chipElementCount(selector)).toBe(0);
  });
});

describe("contrast: the SAME hook mechanism DOES render a chip when the projection is NOT limited", () => {
  test("mounting PROBE_TEXT with chipFor matching the real marker block renders exactly one chip -- proving the \"no chips\" result above is caused by the limited-projection decision, not a broken or vacuous hook", async () => {
    const selector = await mount(PROBE_TEXT, {
      // Mirrors the decision rule for `smallProjection` above
      // (`limited` is `undefined`): a real consumer may render this
      // block's chip normally.
      customBlock: { label: "GP-NORMAL", mode: "label", chipFor: ["@page splash"] },
    });
    await requireBlockCount(3);

    expect(await chipElementCount(selector)).toBe(1);
    const markerBlock = await block(1);
    expect(markerBlock.className).toContain("gpc-custom-chip");
    expect(markerBlock.textContent).toBe("GP-NORMAL:paragraph");

    const lead = await block(0);
    const trail = await block(2);
    expect(lead.className).not.toContain("gpc-custom-chip");
    expect(trail.className).not.toContain("gpc-custom-chip");
  });
});

describe("harness liveness", () => {
  test("the shared session produced no console or page errors across every case above", () => {
    expect(harness.consoleErrors).toEqual([]);
    expect(harness.pageErrors).toEqual([]);
  });
});
