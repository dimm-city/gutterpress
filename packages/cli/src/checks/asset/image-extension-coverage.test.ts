/**
 * Guards the image/font extension-set contract shared by the asset checks.
 *
 * Background: collectImageFiles was copy-pasted across three files with
 * DIVERGENT glob lists, so webp/svg/gif were size-checked yet silently exempt
 * from the header-reader checks (color-space / resolution / alpha). This test
 * pins the *intended* coverage:
 *
 *   - RASTER_INSPECTABLE_EXTS — the formats inspectImage can actually parse.
 *     The header-reader checks operate ONLY over these.
 *   - ALL_IMAGE_EXTS — every image extension treated as an asset for byte-level
 *     checks (file size). Superset of RASTER_INSPECTABLE_EXTS.
 *   - The extras (webp/svg/gif) are size-checked but intentionally NOT
 *     header-inspected, because inspectImage genuinely cannot read them.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RASTER_INSPECTABLE_EXTS,
  ALL_IMAGE_EXTS,
  FONT_EXTS,
} from "./extensions";
import { collectImageFiles, inspectImage } from "../../lib/image-inspect";
import { resolveConfig } from "../../lib/manifest";
import { getCheckById } from "../registry";
import type { CheckContext } from "../types";

// self-register all asset checks
import "./index";

function makeCtx(dir: string): CheckContext {
  return {
    config: resolveConfig({}, {} as any),
    inputDir: dir,
    outputDir: dir,
    assetDirs: [dir],
  };
}

// ---------------------------------------------------------------------------
// Constant contract
// ---------------------------------------------------------------------------

describe("asset extension sets", () => {
  test("ALL_IMAGE_EXTS is a superset of RASTER_INSPECTABLE_EXTS", () => {
    for (const ext of RASTER_INSPECTABLE_EXTS) {
      expect(ALL_IMAGE_EXTS).toContain(ext);
    }
  });

  test("the size-only extras are exactly webp/svg/gif (not header-inspectable)", () => {
    const extras = (ALL_IMAGE_EXTS as readonly string[]).filter(
      (e) => !(RASTER_INSPECTABLE_EXTS as readonly string[]).includes(e)
    );
    expect(extras.sort()).toEqual(["gif", "svg", "webp"]);
  });

  test("FONT_EXTS covers the common web/print font formats", () => {
    expect(([...FONT_EXTS] as string[]).sort()).toEqual(
      ["eot", "otf", "ttf", "woff", "woff2"].sort()
    );
  });
});

// ---------------------------------------------------------------------------
// Behavioural coverage: webp is collected for size, skipped for inspection
// ---------------------------------------------------------------------------

describe("image collection honours the shared sets", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ext-cov-"));
    await writeFile(join(dir, "photo.png"), Buffer.alloc(16));
    await writeFile(join(dir, "cover.webp"), Buffer.alloc(16));
    await writeFile(join(dir, "logo.svg"), Buffer.from("<svg/>"));
    await writeFile(join(dir, "anim.gif"), Buffer.alloc(16));
    await writeFile(join(dir, "body.ttf"), Buffer.alloc(16));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("RASTER_INSPECTABLE_EXTS collects png but NOT webp/svg/gif", async () => {
    const files = await collectImageFiles([dir], RASTER_INSPECTABLE_EXTS);
    const names = files.map((f) => f.split("/").pop());
    expect(names).toContain("photo.png");
    expect(names).not.toContain("cover.webp");
    expect(names).not.toContain("logo.svg");
    expect(names).not.toContain("anim.gif");
  });

  test("ALL_IMAGE_EXTS collects every image asset including webp/svg/gif", async () => {
    const files = await collectImageFiles([dir], ALL_IMAGE_EXTS);
    const names = files.map((f) => f.split("/").pop());
    expect(names).toContain("photo.png");
    expect(names).toContain("cover.webp");
    expect(names).toContain("logo.svg");
    expect(names).toContain("anim.gif");
  });

  test("inspectImage cannot parse webp — justifies the header-check exemption", async () => {
    const info = await inspectImage(join(dir, "cover.webp"));
    expect(info).toBeNull();
  });

  test("FONT_EXTS glob finds font files", async () => {
    const { glob } = await import("glob");
    const fonts = await glob(`**/*.{${FONT_EXTS.join(",")}}`, {
      cwd: dir,
      absolute: true,
    });
    expect(fonts.map((f) => f.split("/").pop())).toContain("body.ttf");
  });
});

// ---------------------------------------------------------------------------
// The actual checks: webp is size-checked but exempt from header inspection
// ---------------------------------------------------------------------------

describe("asset checks apply the shared sets consistently", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ext-cov-checks-"));
    // A large webp: size-checkable, but not header-inspectable.
    await writeFile(join(dir, "huge.webp"), Buffer.alloc(2_000_000));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("file-size check DOES flag an oversized webp", async () => {
    const ctx = makeCtx(dir);
    ctx.config.validate.assets.maxImageSize = 1_000_000;
    const check = getCheckById("asset.image.file-size")!;
    const results = await check.run(ctx);
    expect(results.map((r) => r.file?.split("/").pop())).toContain("huge.webp");
  });

  test("color-space check SKIPS webp (not header-inspectable)", async () => {
    const ctx = makeCtx(dir);
    ctx.config.validate.assets.allowedColorSpaces = ["sRGB"];
    const check = getCheckById("asset.image.color-space")!;
    const results = await check.run(ctx);
    expect(results).toHaveLength(0);
  });
});
