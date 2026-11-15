/**
 * Ctrl-C / SIGTERM during `gutterpress build --format pdf` must clean up after
 * itself: before, the process died with Chromium still running on its profile
 * folder (a 100+ MB `gp-cdp-*` in the temp dir) and the build's
 * `dist/.<book>-build-*` work folder on disk. The build now aborts through
 * `runBuild`'s signal and exits 128 + the signal number.
 *
 * Driven through the real CLI process, like cli-contract.test.ts.
 */

import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../lib/chromium.ts";
import { makeTempDir } from "../test-helpers/testkit.ts";

const CLI_ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.ts");

const chromium = await resolveChromiumExecutable();
const testIfChromium = chromium ? test : test.skip;

for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  testIfChromium(`${signal} mid-render exits ${exitCode} and leaves no work folder or Chromium profile`, async () => {
    const root = await makeTempDir("gutterpress-interrupt-");
    const book = path.join(root, "book");
    // Short path: Chromium refuses a profile socket path over ~100 characters.
    const scratch = await mkdtemp(path.join(tmpdir(), "s-"));
    await mkdir(book, { recursive: true });
    await writeFile(path.join(book, "manifest.yaml"), "title: Interrupt Test\n");
    // Enough pages that the render is still running when the signal arrives.
    await writeFile(path.join(book, "chapter-01.md"), "# One\n\n" + "A paragraph of body text. ".repeat(40).concat("\n\n").repeat(150));
    try {
      const proc = Bun.spawn({
        cmd: ["bun", "run", CLI_ENTRY, "build", book, "--format", "pdf", "--skip-post-validate"],
        stdout: "pipe",
        stderr: "pipe",
        // Chromium's profile folder goes in the temp dir; look for it in ours.
        env: { ...process.env, TMPDIR: scratch },
      });
      // Wait for the render stage: by then the browser is up and the work folder exists.
      let log = "";
      const decoder = new TextDecoder();
      const reader = proc.stdout.getReader();
      while (!log.includes("Rendering HTML to PDF")) {
        const { value, done } = await reader.read();
        if (done) break;
        log += decoder.decode(value);
      }
      expect(log).toContain("Rendering HTML to PDF");
      proc.kill(signal);
      reader.releaseLock();
      expect(await proc.exited).toBe(exitCode);

      const dist = path.join(book, "dist");
      const left = [
        ...(await readdir(dist).catch(() => [] as string[])).filter((n) => n.includes("-build-")),
        ...(await readdir(scratch)).filter((n) => n.startsWith("gp-cdp-")),
      ];
      expect(left).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(scratch, { recursive: true, force: true });
    }
  }, 60_000);
}
