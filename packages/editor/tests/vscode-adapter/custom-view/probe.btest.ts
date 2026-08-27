import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  openHarnessSession,
  waitForHarnessReady,
  type HarnessSession,
} from "../../browser-harness/index.ts";
import type { CustomViewMountOptions } from "./support/entry.ts";

/**
 * SFE-P1b Lane C — real-Chromium spikes proving or disproving D5 cases 4, 5,
 * and 6 against the exact pinned `@vscode/markdown-editor@0.0.2-84` runtime
 * (I-01: "exercise the exact pinned runtime", not package declarations).
 *
 * Probes (matching the run spec exactly):
 *   - a paragraph-shaped Gutterpress marker line: `@page splash`
 *   - a fenced-code-free "plugin-region-like" paragraph: `::: sidebar`
 *   - a fenced code block whose info string is `gutterpress-region` — the
 *     ONE hook D5's Recorded facts confirm exists
 *     (`BlockViewOptions.renderCustomCodeBlock`), used both as the known-hook
 *     comparison point and to characterize its two-state (inactive/active)
 *     behavior for cases 5 and 6.
 *
 * ONE shared browser session for every case in this file, matching Lane A's
 * own measured finding (see `tests/browser-harness/index.ts`'s header): a
 * fresh Chromium launch per `test()` hangs in this sandbox.
 *
 * AP-21: every case queries `documentBlockCount()`/`blockInfo()` (real DOM +
 * AST state) BEFORE any behavioral assertion, so a silently-failed mount
 * cannot be misread as a passing or failing case.
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
  return harness.page.evaluate(() => window.__gpc.containerSelector);
}

async function blockCount(): Promise<number> {
  return harness.page.evaluate(() => window.__gpc.documentBlockCount());
}

async function block(index: number) {
  return harness.page.evaluate((i) => window.__gpc.blockInfo(i), index);
}

async function codeBlockHookCalls() {
  return harness.page.evaluate(() => window.__gpc.codeBlockHookCalls());
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

/** AP-21 liveness: requires the mounted container really has `expected`
 * `.md-block` elements before any test proceeds to behavioral assertions. */
async function requireBlockCount(expected: number): Promise<void> {
  const count = await blockCount();
  expect(count).toBe(expected);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** 4 blocks: an ordinary lead-in, the two paragraph-shaped Gutterpress-like
 * probes, and an ordinary trailing paragraph. */
const PARAGRAPH_PROBE_TEXT = [
  "Ordinary lead-in paragraph.",
  "",
  "@page splash",
  "",
  "::: sidebar",
  "",
  "Ordinary trailing paragraph.",
].join("\n");

/** 3 blocks: lead text, the ONE real fenced-code hook target, trail text. */
const CODE_BLOCK_PROBE_TEXT = [
  "Lead text.",
  "",
  "```gutterpress-region",
  "region body line 1",
  "region body line 2",
  "```",
  "",
  "Trail text.",
].join("\n");

// ---------------------------------------------------------------------------
// Case 4 — custom inactive Gutterpress block rendering
// ---------------------------------------------------------------------------

describe("case 4 — known-hook baseline: renderCustomCodeBlock DOES fire for a real fenced code block", () => {
  test("a ```gutterpress-region fence renders the custom chip instead of highlighted code while inactive", async () => {
    await mount(CODE_BLOCK_PROBE_TEXT, { customCodeBlockChipLabel: "GP-REGION" });
    await requireBlockCount(3);

    const calls = await codeBlockHookCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ language: "gutterpress-region" });
    expect(calls[0]?.content).toContain("region body line 1");
    expect(calls[0]?.content).toContain("region body line 2");

    const codeBlock = await block(1);
    expect(codeBlock.kind).toBe("codeBlock");
    // The hook's returned HTMLElement becomes the block's own mount element
    // (verified against dist/index.js: `d.classList.add("md-block",
    // "md-code-block"), m = d`) -- the custom chip class survives alongside
    // the block's normal classes, and the block's rendered text is the
    // CUSTOM label, not the fenced code's own content.
    expect(codeBlock.className).toContain("gpc-custom-chip");
    expect(codeBlock.className).toContain("md-code-block");
    expect(codeBlock.textContent).toBe("GP-REGION:gutterpress-region");
    expect(codeBlock.textContent).not.toContain("region body line 1");
  });
});

describe("case 4 — absence proof: no generic hook fires for a paragraph-shaped Gutterpress marker", () => {
  test("`@page splash` and `::: sidebar` render as ordinary <p class=\"md-block md-paragraph\"> with their literal source text, and NEVER invoke renderCustomCodeBlock", async () => {
    // The SAME instrumented renderCustomCodeBlock used in the known-hook
    // baseline above, mounted against a document that contains ONLY
    // paragraph-shaped probes (no fenced code at all) -- if there were any
    // generic block-rendering seam this hook (or anything it gates) could
    // reach, this is where it would show up.
    await mount(PARAGRAPH_PROBE_TEXT, { customCodeBlockChipLabel: "GP-REGION" });
    await requireBlockCount(4);

    const pageMarker = await block(1);
    expect(pageMarker.kind).toBe("paragraph");
    // `md-markers-hidden` is a generic state class every inactive block
    // carries (verified live -- not specific to this probe); the class list
    // is otherwise exactly the generic paragraph view's, with nothing
    // Gutterpress-aware in it.
    expect(pageMarker.className).toContain("md-block");
    expect(pageMarker.className).toContain("md-paragraph");
    expect(pageMarker.className).not.toContain("gpc-custom-chip");
    expect(pageMarker.textContent).toContain("@page splash");

    const sidebarMarker = await block(2);
    expect(sidebarMarker.kind).toBe("paragraph");
    expect(sidebarMarker.className).toContain("md-block");
    expect(sidebarMarker.className).toContain("md-paragraph");
    expect(sidebarMarker.className).not.toContain("gpc-custom-chip");
    expect(sidebarMarker.textContent).toContain("::: sidebar");

    // The one production hook the package exposes for custom INACTIVE
    // rendering was never invoked -- not for a fenced block (there is none
    // in this document) and, more importantly, not as a side effect of
    // encountering either paragraph-shaped probe. This is the generic-hook
    // absence proof for case 4's specified probe shapes.
    expect(await codeBlockHookCalls()).toEqual([]);
  });

  test("an unrecognized top-level construct (not a paragraph) renders via the SAME hardcoded raw-scroll view regardless of options -- still no generic hook", async () => {
    // A plain `<div>` block (micromark's `htmlFlow` token) is one of the few
    // constructs this parser actually routes to `UnhandledBlockAstNode`
    // rather than `ParagraphAstNode` -- included so the "unhandled" half of
    // D5 case 4's "ordinary/unhandled" framing is exercised too, not just
    // the paragraph half. (An HTML *comment* specifically is deliberately
    // NOT used here: `UnhandledBlockAstNode.htmlComment` special-cases
    // comments into a DIFFERENT hardcoded view -- `Ln`/`md-html-comment*` --
    // which would prove the same "no generic hook" point through a
    // different hardcoded branch, muddying this specific citation.)
    await mount("<div>plain html block</div>", {
      customCodeBlockChipLabel: "GP-REGION",
    });
    await requireBlockCount(1);

    const unhandled = await block(0);
    expect(unhandled.kind).toBe("unhandledBlock");
    // dist/index.js's `Sn` view class: always `md-block md-unhandled-block`
    // wrapping a `<pre class="md-code-block md-unhandled-scroll"><code>`,
    // unconditionally -- no options parameter is even read for this case.
    expect(unhandled.className).toContain("md-block");
    expect(unhandled.className).toContain("md-unhandled-block");
    expect(unhandled.className).not.toContain("gpc-custom-chip");
    expect(await codeBlockHookCalls()).toEqual([]);
  });
});

describe("case 4 — overlay workaround: additive only, cannot participate in text flow", () => {
  test("an overlay chip positioned over the paragraph marker via rangeRects() does not replace, hide, or remove the block's own rendered text", async () => {
    await mount(PARAGRAPH_PROBE_TEXT);
    await requireBlockCount(4);

    const before = await block(1);
    expect(before.textContent).toContain("@page splash");

    const rectFound = await harness.page.evaluate(() =>
      window.__gpc.mountOverlayChip(1, "Splash Page"),
    );
    expect(rectFound).toBe(true);

    const inOverlayLayer = await harness.page.evaluate(() =>
      window.__gpc.overlayChipInOverlayContainer(),
    );
    expect(inOverlayLayer).toBe(true);
    expect(await harness.page.evaluate(() => window.__gpc.overlayChipText())).toContain(
      "Splash Page",
    );

    // The block's OWN DOM is untouched by mounting the overlay: same kind,
    // same class, same literal source text still present and still part of
    // the semantic document flow. The overlay is layered on top (matching
    // the package's own CommentModeController doc: "layered on top of the
    // editor without modifying it") -- it cannot substitute for or hide the
    // block's real rendering, which is exactly what a generic custom-block
    // hook would need to do to satisfy case 4 for this probe shape.
    const after = await block(1);
    expect(after.kind).toBe(before.kind);
    expect(after.className).toBe(before.className);
    expect(after.textContent).toBe(before.textContent);
  });
});

// ---------------------------------------------------------------------------
// Case 5 — active/source-aware rendering for a projected block
// ---------------------------------------------------------------------------

describe("case 5 — the ONE working two-state transition: renderCustomCodeBlock's inactive chip vs. active source editing", () => {
  test("activating the fenced block swaps the custom chip for source-aware editable content at its exact range; deactivating restores the chip with no byte drift", async () => {
    const selector = await mount(CODE_BLOCK_PROBE_TEXT, { customCodeBlockChipLabel: "GP-REGION" });
    await requireBlockCount(3);

    const inactive = await block(1);
    expect(inactive.className).toContain("gpc-custom-chip");
    const originalHostText = await hostText();
    // Exact expected interior position for the edit below, computed
    // independently of any navigation heuristics: the end of "region body
    // line 1" inside the fenced block's REAL source (not its custom-painted
    // form).
    const bodyLine1End =
      CODE_BLOCK_PROBE_TEXT.indexOf("region body line 1") + "region body line 1".length;

    // Activate: click into the PRECEDING block (real, unambiguous text, not
    // the custom chip), land the caret at its end via Home/End (a
    // deterministic offset, independent of exact pixel hit-testing), then
    // step forward with real ArrowDown keystrokes until the model's own
    // selection reports an offset inside the code block's exact
    // [absoluteStart, absoluteStart + length) range -- this is REAL keyboard
    // navigation driving the REAL controller, not a forced/synthetic
    // activation.
    //
    // EMPIRICAL FINDING (recorded in the decision record): the first
    // ArrowDown that enters a `renderCustomCodeBlock`-painted block lands
    // the caret at EXACTLY `absoluteStart` -- the custom chip has no
    // per-character layout data for the model to place a caret against, so
    // it falls back to the block's start offset. Typing there would insert
    // BEFORE the opening fence's backticks and corrupt the fence itself
    // (confirmed by an earlier version of this test: the block reparsed as
    // an ordinary paragraph). This test therefore navigates one line
    // FURTHER after entering -- onto the real "region body line 1" line,
    // now rendered as ordinary source text with normal per-character
    // layout -- before editing.
    await harness.page.click(`${selector} .md-document > .md-block:nth-child(1)`);
    await harness.page.keyboard.press("Home");
    let insideBlock = false;
    for (let attempt = 0; attempt < 10 && !insideBlock; attempt++) {
      await harness.page.keyboard.press("ArrowDown");
      await harness.page.waitForTimeout(30);
      const sel = await selectionOffsets();
      insideBlock =
        sel !== null &&
        sel !== undefined &&
        sel.active >= inactive.absoluteStart &&
        sel.active <= inactive.absoluteStart + inactive.length;
    }
    expect(insideBlock).toBe(true);

    const active = await block(1);
    expect(active.className).not.toContain("gpc-custom-chip");
    // Source-aware active rendering shows the real fenced-code source,
    // fence markers included -- not the custom label.
    expect(active.textContent).toContain("gutterpress-region");
    expect(active.textContent).toContain("region body line 1");
    expect(active.textContent).not.toContain("GP-REGION:");

    // Move one line further and to its end -- the exact, independently
    // computed `bodyLine1End` offset, now that the block is a normal
    // source-aware editable text region.
    await harness.page.keyboard.press("ArrowDown");
    await harness.page.waitForTimeout(30);
    await harness.page.keyboard.press("End");
    await harness.page.waitForTimeout(30);
    const preEditSel = await selectionOffsets();
    expect(preEditSel).not.toBeUndefined();
    expect(preEditSel!.active).toBe(bodyLine1End);

    // Edit while active: type a character and confirm it lands as a REAL,
    // exact-range host edit (D2/D3: an accepted rich-editor edit changes
    // only its explicit source range) -- not a synthesized whole-document
    // rewrite.
    await harness.page.keyboard.type("X");
    await harness.page.waitForTimeout(50);
    const editedHostText = await hostText();
    const expectedEditedText =
      originalHostText.slice(0, bodyLine1End) + "X" + originalHostText.slice(bodyLine1End);
    expect(editedHostText).toBe(expectedEditedText);
    expect(await hostVersion()).toBe(1);

    // Deactivate: move the caret back out to the leading block.
    await harness.page.click(`${selector} .md-document > .md-block:nth-child(1)`);
    await harness.page.waitForTimeout(50);

    const reInactive = await block(1);
    expect(reInactive.className).toContain("gpc-custom-chip");
    // Leaving the block does not itself change any bytes (no re-serialization
    // on deactivation) -- the host text is exactly what typing produced.
    expect(await hostText()).toBe(editedHostText);
    expect(await hostVersion()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Case 6 — selection mapping through projected content
// ---------------------------------------------------------------------------

describe("case 6 — selection mapping across the fenced-code projected block (inactive, custom-painted)", () => {
  test("Ctrl+Home / Shift+Ctrl+End selects the exact full document, including the custom-rendered block's real source range", async () => {
    const selector = await mount(CODE_BLOCK_PROBE_TEXT, { customCodeBlockChipLabel: "GP-REGION" });
    await requireBlockCount(3);

    await harness.page.click(`${selector} .md-document > .md-block:nth-child(2)`);
    await harness.page.keyboard.press("Control+Home");
    await harness.page.waitForTimeout(30);
    let sel = await selectionOffsets();
    expect(sel).toEqual({ anchor: 0, active: 0, start: 0, endExclusive: 0 });

    await harness.page.keyboard.press("Shift+Control+End");
    await harness.page.waitForTimeout(30);
    sel = await selectionOffsets();
    expect(sel).not.toBeUndefined();
    expect(sel!.anchor).toBe(0);
    expect(sel!.active).toBe(CODE_BLOCK_PROBE_TEXT.length);
    expect(sel!.start).toBe(0);
    expect(sel!.endExclusive).toBe(CODE_BLOCK_PROBE_TEXT.length);

    // "Copying it yields the exact source slice": the package's own
    // EditorController documents that copy/cut read the MODEL's selection,
    // not the browser's native DOM selection -- this is that exact read.
    expect(await sourceSlice(sel!.start, sel!.endExclusive)).toBe(CODE_BLOCK_PROBE_TEXT);
    expect(await hostText()).toBe(CODE_BLOCK_PROBE_TEXT);
  });

  test("Shift+ArrowDown from the end of the lead block extends the selection monotonically forward through the projected block's exact range", async () => {
    const selector = await mount(CODE_BLOCK_PROBE_TEXT, { customCodeBlockChipLabel: "GP-REGION" });
    await requireBlockCount(3);
    const leadBlock = await block(0);
    const codeBlock = await block(1);

    await harness.page.click(`${selector} .md-document > .md-block:nth-child(1)`);
    await harness.page.keyboard.press("End");
    await harness.page.waitForTimeout(30);
    const collapsed = await selectionOffsets();
    expect(collapsed).not.toBeUndefined();
    expect(collapsed!.start).toBe(collapsed!.endExclusive);
    const anchor = collapsed!.anchor;

    let reachedPastCodeBlock = false;
    let previousActive = collapsed!.active;
    for (let step = 0; step < 12 && !reachedPastCodeBlock; step++) {
      await harness.page.keyboard.press("Shift+ArrowDown");
      await harness.page.waitForTimeout(30);
      const sel = await selectionOffsets();
      expect(sel).not.toBeUndefined();
      // Selection mapping stays coherent: the anchor never moves, and the
      // active end only ever advances forward (never jumps back or goes
      // undefined) while crossing the projected block.
      expect(sel!.anchor).toBe(anchor);
      expect(sel!.active).toBeGreaterThanOrEqual(previousActive);
      previousActive = sel!.active;
      reachedPastCodeBlock = sel!.active >= codeBlock.absoluteStart + codeBlock.length;
    }
    expect(reachedPastCodeBlock).toBe(true);

    // The final selection's source slice fully contains the projected
    // block's own exact source text (fence markers included), proving the
    // crossing did not skip, truncate, or corrupt the custom-rendered
    // block's range even though its PAINTED form (the chip) bears no visual
    // resemblance to that source text.
    const finalSel = await selectionOffsets();
    const slice = await sourceSlice(finalSel!.start, finalSel!.endExclusive);
    expect(slice).toContain("```gutterpress-region");
    expect(slice).toContain("region body line 1");
    expect(slice).toContain("region body line 2");
    expect(finalSel!.start).toBeLessThanOrEqual(leadBlock.absoluteStart + leadBlock.length);
  });

  test("pointer drag from inside the lead block toward the trail block reaches into the projected block with a coherent, uncorrupted source mapping", async () => {
    const selector = await mount(CODE_BLOCK_PROBE_TEXT, { customCodeBlockChipLabel: "GP-REGION" });
    await requireBlockCount(3);
    const codeBlock = await block(1);

    const leadEl = harness.page.locator(`${selector} .md-document > .md-block:nth-child(1)`);
    const trailEl = harness.page.locator(`${selector} .md-document > .md-block:nth-child(3)`);
    const leadBox = await leadEl.boundingBox();
    const trailBox = await trailEl.boundingBox();
    expect(leadBox).not.toBeNull();
    expect(trailBox).not.toBeNull();

    await harness.page.mouse.move(leadBox!.x + 5, leadBox!.y + leadBox!.height / 2);
    await harness.page.mouse.down();
    await harness.page.mouse.move(trailBox!.x + 5, trailBox!.y + trailBox!.height / 2, {
      steps: 8,
    });
    await harness.page.mouse.up();
    await harness.page.waitForTimeout(50);

    const sel = await selectionOffsets();
    expect(sel).not.toBeUndefined();
    expect(sel!.start).toBeLessThan(sel!.endExclusive);
    expect(sel!.start).toBeLessThanOrEqual(codeBlock.absoluteStart);
    // EMPIRICAL FINDING (recorded in the decision record): unlike the
    // exact-offset keyboard tests above, a synthetic pointer drag ending
    // over the TRAIL block does not reliably extend the selection past the
    // custom-painted code block -- the observed `endExclusive` in this
    // sandbox landed inside the block's OWN real source range (e.g. mid
    // "region body line 1"), short of the block's end, let alone the trail
    // block. This is itself material evidence: hit-testing/dragging over a
    // `renderCustomCodeBlock`-painted block is materially less reliable
    // than over ordinary text, because the custom HTML carries none of the
    // model's per-character layout data the drag needs to map a pixel
    // position back to a source offset once inside it. The assertion below
    // is therefore intentionally weaker than the keyboard tests: it only
    // requires that the drag reached INTO the projected block, and that
    // wherever it landed, the resulting [start, endExclusive) is an EXACT,
    // uncorrupted, character-for-character match against the real source --
    // i.e. selection mapping stayed coherent even if imprecise.
    expect(sel!.endExclusive).toBeGreaterThan(codeBlock.absoluteStart);
    const slice = await sourceSlice(sel!.start, sel!.endExclusive);
    expect(slice).toBe(CODE_BLOCK_PROBE_TEXT.slice(sel!.start, sel!.endExclusive));
    expect(slice).toContain("```gutterpress-region");
  });
});

describe("case 6 — selection mapping across the plain paragraph-shaped probes (baseline, no custom rendering involved)", () => {
  test("Ctrl+Home / Shift+Ctrl+End selects the exact full document across both marker-shaped paragraphs", async () => {
    await mount(PARAGRAPH_PROBE_TEXT);
    await requireBlockCount(4);

    await harness.page.click(`.md-document > .md-block:nth-child(2)`);
    await harness.page.keyboard.press("Control+Home");
    await harness.page.keyboard.press("Shift+Control+End");
    await harness.page.waitForTimeout(30);

    const sel = await selectionOffsets();
    expect(sel).toEqual({
      anchor: 0,
      active: PARAGRAPH_PROBE_TEXT.length,
      start: 0,
      endExclusive: PARAGRAPH_PROBE_TEXT.length,
    });
    expect(await sourceSlice(0, PARAGRAPH_PROBE_TEXT.length)).toBe(PARAGRAPH_PROBE_TEXT);
  });
});

describe("harness liveness", () => {
  test("the shared session produced no console or page errors across every case above", () => {
    expect(harness.consoleErrors).toEqual([]);
    expect(harness.pageErrors).toEqual([]);
  });
});
