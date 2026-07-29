import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as execMod from "./exec";
import * as toolProbe from "./tool-probe";
import {
  convertToPdfxCmyk,
  resolveGhostscript,
  stripAnnotations,
} from "./ghostscript";

const originalGhostscriptPath = process.env.GHOSTSCRIPT_PATH;

afterEach(() => {
  (execMod.run as unknown as { mockRestore?: () => void }).mockRestore?.();
  (toolProbe.findTool as unknown as { mockRestore?: () => void }).mockRestore?.();
  if (originalGhostscriptPath === undefined) delete process.env.GHOSTSCRIPT_PATH;
  else process.env.GHOSTSCRIPT_PATH = originalGhostscriptPath;
});

describe("resolveGhostscript", () => {
  test("uses GHOSTSCRIPT_PATH before probing PATH", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gutterpress-gs-resolve-"));
    try {
      const executable = join(dir, "custom-gs");
      await writeFile(executable, "");
      const findTool = spyOn(toolProbe, "findTool").mockResolvedValue(undefined);

      await expect(
        resolveGhostscript(process.platform, { GHOSTSCRIPT_PATH: executable })
      ).resolves.toBe(executable);
      expect(findTool).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("probes the standard Windows command names in priority order", async () => {
    const findTool = spyOn(toolProbe, "findTool").mockImplementation(
      async (name) => name === "gs" ? "C:\\tools\\gs.exe" : undefined
    );

    await expect(resolveGhostscript("win32", {})).resolves.toBe(
      "C:\\tools\\gs.exe"
    );
    expect(findTool.mock.calls.map(([name]) => name)).toEqual([
      "gswin64c",
      "gswin32c",
      "gs",
    ]);
  });

  test("finds the newest conventional versioned Program Files install", async () => {
    const root = await mkdtemp(join(tmpdir(), "gutterpress-gs-program-files-"));
    try {
      const oldBin = join(root, "gs", "gs9.56.1", "bin");
      const newBin = join(root, "gs", "gs10.06.0", "bin");
      await mkdir(oldBin, { recursive: true });
      await mkdir(newBin, { recursive: true });
      await writeFile(join(oldBin, "gswin64c.exe"), "");
      await writeFile(join(newBin, "gswin64c.exe"), "");
      spyOn(toolProbe, "findTool").mockResolvedValue(undefined);

      await expect(
        resolveGhostscript("win32", { ProgramFiles: root })
      ).resolves.toBe(join(newBin, "gswin64c.exe"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("stripAnnotations keeps its qpdf scratch file in staging", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "gutterpress-gs-output-"));
  const stagingDir = await mkdtemp(join(tmpdir(), "gutterpress-gs-stage-"));
  try {
    const pdfPath = join(outputDir, "book.pdf");
    await writeFile(pdfPath, "original");
    const run = spyOn(execMod, "run").mockImplementation(async (_cmd, args) => {
      expect(args[1]).toBe(join(stagingDir, "annotations-stripped.pdf"));
      await writeFile(args[1]!, "stripped");
    });

    await stripAnnotations(pdfPath, stagingDir);

    expect(run).toHaveBeenCalledWith("qpdf", [
      pdfPath,
      join(stagingDir, "annotations-stripped.pdf"),
      "--flatten-annotations=all",
    ]);
    expect(await readFile(pdfPath, "utf8")).toBe("stripped");
    expect(await readdir(outputDir)).toEqual(["book.pdf"]);
    expect(await readdir(stagingDir)).toEqual([]);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
    await rm(stagingDir, { recursive: true, force: true });
  }
});

test("convertToPdfxCmyk uses resolved Ghostscript and stages its definition file", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "gutterpress-gs-output-"));
  const stagingDir = await mkdtemp(join(tmpdir(), "gutterpress-gs-stage-"));
  try {
    const executable = join(stagingDir, "custom-gs");
    const iccPath = join(stagingDir, "profile.icc");
    const inputPdf = join(stagingDir, "raw.pdf");
    const outPdf = join(outputDir, "book.pdf");
    await writeFile(executable, "");
    await writeFile(iccPath, "not-a-real-icc");
    await writeFile(inputPdf, "not-a-real-pdf");
    process.env.GHOSTSCRIPT_PATH = executable;

    let capturedArgs: string[] = [];
    const run = spyOn(execMod, "run").mockImplementation(async (_cmd, args) => {
      capturedArgs = args;
      const definition = args.at(-2)!;
      expect(definition).toBe(join(stagingDir, "pdfx-def.ps"));
      expect(existsSync(definition)).toBe(true);
      throw new Error("Ghostscript conversion failed");
    });

    await expect(
      convertToPdfxCmyk(inputPdf, outPdf, {
        iccPath,
        pdfx: "x3",
        stagingDir,
      })
    ).rejects.toThrow("Ghostscript conversion failed");

    expect(run.mock.calls[0]?.[0]).toBe(executable);
    expect(capturedArgs).toContain(`-sOutputICCProfile=${iccPath}`);
    expect(capturedArgs.some((arg) => arg.startsWith("-sDefaultRGBProfile="))).toBe(false);
    expect(await readdir(outputDir)).toEqual([]);
    expect(existsSync(join(stagingDir, "pdfx-def.ps"))).toBe(false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
    await rm(stagingDir, { recursive: true, force: true });
  }
});
