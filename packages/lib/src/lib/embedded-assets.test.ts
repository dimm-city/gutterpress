import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { getAssetsDir, getAssetPath } from "./embedded-assets.ts";

test("getAssetsDir re-extracts when the cached temp dir was removed", async () => {
  const dir1 = await getAssetsDir();
  expect(existsSync(dir1)).toBe(true);
  expect(existsSync(join(dir1, "vendor/paged.polyfill.js"))).toBe(true);

  // Simulate OS tmp reaper / lifecycle shutdown cleanup removing the dir.
  await rm(dir1, { recursive: true, force: true });
  expect(existsSync(dir1)).toBe(false);

  const dir2 = await getAssetsDir();
  // The returned dir must point at a real, fully-extracted directory.
  expect(existsSync(join(dir2, "vendor/paged.polyfill.js"))).toBe(true);

  const polyfill = await getAssetPath("vendor/paged.polyfill.js");
  expect(existsSync(polyfill)).toBe(true);
});
