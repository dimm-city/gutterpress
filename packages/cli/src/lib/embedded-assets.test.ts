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

// Regression test for the sentinel-asset choice (native-only-migration-plan.md
// Phase 6 housekeeping, item 1). The cache-validity check in `getAssetsDir()`
// keys off ONE asset's presence on disk; if that sentinel ever named a
// Paged.js-only asset, deleting Paged.js would make the sentinel check fail
// forever and every call would pay for a fresh full extraction. The sentinel
// must be an asset that ships on both legs (today) and outlives Paged.js
// entirely (after removal) — the native engine's viewer bundle.
test("sentinel asset is a native-engine asset, not a Paged.js-only one, so cache validity survives Paged.js removal", async () => {
  const dir1 = await getAssetsDir();

  // Deleting ONLY the paged polyfill (simulating "Paged.js has been removed
  // from the embedded asset set") must NOT invalidate the cached extraction —
  // the sentinel the cache check reads must not be this file.
  await rm(join(dir1, "vendor/paged.polyfill.js"), { force: true });
  const dir2 = await getAssetsDir();
  expect(dir2).toBe(dir1);
  // Confirms getAssetsDir did not re-extract: the polyfill stays deleted.
  expect(existsSync(join(dir1, "vendor/paged.polyfill.js"))).toBe(false);

  // Deleting the actual sentinel (the viewer bundle) DOES force a fresh
  // extraction, restoring every asset including the one just removed above.
  await rm(join(dir1, "engine/gutterpress-viewer.js"), { force: true });
  const dir3 = await getAssetsDir();
  expect(existsSync(join(dir3, "engine/gutterpress-viewer.js"))).toBe(true);
  expect(existsSync(join(dir3, "vendor/paged.polyfill.js"))).toBe(true);
});
