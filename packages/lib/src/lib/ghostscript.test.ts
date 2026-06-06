import { test, expect, mock, afterEach } from "bun:test";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock the exec module so run() rejects (simulating a non-zero gs exit)
// without spawning a real ghostscript process.
const runMock = mock(async () => {
  throw new Error("gs ... exited 1");
});

await mock.module("./exec", () => ({
  run: runMock,
}));

const { convertToPdfxCmyk } = await import("./ghostscript");

afterEach(() => {
  runMock.mockClear();
});

test("convertToPdfxCmyk removes the temp .pdfx_def_*.ps file even when gs fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pmd-gs-"));
  try {
    const iccPath = join(dir, "fake.icc");
    await writeFile(iccPath, "not-a-real-icc");
    const outPdf = join(dir, "out.pdf");

    await expect(
      convertToPdfxCmyk(join(dir, "in.pdf"), outPdf, {
        iccPath,
        pdfx: "x3",
      })
    ).rejects.toThrow();

    const entries = await readdir(dir);
    const leaked = entries.filter((f) => /^\.pdfx_def_.*\.ps$/.test(f));
    expect(leaked).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
