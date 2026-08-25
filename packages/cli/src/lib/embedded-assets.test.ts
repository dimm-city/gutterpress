import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { getAssetsDir, getAssetPath } from "./embedded-assets.ts";

test("getAssetsDir re-extracts when the cached temp dir was removed", async () => {
  const dir1 = await getAssetsDir();
  expect(existsSync(dir1)).toBe(true);
  expect(existsSync(join(dir1, "engine/gutterpress-viewer.js"))).toBe(true);

  // Simulate OS tmp reaper / lifecycle shutdown cleanup removing the dir.
  await rm(dir1, { recursive: true, force: true });
  expect(existsSync(dir1)).toBe(false);

  const dir2 = await getAssetsDir();
  // The returned dir must point at a real, fully-extracted directory.
  expect(existsSync(join(dir2, "engine/gutterpress-viewer.js"))).toBe(true);

  const viewer = await getAssetPath("engine/gutterpress-viewer.js");
  expect(existsSync(viewer)).toBe(true);
});

// Regression test for the sentinel-asset choice. The cache-validity check in
// `getAssetsDir()` keys off ONE asset's presence on disk; if that sentinel
// ever named an asset some builds omit, the check would fail forever for those
// builds and every call would pay for a fresh full extraction. The sentinel is
// the engine's viewer bundle, which is embedded unconditionally.
test("sentinel asset is an unconditionally embedded engine asset", async () => {
  const dir1 = await getAssetsDir();

  // Deleting a non-sentinel asset must NOT invalidate the cached extraction —
  // the sentinel check reads only the viewer bundle's presence.
  await rm(join(dir1, "preview/scripts/preview-bridge.js"), { force: true });
  const dir2 = await getAssetsDir();
  expect(dir2).toBe(dir1);
  // Confirms getAssetsDir did not re-extract: the deleted file stays deleted.
  expect(existsSync(join(dir1, "preview/scripts/preview-bridge.js"))).toBe(false);

  // Deleting the actual sentinel (the viewer bundle) DOES force a fresh
  // extraction, restoring every asset including the one just removed above.
  await rm(join(dir1, "engine/gutterpress-viewer.js"), { force: true });
  const dir3 = await getAssetsDir();
  expect(existsSync(join(dir3, "engine/gutterpress-viewer.js"))).toBe(true);
  expect(existsSync(join(dir3, "preview/scripts/preview-bridge.js"))).toBe(true);
});
