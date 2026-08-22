import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as execMod from "./exec";
import * as toolProbe from "./tool-probe";
import {
  convertToPdfxCmyk,
  hasLiveTransparency,
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

test("stripAnnotations keeps its qpdf scratch file in staging, and deletes leftover /Annots", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "gutterpress-gs-output-"));
  const stagingDir = await mkdtemp(join(tmpdir(), "gutterpress-gs-stage-"));
  try {
    const pdfPath = join(outputDir, "book.pdf");
    await writeFile(pdfPath, "original");

    // A real one-page PDF with a Link annotation qpdf's flatten step would
    // NOT remove (no appearance stream to draw) — B.12's actual failure
    // mode. The mocked "qpdf" step is a no-op copy, so `stripAnnotations`'s
    // own pdf-lib pass is what has to delete it.
    const { PDFDocument, PDFName, PDFArray } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    const annotDict: any = doc.context.obj({ Type: "Annot", Subtype: "Link" });
    const annotRef = doc.context.register(annotDict);
    page.node.set(PDFName.of("Annots"), PDFArray.withContext(doc.context));
    (page.node.Annots() as any).push(annotRef);
    const withAnnot = await doc.save();

    const run = spyOn(execMod, "run").mockImplementation(async (_cmd, args) => {
      expect(args[1]).toBe(join(stagingDir, "annotations-stripped.pdf"));
      await writeFile(args[1]!, withAnnot);
    });

    await stripAnnotations(pdfPath, stagingDir);

    expect(run).toHaveBeenCalledWith("qpdf", [
      pdfPath,
      join(stagingDir, "annotations-stripped.pdf"),
      "--flatten-annotations=all",
    ]);
    const result = await PDFDocument.load(await readFile(pdfPath));
    expect(result.getPage(0).node.has(PDFName.of("Annots"))).toBe(false);
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

describe("hasLiveTransparency", () => {
  /**
   * Build a real (pdf-lib-parseable) one-page PDF whose page dict carries the
   * given extra entries, optionally alongside an extra indirect object. Real
   * structure matters here: the predicate walks the parsed object graph, and
   * the regression it exists to catch is precisely that a raw-byte scan
   * cannot see dicts Chromium packs into compressed object streams.
   */
  async function pdfWith(
    mutate: (ctx: import("pdf-lib").PDFContext, page: import("pdf-lib").PDFPage) => void,
    useObjectStreams = false
  ): Promise<Uint8Array> {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    mutate(doc.context, page);
    return doc.save({ useObjectStreams });
  }

  test("false on a plain opaque PDF", async () => {
    expect(await hasLiveTransparency(await pdfWith(() => {}))).toBe(false);
  });

  test("detects an alpha-channel image (/SMask on an image XObject)", async () => {
    const { PDFName, PDFRawStream } = await import("pdf-lib");
    const pdf = await pdfWith((ctx) => {
      const mask = ctx.register(PDFRawStream.of(ctx.obj({}), new Uint8Array([0])));
      ctx.register(
        PDFRawStream.of(
          ctx.obj({ Type: PDFName.of("XObject"), Subtype: PDFName.of("Image"), SMask: mask }),
          new Uint8Array([0])
        )
      );
    });
    expect(await hasLiveTransparency(pdf)).toBe(true);
  });

  test("does not false-positive on an opaque image's /SMask /None", async () => {
    const { PDFName, PDFRawStream } = await import("pdf-lib");
    const pdf = await pdfWith((ctx) => {
      ctx.register(
        PDFRawStream.of(
          ctx.obj({
            Type: PDFName.of("XObject"),
            Subtype: PDFName.of("Image"),
            SMask: PDFName.of("None"),
          }),
          new Uint8Array([0])
        )
      );
    });
    expect(await hasLiveTransparency(pdf)).toBe(false);
  });

  test("detects a CSS-opacity transparency group even inside an object stream", async () => {
    const { PDFName } = await import("pdf-lib");
    // useObjectStreams: true is the case the previous raw-regex scan missed —
    // a CSS `opacity` book rasterized to zero embedded fonts with no warning.
    const pdf = await pdfWith((ctx, page) => {
      page.node.set(
        PDFName.of("Group"),
        ctx.obj({ S: PDFName.of("Transparency"), Type: PDFName.of("Group") })
      );
    }, true);
    expect(await hasLiveTransparency(pdf)).toBe(true);
  });

  test("detects graphics-state constant alpha (/ca < 1)", async () => {
    const { PDFName } = await import("pdf-lib");
    const pdf = await pdfWith((ctx) => {
      ctx.register(ctx.obj({ Type: PDFName.of("ExtGState"), ca: 0.5 }));
    }, true);
    expect(await hasLiveTransparency(pdf)).toBe(true);
  });

  test("does not false-positive on a fully opaque graphics state (/ca 1)", async () => {
    const { PDFName } = await import("pdf-lib");
    const pdf = await pdfWith((ctx) => {
      ctx.register(ctx.obj({ Type: PDFName.of("ExtGState"), ca: 1, CA: 1 }));
    }, true);
    expect(await hasLiveTransparency(pdf)).toBe(false);
  });

  test("returns false rather than throwing on bytes that are not a PDF", async () => {
    expect(await hasLiveTransparency(Buffer.from("not a pdf at all"))).toBe(false);
  });
});
