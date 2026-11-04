import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crpc1SeparatesBlack, verifyPdfxSeparation } from "./pdfx-probe";

describe("crpc1SeparatesBlack", () => {
  test("CRPC1's separation of #000 (measured on Ghostscript 10.06.0, #331) is the profile's", () => {
    expect(crpc1SeparatesBlack({ c: 47, k: 100, tac: 229 })).toBe("profile");
    expect(crpc1SeparatesBlack({ c: 50, k: 100, tac: 240 })).toBe("profile");
  });
  test("default_cmyk.icc's separation (measured on Ghostscript 10.02.1) is not", () => {
    expect(crpc1SeparatesBlack({ c: 72.2, k: 88.2, tac: 294.9 })).toBe("default");
  });
  test("a four-colour black with K at 100 but heavy CMY is not CRPC1 either", () => {
    expect(crpc1SeparatesBlack({ c: 60, k: 100, tac: 260 })).toBe("default");
  });
});

describe("verifyPdfxSeparation", () => {
  test("judges nothing for a profile without a known signature, and runs no Ghostscript", async () => {
    const stage = await mkdtemp(join(tmpdir(), "gutterpress-probe-unknown-"));
    try {
      const icc = join(stage, "MyPress.icc");
      await writeFile(icc, "not-a-real-icc");
      expect(await verifyPdfxSeparation({ iccPath: icc, pdfx: "x1a", stagingDir: stage })).toEqual({
        checked: false,
      });
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  });
});
