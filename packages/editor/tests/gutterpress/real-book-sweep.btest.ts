import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openHarnessSession, waitForHarnessReady, type HarnessSession } from "../browser-harness/index.ts";

/**
 * T1 - the real-Chromium no-edit sweep over every example-book chapter.
 *
 * `packages/desktop/tests/editor/real-book-byte-identity.test.ts` proves the
 * session/projection half of "real chapters round-trip with zero byte
 * drift" under happy-dom, and its own header names the gap it cannot close
 * there: the real `@vscode/markdown-editor` fork needs a real browser
 * (`EditContext`), so real chapters had never been MOUNTED in one. This
 * file closes that gap. Same corpus (the 25 files that test enumerates,
 * re-enumerated here so this file is legible evidence on its own), plus the
 * desktop's plugin-book fixture, each mounted through the real
 * `mountGutterpressEditor` in real Chromium via `tests/gutterpress/support/
 * entry.ts`, then read back byte-for-byte.
 *
 * Per file: reload the harness page (a fresh module state - both reviewers
 * measured scroll/state leaking across mounts in one session, and with a
 * reload the sweep was 30/30 twice), mount, assert the host still holds the
 * file's exact bytes at version 0, pin the chip count (>0 for marker or
 * raw-HTML bearing chapters, exactly 0 for the plain-prose contrast cases),
 * open the first marker chip by clicking its margin tag, click an adjacent
 * plain block to close it again, assert the chip is restored and nothing
 * was written, dispose, and assert once more.
 *
 * PLUGIN-BLIND: the driver builds the plugin-free projection
 * (`createEditorProjection` with no plugin wiring), so the plugin-book's
 * `@@callout` lines are ordinary paragraphs here, not chips. Those files
 * are labelled `plugin-blind` and assert BYTES, not callout chips - the
 * plugin-aware projection is `packages/desktop`'s host-side pipeline and is
 * covered by that package's `real-book-plugin-*.test.ts` files.
 *
 * Images: chapters link `assets/...` images the harness server does not
 * serve. A request for any image extension is answered with a 1x1 PNG so a
 * 404 can never surface as a console error and fail the liveness case for a
 * reason unrelated to the editor.
 */

const entryPath = resolve(import.meta.dir, "support/entry.ts");
const EXAMPLES_ROOT = resolve(import.meta.dir, "../../../../examples");
const PLUGIN_BOOK_ROOT = resolve(import.meta.dir, "../../../desktop/tests/fixtures/plugin-book");

interface SweepFile {
  readonly id: string;
  readonly path: string;
  /** "some": at least one chip expected; "none": exactly zero (plain prose). */
  readonly chips: "some" | "none";
  readonly pluginBlind?: true;
}

function filesOf(root: string, corpus: string, dir: string, files: readonly string[], chips: "some" | "none", pluginBlind?: true): SweepFile[] {
  return files.map((f) => ({ id: `${corpus}/${f}`, path: resolve(root, dir, f), chips, ...(pluginBlind ? { pluginBlind } : {}) }));
}

/** The exact corpus - enumerated, not readdir'd, so it cannot silently pick up manifests or styles. */
const SWEEP_FILES: readonly SweepFile[] = [
  ...filesOf(EXAMPLES_ROOT, "gutterpress-user-guide", "gutterpress-user-guide", [
    "00-cover.md",
    "00-toc.md",
    "01-getting-started.md",
    "02-writing-content.md",
    "03-visual-elements.md",
    "04-styling-theming.md",
    "05-plugins.md",
    "06-validation.md",
    "07-system-setup.md",
    "08-publishing.md",
  ], "some"),
  ...filesOf(EXAMPLES_ROOT, "gutterpress-user-guide", "gutterpress-user-guide", ["README.md"], "none"),
  ...filesOf(EXAMPLES_ROOT, "with-design-guide/design-guide", "with-design-guide/design-guide", [
    "00-toc.md",
    "00-overview.md",
    "01-typography.md",
    "02-palette.md",
    "03-components.md",
    "04-page-templates.md",
    "05-layout.md",
    "06-markdown-reference.md",
    "101-publishing.md",
  ], "some"),
  ...filesOf(EXAMPLES_ROOT, "with-design-guide/book-01", "with-design-guide/book-01", ["chapter-01.md"], "none"),
  ...filesOf(EXAMPLES_ROOT, "with-design-guide/book-02", "with-design-guide/book-02", ["chapter-01.md"], "none"),
  ...filesOf(EXAMPLES_ROOT, "with-validation", "with-validation", ["README.md", "chapter-01.md", "chapter-02.md"], "none"),
  ...filesOf(PLUGIN_BOOK_ROOT, "plugin-book (plugin-blind)", ".", ["01-introduction.md", "02-field-notes.md"], "some", true),
  ...filesOf(PLUGIN_BOOK_ROOT, "plugin-book (plugin-blind)", ".", ["03-checklist.md"], "none", true),
];
const EXAMPLE_FILE_COUNT = 25;
const PLUGIN_BOOK_FILE_COUNT = 3;

/** `readFileSync` is the only operation this file ever performs on a fixture (AP-25). */
const LOADED = SWEEP_FILES.map((f) => ({ ...f, bytes: readFileSync(f.path) }));

/** A 1x1 transparent PNG - the answer to every image request (see the header). */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let harness: HarnessSession;
let closeHarness: () => Promise<void>;

beforeAll(async () => {
  const opened = await openHarnessSession(entryPath);
  harness = opened.session;
  closeHarness = opened.close;
  await harness.page.route(/\.(png|jpe?g|gif|svg|webp|avif)(\?.*)?$/i, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 }),
  );
  await waitForHarnessReady(harness.page);
}, 30_000);

afterAll(async () => {
  await closeHarness();
});

const hostText = () => harness.page.evaluate(() => window.__gpGutterpress.getHostText());
const hostVersion = () => harness.page.evaluate(() => window.__gpGutterpress.getHostVersion());
const chipCount = () => harness.page.evaluate(() => window.__gpGutterpress.chipCount());
const blockCount = () => harness.page.evaluate(() => window.__gpGutterpress.blockCount());
const chipKind = (i: number) => harness.page.evaluate((c) => window.__gpGutterpress.chipInfo(c).kind, i);
const blockClassName = (i: number) => harness.page.evaluate((b) => window.__gpGutterpress.blockClassName(b), i);

/** The first chip a click on its margin tag opens: a marker, not a raw-html/plugin-region rendering chip. */
async function firstOpenableChip(chips: number): Promise<number | undefined> {
  for (let i = 0; i < chips; i++) {
    const kind = await chipKind(i);
    if (kind !== "raw-html" && kind !== "plugin-region") return i;
  }
  return undefined;
}

/** The nearest top-level block to `blockIndex` that is not a chip: the block a click lands on to close the opened marker. */
async function adjacentPlainBlock(blockIndex: number, blocks: number): Promise<number | undefined> {
  for (let distance = 1; distance < blocks; distance++) {
    for (const candidate of [blockIndex + distance, blockIndex - distance]) {
      if (candidate < 0 || candidate >= blocks) continue;
      if (!(await blockClassName(candidate)).includes("gp-block-chip")) return candidate;
    }
  }
  return undefined;
}

describe("coverage report (AP-21: the corpus is real and complete before any file is mounted)", () => {
  test(`${EXAMPLE_FILE_COUNT} example files + ${PLUGIN_BOOK_FILE_COUNT} plugin-book files were read from disk`, () => {
    const totalBytes = LOADED.reduce((sum, f) => sum + f.bytes.length, 0);
    console.log(`[real-book-sweep] ${LOADED.length} files, ${totalBytes} bytes`);
    expect(LOADED.length).toBe(EXAMPLE_FILE_COUNT + PLUGIN_BOOK_FILE_COUNT);
    expect(LOADED.filter((f) => f.pluginBlind).length).toBe(PLUGIN_BOOK_FILE_COUNT);
    for (const f of LOADED) expect(f.bytes.length).toBeGreaterThan(0);
    expect(totalBytes).toBeGreaterThan(100_000);
  });
});

describe("real chapters mounted in real Chromium: no-edit byte identity, chip pin, open and close one marker", () => {
  for (const file of LOADED) {
    test(`${file.id}${file.pluginBlind ? " [plugin-blind: bytes, not callout chips]" : ""}`, async () => {
      // Fresh page per file: no scroll or module state from the previous mount.
      await harness.page.reload();
      await waitForHarnessReady(harness.page);

      const text = file.bytes.toString("utf8");
      const mountStartedAt = performance.now();
      const { containerSelector } = await harness.page.evaluate((t) => window.__gpGutterpress.mount(t), text);
      await harness.page.waitForSelector(`${containerSelector} .md-editor`, { timeout: 10_000 });
      console.log(`[real-book-sweep] ${file.id}: mounted in ${(performance.now() - mountStartedAt).toFixed(0)}ms`);

      // Byte identity, on the raw buffer (this prose carries multi-byte characters).
      expect(Buffer.from(await hostText(), "utf8").equals(file.bytes)).toBe(true);
      expect(await hostVersion()).toBe(0);

      const chips = await chipCount();
      const blocks = await blockCount();
      expect(blocks).toBeGreaterThan(0);
      if (file.chips === "none") {
        expect(chips).toBe(0);
        return;
      }
      expect(chips).toBeGreaterThan(0);

      const chipIndex = await firstOpenableChip(chips);
      expect(chipIndex).toBeDefined();
      const chipBlock = await harness.page.evaluate((c) => window.__gpGutterpress.chipBlockIndex(c), chipIndex!);
      const plainBlock = await adjacentPlainBlock(chipBlock, blocks);
      expect(plainBlock).toBeDefined();

      // Open the marker: click its margin tag (the chip has no box in the flow).
      await harness.page.evaluate(() => window.scrollTo(0, 0));
      await harness.page.waitForSelector(".gp-marker-tag", { timeout: 5_000 });
      await harness.page.evaluate((c) => window.__gpGutterpress.scrollChipIntoView(c), chipIndex!);
      const tagPoint = await harness.page.evaluate((c) => window.__gpGutterpress.markerTagPoint(c), chipIndex!);
      await harness.page.mouse.click(tagPoint.x, tagPoint.y);
      await harness.page.waitForTimeout(50);
      expect(await chipCount()).toBe(chips - 1);

      // Close it: click the adjacent plain block.
      await harness.page.evaluate((b) => window.__gpGutterpress.scrollBlockIntoView(b), plainBlock!);
      const center = await harness.page.evaluate((b) => window.__gpGutterpress.blockCenter(b), plainBlock!);
      await harness.page.mouse.click(center.x, center.y);
      await harness.page.waitForTimeout(50);
      expect(await chipCount()).toBe(chips);
      expect(await blockCount()).toBe(blocks);
      expect(Buffer.from(await hostText(), "utf8").equals(file.bytes)).toBe(true);
      expect(await hostVersion()).toBe(0);

      await harness.page.evaluate(() => window.__gpGutterpress.dispose());
      expect(Buffer.from(await hostText(), "utf8").equals(file.bytes)).toBe(true);
      expect(await hostVersion()).toBe(0);
    }, 60_000);
  }
});

describe("harness liveness", () => {
  test("no console or page errors across every file above", () => {
    expect(harness.consoleErrors).toEqual([]);
    expect(harness.pageErrors).toEqual([]);
  });
});
