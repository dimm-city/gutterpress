import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  openHarnessSession,
  waitForHarnessReady,
  type HarnessSession,
} from "../browser-harness/index.ts";

/**
 * SFE-P3d-sweep Lane A — gap closure for scenario 4 ("create/edit table").
 *
 * AUDIT FINDING this file closes: `packages/editor/tests/standard/table.test.ts`
 * proves `insert-table` at the pure-command level (a `(snapshot, selection)
 * -> edit` function producing a rows x cols pipe skeleton) — it never mounts
 * a real editor. No test anywhere in the tree drove the real, pinned
 * `@vscode/markdown-editor` fork against an EXISTING pipe table and typed
 * into one of its cells. The fork's own type declarations
 * (`TableAstNode`/`TableRowAstNode`/`TableCellAstNode`, a dedicated
 * `_resolveTableCellOffset` hit-tester) show table CELL editing is a real,
 * built-out feature of the base editor, distinct from `insert-table`'s
 * skeleton-generation command — this file is the missing end-to-end proof
 * for that half.
 *
 * Reuses `tests/vscode-adapter/support/entry.ts`'s existing `window.__gp`
 * driver unmodified (same entry `browser.cases.btest.ts` uses) — no new
 * harness machinery, per the run's audit-first/no-new-machinery posture
 * (SFE-P3e's ruling: "prefer deleting cleverness to guarding it"). ONE
 * shared browser session for every case in this file (a fresh Chromium
 * launch per `test()` hangs in this sandbox — see `browser-harness/index.ts`'s
 * own header).
 *
 * Every offset below was measured against a REAL mount before being written
 * as an assertion (not hand-counted): Home reliably places the caret at the
 * TABLE ROW's own source start (proven live: typing after Home landed
 * exactly at `text.indexOf("| <row's first cell> ")`), and ArrowRight from
 * there advances linearly through the raw source — INCLUDING the hidden
 * pipe/glue characters the fork visually collapses (`.md-glue-hidden`) — one
 * character per press, with no skipping. This lets every case below compute
 * its expected edit offset with plain `String.prototype.indexOf` arithmetic,
 * the same pattern `gutterpress.btest.ts`'s "edit locality on the marker
 * line" suite already uses for marker text.
 *
 * AP-21 (liveness before behavior): the first case proves the table
 * genuinely rendered as a real `<table>` with header/delimiter/data rows
 * before any test relies on that structure for an editing assertion.
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
  await harness.page.evaluate((t) => window.__gp.mount(t), text);
  await harness.page.waitForTimeout(50);
  return harness.page.evaluate(() => window.__gp.containerSelector);
}

async function hostText(): Promise<string> {
  return harness.page.evaluate(() => window.__gp.getHostText());
}

async function hostVersion(): Promise<number> {
  return harness.page.evaluate(() => window.__gp.getHostVersion());
}

/** AP-21 liveness: the mounted container really rendered a `.md-document`
 *  with the expected text before any behavioral assertion proceeds — mirrors
 *  `browser.cases.btest.ts`'s own `requireDocumentText`. */
async function requireDocumentText(selector: string): Promise<string> {
  const text = await harness.page.evaluate(
    (sel: string) => document.querySelector(`${sel} .md-document`)?.textContent ?? null,
    selector,
  );
  expect(text).not.toBeNull();
  return text as string;
}

/**
 * A two-column, two-data-row pipe table flanked by ordinary paragraphs.
 * Every cell value is a short, unique run so an interior edit is
 * unambiguous to locate and assert against.
 */
const TABLE_SOURCE =
  "Intro paragraph.\n\n| H1 | H2 |\n| --- | --- |\n| AAA | BBB |\n| CCC | DDD |\n\nTrail paragraph.\n";

describe("live table rendering (AP-21 liveness for every case below)", () => {
  test("a pipe table mounts as a real <table> (header, delimiter, and both data rows), distinct from the surrounding paragraph blocks", async () => {
    const selector = await mount(TABLE_SOURCE);
    await requireDocumentText(selector);

    const info = await harness.page.evaluate((sel: string) => {
      const blocks = Array.from(document.querySelectorAll(`${sel} .md-document > .md-block`));
      const tableWrapper = blocks[1];
      return {
        blockCount: blocks.length,
        firstBlockTag: blocks[0]?.tagName,
        wrapperClassName: tableWrapper?.className ?? null,
        rowCount: tableWrapper?.querySelectorAll("table tr").length ?? 0,
        // `.textContent` on a real cell includes the fork's own hidden
        // pipe/space "glue" spans (`.md-glue-hidden`) alongside the real
        // content -- CSS visibility never removes text from `.textContent`
        // -- so each cell reads like "| H1 " rather than a bare "H1"
        // (measured live before writing this assertion). Joining every
        // cell's text and checking substring containment proves the real
        // content is present without depending on that glue formatting.
        allCellText: Array.from(tableWrapper?.querySelectorAll("td") ?? [])
          .map((td) => td.textContent)
          .join(" | "),
        lastBlockTag: blocks[2]?.tagName,
      };
    }, selector);

    expect(info.blockCount).toBe(3);
    expect(info.firstBlockTag).toBe("P");
    expect(info.lastBlockTag).toBe("P");
    // The table is its OWN block kind, not folded into a paragraph.
    expect(info.wrapperClassName).toContain("md-table-wrapper");
    // Header row + delimiter row + 2 data rows.
    expect(info.rowCount).toBe(4);
    expect(info.allCellText).toContain("H1");
    expect(info.allCellText).toContain("H2");
    expect(info.allCellText).toContain("AAA");
    expect(info.allCellText).toContain("BBB");
    expect(info.allCellText).toContain("CCC");
    expect(info.allCellText).toContain("DDD");
  });
});

describe("typing inside an EXISTING data cell", () => {
  test("a keystroke inside the second data row's first cell is a byte-exact interior edit; the header row, delimiter row, and every OTHER cell are untouched", async () => {
    const selector = await mount(TABLE_SOURCE);
    await requireDocumentText(selector);

    const rowStart = TABLE_SOURCE.indexOf("| CCC | DDD |");
    expect(rowStart).toBeGreaterThan(-1);
    const cccOffset = TABLE_SOURCE.indexOf("CCC");
    const withinRow = cccOffset - rowStart + 1; // lands between "C" and "CC"

    // Click anywhere in the target row (imprecise), then Home self-corrects
    // to the row's own source start (measured live -- see file header) so
    // the ArrowRight count below lands at a PRECISE, known offset regardless
    // of exactly where the click landed.
    await harness.page.click(`${selector} td:text("CCC")`);
    await harness.page.keyboard.press("Home");
    for (let i = 0; i < withinRow; i++) await harness.page.keyboard.press("ArrowRight");
    await harness.page.keyboard.type("X");
    await harness.page.waitForTimeout(50);

    const expectedOffset = rowStart + withinRow;
    const expectedText =
      TABLE_SOURCE.slice(0, expectedOffset) + "X" + TABLE_SOURCE.slice(expectedOffset);
    const after = await hostText();
    expect(after).toBe(expectedText);
    expect(after).toContain("CXCC"); // the edited cell, byte-exact
    expect(await hostVersion()).toBe(1);

    const edit = await harness.page.evaluate(() => window.__gp.lastSubmittedEdit());
    expect(edit).toEqual({ from: expectedOffset, to: expectedOffset, insert: "X", expectedVersion: 0 });

    // Every OTHER row is byte-identical to the original -- the pipe/dash
    // table structure itself was never touched by a cell-interior edit.
    expect(after).toContain("| H1 | H2 |\n");
    expect(after).toContain("| --- | --- |\n");
    expect(after).toContain("| AAA | BBB |\n");
  });
});

describe("typing inside a HEADER cell", () => {
  test("a keystroke inside the header row's second cell is likewise a byte-exact interior edit, distinguishing header-row editing from data-row editing", async () => {
    const selector = await mount(TABLE_SOURCE);
    await requireDocumentText(selector);

    const rowStart = TABLE_SOURCE.indexOf("| H1 | H2 |");
    expect(rowStart).toBeGreaterThan(-1);
    const h2Offset = TABLE_SOURCE.indexOf("H2");
    const withinRow = h2Offset - rowStart + 2; // lands right after "H2"

    await harness.page.click(`${selector} td:text("H2")`);
    await harness.page.keyboard.press("Home");
    for (let i = 0; i < withinRow; i++) await harness.page.keyboard.press("ArrowRight");
    await harness.page.keyboard.type("!");
    await harness.page.waitForTimeout(50);

    const expectedOffset = rowStart + withinRow;
    const expectedText =
      TABLE_SOURCE.slice(0, expectedOffset) + "!" + TABLE_SOURCE.slice(expectedOffset);
    const after = await hostText();
    expect(after).toBe(expectedText);
    expect(after).toContain("H2!");
    expect(await hostVersion()).toBe(1);

    // The delimiter row and both data rows survive byte-for-byte.
    expect(after).toContain("| --- | --- |\n");
    expect(after).toContain("| AAA | BBB |\n");
    expect(after).toContain("| CCC | DDD |\n");
  });
});

describe("harness liveness", () => {
  test("the shared session produced no console or page errors across every case above", () => {
    expect(harness.consoleErrors).toEqual([]);
    expect(harness.pageErrors).toEqual([]);
  });
});
