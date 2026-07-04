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
import { describe, test, expect, mock } from "bun:test";
import { resolveConfig } from "../../lib/manifest";
import type { CheckContext } from "../types";

// --- Mutable mock state -----------------------------------------------------

let inkPages: Array<{
  page: number;
  c: number;
  m: number;
  y: number;
  k: number;
  tac: number;
}> = [];

const inspectState: {
  imagesByPage: Map<number, Array<{ placedW: number; placedH: number }>>;
  textByPage: string[];
  fonts: Array<{ name: string; embedded: boolean }>;
} = {
  imagesByPage: new Map(),
  textByPage: [],
  fonts: [],
};

await mock.module("../../lib/pdf-parse", () => ({
  getPerPageInkCoverage: async () => inkPages,
  readPdfBytes: async () => "",
  parseInkCov: () => [],
}));

await mock.module("../../lib/pdf-inspect", () => ({
  loadPdf: async () => ({ getPage: async () => ({}) }),
  getOpPass: async () => ({
    imagesByPage: inspectState.imagesByPage,
    fonts: inspectState.fonts,
  }),
  getTextPass: async () => ({ textByPage: inspectState.textByPage }),
  getPageSize: () => ({ w: 100, h: 100 }),
}));

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
    inkPages = Array.from({ length: 8 }, (_, i) => {
      const tac = 400 - i * 10;
      return { page: i + 1, c: tac / 4, m: tac / 4, y: tac / 4, k: tac / 4, tac };
    });

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
    inkPages = [{ page: 1, c: 10, m: 10, y: 10, k: 10, tac: 40 }];
    const results = await inkCheck.run(makeCtx());
    expect(results).toHaveLength(0);
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
