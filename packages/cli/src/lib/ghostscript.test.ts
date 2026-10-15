import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFName as PdfName } from "pdf-lib";
import * as execMod from "./exec";
import * as toolProbe from "./tool-probe";
import { log } from "../utils/logger";
import {
  convertToPdfxCmyk,
  planTransparentPages,
  transparentPages,
  resolveGhostscript,
  stripAnnotations,
} from "./ghostscript";

const originalGhostscriptPath = process.env.GHOSTSCRIPT_PATH;

afterEach(() => {
  (execMod.run as unknown as { mockRestore?: () => void }).mockRestore?.();
  (execMod.spawnCapture as unknown as { mockRestore?: () => void }).mockRestore?.();
  (log.warn as unknown as { mockRestore?: () => void }).mockRestore?.();
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
    const run = spyOn(execMod, "spawnCapture").mockImplementation(async (_cmd, args) => {
      capturedArgs = args;
      const definition = args.at(-2)!;
      expect(definition).toBe(join(stagingDir, "pdfx-def.ps"));
      expect(existsSync(definition)).toBe(true);
      return { code: 1, signal: null, stdout: "Error: /undefined in x\n", stderr: "" };
    });

    await expect(
      convertToPdfxCmyk(inputPdf, outPdf, {
        iccPath,
        pdfx: "x3",
        stagingDir,
      })
    ).rejects.toThrow("Error: /undefined in x");

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

test("convertToPdfxCmyk passes pdfx.rasterDpi to Ghostscript only when set", async () => {
  const stagingDir = await mkdtemp(join(tmpdir(), "gutterpress-gs-dpi-"));
  try {
    const executable = join(stagingDir, "custom-gs");
    await writeFile(executable, "");
    process.env.GHOSTSCRIPT_PATH = executable;
    const spawnSpy = spyOn(execMod, "spawnCapture").mockResolvedValue({
      code: 0,
      signal: null,
      stdout: "",
      stderr: "",
    });
    const convert = (rasterDpi?: number) =>
      convertToPdfxCmyk(join(stagingDir, "raw.pdf"), join(stagingDir, "out.pdf"), {
        iccPath: join(stagingDir, "profile.icc"),
        pdfx: "x1a",
        stagingDir,
        rasterDpi,
      });
    await convert();
    await convert(300);
    const resolutions = spawnSpy.mock.calls.map((c) => (c[1] as string[]).filter((a) => a.startsWith("-r")));
    expect(resolutions).toEqual([[], ["-r300"]]);
    spawnSpy.mockRestore();
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
});

test("convertToPdfxCmyk logs Ghostscript's warnings block instead of discarding it", async () => {
  const stagingDir = await mkdtemp(join(tmpdir(), "gutterpress-gs-warn-"));
  try {
    const executable = join(stagingDir, "custom-gs");
    await writeFile(executable, "");
    process.env.GHOSTSCRIPT_PATH = executable;
    spyOn(execMod, "spawnCapture").mockResolvedValue({
      code: 0,
      signal: null,
      stdout: "Page 1\n\terror in pattern\n",
      stderr:
        "\nThe following warnings were encountered at least once while processing this file:\n\n   **** This file had errors that were repaired or ignored.\n",
    });
    const warn = spyOn(log, "warn").mockImplementation(() => {});

    await convertToPdfxCmyk(join(stagingDir, "raw.pdf"), join(stagingDir, "out.pdf"), {
      iccPath: join(stagingDir, "profile.icc"),
      pdfx: "x3",
      stagingDir,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("This file had errors that were repaired");
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
});

test("convertToPdfxCmyk reports a Ghostscript crash with its version", async () => {
  const stagingDir = await mkdtemp(join(tmpdir(), "gutterpress-gs-crash-"));
  try {
    const executable = join(stagingDir, "custom-gs");
    const iccPath = join(stagingDir, "profile.icc");
    await writeFile(executable, "");
    await writeFile(iccPath, "not-a-real-icc");
    process.env.GHOSTSCRIPT_PATH = executable;
    spyOn(execMod, "spawnCapture").mockResolvedValue({
      code: null,
      signal: "SIGSEGV",
      stdout: "",
      stderr: "",
    });
    const capture = spyOn(execMod, "execCapture").mockResolvedValue({
      stdout: "10.02.1\n",
      stderr: "",
    });

    await expect(
      convertToPdfxCmyk(join(stagingDir, "in.pdf"), join(stagingDir, "out.pdf"), {
        iccPath,
        pdfx: "x1a",
        stagingDir,
      })
    ).rejects.toThrow(/Ghostscript 10\.02\.1 crashed \(SIGSEGV\).*alpha-channel image/);
    expect(capture.mock.calls[0]?.[1]).toEqual(["--version"]);
    capture.mockRestore();
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
});

describe("transparentPages", () => {
  /**
   * Build a real (pdf-lib-parseable) PDF whose pages carry the entries the
   * callback adds. Real structure matters here: the predicate walks each
   * page's parsed object graph, and the regression it exists to catch is
   * precisely that a raw-byte scan cannot see dicts Chromium packs into
   * compressed object streams.
   */
  async function pdfWith(
    mutate: (
      ctx: import("pdf-lib").PDFContext,
      pages: import("pdf-lib").PDFPage[]
    ) => void,
    useObjectStreams = false,
    pageCount = 1
  ): Promise<Uint8Array> {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const pages = Array.from({ length: pageCount }, () => doc.addPage([100, 100]));
    mutate(doc.context, pages);
    return doc.save({ useObjectStreams });
  }

  /** Put `obj` in the page's `/Resources /<kind> /X`, the way Chromium does. */
  function attach(
    ctx: import("pdf-lib").PDFContext,
    page: import("pdf-lib").PDFPage,
    kind: string,
    obj: import("pdf-lib").PDFObject
  ) {
    page.node.set(PdfName.of("Resources"), ctx.obj({ [kind]: { X: ctx.register(obj) } }));
  }

  test("none on a plain opaque PDF", async () => {
    expect(await transparentPages(await pdfWith(() => {}))).toEqual([]);
  });

  test("detects an alpha-channel image (/SMask on an image XObject)", async () => {
    const { PDFName, PDFRawStream } = await import("pdf-lib");
    const pdf = await pdfWith((ctx, [page]) => {
      const mask = ctx.register(PDFRawStream.of(ctx.obj({}), new Uint8Array([0])));
      attach(
        ctx,
        page!,
        "XObject",
        PDFRawStream.of(
          ctx.obj({ Type: PDFName.of("XObject"), Subtype: PDFName.of("Image"), SMask: mask }),
          new Uint8Array([0])
        )
      );
    });
    expect(await transparentPages(pdf)).toEqual([1]);
  });

  test("does not false-positive on an opaque image's /SMask /None", async () => {
    const { PDFName, PDFRawStream } = await import("pdf-lib");
    const pdf = await pdfWith((ctx, [page]) => {
      attach(
        ctx,
        page!,
        "XObject",
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
    expect(await transparentPages(pdf)).toEqual([]);
  });

  test("detects a CSS-opacity transparency group even inside an object stream", async () => {
    const { PDFName } = await import("pdf-lib");
    // useObjectStreams: true is the case the previous raw-regex scan missed —
    // a CSS `opacity` book rasterized to zero embedded fonts with no warning.
    const pdf = await pdfWith((ctx, [page]) => {
      page!.node.set(
        PDFName.of("Group"),
        ctx.obj({ S: PDFName.of("Transparency"), Type: PDFName.of("Group") })
      );
    }, true);
    expect(await transparentPages(pdf)).toEqual([1]);
  });

  test("detects graphics-state constant alpha (/ca < 1) and names only that page", async () => {
    const { PDFName } = await import("pdf-lib");
    const pdf = await pdfWith(
      (ctx, pages) => {
        attach(ctx, pages[1]!, "ExtGState", ctx.obj({ Type: PDFName.of("ExtGState"), ca: 0.5 }));
      },
      true,
      3
    );
    expect(await transparentPages(pdf)).toEqual([2]);
  });

  test("detects a non-Normal blend mode", async () => {
    const { PDFName } = await import("pdf-lib");
    const pdf = await pdfWith((ctx, [page]) => {
      attach(
        ctx,
        page!,
        "ExtGState",
        ctx.obj({ Type: PDFName.of("ExtGState"), BM: PDFName.of("Multiply") })
      );
    });
    expect(await transparentPages(pdf)).toEqual([1]);
  });

  test("does not false-positive on a fully opaque graphics state or /BM /Normal", async () => {
    const { PDFName } = await import("pdf-lib");
    const pdf = await pdfWith((ctx, [page]) => {
      attach(
        ctx,
        page!,
        "ExtGState",
        ctx.obj({ Type: PDFName.of("ExtGState"), ca: 1, CA: 1, BM: PDFName.of("Normal") })
      );
    }, true);
    expect(await transparentPages(pdf)).toEqual([]);
  });

  test("returns none rather than throwing on bytes that are not a PDF", async () => {
    expect(await transparentPages(Buffer.from("not a pdf at all"))).toEqual([]);
  });
});

describe("planTransparentPages", () => {
  test("puts every transparent page in exactly one group", () => {
    const plan = planTransparentPages(
      [1, 2, 3, 4, 5, 6],
      new Map([
        [2, "no-text"],
        [3, "text-transparency"],
        [5, "type3-font"],
      ]),
      [],
      [4]
    );
    expect(plan.split).toEqual([1, 6]);
    expect(plan.artOnly).toEqual([2]);
    expect(plan.kept).toEqual(new Map([[3, "text-transparency"], [4, "gradient"], [5, "type3-font"]]));
  });

  test("the author's flattenPages list wins over the text's own reason and a gradient", () => {
    const plan = planTransparentPages([1, 2, 3], new Map([[2, "type3-font"]]), [1, 2, 3], [3]);
    expect(plan.split).toEqual([]);
    expect(plan.kept).toEqual(new Map([[1, "listed"], [2, "listed"], [3, "listed"]]));
  });

  test("a page with no text stays artwork-only, even when listed or carrying a gradient", () => {
    const plan = planTransparentPages([1, 2], new Map([[1, "no-text"], [2, "no-text"]]), [1], [2]);
    expect(plan).toEqual({ split: [], artOnly: [1, 2], kept: new Map() });
  });

  test("a text reason outranks a gradient on the same page", () => {
    expect(planTransparentPages([1], new Map([[1, "text-pattern-or-clip"]]), [], [1]).kept).toEqual(
      new Map([[1, "text-pattern-or-clip"]])
    );
  });

  test("listed or gradient pages without transparency are ignored", () => {
    expect(planTransparentPages([2], new Map(), [1, 9], [3])).toEqual({ split: [2], artOnly: [], kept: new Map() });
  });
});
