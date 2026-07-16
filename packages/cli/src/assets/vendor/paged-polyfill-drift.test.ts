/**
 * Drift guard for the two vendored paged.polyfill.js copies (audit E1/conf-9,
 * conf-20).
 *
 * The CLI (packages/cli/src/assets/vendor/paged.polyfill.js) and the viewer
 * (packages/viewer/static/vendor/paged.polyfill.js) ship byte-identical copies
 * of the same ~33k-line vendored pagedjs build. Nothing in the build or CI
 * enforced that they stay in sync, and PAGEDJS-PATCHES.md's update instructions
 * only mention the CLI copy — so the next pagedjs bump could silently desync the
 * viewer. This test fails the moment the two diverge.
 *
 * If this fails after a deliberate pagedjs update: re-copy the new dist to BOTH
 * paths (see PAGEDJS-PATCHES.md) and re-apply the documented patches to both.
 */
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const CLI_COPY = path.join(import.meta.dir, "paged.polyfill.js");
const VIEWER_COPY = path.join(
  import.meta.dir,
  "../../../../viewer/static/vendor/paged.polyfill.js",
);

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

describe("vendored paged.polyfill.js copies", () => {
  it("are byte-identical across packages/cli and packages/viewer", () => {
    const cli = sha256(CLI_COPY);
    const viewer = sha256(VIEWER_COPY);
    expect(viewer).toBe(cli);
  });
});
