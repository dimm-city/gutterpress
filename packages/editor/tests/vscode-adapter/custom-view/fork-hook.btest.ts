import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  openHarnessSession,
  waitForHarnessReady,
  type HarnessSession,
} from "../../browser-harness/index.ts";
import type { CustomBlockHookCall, CustomViewMountOptions } from "./support/entry.ts";

/**
 * SFE-P1b2 Lane B — real-Chromium contract tests for the gp-fork
 * `renderCustomBlock` seam (`packages/vscode-markdown-editor/PATCHES.md`
 * hunks 1–6), against the vendored fork this run's Lane A patched. Where
 * `probe.btest.ts` (SFE-P1b Lane C) proved D5 cases 4 and 5 FAIL against
 * the unpatched, published `@vscode/markdown-editor@0.0.2-85` runtime for
 * a paragraph-shaped Gutterpress marker line and an unhandled-block probe,
 * THIS file proves them PASS against the fork's new seam — the "turn cases
 * 4 and 5 green" deliverable named in the run specification
 * (`docs/plans/source-first-editor/runs/SFE-P1b2.md`).
 *
 * Shares `probe.btest.ts`'s driver (`support/entry.ts`, extended by this
 * run to add `renderCustomBlock` wiring, `customBlockHookCalls()`,
 * `blockOuterHTML()`, `offsetAtClientPoint()`, and
 * `segmentCharacterCenter()`) and its ONE-shared-browser-session pattern
 * (a fresh Chromium launch per `test()` was measured to hang in this
 * sandbox — see `tests/browser-harness/index.ts`'s header).
 *
 * AP-21: every case queries `documentBlockCount()`/`blockInfo()`/
 * `customBlockHookCalls()` liveness (a nonempty, independently-verifiable
 * fact) BEFORE any behavioral assertion, so a silently-failed mount or a
 * hook that was never actually consulted cannot be misread as a pass.
 *
 * SEGMENTS DECISION (run spec, "Constraint decision required"): **option
 * (a) — real per-character `segments` ARE wired** for the `@page splash`
 * paragraph probe (see the "segments decision" describe block below) and
 * proven, with real Chromium evidence, to land caret entry INSIDE the
 * block at the exact expected offset and to match keyboard-navigation
 * precision on drag. The bare-`dom`-only fallback (no `segments`) is ALSO
 * exercised and pinned as an explicit, still-legitimate mode (case 4's
 * "label" probes and case 5's "plain-text" probe below) — SFE-P1b2 wires
 * BOTH, per the segments-mode field on `CustomBlockMountOptions`, rather
 * than only one.
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

async function mount(text: string, options?: CustomViewMountOptions): Promise<string> {
  await harness.page.evaluate(
    ({ text, options }) => window.__gpc.mount(text, options),
    { text, options },
  );
  // SFE-P1b2 empirical finding: `mount()` returns as soon as the model/view
  // are constructed, but layout/measurement (which `segmentCharacterCenter`/
  // `offsetAtClientPoint` and real pointer positioning depend on) can still
  // be one frame behind at that instant -- observed live as flaky/incorrect
  // click targeting without this settle wait, stable with it (see this
  // file's tests below, all of which mount through this one helper).
  await harness.page.waitForTimeout(50);
  return harness.page.evaluate(() => window.__gpc.containerSelector);
}

async function blockCount(): Promise<number> {
  return harness.page.evaluate(() => window.__gpc.documentBlockCount());
}

async function block(index: number) {
  return harness.page.evaluate((i) => window.__gpc.blockInfo(i), index);
}

async function blockOuterHTML(index: number): Promise<string> {
  return harness.page.evaluate((i) => window.__gpc.blockOuterHTML(i), index);
}

async function customBlockHookCalls(): Promise<readonly CustomBlockHookCall[]> {
  return harness.page.evaluate(() => window.__gpc.customBlockHookCalls());
}

async function selectionOffsets() {
  return harness.page.evaluate(() => window.__gpc.selectionOffsets());
}

async function sourceSlice(start: number, end: number): Promise<string> {
  return harness.page.evaluate(({ start, end }) => window.__gpc.sourceSlice(start, end), {
    start,
    end,
  });
}

async function hostText(): Promise<string> {
  return harness.page.evaluate(() => window.__gpc.getHostText());
}

async function hostVersion(): Promise<number> {
  return harness.page.evaluate(() => window.__gpc.getHostVersion());
}

async function segmentCharacterCenter(index: number, charIndex: number) {
  return harness.page.evaluate(
    ({ i, c }) => window.__gpc.segmentCharacterCenter(i, c),
    { i: index, c: charIndex },
  );
}

async function characterCenter(index: number, charOffset: number) {
  return harness.page.evaluate(
    ({ i, c }) => window.__gpc.characterCenter(i, c),
    { i: index, c: charOffset },
  );
}

async function offsetAtClientPoint(x: number, y: number): Promise<number> {
  return harness.page.evaluate(({ x, y }) => window.__gpc.offsetAtClientPoint(x, y), { x, y });
}

/** AP-21 liveness: requires the mounted container really has `expected`
 * `.md-block` elements before any test proceeds to behavioral assertions. */
async function requireBlockCount(expected: number): Promise<void> {
  const count = await blockCount();
  expect(count).toBe(expected);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** 3 blocks: lead text, the `@page splash` paragraph probe, trail text --
 * the SAME probe shape `probe.btest.ts` used, so this file's cases 4/5/6
 * are directly comparable to that file's (failed, for this probe) D5
 * findings. */
const PARAGRAPH_CHIP_PROBE_TEXT = ["Lead text.", "", "@page splash", "", "Trail text."].join(
  "\n",
);

/** A single, standalone unhandled-block probe -- deliberately not an HTML
 * *comment* (`UnhandledBlockAstNode.htmlComment` special-cases comments
 * into a different hardcoded view, `Ln`), mirroring `probe.btest.ts`'s own
 * fixture choice for the same reason. */
const UNHANDLED_CHIP_PROBE_TEXT = "<div>plain html block</div>";

/**
 * 6 blocks spanning every kind the fork's patch does NOT touch (heading,
 * list, codeBlock) alongside the paragraph probe, in one document -- the
 * fixture case 4's negative gate needs: "the hook is NOT called for a
 * heading/list/code block in the same document."
 */
const MIXED_KIND_PROBE_TEXT = [
  "# A Heading",
  "",
  "Ordinary lead-in paragraph.",
  "",
  "@page splash",
  "",
  "- list item one",
  "- list item two",
  "",
  "```js",
  "const x = 1;",
  "```",
  "",
  "Ordinary trailing paragraph.",
].join("\n");

// ---------------------------------------------------------------------------
// Case 4 — custom inactive Gutterpress block rendering (the fork's seam)
// ---------------------------------------------------------------------------

describe("case 4 — renderCustomBlock fires for the paragraph probe; a heading/list the host declines, and a codeBlock it is never asked about, keep their own rendering", () => {
  test("the @page splash paragraph gets the custom chip; heading/list/codeBlock blocks keep their own default rendering untouched", async () => {
    await mount(MIXED_KIND_PROBE_TEXT, {
      customBlock: { label: "GP-BLOCK", mode: "label", chipFor: ["@page splash"] },
    });
    await requireBlockCount(6);

    const heading = await block(0);
    const probe = await block(2);
    const list = await block(3);
    const codeBlock = await block(4);

    // Positive: the probe got the custom chip, and the default paragraph
    // view is GONE (not merely additional to it).
    expect(probe.kind).toBe("paragraph");
    expect(probe.className).toContain("md-block");
    expect(probe.className).toContain("gpc-custom-chip");
    expect(probe.className).toContain("gpc-custom-chip-label");
    expect(probe.className).not.toContain("md-paragraph");
    expect(probe.textContent).toBe("GP-BLOCK:paragraph");

    // Negative: the OTHER kinds are byte-for-byte their normal selves. For
    // the heading and the list the fork now DOES consult the hook (PATCHES.md
    // Patch 6 extended the seam to those arms), and this fixture's host
    // chips only the paragraph -- so what this proves is the fall-through:
    // a host that returns undefined leaves the upstream view exactly as it
    // was. The codeBlock arm is not patched at all and never asks.
    expect(heading.kind).toBe("heading");
    expect(heading.className).toContain("md-heading");
    expect(heading.className).not.toContain("gpc-custom-chip");
    expect(list.kind).toBe("list");
    expect(list.className).toContain("md-list");
    expect(list.className).not.toContain("gpc-custom-chip");
    expect(codeBlock.kind).toBe("codeBlock");
    expect(codeBlock.className).toContain("md-code-block");
    expect(codeBlock.className).not.toContain("gpc-custom-chip");

    // AP-21 liveness before the negative-gate assertion below: the hook
    // really was consulted for SOMETHING in this document.
    const calls = await customBlockHookCalls();
    expect(calls.length).toBeGreaterThan(0);
    // Which arms consult the hook, asserted empirically against the REAL
    // pinned runtime rather than inferred from reading the patch source:
    // the patched arms ask, and `codeBlock` -- which has its own
    // `renderCustomCodeBlock` seam upstream and no `renderCustomBlock` one --
    // never does.
    const asked = new Set(calls.map((call) => call.kind));
    expect(asked.has("heading")).toBe(true);
    expect(asked.has("list")).toBe(true);
    expect(asked.has("codeBlock")).toBe(false);
    for (const call of calls) {
      expect(["paragraph", "unhandledBlock", "heading", "blockQuote", "list", "table"]).toContain(call.kind);
    }
  });
});

describe("case 4 — renderCustomBlock fires for the <div> unhandled-block probe", () => {
  test("a standalone <div>plain html block</div> gets the custom chip; the default unhandled-block view is absent", async () => {
    await mount(UNHANDLED_CHIP_PROBE_TEXT, {
      customBlock: { label: "GP-BLOCK", mode: "label", chipFor: ["<div>plain html block</div>"] },
    });
    await requireBlockCount(1);

    const probe = await block(0);
    expect(probe.kind).toBe("unhandledBlock");
    expect(probe.className).toContain("md-block");
    expect(probe.className).toContain("gpc-custom-chip");
    expect(probe.className).toContain("gpc-custom-chip-label");
    expect(probe.className).not.toContain("md-unhandled-block");
    expect(probe.textContent).toBe("GP-BLOCK:unhandledBlock");

    const calls = await customBlockHookCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls).toEqual([
      { kind: "unhandledBlock", sourceText: "<div>plain html block</div>" },
    ]);
  });
});

describe("case 4 — the hook is called with the exact node kind and the exact sourceText slice", () => {
  test("the recorded sourceText for the paragraph probe equals an independently-sliced [absoluteStart, absoluteStart+length) read of the mounted document", async () => {
    await mount(PARAGRAPH_CHIP_PROBE_TEXT, {
      customBlock: { label: "GP-BLOCK", mode: "label", chipFor: ["@page splash"] },
    });
    await requireBlockCount(3);

    const info = await block(1);
    const calls = await customBlockHookCalls();
    expect(calls.length).toBeGreaterThan(0);

    // Independent of whatever the hook itself reported: slice the STATIC,
    // known fixture text at the block's own AST-reported [absoluteStart,
    // absoluteStart+length) range (blockInfo/`astBlocks()` in the driver
    // reads `EditorView.viewData`, a wholly separate code path from the
    // hook call recording).
    const expectedSourceText = PARAGRAPH_CHIP_PROBE_TEXT.slice(
      info.absoluteStart,
      info.absoluteStart + info.length,
    );
    expect(expectedSourceText).toBe("@page splash\n\n");

    const matchingCall = calls.find((c) => c.sourceText === expectedSourceText);
    expect(matchingCall).not.toBeUndefined();
    expect(matchingCall?.kind).toBe("paragraph");
  });
});

describe("case 4 — never consulted for the ACTIVE render of the block itself", () => {
  test("entering the probe swaps the chip for real source text; the active block's own rendering never comes from the hook (other inactive blocks may legitimately still be re-consulted)", async () => {
    const selector = await mount(PARAGRAPH_CHIP_PROBE_TEXT, {
      customBlock: { label: "GP-BLOCK", mode: "label", chipFor: ["@page splash"] },
    });
    await requireBlockCount(3);

    const inactive = await block(1);
    expect(inactive.className).toContain("gpc-custom-chip");
    // The exact, independently-known sourceText this probe's chip was built
    // from -- computed once, BEFORE activation, so the check below does not
    // depend on the hook being called again with the same value.
    const probeSourceText = PARAGRAPH_CHIP_PROBE_TEXT.slice(
      inactive.absoluteStart,
      inactive.absoluteStart + inactive.length,
    );

    const callsBeforeCount = (await customBlockHookCalls()).length;
    expect(callsBeforeCount).toBeGreaterThan(0);

    // Real keyboard navigation into the block (matching probe.btest.ts's
    // own case-5 pattern): Home on the lead block, then ArrowDown once.
    await harness.page.click(`${selector} .md-document > .md-block:nth-child(1)`);
    await harness.page.keyboard.press("Home");
    await harness.page.keyboard.press("ArrowDown");
    await harness.page.waitForTimeout(50);

    const active = await block(1);
    expect(active.className).not.toContain("gpc-custom-chip");
    expect(active.className).toContain("md-block-active");
    // Source-aware active rendering shows the real marker line, fence-free
    // (a paragraph has no fence to hide) -- not the chip's label text.
    expect(active.textContent).toContain("@page splash");
    expect(active.textContent).not.toBe("GP-BLOCK:paragraph");

    // The hook MAY legitimately be re-consulted for OTHER, still-inactive
    // blocks as part of the same re-render (the run spec's own wording) --
    // what must NOT happen is the ACTIVE block's own rendering being the
    // hook's chip DOM. Checked honestly: inspect every call recorded SINCE
    // activation and confirm none of them is a call for the ACTIVE block's
    // own exact source range.
    const callsAfter = await customBlockHookCalls();
    const newCalls = callsAfter.slice(callsBeforeCount);
    for (const call of newCalls) {
      expect(call.sourceText).not.toBe(probeSourceText);
    }
  });
});

describe("case 4 — fallback: returning undefined falls through to the exact default view", () => {
  test("a renderCustomBlock hook that declines every node produces byte-identical DOM to a control mount with no hook at all", async () => {
    await mount(PARAGRAPH_CHIP_PROBE_TEXT);
    await requireBlockCount(3);
    const controlHTML = await blockOuterHTML(1);

    await mount(PARAGRAPH_CHIP_PROBE_TEXT, {
      // chipFor: [] -- the hook is set and IS consulted (proven below via
      // customBlockHookCalls liveness) but never matches, so every call
      // returns undefined.
      customBlock: { label: "GP-BLOCK", mode: "label", chipFor: [] },
    });
    await requireBlockCount(3);

    const calls = await customBlockHookCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.sourceText.includes("@page splash"))).toBe(true);

    const fallbackHTML = await blockOuterHTML(1);
    expect(fallbackHTML).toBe(controlHTML);
  });
});

// ---------------------------------------------------------------------------
// Case 5 — active/source-aware rendering, byte-exact edits, zero-drift exit
// ---------------------------------------------------------------------------

describe("case 5 — bare-dom fallback (no segments): entry lands at absoluteStart; typing PREPENDS onto the marker line, safely (unlike the fence-corruption hazard)", () => {
  test("the fence-corruption hazard note, re-applied to a paragraph: prepending is safe -- no corruption beyond the explicit edit", async () => {
    const selector = await mount(PARAGRAPH_CHIP_PROBE_TEXT, {
      customBlock: { label: "GP-BLOCK", mode: "plain-text", chipFor: ["@page splash"] },
    });
    await requireBlockCount(3);

    const inactive = await block(1);
    expect(inactive.className).toContain("gpc-custom-chip-plain");
    const originalHostText = await hostText();
    expect(originalHostText).toBe(PARAGRAPH_CHIP_PROBE_TEXT);

    // Independently known target offset: the marker line's own start,
    // found via String.indexOf against the static fixture -- not derived
    // from navigation.
    const markerStart = PARAGRAPH_CHIP_PROBE_TEXT.indexOf("@page splash");
    expect(markerStart).toBe(12);

    await harness.page.click(`${selector} .md-document > .md-block:nth-child(1)`);
    await harness.page.keyboard.press("Home");
    await harness.page.keyboard.press("ArrowDown");
    await harness.page.waitForTimeout(50);

    // EMPIRICAL FINDING (SFE-P1b2, re-confirming the original decision
    // record's fenced-code finding for the NEW seam, on a paragraph
    // probe): the bare-dom (no-segments) chip carries no per-character
    // layout data, so the first ArrowDown that enters it lands the caret
    // at EXACTLY the block's absoluteStart.
    const sel = await selectionOffsets();
    expect(sel).not.toBeUndefined();
    expect(sel!.active).toBe(markerStart);

    const active = await block(1);
    expect(active.className).not.toContain("gpc-custom-chip");
    expect(active.textContent).toContain("@page splash");

    await harness.page.keyboard.type("X");
    await harness.page.waitForTimeout(50);

    const editedHostText = await hostText();
    // Typing at absoluteStart PREPENDS -- the marker line becomes
    // "X@page splash", byte-exact, with everything else unchanged. For a
    // PARAGRAPH (unlike the fenced-code probe) this is safe: there is no
    // fence syntax to corrupt by an extra leading character.
    const expectedEditedText =
      originalHostText.slice(0, markerStart) + "X" + originalHostText.slice(markerStart);
    expect(editedHostText).toBe(expectedEditedText);
    expect(editedHostText).toContain("X@page splash");
    expect(await hostVersion()).toBe(1);

    // No corruption beyond the explicit edit: the document still parses
    // into exactly the same block SHAPE (3 blocks, the edited one still a
    // paragraph) -- an actual fence-corruption failure (as recorded for
    // the codeBlock probe) would have reparsed the block into something
    // else entirely.
    await requireBlockCount(3);
    const reparsed = await block(1);
    expect(reparsed.kind).toBe("paragraph");

    // Leave the block: chip restored, zero FURTHER byte drift.
    await harness.page.click(`${selector} .md-document > .md-block:nth-child(1)`);
    await harness.page.waitForTimeout(50);
    const reInactive = await block(1);
    expect(reInactive.className).toContain("gpc-custom-chip-plain");
    expect(await hostText()).toBe(editedHostText);
    expect(await hostVersion()).toBe(1);
  });
});

describe("case 5 — segmented chip: entry lands INSIDE at the exact expected offset; interior edit is byte-exact; leaving restores the chip with zero drift", () => {
  test("clicking the 's' of \"splash\" lands the caret one character past it, exactly; typing there is a byte-exact interior edit", async () => {
    // Matched via "@page" (not the full "@page splash") deliberately: the
    // interior edit below inserts a character INSIDE "splash", which would
    // break a "@page splash" substring match on the RE-render after typing
    // -- an artifact of this test-only provider's substring matching, not
    // a fork limitation. "@page" alone survives an interior edit anywhere
    // after it and still uniquely identifies this probe in this fixture.
    const selector = await mount(PARAGRAPH_CHIP_PROBE_TEXT, {
      customBlock: { label: "GP-SEG", mode: "segmented-text", chipFor: ["@page"] },
    });
    await requireBlockCount(3);

    const inactive = await block(1);
    expect(inactive.className).toContain("gpc-custom-chip-segmented");
    const originalHostText = await hostText();

    // Independently-known target: character index 6 of "@page splash" is
    // the first "s" of "splash" (indices: 0='@' 1='p' 2='a' 3='g' 4='e'
    // 5=' ' 6='s' ...). Clicking a 1-length segment's center resolves to
    // its TRAILING edge (verified live, reproducibly, across repeated
    // fresh mounts) -- so the expected landing offset is ONE PAST that
    // character's start. Computed here via String.indexOf against the
    // static fixture, not by reasoning about the mount code's own
    // absoluteStart+charIndex arithmetic.
    const interiorOffset = PARAGRAPH_CHIP_PROBE_TEXT.indexOf("splash") + 1;
    expect(interiorOffset).toBe(19);

    const pt = await segmentCharacterCenter(1, 6);
    await harness.page.mouse.click(pt.x, pt.y);
    await harness.page.waitForTimeout(50);

    const sel = await selectionOffsets();
    expect(sel).not.toBeUndefined();
    // The correct offset, exactly -- not merely "inside the block's range"
    // -- proving segments genuinely enable interior caret placement.
    expect(sel!.active).toBe(interiorOffset);
    // Cross-checked via a SECOND, independent mechanism: the package's own
    // VisualLineMap.offsetAtPoint geometry query at the exact same client
    // point, computed via a wholly separate code path from the selection
    // the click itself produced.
    expect(await offsetAtClientPoint(pt.x, pt.y)).toBe(interiorOffset);

    const active = await block(1);
    expect(active.className).not.toContain("gpc-custom-chip");
    expect(active.textContent).toContain("@page splash");

    await harness.page.keyboard.type("X");
    await harness.page.waitForTimeout(50);

    const editedHostText = await hostText();
    const expectedEditedText =
      originalHostText.slice(0, interiorOffset) + "X" + originalHostText.slice(interiorOffset);
    expect(editedHostText).toBe(expectedEditedText);
    // Byte-exact INTERIOR edit -- "@page s" + "X" + "plash...", not a
    // prepend, proving this is materially different from (and strictly
    // better than) the bare-dom fallback case above.
    expect(editedHostText).toContain("@page sXplash");
    expect(await hostVersion()).toBe(1);

    // Leave: chip restored, zero further byte drift.
    await harness.page.click(`${selector} .md-document > .md-block:nth-child(1)`);
    await harness.page.waitForTimeout(50);
    const reInactive = await block(1);
    expect(reInactive.className).toContain("gpc-custom-chip-segmented");
    expect(await hostText()).toBe(editedHostText);
    expect(await hostVersion()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Segments decision — real per-character segments, proven for the paragraph probe
// ---------------------------------------------------------------------------

describe("segments decision — caret-entry and drag precision now match the keyboard baseline (option (a): segments ARE wired)", () => {
  test("clicking each of several distinct characters lands at a distinct, exactly-predictable offset (not just 'inside the block')", async () => {
    // Fresh mount per click -- a click both moves the caret AND activates
    // the block it lands in (verified live), so re-using one mount across
    // several clicks would test against a moving target after the first.
    const cases: ReadonlyArray<{ charIndex: number; expectedOffset: number }> = [
      { charIndex: 0, expectedOffset: 13 }, // '@' -> boundary after it
      { charIndex: 1, expectedOffset: 14 }, // 'p' of "page"
      { charIndex: 6, expectedOffset: 19 }, // 's' of "splash"
      { charIndex: 11, expectedOffset: 24 }, // 'h', last letter of "splash"
    ];
    for (const { charIndex, expectedOffset } of cases) {
      await mount(PARAGRAPH_CHIP_PROBE_TEXT, {
        customBlock: { label: "GP-SEG", mode: "segmented-text", chipFor: ["@page splash"] },
      });
      await requireBlockCount(3);
      const pt = await segmentCharacterCenter(1, charIndex);
      await harness.page.mouse.click(pt.x, pt.y);
      await harness.page.waitForTimeout(50);
      const sel = await selectionOffsets();
      expect(sel).not.toBeUndefined();
      expect(sel!.active).toBe(expectedOffset);
      expect(await offsetAtClientPoint(pt.x, pt.y)).toBe(expectedOffset);
    }
  });

  test("a pointer drag between two known characters selects EXACTLY the expected interior range, matching keyboard precision", async () => {
    await mount(PARAGRAPH_CHIP_PROBE_TEXT, {
      customBlock: { label: "GP-SEG", mode: "segmented-text", chipFor: ["@page splash"] },
    });
    await requireBlockCount(3);
    const probe = await block(1);

    // Drag from character index 1 ('p' of "page") to character index 10
    // ('s', second "s" of "splash").
    const startPt = await segmentCharacterCenter(1, 1);
    const endPt = await segmentCharacterCenter(1, 10);
    const expectedStart = probe.absoluteStart + 1 + 1;
    const expectedEnd = probe.absoluteStart + 10 + 1;

    await harness.page.mouse.move(startPt.x, startPt.y);
    await harness.page.mouse.down();
    await harness.page.mouse.move(endPt.x, endPt.y, { steps: 8 });
    await harness.page.mouse.up();
    await harness.page.waitForTimeout(50);

    const sel = await selectionOffsets();
    expect(sel).not.toBeUndefined();
    // EXACT, not merely "reached into the block" -- this is the material
    // difference from probe.btest.ts's codeBlock drag test, whose target
    // hook (renderCustomCodeBlock) has no segments capability at all.
    expect(sel!.start).toBe(expectedStart);
    expect(sel!.endExclusive).toBe(expectedEnd);
    // Cross-checked independently at both endpoints, via a wholly separate
    // geometry code path from the drag's own selection reporting.
    expect(await offsetAtClientPoint(startPt.x, startPt.y)).toBe(expectedStart);
    expect(await offsetAtClientPoint(endPt.x, endPt.y)).toBe(expectedEnd);

    const slice = await sourceSlice(sel!.start, sel!.endExclusive);
    expect(slice).toBe(PARAGRAPH_CHIP_PROBE_TEXT.slice(expectedStart, expectedEnd));
    expect(slice).toBe("age splas");
  });
});

// ---------------------------------------------------------------------------
// Case 6 (re-run) — selection mapping through the paragraph probe, hook active
// ---------------------------------------------------------------------------
//
// probe.btest.ts's D5 case-6 suite exercised only the ```gutterpress-region
// fenced-code probe (via the PRE-EXISTING renderCustomCodeBlock hook); its
// own "selection mapping across the plain paragraph-shaped probes" describe
// block explicitly used NO custom rendering at all for `@page splash`. This
// is the FIRST proof of case 6 against the paragraph probe WITH the fork's
// renderCustomBlock hook active (segmented, so the block is genuinely
// custom-painted, not merely inactive-by-default) -- not a regression check.

describe("case 6 (re-run, first proof) — full-document keyboard selection across the active paragraph probe", () => {
  test("Ctrl+Home / Shift+Ctrl+End selects the exact full document, including the custom-rendered probe's real source range", async () => {
    await mount(PARAGRAPH_CHIP_PROBE_TEXT, {
      customBlock: { label: "GP-SEG", mode: "segmented-text", chipFor: ["@page splash"] },
    });
    await requireBlockCount(3);

    await harness.page.click(`.md-document > .md-block:nth-child(1)`);
    await harness.page.keyboard.press("Control+Home");
    await harness.page.waitForTimeout(30);
    let sel = await selectionOffsets();
    expect(sel).toEqual({ anchor: 0, active: 0, start: 0, endExclusive: 0 });

    await harness.page.keyboard.press("Shift+Control+End");
    await harness.page.waitForTimeout(30);
    sel = await selectionOffsets();
    expect(sel).not.toBeUndefined();
    expect(sel!.anchor).toBe(0);
    expect(sel!.active).toBe(PARAGRAPH_CHIP_PROBE_TEXT.length);
    expect(sel!.start).toBe(0);
    expect(sel!.endExclusive).toBe(PARAGRAPH_CHIP_PROBE_TEXT.length);

    expect(await sourceSlice(sel!.start, sel!.endExclusive)).toBe(PARAGRAPH_CHIP_PROBE_TEXT);
    expect(await hostText()).toBe(PARAGRAPH_CHIP_PROBE_TEXT);
  });
});

describe("case 6 (re-run, first proof) — Shift+ArrowDown crossing the active paragraph probe", () => {
  test("the selection extends monotonically forward through the projected block's exact range", async () => {
    await mount(PARAGRAPH_CHIP_PROBE_TEXT, {
      customBlock: { label: "GP-SEG", mode: "segmented-text", chipFor: ["@page splash"] },
    });
    await requireBlockCount(3);
    const leadBlock = await block(0);
    const probeBlock = await block(1);

    await harness.page.click(`.md-document > .md-block:nth-child(1)`);
    await harness.page.keyboard.press("End");
    await harness.page.waitForTimeout(30);
    const collapsed = await selectionOffsets();
    expect(collapsed).not.toBeUndefined();
    expect(collapsed!.start).toBe(collapsed!.endExclusive);
    const anchor = collapsed!.anchor;

    let reachedPastProbe = false;
    let previousActive = collapsed!.active;
    for (let step = 0; step < 12 && !reachedPastProbe; step++) {
      await harness.page.keyboard.press("Shift+ArrowDown");
      await harness.page.waitForTimeout(30);
      const sel = await selectionOffsets();
      expect(sel).not.toBeUndefined();
      expect(sel!.anchor).toBe(anchor);
      expect(sel!.active).toBeGreaterThanOrEqual(previousActive);
      previousActive = sel!.active;
      reachedPastProbe = sel!.active >= probeBlock.absoluteStart + probeBlock.length;
    }
    expect(reachedPastProbe).toBe(true);

    const finalSel = await selectionOffsets();
    const slice = await sourceSlice(finalSel!.start, finalSel!.endExclusive);
    expect(slice).toContain("@page splash");
    expect(finalSel!.start).toBeLessThanOrEqual(leadBlock.absoluteStart + leadBlock.length);
  });
});

// ---------------------------------------------------------------------------
// SFE-P3d-sweep+P3f repair round, round 1 (finding 1 / finding 2) —
// pointer->offset resolution for a block whose absoluteStart shifted
// because an EARLIER block was edited. `dist/index.js`'s per-keystroke
// measurement-cache (`PATCHES.md` "Patch 2") reuses a block's cached
// `visualLineMap` (which bakes in ABSOLUTE source offsets, see mo()) by
// DOM/view-node identity alone; a block whose own AST is untouched keeps
// that identity even though every later block's `absoluteStart` shifted by
// the length of an edit landing earlier in the document. Before this
// repair round's fix (requiring the cache's own `absoluteStart` to match
// the block's CURRENT `absoluteStart`), this test fails: the resolved
// offset for a character in the LATE block stays pinned to its PRE-edit
// value instead of shifting by the edit's length. Uses NO new harness —
// the same shared `support/entry.ts` session/mount every case in this file
// already uses, and `offsetAtClientPoint` (added for SFE-P1b2's drag
// cross-check) reads through the EXACT mechanism this bug lives in
// (`EditorView.measuredLayout.visualLineMap.get().offsetAtPoint`).
// ---------------------------------------------------------------------------

describe("SFE-P3d-sweep+P3f repair round 1 — pointer offset stays byte-exact after an edit shifts an earlier block", () => {
  const FOUR_BLOCK_TEXT = "aaaa\n\nbbbb\n\ncccc\n\ndddd";
  const LATE_BLOCK_INDEX = 3; // "dddd"
  const LATE_CHAR_OFFSET = 2; // the third 'd'
  // Clicking a single character's rect center resolves to its TRAILING
  // edge (same empirically-verified behavior this file's "segments
  // decision" describe block above documents and relies on) -- so the
  // landing offset one past a block's own absoluteStart + charOffset.
  const CLICK_LANDS_PAST_CHAR = 1;

  test("baseline (no edit yet): pointer resolves to the block's own un-shifted absoluteStart + charOffset", async () => {
    await mount(FOUR_BLOCK_TEXT);
    await requireBlockCount(4);

    const lateBlock = await block(LATE_BLOCK_INDEX);
    expect(lateBlock.absoluteStart).toBe(FOUR_BLOCK_TEXT.indexOf("dddd"));

    const pt = await characterCenter(LATE_BLOCK_INDEX, LATE_CHAR_OFFSET);
    expect(await offsetAtClientPoint(pt.x, pt.y)).toBe(
      lateBlock.absoluteStart + LATE_CHAR_OFFSET + CLICK_LANDS_PAST_CHAR,
    );
  });

  test("INSERTING characters into an earlier block shifts the resolved pointer offset in a later block by the exact insert length, and the next keystroke lands there", async () => {
    await mount(FOUR_BLOCK_TEXT);
    await requireBlockCount(4);

    const originalLateAbsoluteStart = (await block(LATE_BLOCK_INDEX)).absoluteStart;

    // Real keystroke-by-keystroke input in the FIRST block, nowhere near
    // the block under test -- exactly the shape of edit finding 1's own
    // repro used ("click block 1, Home, type XXXXX, then click block 4").
    // A PRECISE click (not a coarse block click + Home/End) is used because
    // this fork's own paragraph blocks include their trailing blank line in
    // the block's DOM (confirmed live: `block(0).length` is 6, covering
    // "aaaa\n\n", not just "aaaa") -- coarse click + Home/End is a second,
    // unrelated source of caret-placement uncertainty this test does not
    // need to take on. Clicking character index 0 ('a') lands the caret ONE
    // PAST it (the same trailing-edge behavior `CLICK_LANDS_PAST_CHAR`
    // documents above), i.e. absolute offset 1 -- still well inside block0,
    // still shifts every later block's absoluteStart by INSERT.length.
    const insertPt = await characterCenter(0, 0);
    await harness.page.mouse.click(insertPt.x, insertPt.y);
    await harness.page.waitForTimeout(50);
    const INSERT = "XXXXX";
    await harness.page.keyboard.type(INSERT);
    await harness.page.waitForTimeout(80);

    const textAfterInsertEdit = FOUR_BLOCK_TEXT.slice(0, 1) + INSERT + FOUR_BLOCK_TEXT.slice(1);
    expect(await hostText()).toBe(textAfterInsertEdit);

    // Ground truth, read from the view's own parsed AST (`viewData`), NOT
    // from the measurement pass under test -- genuinely independent of the
    // bug this test pins.
    const lateBlockAfterEdit = await block(LATE_BLOCK_INDEX);
    expect(lateBlockAfterEdit.absoluteStart).toBe(originalLateAbsoluteStart + INSERT.length);
    const expectedOffset = lateBlockAfterEdit.absoluteStart + LATE_CHAR_OFFSET + CLICK_LANDS_PAST_CHAR;

    const pt = await characterCenter(LATE_BLOCK_INDEX, LATE_CHAR_OFFSET);
    // The mechanism assertion: a STALE (pre-fix) cache resolves this to
    // originalLateAbsoluteStart + LATE_CHAR_OFFSET + CLICK_LANDS_PAST_CHAR
    // instead -- off by exactly INSERT.length, reproducing finding 1's
    // off-by-N mechanism directly.
    expect(await offsetAtClientPoint(pt.x, pt.y)).toBe(expectedOffset);

    // Behavioral proof, not just the geometry query: a real pointer click
    // followed by a real keystroke lands the new character at the correct
    // byte offset in the HOST's own text.
    await harness.page.mouse.click(pt.x, pt.y);
    await harness.page.waitForTimeout(50);
    await harness.page.keyboard.type("!");
    await harness.page.waitForTimeout(50);

    const expectedFinalText =
      textAfterInsertEdit.slice(0, expectedOffset) + "!" + textAfterInsertEdit.slice(expectedOffset);
    expect(await hostText()).toBe(expectedFinalText);
  });

  test("DELETING characters from an earlier block shifts the resolved pointer offset in a later block DOWN by the exact delete length, and the next keystroke lands there", async () => {
    await mount(FOUR_BLOCK_TEXT);
    await requireBlockCount(4);

    const originalLateAbsoluteStart = (await block(LATE_BLOCK_INDEX)).absoluteStart;

    // Precise click at character index 3 (the last 'a' of "aaaa") lands the
    // caret ONE PAST it -- absolute offset 4, i.e. exactly at the end of
    // "aaaa" and before its trailing blank line (see the INSERT case's
    // comment above for why a precise click is used instead of End, which
    // this fork resolves to a DIFFERENT position for a block whose own DOM
    // spans a trailing blank line). Two Backspaces from there delete
    // "aaaa"'s last two characters, leaving "aa".
    const deletePt = await characterCenter(0, 3);
    await harness.page.mouse.click(deletePt.x, deletePt.y);
    await harness.page.waitForTimeout(50);
    const DELETE_COUNT = 2;
    for (let i = 0; i < DELETE_COUNT; i++) {
      const before = await hostText();
      await harness.page.keyboard.press("Backspace");
      await harness.page.waitForFunction(
        (beforeLen) => window.__gpc.getHostText().length < beforeLen,
        before.length,
        { timeout: 5_000 },
      );
    }
    await harness.page.waitForTimeout(50);

    // "aaaa" (indices 0-3) loses its last DELETE_COUNT characters; every
    // byte from index 4 onward ("\n\nbbbb...") is untouched.
    const textAfterDeleteEdit = FOUR_BLOCK_TEXT.slice(0, 4 - DELETE_COUNT) + FOUR_BLOCK_TEXT.slice(4);
    expect(await hostText()).toBe(textAfterDeleteEdit);

    const lateBlockAfterEdit = await block(LATE_BLOCK_INDEX);
    expect(lateBlockAfterEdit.absoluteStart).toBe(originalLateAbsoluteStart - DELETE_COUNT);
    const expectedOffset = lateBlockAfterEdit.absoluteStart + LATE_CHAR_OFFSET + CLICK_LANDS_PAST_CHAR;

    const pt = await characterCenter(LATE_BLOCK_INDEX, LATE_CHAR_OFFSET);
    expect(await offsetAtClientPoint(pt.x, pt.y)).toBe(expectedOffset);

    await harness.page.mouse.click(pt.x, pt.y);
    await harness.page.waitForTimeout(50);
    await harness.page.keyboard.type("!");
    await harness.page.waitForTimeout(50);

    const expectedFinalText =
      textAfterDeleteEdit.slice(0, expectedOffset) + "!" + textAfterDeleteEdit.slice(expectedOffset);
    expect(await hostText()).toBe(expectedFinalText);
  });
});

describe("harness liveness", () => {
  test("the shared session produced no console or page errors across every case above", () => {
    expect(harness.consoleErrors).toEqual([]);
    expect(harness.pageErrors).toEqual([]);
  });
});
