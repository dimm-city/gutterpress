import { expect, test } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { launchChromium } from "../shared/cdp.ts";
import { build } from "./build.ts";

/**
 * An extension that says "wait for me" (`__gpReadyPending`) and never signals
 * `gp:ready` makes the build stop waiting after 15 s and print without it.
 * That must be reported, not silent.
 */

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;

const doc = (pending: boolean) => `<!doctype html><html><meta charset="utf-8"><style>
@page { size: 300px 400px; margin: 40px; }
</style>${pending ? "<script>window.__gpReadyPending = true</script>" : ""}<p>hello</p>`;

testIf(
  "a gp:ready wait that runs out is reported as a build diagnostic",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-ready-"));
    const browser = await launchChromium();
    try {
      const run = async (name: string, html: string) => {
        const file = path.join(dir, `${name}.html`);
        await fsp.writeFile(file, html, "utf8");
        const result = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });
        return result.diagnostics.filter((d) => d.code === "engine.ready.timeout");
      };
      expect(await run("ready", doc(false))).toHaveLength(0);
      const found = await run("stuck", doc(true));
      expect(found).toHaveLength(1);
      expect(found[0]!.severity).toBe("warning");
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  90_000,
);
