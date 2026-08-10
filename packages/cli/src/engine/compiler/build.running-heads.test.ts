import { test, expect } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { launchChromium } from "../shared/cdp.ts";
import { loadManifestWithPath, resolveConfig } from "../../lib/manifest.ts";
import { renderChaptersToFile } from "../../lib/markdown/index.ts";
import { loadPluginsWithCss } from "../../lib/markdown/plugins.ts";
import { planImageCopies } from "../../lib/asset-inline.ts";
import { build } from "./build.ts";
import { loadPdf, getTextPass } from "../../lib/pdf-inspect.ts";

/**
 * Regression for the two-page running-head defect found on
 * docs/fixtures/css-authoring-spike/book: `<gp-anchor>`'s
 * `position:absolute` zero-size first child, sitting immediately after a
 * forced `break-before: page`, measured ONE PAGE LATE via the PDF's named
 * destinations — page 2 (own h1 "Contents") reported page 3, colliding with
 * page 3's own "Reading the Tides" entry. `string(chapter-title)` then
 * printed the wrong running head on both pages 2 and 3 (verified via
 * pdftotext before the fix: p2 "THE SALT MARSH ALMANAC", p3 "CONTENTS").
 * Fixed by dropping `position:absolute` from the anchor (agent.ts's
 * `ensureAnchor`) so it fragments through ordinary in-flow layout, the same
 * mechanism that already measured author-supplied ids correctly.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
);
const FIXTURE_DIR = path.join(REPO_ROOT, "docs", "fixtures", "css-authoring-spike", "book");
const RENDER_TEST_TIMEOUT_MS = 90_000;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[build.running-heads.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it.",
  );
}

testIf(
  "string(chapter-title) prints each page's OWN running head, not a neighbor's (pages 2-3)",
  async () => {
    const stageDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), "gutterpress-running-heads-test-"),
    );
    const browser = await launchChromium();
    try {
      const { manifest, manifestPath } = await loadManifestWithPath(FIXTURE_DIR);
      const config = resolveConfig({ engine: "native" }, manifest);
      const renderDir = manifestPath ? path.dirname(manifestPath) : FIXTURE_DIR;
      const { plugins, pluginCss } = await loadPluginsWithCss(config.plugins, renderDir);

      const imageRefs: string[] = [];
      const htmlPath = await renderChaptersToFile(renderDir, stageDir, {
        title: config.title,
        styles: config.styles,
        files: config.source.files,
        plugins,
        pluginCss,
        onImageRefs: (refs) => imageRefs.push(...refs),
      });
      const { copies } = await planImageCopies(renderDir, imageRefs);
      await Promise.all(
        copies.map(async (c) => {
          const dest = path.join(stageDir, c.to);
          await fsp.mkdir(path.dirname(dest), { recursive: true });
          await fsp.copyFile(c.from, dest);
        }),
      );

      const result = await build({
        input: pathToFileURL(htmlPath).href,
        browser,
      });
      expect(result.pageCount).toBe(7);

      const pdfPath = path.join(stageDir, "book.pdf");
      await fsp.writeFile(pdfPath, result.bytes);
      const doc = await loadPdf(pdfPath);
      expect(doc).not.toBeNull();
      const { textByPage } = await getTextPass(doc!);

      // Page 2's own h1 is "Contents" — must show its own head, not page 1's.
      expect(textByPage[1]).toContain("CONTENTS");
      expect(textByPage[1]).not.toContain("SALT MARSH ALMANAC");

      // Page 3's own h1 is "Reading the Tides" — must show its own head, not
      // page 2's.
      expect(textByPage[2]).toContain("READING THE TIDES");
      expect(textByPage[2]).not.toContain("CONTENTS");
    } finally {
      await browser.close();
      await fsp.rm(stageDir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS,
);
