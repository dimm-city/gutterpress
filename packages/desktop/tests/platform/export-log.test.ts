/**
 * What the app log says about an export (electron/export/export-log.ts): that
 * it started, and how it ended. A failure is recorded in full, because the
 * author is shown one line of it and a packaged app has no console.
 */
import { expect, test } from "bun:test";
import { loggedExport } from "../../electron/export/export-log";

function harness() {
  const events: string[] = [];
  const errors: string[] = [];
  let clock = 0;
  return {
    events,
    errors,
    advance: (ms: number) => (clock += ms),
    log: { event: (line: string) => events.push(line), error: (line: string) => errors.push(line) },
    now: () => clock,
  };
}

test("a finished export is two lines: started, and finished with how long it took", async () => {
  const h = harness();
  const result = await loggedExport("pdf", async () => {
    h.advance(182_000);
    return { pdfPath: "/book/dist/book.pdf" };
  }, h.log, h.now);
  expect(result).toEqual({ pdfPath: "/book/dist/book.pdf" });
  expect(h.events).toEqual(["[export] pdf build started", "[export] pdf build finished in 3m 02s"]);
  expect(h.errors).toEqual([]);
});

test("a failed export records its code, its whole message and its stack, and still rejects", async () => {
  const h = harness();
  const failure = Object.assign(new Error("Ghostscript failed (exit 1)\nUnrecoverable error in pdfwrite"), {
    code: "BUILD_ERROR",
  });
  const run = loggedExport("pdfx", async () => {
    h.advance(1_699_000);
    throw failure;
  }, h.log, h.now);
  await expect(run).rejects.toBe(failure);
  expect(h.events).toEqual(["[export] pdfx build started"]);
  expect(h.errors[0]).toBe(
    "[export] pdfx build failed after 28m 19s (BUILD_ERROR): Ghostscript failed (exit 1)\nUnrecoverable error in pdfwrite",
  );
  expect(h.errors[1]).toContain("export-log.test.ts"); // the stack, for whoever reads the log
});

test("a canceled export is not a fault", async () => {
  const h = harness();
  const canceled = Object.assign(new Error("PDF export canceled"), { code: "EXPORT_CANCELED" });
  await expect(
    loggedExport("pdf", async () => {
      h.advance(12_000);
      throw canceled;
    }, h.log, h.now),
  ).rejects.toBe(canceled);
  expect(h.events).toEqual(["[export] pdf build started", "[export] pdf build canceled after 12s"]);
  expect(h.errors).toEqual([]);
});

test("a sign-in carried in a URL never reaches the log", async () => {
  const h = harness();
  await loggedExport("pdf", async () => {
    throw new Error("fetch https://author:ghp_secret@github.com/a/b.git failed");
  }, h.log, h.now).catch(() => {});
  expect(h.errors.join("\n")).not.toContain("ghp_secret");
  expect(h.errors[0]).toContain("github.com/a/b.git failed");
});
