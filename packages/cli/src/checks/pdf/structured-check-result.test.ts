/**
 * Structured CheckResult payloads for the PDF print checks that the CLI summary
 * special-cases. These checks must emit exactly ONE CheckResult per finding
 * (per-page breakdown lives in `detail` / structured `data`), and expose
 * machine-readable `code` / `data` fields so the report layer never has to
 * re-parse human-readable message text.
 *
 * The underlying PDF inspectors (Ghostscript inkcov, PDF.js reader) are mocked
 * so these run with no external tools and no fixtures.
 */
import { describe, test, expect, spyOn, afterAll } from "bun:test";
import { resolveConfig } from "../../lib/manifest";
import type { CheckContext } from "../types";
import * as pdfParse from "../../lib/pdf-parse";
import * as pdfInspect from "../../lib/pdf-inspect";

// --- Mutable mock state -----------------------------------------------------

type InkPage = { page: number; c: number; m: number; y: number; k: number; tac: number };

// Mirrors pdf-parse.ts's InkCoverageResult discriminated union (finding #51):
// a gs failure must be distinguishable from a legitimately empty result, so
// the mock — like the real function — returns one shape or the other rather
// than always succeeding with an array.
let inkResult: { ok: true; pages: InkPage[] } | { ok: false; error: string } = {
  ok: true,
  pages: [],
};

const inspectState: {
  imagesByPage: Map<number, Array<{ placedW: number; placedH: number }>>;
  textByPage: string[];
  fonts: Array<{ name: string; embedded: boolean }>;
} = {
  imagesByPage: new Map(),
  textByPage: [],
  fonts: [],
};

// `spyOn` + `mockRestore()`, NOT `mock.module()`. `mock.module()` replaces the
// module in Bun's SHARED, process-wide resolution registry for the whole test
// run — every file that runs afterwards, not just this one — and is never
// auto-restored. That caused real cross-file pollution: any later file that
// freshly imported the real `pdf-parse`/`pdf-inspect` silently got these fakes
// (e.g. `parseInkCov()` always returning `[]`), and any later file importing
// the check registry hit a module-link `SyntaxError` because the fake's export
// list omitted `isLoadable`, which `checks/pdf/qpdf-structure.ts` imports
// statically. Reproducible with `bun test --randomize --seed=12345`.
//
// `spyOn` patches the live export bindings on the real module object that every
// other file's named imports are already bound to, so `mockRestore()` below
// hands the real implementation back to whoever runs next. Same discipline
// `build-runner.browser-lifecycle.test.ts` and `chromium.test.ts` document.
spyOn(pdfParse, "getPerPageInkCoverage").mockImplementation(async () => inkResult);
spyOn(pdfParse, "readPdfBytes").mockImplementation(async () => "");
spyOn(pdfParse, "parseInkCov").mockImplementation(() => []);

spyOn(pdfInspect, "loadPdf").mockImplementation(
  async () => ({ getPage: async () => ({}) }) as never
);
spyOn(pdfInspect, "getOpPass").mockImplementation(
  async () =>
    ({
      imagesByPage: inspectState.imagesByPage,
      fonts: inspectState.fonts,
    }) as never
);
spyOn(pdfInspect, "getTextPass").mockImplementation(
  async () => ({ textByPage: inspectState.textByPage }) as never
);
spyOn(pdfInspect, "getPageSize").mockImplementation(() => ({ w: 100, h: 100 }) as never);

afterAll(() => {
  for (const fn of [
    pdfParse.getPerPageInkCoverage,
    pdfParse.readPdfBytes,
    pdfParse.parseInkCov,
    pdfInspect.loadPdf,
    pdfInspect.getOpPass,
    pdfInspect.getTextPass,
    pdfInspect.getPageSize,
  ]) {
    (fn as unknown as { mockRestore?: () => void }).mockRestore?.();
  }
});

const inkCheck = (await import("./ink-coverage")).default;
const rasterCheck = (await import("./rasterized-pages")).default;
const fontCheck = (await import("./embedded-fonts")).default;

function makeCtx(): CheckContext {
  return {
    config: resolveConfig({}, {}),
    inputDir: "/tmp/in",
    outputDir: "/tmp/out",
    pdfPath: "/tmp/book.pdf",
  };
}

// ---------------------------------------------------------------------------

describe("ink-coverage emits one CheckResult per finding", () => {
  test("8 offending pages produce a single structured result", async () => {
    // Default limit is maxTac(240) + tolerance(0.5) = 240.5.
    inkResult = {
      ok: true,
      pages: Array.from({ length: 8 }, (_, i) => {
        const tac = 400 - i * 10;
        return { page: i + 1, c: tac / 4, m: tac / 4, y: tac / 4, k: tac / 4, tac };
      }),
    };

    const results = await inkCheck.run(makeCtx());

    expect(results).toHaveLength(1);
    const [r] = results;
    expect(r!.code).toBe("ink-coverage-exceeded");
    expect(r!.severity).toBe("warning");
    // structured payload, not parsed from prose
    expect(r!.data?.maxTac).toBe(400);
    expect(r!.data?.offendingCount).toBe(8);
    expect((r!.data?.pages as unknown[]).length).toBe(8);
    // per-page breakdown moved into detail (previously separate result rows)
    expect(r!.detail).toBeDefined();
    expect(r!.detail).toContain("Page 1");
    // user-facing headline text substantially unchanged
    expect(r!.message.startsWith("Total ink coverage")).toBe(true);
  });

  test("no offending pages produce no results", async () => {
    inkResult = { ok: true, pages: [{ page: 1, c: 10, m: 10, y: 10, k: 10, tac: 40 }] };
    const results = await inkCheck.run(makeCtx());
    expect(results).toHaveLength(0);
  });

  // Finding #51: a Ghostscript failure must surface as a visible
  // warning-severity result, not silently pass as "no offending pages".
  test("a Ghostscript failure surfaces as a warning, not a silent pass", async () => {
    inkResult = { ok: false, error: "spawn gs ENOENT" };
    const results = await inkCheck.run(makeCtx());

    expect(results).toHaveLength(1);
    const [r] = results;
    expect(r!.severity).toBe("warning");
    expect(r!.code).toBe("ink-coverage-unmeasured");
    expect(r!.message).toBe("Ink coverage could not be measured");
    expect(r!.detail).toContain("spawn gs ENOENT");
    expect(r!.data?.error).toBe("spawn gs ENOENT");
  });
});

describe("rasterized-pages emits one CheckResult per finding", () => {
  test("3 rasterized pages produce a single structured result", async () => {
    const img = { placedW: 100, placedH: 100 };
    inspectState.imagesByPage = new Map([
      [1, [img]],
      [2, [img]],
      [3, [img]],
    ]);
    inspectState.textByPage = ["x".repeat(50), "y".repeat(50), "z".repeat(50)];

    const results = await rasterCheck.run(makeCtx());

    expect(results).toHaveLength(1);
    const [r] = results;
    expect(r!.code).toBe("rasterized-pages-detected");
    expect(r!.data?.pages).toEqual([1, 2, 3]);
    expect(r!.detail).toBeDefined();
    expect(r!.message.startsWith("Possible rasterized pages detected:")).toBe(
      true
    );
  });
});

describe("embedded-fonts exposes structured codes", () => {
  test("no fonts detected -> single result with code no-fonts", async () => {
    inspectState.fonts = [];
    const results = await fontCheck.run(makeCtx());
    expect(results).toHaveLength(1);
    expect(results[0]!.code).toBe("no-fonts");
  });

  test("unembedded font -> single result with code fonts-not-embedded", async () => {
    inspectState.fonts = [
      { name: "Foo", embedded: false },
      { name: "Bar", embedded: true },
    ];
    const results = await fontCheck.run(makeCtx());
    expect(results).toHaveLength(1);
    expect(results[0]!.code).toBe("fonts-not-embedded");
    expect(results[0]!.severity).toBe("error");
    expect((results[0]!.data?.fonts as string[]).includes("Foo")).toBe(true);
  });

  test("all fonts embedded -> no results", async () => {
    inspectState.fonts = [{ name: "Foo", embedded: true }];
    const results = await fontCheck.run(makeCtx());
    expect(results).toHaveLength(0);
  });
});
