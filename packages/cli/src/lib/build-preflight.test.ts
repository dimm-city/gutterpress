/**
 * `preflightBuildTools`'s Chromium check: required for a pooled-Chromium
 * build, skipped when an `engineBrowser` (the desktop's Electron host) is
 * injected.
 *
 * `./chromium` is spied on (not `mock.module`-replaced): `mock.module`
 * clobbers the shared resolution registry for every other test file in the
 * run.
 */
import { test, expect, spyOn, afterEach } from "bun:test";
import * as chromium from "./chromium.ts";
import { preflightBuildTools } from "./build-preflight.ts";

let resolveChromiumMock: ReturnType<typeof spyOn>;
let requireChromiumMock: ReturnType<typeof spyOn>;

function mockChromiumMissing(): void {
  resolveChromiumMock = spyOn(chromium, "resolveChromiumExecutable").mockImplementation(
    async () => undefined
  );
  requireChromiumMock = spyOn(chromium, "requireChromiumExecutable").mockImplementation(
    async () => {
      throw new Error("Chromium not found (mocked)");
    }
  );
}

afterEach(() => {
  resolveChromiumMock?.mockRestore();
  requireChromiumMock?.mockRestore();
});

const config = { pdfx: { stripAnnotations: false } };

test("preflightBuildTools checks for Chromium on a pooled-Chromium build", async () => {
  mockChromiumMissing();
  await expect(preflightBuildTools("pdf", {}, config)).rejects.toThrow(
    /Chromium not found/
  );
  expect(requireChromiumMock).toHaveBeenCalledTimes(1);
});

test("preflightBuildTools skips the Chromium check when an engineBrowser is injected", async () => {
  mockChromiumMissing();
  await expect(
    preflightBuildTools("pdf", { engineBrowser: async () => ({}) as never }, config)
  ).resolves.toBeUndefined();
  expect(requireChromiumMock).not.toHaveBeenCalled();
});

test("preflightBuildTools skips the Chromium check entirely for --format html", async () => {
  mockChromiumMissing();
  await expect(preflightBuildTools("html", {}, config)).resolves.toBeUndefined();
  expect(requireChromiumMock).not.toHaveBeenCalled();
});
