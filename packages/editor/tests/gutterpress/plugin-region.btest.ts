import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { openHarnessSession, waitForHarnessReady, type HarnessSession } from "../browser-harness/index.ts";

/**
 * SFE-P2c Lane C — real-Chromium proofs that `mountGutterpressEditor` +
 * `createGutterpressBlockProvider` (`src/gutterpress/**`) render the
 * `"plugin-region"` kind (P2b reserved it; this run makes it real) against
 * the real fork, driven by a REAL projection built from a plugin-applied
 * `md` + `trusted: true` (`support/plugin-entry.ts`, this suite's own
 * driver — a sibling of `gutterpress.btest.ts`'s `support/entry.ts`, kept
 * separate so that file's already-approved fixtures are never touched).
 *
 * VERIFY, NOT ASSUME (the run spec's own instruction): every case below
 * exercises the PRODUCTION `src/gutterpress/{plan,render-chip,match,
 * provider,mount}.ts` unmodified for this kind — see those modules' own
 * "PLUGIN-REGION (SFE-P2c)" header sections for why zero code change was
 * needed and what this suite proves live in place of a second code path.
 *
 * Reuses `tests/browser-harness` and `gutterpress.btest.ts`'s own proven
 * patterns: ONE shared browser session for every case (a fresh Chromium
 * launch per `test()` was measured to hang in this sandbox), AP-21
 * liveness assertions (`requireCounts`) before every behavioral assertion,
 * and the P1b2 `fork-hook.btest.ts` "bare-dom fallback" interaction
 * sequence (click a NEIGHBORING plain block, `Home`, `ArrowDown` to enter
 * the target block precisely at its own `absoluteStart`) for the
 * non-segmented plugin-region chip — `editMode: "source"` gives it no
 * per-character segments, the same as raw-html, so this is the proven
 * pattern for THIS shape, not the per-character `segmentCharacterCenter`
 * mouse-click pattern `gutterpress.btest.ts` uses for segmented marker
 * chips.
 */

const entryPath = resolve(import.meta.dir, "support/plugin-entry.ts");

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

// ---------------------------------------------------------------------------
// Fixture — an ordinary paragraph, an `@@aside` project-plugin marker whose
// own label payload embeds a <script> tag (both in its consumed source AND
// in the view attribute the plugin attaches), and a trailing paragraph.
// Shaped identically to fork-hook.btest.ts's own proven
// PARAGRAPH_CHIP_PROBE_TEXT ("Lead text." / marker / "Trail text.") so the
// SAME already-verified bare-dom-fallback interaction sequence applies here
// with no new assumptions about click/caret behavior.
// ---------------------------------------------------------------------------

const SCRIPT_PAYLOAD = "<script>window.__gpPluginScriptRan = true;</script>";
const ASIDE_LINE = `@@aside ${SCRIPT_PAYLOAD}`;
const FIXTURE_SOURCE = ["Lead text.", "", ASIDE_LINE, "", "Trail text."].join("\n");

// Block order in FIXTURE_SOURCE: 0 "Lead text." (ordinary, unprojected),
// 1 the @@aside plugin-region, 2 "Trail text." (ordinary, unprojected).
const TOTAL_BLOCK_COUNT = 3;
const ASIDE_BLOCK_INDEX = 1;
const TRAIL_BLOCK_INDEX = 2;
// Char offset of the aside line's own start -- "Lead text." (10) + "\n\n" (2).
const MARKER_START = 12;

async function mount(text: string, keepEvidence: boolean): Promise<string> {
  const result = await harness.page.evaluate(
    ({ t, k }) => window.__gpGutterpressPlugin.mount(t, k),
    { t: text, k: keepEvidence },
  );
  await harness.page.waitForTimeout(50);
  return result.containerSelector;
}

async function blockCount(): Promise<number> {
  return harness.page.evaluate(() => window.__gpGutterpressPlugin.blockCount());
}
async function blockClassName(index: number): Promise<string> {
  return harness.page.evaluate((i) => window.__gpGutterpressPlugin.blockClassName(i), index);
}
async function blockTextContent(index: number): Promise<string> {
  return harness.page.evaluate((i) => window.__gpGutterpressPlugin.blockTextContent(i), index);
}
async function chipCount(): Promise<number> {
  return harness.page.evaluate(() => window.__gpGutterpressPlugin.chipCount());
}
async function chipInfo(index: number) {
  return harness.page.evaluate((i) => window.__gpGutterpressPlugin.chipInfo(i), index);
}
async function chipOuterHTML(index: number): Promise<string> {
  return harness.page.evaluate((i) => window.__gpGutterpressPlugin.chipOuterHTML(i), index);
}
async function hostText(): Promise<string> {
  return harness.page.evaluate(() => window.__gpGutterpressPlugin.getHostText());
}
async function hostVersion(): Promise<number> {
  return harness.page.evaluate(() => window.__gpGutterpressPlugin.getHostVersion());
}
async function scriptRan(): Promise<boolean> {
  return harness.page.evaluate(() => window.__gpPluginScriptRan === true);
}

/** AP-21 liveness: the mounted container really has the expected block/chip counts before any behavioral assertion proceeds. */
async function requireCounts(blocks: number, chips: number): Promise<void> {
  expect(await blockCount()).toBe(blocks);
  expect(await chipCount()).toBe(chips);
}

/** Enters `ASIDE_BLOCK_INDEX` via the proven bare-dom-fallback sequence: click the PRECEDING plain block, Home, ArrowDown -- lands caret exactly at the target block's own start (fork-hook.btest.ts case 5, re-verified live here for this module's own chip). */
async function enterAsideBlock(selector: string): Promise<void> {
  await harness.page.click(`${selector} .md-document > .md-block:nth-child(1)`);
  await harness.page.keyboard.press("Home");
  await harness.page.keyboard.press("ArrowDown");
  await harness.page.waitForTimeout(50);
}

// ---------------------------------------------------------------------------
// Inactive view: chip renders with its own attributes
// ---------------------------------------------------------------------------

describe("evidence-bearing plugin-region: inactive view", () => {
  test("renders exactly one chip, in document order, carrying its kind, exact source, md-block, and view attributes", async () => {
    await mount(FIXTURE_SOURCE, true);
    await requireCounts(TOTAL_BLOCK_COUNT, 1);

    const lead = await blockClassName(0);
    expect(lead).not.toContain("gp-block-chip");
    const trail = await blockClassName(TRAIL_BLOCK_INDEX);
    expect(trail).not.toContain("gp-block-chip");

    const chip = await chipInfo(0);
    expect(chip.gpBlockKind).toBe("plugin-region");
    expect(chip.className).toContain("md-block");
    expect(chip.className).toContain("gp-block-chip");
    expect(chip.className).toContain("gp-block-chip--plugin-region");
    expect(chip.textContent).toContain("plugin-region");
    // Exact consumed source, byte-for-byte -- the "plugin's own produced
    // HTML" this run's projection actually supplies for this kind is its
    // own AUTHORED SOURCE (see plan.ts's "PLUGIN-REGION (SFE-P2c)" header
    // section): no inactiveHtml field, so this IS the rendered content.
    expect(chip.textContent).toContain(ASIDE_LINE);
    // Safe view attribute carried onto the chip (AP-06).
    expect(chip.textContent).toContain(`data-aside-label="${SCRIPT_PAYLOAD}"`);
  });
});

// ---------------------------------------------------------------------------
// Script payload never executes -- inert by construction (textContent only)
// ---------------------------------------------------------------------------

describe("plugin-region chip: a <script> payload in both source text and a view attribute never executes", () => {
  test("the payload renders as literal, escaped text and window.__gpPluginScriptRan stays false", async () => {
    await mount(FIXTURE_SOURCE, true);
    await requireCounts(TOTAL_BLOCK_COUNT, 1);

    expect(await scriptRan()).toBe(false);

    // Serialized outerHTML must show the tag ESCAPED (proof it was written
    // via textContent, never innerHTML/parsed markup) -- both occurrences
    // (source preview AND the attribute badge).
    const outer = await chipOuterHTML(0);
    expect(outer).toContain("&lt;script&gt;");
    expect(outer).not.toMatch(/<script>window/);

    // Typing immediately afterward cannot reach a poisoned global either.
    await harness.page.keyboard.type("Z");
    await harness.page.waitForTimeout(30);
    expect(await scriptRan()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Active view: caret entry reveals exact source; edit is byte-exact;
// deactivation restores with zero drift (no edit in this describe block).
// ---------------------------------------------------------------------------

describe("two-state: activation, deactivation restores the chip with zero drift", () => {
  test("entering the block via the proven bare-dom sequence shows the real source (chip gone); leaving without editing restores the exact same chip", async () => {
    const selector = await mount(FIXTURE_SOURCE, true);
    await requireCounts(TOTAL_BLOCK_COUNT, 1);

    const originalHostText = await hostText();
    const originalVersion = await hostVersion();

    await enterAsideBlock(selector);

    // Active: the chip is gone, real source shown.
    await requireCounts(TOTAL_BLOCK_COUNT, 0);
    const activeClassName = await blockClassName(ASIDE_BLOCK_INDEX);
    expect(activeClassName).not.toContain("gp-block-chip");
    const activeText = await blockTextContent(ASIDE_BLOCK_INDEX);
    expect(activeText).toContain(ASIDE_LINE);

    // No edit happened from entering the block -- host is untouched.
    expect(await hostText()).toBe(originalHostText);
    expect(await hostVersion()).toBe(originalVersion);

    // Deactivate: click the trailing paragraph.
    await harness.page.click(`${selector} .md-document > .md-block:nth-child(${TRAIL_BLOCK_INDEX + 1})`);
    await harness.page.waitForTimeout(50);

    await requireCounts(TOTAL_BLOCK_COUNT, 1);
    const restored = await chipInfo(0);
    expect(restored.className).toContain("gp-block-chip");
    expect(restored.textContent).toContain(ASIDE_LINE);
    // Zero drift: still the exact original text/version.
    expect(await hostText()).toBe(originalHostText);
    expect(await hostVersion()).toBe(originalVersion);
  });
});

describe("edit locality: caret entry lands at the block's own start; typing is a byte-exact prepend", () => {
  test("typing immediately after entering the block prepends exactly one character at the block's own start offset, nothing else moves", async () => {
    const selector = await mount(FIXTURE_SOURCE, true);
    await requireCounts(TOTAL_BLOCK_COUNT, 1);
    const originalHostText = await hostText();
    expect(originalHostText.indexOf(ASIDE_LINE)).toBe(MARKER_START);

    await enterAsideBlock(selector);
    await harness.page.keyboard.type("X");
    await harness.page.waitForTimeout(50);

    const expectedEditedText =
      originalHostText.slice(0, MARKER_START) + "X" + originalHostText.slice(MARKER_START);
    expect(await hostText()).toBe(expectedEditedText);
    expect(await hostText()).toContain(`X${ASIDE_LINE}`);
    expect(await hostVersion()).toBe(1);

    // Leave the block: the just-edited block does NOT get its chip back --
    // the provider fell through to the fork's own default rendering for it
    // (G-11: the mounted projection's sourceVersion is now behind the live
    // host version), matching gutterpress.btest.ts's identical proof for
    // the marker-family kind.
    await harness.page.click(`${selector} .md-document > .md-block:nth-child(${TRAIL_BLOCK_INDEX + 1})`);
    await harness.page.waitForTimeout(50);
    const editedBlockClassName = await blockClassName(ASIDE_BLOCK_INDEX);
    expect(editedBlockClassName).not.toContain("gp-block-chip");
  });
});

// ---------------------------------------------------------------------------
// Refused region: no chip, plain source editing, document stays editable.
// ---------------------------------------------------------------------------

describe("refused plugin-region (no source-range evidence): no chip anywhere, stays fully editable", () => {
  test("the SAME source, mounted with the no-evidence plugin variant, renders zero chips -- contrast with the evidence-bearing case above proves this is the refusal, not a broken mount", async () => {
    await mount(FIXTURE_SOURCE, false);
    await requireCounts(TOTAL_BLOCK_COUNT, 0);

    // The refused block still renders its own real text -- never silently
    // dropped, never a guessed writable range, just plain unprojected
    // content (never a chip-shaped affordance either -- see match.ts's
    // "REFUSED PLUGIN REGIONS (SFE-P2c)" header section for the decision
    // record).
    const asideText = await blockTextContent(ASIDE_BLOCK_INDEX);
    expect(asideText).toContain(ASIDE_LINE);
    const asideClassName = await blockClassName(ASIDE_BLOCK_INDEX);
    expect(asideClassName).not.toContain("gp-block-chip");
  });

  test("the refused span stays directly, plainly editable -- a real keystroke reaches the host with no activation step", async () => {
    const selector = await mount(FIXTURE_SOURCE, false);
    await requireCounts(TOTAL_BLOCK_COUNT, 0);
    const originalHostText = await hostText();
    expect(originalHostText).toBe(FIXTURE_SOURCE);

    // No "activate a chip" step needed -- there is no chip to begin with;
    // the SAME bare-dom-fallback navigation sequence still works here
    // because it is a plain, ordinary block, not because of any
    // chip-specific mechanism.
    await enterAsideBlock(selector);
    await harness.page.keyboard.type("X");
    await harness.page.waitForTimeout(50);

    const expectedEditedText =
      originalHostText.slice(0, MARKER_START) + "X" + originalHostText.slice(MARKER_START);
    expect(await hostText()).toBe(expectedEditedText);
    expect(await hostVersion()).toBe(1);
    expect(await chipCount()).toBe(0);
    expect(await scriptRan()).toBe(false);
  });
});

describe("harness liveness", () => {
  test("no console or page errors across every case above", () => {
    expect(harness.consoleErrors).toEqual([]);
    expect(harness.pageErrors).toEqual([]);
  });
});
