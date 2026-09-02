/**
 * Unit tests for the render-parity gate's pure logic (issue #252). No
 * Chromium, no PDFs — these build synthetic `Report` objects directly and
 * exercise `compareReports`/`formatDiffs`/`serializeReport`. The
 * Chromium-backed acceptance test (build a real fixture twice, assert
 * byte-identical extraction; rebuild with an injected shift, assert a real
 * diff) lives in render-parity.acceptance.test.ts.
 */
import { describe, test, expect } from "bun:test";
import {
  compareReports,
  formatDiffs,
  serializeReport,
  WaiverValidationError,
  type ImageReport,
  type PageReport,
  type Report,
  type TextRunReport,
  type Waiver,
} from "./render-parity.ts";

function run(overrides: Partial<TextRunReport> = {}): TextRunReport {
  return { s: "Hello, world.", x: 72, y: 700, w: 60, h: 10, ...overrides };
}

function image(overrides: Partial<ImageReport> = {}): ImageReport {
  return { x: 100, y: 200, w: 144, h: 96, ...overrides };
}

function page(overrides: Partial<PageReport> = {}): PageReport {
  return { w: 612, h: 792, text: [], images: [], ...overrides };
}

function report(pages: PageReport[]): Report {
  return { version: 1, pageCount: pages.length, pages };
}

// A plain structuredClone-alike, since these are all JSON-safe plain objects.
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

describe("serializeReport — canonical, stable output", () => {
  test("is stable across repeated calls on the same report", () => {
    const r = report([page({ text: [run()], images: [image()] })]);
    expect(serializeReport(r)).toBe(serializeReport(clone(r)));
  });

  test("writes keys in the documented fixed order", () => {
    const r = report([page({ text: [run()], images: [image()] })]);
    const out = serializeReport(r);

    // Top level: version, pageCount, pages.
    const topOrder = ["\"version\"", "\"pageCount\"", "\"pages\""].map((k) => out.indexOf(k));
    expect(topOrder).toEqual([...topOrder].sort((a, b) => a - b));
    expect(topOrder.every((i) => i >= 0)).toBe(true);

    // Page: w, h, text, images.
    const pageOrder = ["\"w\"", "\"h\"", "\"text\"", "\"images\""].map((k) => out.indexOf(k));
    expect(pageOrder).toEqual([...pageOrder].sort((a, b) => a - b));

    // Text run: s, x, y, w, h (first occurrence, inside "text").
    const textBlock = out.slice(out.indexOf("\"text\""));
    const runOrder = ["\"s\"", "\"x\"", "\"y\"", "\"w\"", "\"h\""].map((k) => textBlock.indexOf(k));
    expect(runOrder).toEqual([...runOrder].sort((a, b) => a - b));
  });

  test("ends with exactly one trailing newline", () => {
    const out = serializeReport(report([page()]));
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("compareReports — clean baseline", () => {
  test("identical reports produce no diffs, no waived, no unused waivers", () => {
    const r = report([page({ text: [run()], images: [image()] })]);
    const result = compareReports(r, clone(r));
    expect(result.diffs).toEqual([]);
    expect(result.waived).toEqual([]);
    expect(result.unusedWaivers).toEqual([]);
  });

  test("formatDiffs reports CLEAN for a clean compare", () => {
    const r = report([page()]);
    const result = compareReports(r, clone(r));
    const lines = formatDiffs(result, { basePageCount: 1, candPageCount: 1, tolerance: 0.5 });
    expect(lines).toEqual(["CLEAN: 1 pages"]);
  });
});

describe("compareReports — a real 1.0pt shift on one text run", () => {
  function shiftedPair(): { base: Report; cand: Report } {
    const base = report([page({ text: [run({ y: 700 })] })]);
    const cand = clone(base);
    cand.pages[0]!.text[0]!.y = 701; // exactly 1.0pt
    return { base, cand };
  }

  test("fails at the default 0.5pt tolerance with a readable page/kind/before->after line", () => {
    const { base, cand } = shiftedPair();
    const result = compareReports(base, cand);

    expect(result.diffs).toHaveLength(1);
    const d = result.diffs[0]!;
    expect(d.kind).toBe("text");
    expect(d.page).toBe(1);
    expect(d.before).toContain("700.000");
    expect(d.after).toContain("701.000");

    const lines = formatDiffs(result, { basePageCount: 1, candPageCount: 1, tolerance: 0.5 });
    const diffLine = lines.find((l) => l.startsWith("p1 "));
    expect(diffLine).toBeDefined();
    expect(diffLine).toContain("p1");
    expect(diffLine).toContain("text");
    expect(diffLine).toContain("->");
    expect(diffLine).toContain("700.000");
    expect(diffLine).toContain("701.000");
    // The summary line still names the tolerance and the (un-waived) count.
    expect(lines.at(-1)).toBe("DIFF: 1 vs 1 pages, 1 diff(s), tolerance 0.5pt");
  });

  test("a tolerance of 1.5pt makes the exact same 1.0pt shift pass", () => {
    const { base, cand } = shiftedPair();
    const result = compareReports(base, cand, { tolerance: 1.5 });
    expect(result.diffs).toEqual([]);
  });

  test("a matching waiver excuses the diff and is itself consumed", () => {
    const { base, cand } = shiftedPair();
    const waivers: Waiver[] = [
      { page: 1, kind: "text", reason: "known 1pt shift — test fixture" },
    ];
    const result = compareReports(base, cand, { waivers });

    expect(result.diffs).toEqual([]);
    expect(result.waived).toHaveLength(1);
    expect(result.unusedWaivers).toEqual([]);

    const lines = formatDiffs(result, { basePageCount: 1, candPageCount: 1, tolerance: 0.5 });
    expect(lines.some((l) => l.startsWith("WAIVED"))).toBe(true);
    expect(lines.at(-1)).toBe("CLEAN: 1 pages (1 waived)");
  });

  test("a waiver's `match` must find the run's text, or it does not apply", () => {
    const { base, cand } = shiftedPair();
    const waivers: Waiver[] = [
      { page: 1, kind: "text", match: "nowhere in this run", reason: "should not match" },
    ];
    const result = compareReports(base, cand, { waivers });
    expect(result.diffs).toHaveLength(1); // still fails — the waiver did not apply
    expect(result.unusedWaivers).toHaveLength(1); // and is reported stale
  });

  test("an unused waiver warns but does not block an otherwise-clean compare", () => {
    const base = report([page({ text: [run()] })]);
    const cand = clone(base);
    const waivers: Waiver[] = [
      { page: 5, kind: "text", reason: "does not exist in this fixture" },
    ];
    const result = compareReports(base, cand, { waivers });

    expect(result.diffs).toEqual([]); // clean compare stays clean...
    expect(result.unusedWaivers).toHaveLength(1); // ...but the stale waiver is surfaced

    const lines = formatDiffs(result, { basePageCount: 1, candPageCount: 1, tolerance: 0.5 });
    expect(lines.some((l) => l.includes("WARNING") && l.includes("unused waiver"))).toBe(true);
    // Exit-code contract: only `diffs` decides pass/fail (see scripts/render-parity.ts).
    expect(result.diffs.length > 0 ? 1 : 0).toBe(0);
  });
});

describe("compareReports — page-count and page-size diffs", () => {
  test("a page-count mismatch is reported with no `page` field", () => {
    const base = report([page(), page()]);
    const cand = report([page()]);
    const result = compareReports(base, cand);

    const d = result.diffs.find((d) => d.kind === "page-count");
    expect(d).toBeDefined();
    expect(d!.page).toBeUndefined();
    expect(d!.before).toBe("2");
    expect(d!.after).toBe("1");
  });

  test("a page-size mismatch is reported for the offending page", () => {
    const base = report([page({ w: 612, h: 792 })]);
    const cand = report([page({ w: 612, h: 800 })]);
    const result = compareReports(base, cand);

    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0]!.kind).toBe("page-size");
    expect(result.diffs[0]!.page).toBe(1);
    expect(result.diffs[0]!.before).toBe("612.000x792.000");
    expect(result.diffs[0]!.after).toBe("612.000x800.000");
  });
});

describe("compareReports — exact string content, independent of extent tolerance", () => {
  test("a changed run STRING is a diff even with identical extents", () => {
    const base = report([page({ text: [run({ s: "Original text." })] })]);
    const cand = report([page({ text: [run({ s: "Different text." })] })]);
    const result = compareReports(base, cand, { tolerance: 1000 }); // extents irrelevant here

    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0]!.kind).toBe("text");
    expect(result.diffs[0]!.before).toBe("Original text.");
    expect(result.diffs[0]!.after).toBe("Different text.");
  });

  test("a string mismatch stops further per-index comparison on that page (reflow cascade)", () => {
    const base = report([
      page({ text: [run({ s: "One" }), run({ s: "Two", y: 690 }), run({ s: "Three", y: 680 })] }),
    ]);
    const cand = report([
      // "One" reflowed into two runs, shifting everything after it — a real
      // rebuild would show every following run's index misaligned.
      page({
        text: [
          run({ s: "On" }),
          run({ s: "eTwo", y: 690 }),
          run({ s: "Three", y: 680 }),
        ],
      }),
    ]);
    const result = compareReports(base, cand);
    // Only the first divergence is reported — not a cascade of misaligned
    // index comparisons for every run after it.
    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0]!.index).toBe(0);
  });
});

describe("compareReports — image placements", () => {
  test("an image shifted beyond tolerance is a diff on x/y/w/h", () => {
    const base = report([page({ images: [image({ x: 100, y: 200 })] })]);
    const cand = report([page({ images: [image({ x: 100.8, y: 200 })] })]);
    const result = compareReports(base, cand); // default 0.5pt tolerance

    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0]!.kind).toBe("image");
    expect(result.diffs[0]!.before).toContain("x 100.000");
    expect(result.diffs[0]!.after).toContain("x 100.800");
  });

  test("an image within tolerance is not a diff", () => {
    const base = report([page({ images: [image({ x: 100 })] })]);
    const cand = report([page({ images: [image({ x: 100.2 })] })]);
    expect(compareReports(base, cand).diffs).toEqual([]);
  });
});

describe("compareReports — waiver validation", () => {
  test("a waiver with no reason is a usage error, not a silent pass", () => {
    const base = report([page({ text: [run()] })]);
    const cand = clone(base);
    const waivers = [{ page: 1, kind: "text" } as Waiver]; // reason omitted
    expect(() => compareReports(base, cand, { waivers })).toThrow(WaiverValidationError);
  });

  test("a waiver with an empty-string reason is also rejected", () => {
    const base = report([page({ text: [run()] })]);
    const cand = clone(base);
    const waivers: Waiver[] = [{ page: 1, kind: "text", reason: "   " }];
    expect(() => compareReports(base, cand, { waivers })).toThrow(WaiverValidationError);
  });

  test("validation runs before any comparison — rejected even for an otherwise-clean compare", () => {
    const base = report([page()]);
    const cand = clone(base);
    const waivers = [{ page: 1, kind: "page-size" } as Waiver];
    expect(() => compareReports(base, cand, { waivers })).toThrow(WaiverValidationError);
  });
});

describe("formatDiffs — per-page cap on a reflowed/shifted page", () => {
  test("caps printed lines at 12 per page and notes the remainder, without dropping them from the decision", () => {
    // 15 runs, every one shifted by exactly 1.0pt (a uniform CSS-level shift,
    // the realistic shape of a reflow-causing regression on a dense page).
    const runs = Array.from({ length: 15 }, (_, i) => run({ s: `Line ${i}`, y: 700 - i * 10 }));
    const base = report([page({ text: runs })]);
    const cand = clone(base);
    for (const r of cand.pages[0]!.text as TextRunReport[]) r.y -= 1;

    const result = compareReports(base, cand);
    expect(result.diffs).toHaveLength(15); // nothing dropped from the decision

    const lines = formatDiffs(result, { basePageCount: 1, candPageCount: 1, tolerance: 0.5 });
    const page1Lines = lines.filter((l) => l.startsWith("p1 "));
    expect(page1Lines).toHaveLength(12);
    expect(lines.some((l) => l.includes("...3 more"))).toBe(true);
  });
});
