/**
 * Regression test for Work Package C item 1a: a native-engine build ignores
 * an injected `pdfRenderer` (build-runner.ts always calls `buildNativePdf`,
 * which needs the system/pooled Chromium — see build-runner.ts's comment at
 * its call site), so `preflightBuildTools`'s Chromium check must still run
 * even when `opts.pdfRenderer` is set, as long as it does when the resolved
 * engine is "native". Before this fix, an injected `pdfRenderer` (as the
 * desktop app always supplies) suppressed the check unconditionally, so a
 * native build on a machine without Chromium failed late and cryptically
 * instead of at this fast preflight probe.
 *
 * `./chromium` is spied on (not `mock.module`-replaced) for the same reason
 * build-runner.browser-lifecycle.test.ts gives: `mock.module` clobbers the
 * shared resolution registry for every other test file in the run.
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

const fakeRenderer = async () => {};
const config = { pdfx: { stripAnnotations: false } };

test("preflightBuildTools still checks for Chromium on a native build even with an injected pdfRenderer", async () => {
  mockChromiumMissing();
  await expect(
    preflightBuildTools(
      "pdf",
      { pdfRenderer: fakeRenderer },
      { ...config, engine: "native" }
    )
  ).rejects.toThrow(/Chromium not found/);
  expect(requireChromiumMock).toHaveBeenCalledTimes(1);
});

test("preflightBuildTools skips the Chromium check for a paged build with an injected pdfRenderer", async () => {
  mockChromiumMissing();
  await expect(
    preflightBuildTools(
      "pdf",
      { pdfRenderer: fakeRenderer },
      { ...config, engine: "paged" }
    )
  ).resolves.toBeUndefined();
  expect(requireChromiumMock).not.toHaveBeenCalled();
});
