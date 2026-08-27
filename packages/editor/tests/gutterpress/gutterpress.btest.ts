import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { openHarnessSession, waitForHarnessReady, type HarnessSession } from "../browser-harness/index.ts";

/**
 * SFE-P2b Lane B — real-Chromium proofs that `mountGutterpressEditor` +
 * `createGutterpressBlockProvider` (`src/gutterpress/**`) actually work
 * against the real fork, driven by a REAL projection built from
 * `gutterpress/render`'s `createEditorProjection` (the SAME function
 * `src/gutterpress/support/entry.ts` calls in-page — this is the "browser
 * bundle bundles `gutterpress/render` cleanly" proof the run spec names).
 *
 * Reuses `tests/browser-harness` (`openHarnessSession`/`waitForHarnessReady`,
 * imported, never edited) and the P1b2 `fork-hook.btest.ts` patterns: ONE
 * shared browser session for every case in this file (a fresh Chromium
 * launch per `test()` was measured to hang in this sandbox — see that
 * harness module's own header), AP-21 liveness assertions (block/chip
 * counts) before every behavioral assertion, and real pointer/keyboard
 * input via Playwright.
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

// ---------------------------------------------------------------------------
// Fixture — chapter + page (-> a generated chapter-opener), an ordinary
// paragraph, a raw-html block carrying a script payload, and a trailing
// ordinary paragraph. Markers and the raw-html block are each surrounded by
// blank lines (the proven P1b2 fixture shape — see match.ts's header for why
// that matters: it keeps each marker/raw-html line its own single node in
// the fork's independent parser, matching editor-projection.ts's own
// single-line block convention).
// ---------------------------------------------------------------------------

/**
 * SFE-P2b Lane B repair round 1 (D13/AP-21): a document-order sequence of
 * `@page` markers whose NAME is unique per index -- unlike a repeated bare
 * "@page-break" line (the prior version of this fixture), no two of these
 * collide under `match.ts`'s fail-closed ambiguous-duplicate rule, so an
 * over-cap fixture's "zero chips" result below is caused ONLY by
 * `limited: true`, never by unrelated ambiguity suppression too --
 * `limited` stays the one isolated variable between the control and the
 * over-cap case.
 */
function pageMarkerSource(count: number): string {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) lines.push(`@page p${i}`);
  return lines.join("\n\n") + "\n";
}

const CHAPTER_LABEL = "C.01";
const GENERATED_CHAPTER_OPENER_HTML = `<div class="chapter-opener" data-chapter-label="${CHAPTER_LABEL}">${CHAPTER_LABEL}</div>\n`;

const FIXTURE_SOURCE =
  [
    `@chapter ${CHAPTER_LABEL}`,
    "",
    "@page splash",
    "",
    "Intro paragraph.",
    "",
    "<script>window.__gpcScriptRan = true;</script>",
    "",
    "Trail text.",
  ].join("\n") + "\n";

// Block order in FIXTURE_SOURCE: 0 chapter, 1 page, 2 intro paragraph,
// 3 raw-html (script), 4 trail paragraph. Chips: 0 chapter, 1 page (+
// generated preview), 2 raw-html.
const TOTAL_BLOCK_COUNT = 5;
const TOTAL_CHIP_COUNT = 3;
const INTRO_BLOCK_INDEX = 2;
const TRAIL_BLOCK_INDEX = 4;
const PAGE_CHIP_INDEX = 1;
const RAW_HTML_CHIP_INDEX = 2;

async function mount(text: string): Promise<string> {
  const result = await harness.page.evaluate((t) => window.__gpGutterpress.mount(t), text);
  await harness.page.waitForTimeout(50);
  return result.containerSelector;
}

async function mountStale(text: string): Promise<string> {
  const result = await harness.page.evaluate((t) => window.__gpGutterpress.mountStale(t), text);
  await harness.page.waitForTimeout(50);
  return result.containerSelector;
}

async function blockCount(): Promise<number> {
  return harness.page.evaluate(() => window.__gpGutterpress.blockCount());
}
async function blockClassName(index: number): Promise<string> {
  return harness.page.evaluate((i) => window.__gpGutterpress.blockClassName(i), index);
}
async function chipCount(): Promise<number> {
  return harness.page.evaluate(() => window.__gpGutterpress.chipCount());
}
async function chipInfo(index: number) {
  return harness.page.evaluate((i) => window.__gpGutterpress.chipInfo(i), index);
}
async function chipOuterHTML(index: number): Promise<string> {
  return harness.page.evaluate((i) => window.__gpGutterpress.chipOuterHTML(i), index);
}
async function segmentCharacterCenter(chipIndex: number, charIndex: number) {
  return harness.page.evaluate(
    ({ c, ch }) => window.__gpGutterpress.segmentCharacterCenter(c, ch),
    { c: chipIndex, ch: charIndex },
  );
}
async function generatedPreviewAcceptsFocus(chipIndex: number): Promise<boolean> {
  return harness.page.evaluate((c) => window.__gpGutterpress.generatedPreviewAcceptsFocus(c), chipIndex);
}
async function generatedPreviewText(chipIndex: number): Promise<string | undefined> {
  return harness.page.evaluate((c) => window.__gpGutterpress.generatedPreviewText(c), chipIndex);
}
async function hostText(): Promise<string> {
  return harness.page.evaluate(() => window.__gpGutterpress.getHostText());
}
async function hostVersion(): Promise<number> {
  return harness.page.evaluate(() => window.__gpGutterpress.getHostVersion());
}
async function needsRefresh(): Promise<boolean> {
  return harness.page.evaluate(() => window.__gpGutterpress.needsRefresh());
}
async function scriptRan(): Promise<boolean> {
  return harness.page.evaluate(() => window.__gpcScriptRan === true);
}

/** AP-21 liveness: the mounted container really has the expected block/chip counts before any behavioral assertion proceeds. */
async function requireCounts(blocks: number, chips: number): Promise<void> {
  expect(await blockCount()).toBe(blocks);
  expect(await chipCount()).toBe(chips);
}

// ---------------------------------------------------------------------------
// Structure and content
// ---------------------------------------------------------------------------

describe("mounted structure", () => {
  test("5 blocks, 3 chips, in document order, with the expected kinds", async () => {
    await mount(FIXTURE_SOURCE);
    await requireCounts(TOTAL_BLOCK_COUNT, TOTAL_CHIP_COUNT);

    const chapter = await chipInfo(0);
    expect(chapter.gpBlockKind).toBe("chapter");
    const page = await chipInfo(1);
    expect(page.gpBlockKind).toBe("page");
    const rawHtml = await chipInfo(2);
    expect(rawHtml.gpBlockKind).toBe("raw-html");
  });

  test("ordinary paragraphs (Intro / Trail) are NOT chips -- the hook does not paint blocks outside the projection", async () => {
    await mount(FIXTURE_SOURCE);
    await requireCounts(TOTAL_BLOCK_COUNT, TOTAL_CHIP_COUNT);

    const intro = await blockClassName(INTRO_BLOCK_INDEX);
    expect(intro).not.toContain("gp-block-chip");
    const trail = await blockClassName(TRAIL_BLOCK_INDEX);
    expect(trail).not.toContain("gp-block-chip");
  });

  test("the chapter and page chips show their kind label and their exact marker source text, plus md-block", async () => {
    await mount(FIXTURE_SOURCE);
    await requireCounts(TOTAL_BLOCK_COUNT, TOTAL_CHIP_COUNT);

    const chapter = await chipInfo(0);
    expect(chapter.className).toContain("md-block");
    expect(chapter.className).toContain("gp-block-chip--chapter");
    expect(chapter.textContent).toContain("chapter");
    expect(chapter.textContent).toContain(`@chapter ${CHAPTER_LABEL}`);

    const page = await chipInfo(PAGE_CHIP_INDEX);
    expect(page.className).toContain("gp-block-chip--page");
    expect(page.textContent).toContain("@page splash");
  });
});

// ---------------------------------------------------------------------------
// Generated view -- in-chip preview, read-only, no focus, exact HTML
// ---------------------------------------------------------------------------

describe("generated chapter-opener preview", () => {
  test("is visible in-chip on the page marker, exactly matches the pipeline's own generated HTML, and is not focusable", async () => {
    await mount(FIXTURE_SOURCE);
    await requireCounts(TOTAL_BLOCK_COUNT, TOTAL_CHIP_COUNT);

    const previewText = await generatedPreviewText(PAGE_CHIP_INDEX);
    expect(previewText).toBe(GENERATED_CHAPTER_OPENER_HTML);

    // Read-only / no writable range at all: focusing it directly must be a
    // no-op (it carries no tabindex/contenteditable -- an ordinary <pre>).
    expect(await generatedPreviewAcceptsFocus(PAGE_CHIP_INDEX)).toBe(false);

    // Typing while it "has focus" cannot reach the document: since it never
    // actually gains focus (checked above), the host text is unaffected by
    // typing immediately afterward.
    const before = await hostText();
    await harness.page.keyboard.type("Z");
    await harness.page.waitForTimeout(30);
    expect(await hostText()).toBe(before);
  });

  test("the chapter chip itself has NO generated preview (only the page marker anchors one)", async () => {
    await mount(FIXTURE_SOURCE);
    await requireCounts(TOTAL_BLOCK_COUNT, TOTAL_CHIP_COUNT);
    expect(await generatedPreviewText(0)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Raw HTML -- inert text, script never executes
// ---------------------------------------------------------------------------

describe("raw-html chip", () => {
  test("renders as an inert source preview (the <script> tag is literal text) and never executes", async () => {
    await mount(FIXTURE_SOURCE);
    await requireCounts(TOTAL_BLOCK_COUNT, TOTAL_CHIP_COUNT);

    const info = await chipInfo(RAW_HTML_CHIP_INDEX);
    expect(info.textContent).toContain("<script>window.__gpcScriptRan = true;</script>");

    // Serialized outerHTML must show the tag ESCAPED (proof it was written
    // via textContent, never innerHTML/parsed markup).
    const outer = await chipOuterHTML(RAW_HTML_CHIP_INDEX);
    expect(outer).toContain("&lt;script&gt;");
    expect(outer).not.toMatch(/<script>window/);

    expect(await scriptRan()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Two-state: caret precision, activation, deactivation restores the chip
// (no edit involved -- see the separate "staleness after an edit" suite for
// why an edited block's chip is NOT expected to reappear on its own).
// ---------------------------------------------------------------------------

describe("two-state: activation, deactivation restores the chip with zero drift", () => {
  test("clicking a segment activates the block (chip replaced by real source); merely clicking does not edit; clicking away restores the exact same chip", async () => {
    const selector = await mount(FIXTURE_SOURCE);
    await requireCounts(TOTAL_BLOCK_COUNT, TOTAL_CHIP_COUNT);

    const originalHostText = await hostText();
    const originalVersion = await hostVersion();

    const pt = await segmentCharacterCenter(PAGE_CHIP_INDEX, 6);
    await harness.page.mouse.click(pt.x, pt.y);
    await harness.page.waitForTimeout(50);

    // Active: the chip is gone, real source shown.
    await requireCounts(TOTAL_BLOCK_COUNT, TOTAL_CHIP_COUNT - 1);
    const activeClassName = await blockClassName(PAGE_CHIP_INDEX);
    expect(activeClassName).not.toContain("gp-block-chip");
    expect(activeClassName).toContain("md-block-active");

    // No edit happened from merely clicking -- host is untouched.
    expect(await hostText()).toBe(originalHostText);
    expect(await hostVersion()).toBe(originalVersion);

    // Deactivate: click the intro paragraph instead.
    await harness.page.click(`${selector} .md-document > .md-block:nth-child(${INTRO_BLOCK_INDEX + 1})`);
    await harness.page.waitForTimeout(50);

    await requireCounts(TOTAL_BLOCK_COUNT, TOTAL_CHIP_COUNT);
    const restored = await chipInfo(PAGE_CHIP_INDEX);
    expect(restored.className).toContain("gp-block-chip");
    expect(restored.textContent).toContain("@page splash");
    // Zero drift: still the exact original text/version.
    expect(await hostText()).toBe(originalHostText);
    expect(await hostVersion()).toBe(originalVersion);
  });
});

// ---------------------------------------------------------------------------
// Edit locality on the marker line, and the resulting staleness (G-11)
// ---------------------------------------------------------------------------

describe("edit locality on the marker line, then G-11 staleness once the host version moves past the projection", () => {
  test.each([
    [1, "@pXage splash"],
    [6, "@page sXplash"],
  ])(
    "clicking segment index %i then typing lands a byte-exact interior edit producing %s (caret precision: different click targets produce correspondingly different edits)",
    async (charIndex, expectedSubstring) => {
      await mount(FIXTURE_SOURCE);
      await requireCounts(TOTAL_BLOCK_COUNT, TOTAL_CHIP_COUNT);
      const originalHostText = await hostText();

      const pt = await segmentCharacterCenter(PAGE_CHIP_INDEX, charIndex);
      await harness.page.mouse.click(pt.x, pt.y);
      await harness.page.waitForTimeout(50);
      await harness.page.keyboard.type("X");
      await harness.page.waitForTimeout(50);

      const markerStart = originalHostText.indexOf("@page splash");
      const interiorOffset = markerStart + charIndex + 1;
      const expectedEditedText =
        originalHostText.slice(0, interiorOffset) + "X" + originalHostText.slice(interiorOffset);
      expect(await hostText()).toBe(expectedEditedText);
      expect(await hostText()).toContain(expectedSubstring);
      expect(await hostVersion()).toBe(1);
    },
  );

  test("afterward needsRefresh() is true and the edited block's chip does not reappear", async () => {
    const selector = await mount(FIXTURE_SOURCE);
    await requireCounts(TOTAL_BLOCK_COUNT, TOTAL_CHIP_COUNT);
    const originalHostText = await hostText();
    expect(await needsRefresh()).toBe(false);

    const pt = await segmentCharacterCenter(PAGE_CHIP_INDEX, 6);
    await harness.page.mouse.click(pt.x, pt.y);
    await harness.page.waitForTimeout(50);

    await harness.page.keyboard.type("X");
    await harness.page.waitForTimeout(50);

    // Byte-exact interior edit: "@page s" + "X" + "plash...".
    const interiorOffset = originalHostText.indexOf("splash") + 1;
    const expectedEditedText =
      originalHostText.slice(0, interiorOffset) + "X" + originalHostText.slice(interiorOffset);
    expect(await hostText()).toBe(expectedEditedText);
    expect(await hostText()).toContain("@page sXplash");
    expect(await hostVersion()).toBe(1);

    // G-11: the mounted projection's sourceVersion (0) is now behind the
    // live host version (1).
    expect(await needsRefresh()).toBe(true);

    // Deactivate: click the trailing paragraph.
    await harness.page.click(`${selector} .md-document > .md-block:nth-child(${TRAIL_BLOCK_INDEX + 1})`);
    await harness.page.waitForTimeout(50);

    // The just-edited block does NOT get its chip back -- the provider
    // fell through to the fork's default rendering for it (never a stale
    // chip). Other, UNCHANGED blocks may or may not still show chips
    // (whether they get re-consulted at all is the fork's own canReuse
    // call, out of this module's control either way) -- what this test
    // pins is specifically that the EDITED block never shows a chip again.
    const editedBlockClassName = await blockClassName(PAGE_CHIP_INDEX);
    expect(editedBlockClassName).not.toContain("gp-block-chip");
  });
});

// ---------------------------------------------------------------------------
// Stale projection at mount time -- default rendering, no chips, anywhere
// ---------------------------------------------------------------------------

describe("stale projection at mount time", () => {
  test("mountStale never renders a single chip -- every block falls through to default rendering", async () => {
    await mount("warm-up so mountStale's own liveness check below is meaningful");
    await mountStale(FIXTURE_SOURCE);
    await requireCounts(TOTAL_BLOCK_COUNT, 0);
    expect(await needsRefresh()).toBe(true);

    // The raw <script> text is still present as ordinary (unhandled-block)
    // content -- and still never executes, even without the gp chip
    // wrapping it, since this module never uses innerHTML anywhere.
    expect(await scriptRan()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D13 -- a `limited: true` projection (block-count cap) is stale-equivalent
// end to end, through the REAL mountGutterpressEditor path (closes the
// integration item Lane C's limits.btest.ts flagged for this module).
// ---------------------------------------------------------------------------

describe("D13: a limited: true projection renders no chips, even at a matching sourceVersion", () => {
  test("control: a SMALL, NOT-limited projection built from the same generator renders a real chip per block -- proves the over-cap case's zero chips below is not a vacuous/broken hook", async () => {
    const smallSource = pageMarkerSource(5);
    await mount(smallSource);
    await requireCounts(5, 5);
    expect(await needsRefresh()).toBe(false);
  });

  test("10,001 uniquely-named @page markers (one past MAX_PROJECTED_BLOCKS) produce a limited projection; mounting it (sourceVersion still matches the host) shows real block coverage but zero chips, and needsRefresh() is true", async () => {
    const bigSource = pageMarkerSource(10_001);
    await mount(bigSource);
    // AP-21 liveness: the mount really rendered the full oversized document
    // (not a silent bail-out) before the fail-closed chip-count assertion
    // below is meaningful.
    await requireCounts(10_001, 0);
    expect(await needsRefresh()).toBe(true);
  }, 60_000);
});

describe("harness liveness", () => {
  test("no console or page errors across every case above", () => {
    expect(harness.consoleErrors).toEqual([]);
    expect(harness.pageErrors).toEqual([]);
  });
});
