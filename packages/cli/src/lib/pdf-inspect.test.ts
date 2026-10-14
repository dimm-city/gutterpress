/**
 * Integration tests for the in-process PDF reader (unpdf/PDF.js) against a real
 * Chromium-generated PDF fixture. These exercise the pure-JS replacements for
 * Poppler + general qpdf inspection.
 *
 * The document is loaded once and shared via pdf-inspect's internal cache, so
 * the expensive operator-list pass is paid a single time across all assertions.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadPdf,
  clearPdfCache,
  retainPdfCache,
  pendingGraceDestroyCount,
  DOC_CACHE_MAX,
  getPageSize,
  getOutlineCount,
  getOpPass,
  isLoadable,
  pagesWithUnsplittableText,
} from "./pdf-inspect";
import type { PDFDocumentProxy } from "unpdf/pdfjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// Large (135 MB), Chromium-generated, and gitignored — present on dev machines,
// absent in CI. The rich integration suite below runs only when it exists; the
// synthetic pdf-lib suite further down always runs (CI baseline coverage).
const FIXTURE = join(HERE, "../../../cli/tests/field-guide.pdf");
const HAS_FIXTURE = existsSync(FIXTURE);

if (!HAS_FIXTURE) {
  console.warn(
    `[pdf-inspect.test] fixture not found (${FIXTURE}); skipping real-PDF suite`
  );
}

describe.skipIf(!HAS_FIXTURE)("pdf-inspect (real PDF fixture)", () => {
  let doc: PDFDocumentProxy;

  beforeAll(async () => {
    doc = (await loadPdf(FIXTURE))!;
    // Warm the operator-list pass (≈6s on this 330-page fixture) once so the
    // individual assertions below stay well under bun's default test timeout.
    await getOpPass(doc);
  }, 60_000);

  test("loads the document and reports page count", () => {
    expect(doc).toBeTruthy();
    expect(doc.numPages).toBe(330);
  });

  test("loadPdf returns the same cached instance for the same path", async () => {
    const again = await loadPdf(FIXTURE);
    expect(again).toBe(doc);
  });

  test("loadPdf returns null for a missing file", async () => {
    expect(await loadPdf(join(HERE, "does-not-exist.pdf"))).toBeNull();
  });

  test("page size is reported in points (US Letter)", async () => {
    const page = await doc.getPage(1);
    const { w, h } = getPageSize(page);
    expect(Math.round(w)).toBe(612);
    expect(Math.round(h)).toBe(792);
  });

  test("reads the outline (bookmark) tree", async () => {
    expect(await getOutlineCount(doc)).toBeGreaterThan(0);
  });

  test("enumerates fonts and detects them as embedded (Chromium output)", async () => {
    const { fonts } = await getOpPass(doc);
    expect(fonts.length).toBeGreaterThan(0);
    // Chromium subsets + embeds every font.
    expect(fonts.every((f) => f.embedded)).toBe(true);
  });

  test("builds a per-page image inventory with placed sizes", async () => {
    const { imagesByPage } = await getOpPass(doc);
    expect(imagesByPage.size).toBeGreaterThan(0);
    for (const imgs of imagesByPage.values()) {
      for (const img of imgs) {
        expect(img.placedW).toBeGreaterThan(0);
        expect(img.placedH).toBeGreaterThan(0);
      }
    }
  });

  test("structural parse gate passes for a valid PDF", async () => {
    expect(await isLoadable(doc)).toBe(true);
  });
});

// Synthetic PDF generated in-test with pdf-lib (a runtime dep) — no large
// fixture or external tools needed, so this runs everywhere including CI.
// Covers the loader, page-size, structural gate, and the no-outline path.
describe("pdf-inspect (synthetic pdf-lib document)", () => {
  let dir: string;
  let pdfPath: string;

  beforeAll(async () => {
    const { PDFDocument } = await import("pdf-lib");
    const docu = await PDFDocument.create();
    docu.addPage([612, 792]); // US Letter, points
    docu.addPage([612, 792]);
    const bytes = await docu.save();
    dir = await mkdtemp(join(tmpdir(), "gutterpress-pdfinspect-"));
    pdfPath = join(dir, "synthetic.pdf");
    await writeFile(pdfPath, bytes);
  });

  test("loads and reports page count", async () => {
    const doc = await loadPdf(pdfPath);
    expect(doc).toBeTruthy();
    expect(doc!.numPages).toBe(2);
  });

  test("reports page size in points", async () => {
    const doc = (await loadPdf(pdfPath))!;
    const { w, h } = getPageSize(await doc.getPage(1));
    expect(Math.round(w)).toBe(612);
    expect(Math.round(h)).toBe(792);
  });

  test("no outline → count 0; structural gate passes", async () => {
    const doc = (await loadPdf(pdfPath))!;
    expect(await getOutlineCount(doc)).toBe(0);
    expect(await isLoadable(doc)).toBe(true);
  });

  test("loadPdf returns null for a missing file", async () => {
    expect(await loadPdf(join(dir, "nope.pdf"))).toBeNull();
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
});

// Cache-bounding behavior: LRU eviction defers destruction by a grace period
// (so a mid-check reader isn't killed), but the reclaim — clearPdfCache
// directly, or the last retainPdfCache scope releasing — must destroy
// grace-held evicted documents immediately, not leave them (and their timers)
// alive for up to a minute.
describe("pdf-inspect cache eviction + clearPdfCache", () => {
  let dir: string;
  const paths: string[] = [];

  beforeAll(async () => {
    const { PDFDocument } = await import("pdf-lib");
    const docu = await PDFDocument.create();
    docu.addPage([612, 792]);
    const bytes = await docu.save();
    dir = await mkdtemp(join(tmpdir(), "gutterpress-pdfcache-"));
    // DOC_CACHE_MAX + 1 distinct paths, so loading them all evicts exactly one.
    for (let i = 0; i < DOC_CACHE_MAX + 1; i++) {
      const p = join(dir, `doc-${i}.pdf`);
      await writeFile(p, bytes);
      paths.push(p);
    }
  });

  afterAll(async () => {
    clearPdfCache();
    await rm(dir, { recursive: true, force: true });
  });

  test("clearPdfCache destroys grace-held evicted documents immediately", async () => {
    clearPdfCache(); // isolate from documents cached by earlier suites
    const first = (await loadPdf(paths[0]!))!;
    let destroyed = false;
    const origDestroy = first.destroy.bind(first);
    first.destroy = () => {
      destroyed = true;
      return origDestroy();
    };

    // Load the remaining 8 distinct paths → paths[0] becomes the LRU evictee.
    for (let i = 1; i < paths.length; i++) {
      expect(await loadPdf(paths[i]!)).toBeTruthy();
    }
    await new Promise((r) => setTimeout(r, 20));
    // Eviction alone must NOT destroy it yet — the grace period protects a
    // reader that obtained the proxy just before the eviction.
    expect(destroyed).toBe(false);
    expect(pendingGraceDestroyCount()).toBe(1);

    // The run-boundary reclaim must cancel the grace timer and destroy the
    // evicted document too, not only the 8 still in the cache map.
    clearPdfCache();
    await new Promise((r) => setTimeout(r, 20));
    expect(destroyed).toBe(true);
    expect(pendingGraceDestroyCount()).toBe(0); // no live timers left behind
  });

  // Overlapping-run protection: runChecks is served by a long-lived host (the
  // desktop) where two runs CAN overlap. Each run holds a retain scope; the
  // cache (including grace-held evictees) is cleared only when the LAST scope
  // releases, so one run's end cannot destroy documents the other is reading.
  test("releasing one of two overlapping retains keeps documents alive; the last release clears cached + grace-held", async () => {
    clearPdfCache(); // isolate from earlier suites
    const release1 = retainPdfCache();
    const release2 = retainPdfCache();

    const first = (await loadPdf(paths[0]!))!;
    let destroyed = false;
    const origDestroy = first.destroy.bind(first);
    first.destroy = () => {
      destroyed = true;
      return origDestroy();
    };
    // Evict paths[0] into its destroy-grace window.
    for (let i = 1; i < paths.length; i++) {
      expect(await loadPdf(paths[i]!)).toBeTruthy();
    }
    expect(pendingGraceDestroyCount()).toBe(1);

    // First release: another scope is still active — nothing may be destroyed.
    release1();
    await new Promise((r) => setTimeout(r, 20));
    expect(destroyed).toBe(false);
    expect(pendingGraceDestroyCount()).toBe(1);

    // Last release: cached + grace-held documents are destroyed, timers gone.
    release2();
    await new Promise((r) => setTimeout(r, 20));
    expect(destroyed).toBe(true);
    expect(pendingGraceDestroyCount()).toBe(0);
  });

  test("release is idempotent — a stale release cannot clear a newer scope", async () => {
    clearPdfCache();
    const stale = retainPdfCache();
    stale();
    stale(); // extra call must be a no-op, not a second decrement

    const active = retainPdfCache();
    const doc = (await loadPdf(paths[0]!))!;
    let destroyed = false;
    const origDestroy = doc.destroy.bind(doc);
    doc.destroy = () => {
      destroyed = true;
      return origDestroy();
    };

    stale(); // still a no-op while the newer scope is active
    await new Promise((r) => setTimeout(r, 20));
    expect(destroyed).toBe(false);
    expect(await loadPdf(paths[0]!)).toBe(doc);

    active();
    await new Promise((r) => setTimeout(r, 20));
    expect(destroyed).toBe(true);
  });
});

describe("pagesWithUnsplittableText", () => {
  const TEXT = "BT /F1 12 Tf 10 50 Td (Hello) Tj ET";

  /**
   * One-page PDF whose content stream is `content`. `gs` maps ExtGState names
   * to their entries; `forms` maps XObject names to `{ content, group }`.
   * `pageGroup` puts a transparency group on the PAGE itself.
   */
  async function pdf(
    content: string,
    opts: {
      gs?: Record<string, Record<string, unknown>>;
      forms?: Record<string, { content: string; group?: boolean; knockout?: boolean }>;
      pageGroup?: boolean;
    } = {}
  ): Promise<Uint8Array> {
    const { PDFDocument, PDFName, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    const { context } = doc;
    const font = doc.embedStandardFont(StandardFonts.Helvetica);
    const extGState = context.obj({});
    for (const [name, entries] of Object.entries(opts.gs ?? {})) {
      const dict = context.obj({ Type: "ExtGState" });
      for (const [k, v] of Object.entries(entries)) {
        dict.set(
          PDFName.of(k),
          k === "SMask"
            ? context.obj({
                Type: "Mask",
                S: "Luminosity",
                G: context.register(
                  context.stream("0 g 0 0 100 100 re f", {
                    Type: "XObject",
                    Subtype: "Form",
                    BBox: [0, 0, 100, 100],
                    Group: { S: "Transparency", CS: "DeviceGray" },
                  })
                ),
              })
            : typeof v === "string"
              ? PDFName.of(v)
              : context.obj(v as number)
        );
      }
      extGState.set(PDFName.of(name), context.register(dict));
    }
    const xobjects = context.obj({});
    for (const [name, form] of Object.entries(opts.forms ?? {})) {
      const stream = context.stream(form.content, {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 100, 100],
        Resources: { Font: { F1: font.ref }, XObject: xobjects, ExtGState: extGState },
        ...(form.group
          ? { Group: { S: "Transparency", Type: "Group", I: true, K: !!form.knockout } }
          : {}),
      });
      xobjects.set(PDFName.of(name), context.register(stream));
    }
    page.node.set(
      PDFName.of("Resources"),
      context.obj({ Font: { F1: font.ref }, ExtGState: extGState, XObject: xobjects })
    );
    page.node.set(PDFName.of("Contents"), context.register(context.stream(content)));
    if (opts.pageGroup) {
      page.node.set(PDFName.of("Group"), context.obj({ S: "Transparency", Type: "Group" }));
    }
    return doc.save();
  }

  test("plain text beside a soft shadow is eligible", async () => {
    const bytes = await pdf(`q /G gs 0 0 40 40 re f Q ${TEXT}`, { gs: { G: { ca: 0.4 } } });
    expect(await pagesWithUnsplittableText(bytes)).toEqual([]);
  });

  test("a page-level /Group alone does not count", async () => {
    expect(await pagesWithUnsplittableText(await pdf(TEXT, { pageGroup: true }))).toEqual([]);
  });

  test("constant alpha, blend mode and soft mask on the text flag the page", async () => {
    const gs = {
      A: { ca: 0.15 },
      S: { CA: 0.5 },
      B: { BM: "Multiply" },
      M: { SMask: "mask" },
    };
    for (const name of Object.keys(gs)) {
      expect(await pagesWithUnsplittableText(await pdf(`q /${name} gs ${TEXT} Q`, { gs }))).toEqual([1]);
    }
  });

  test("an opaque or Normal state is eligible, and Q ends the effect", async () => {
    const gs = { N: { ca: 1, CA: 1, BM: "Normal" }, A: { ca: 0.15 } };
    expect(await pagesWithUnsplittableText(await pdf(`q /N gs ${TEXT} Q`, { gs }))).toEqual([]);
    expect(await pagesWithUnsplittableText(await pdf(`q /A gs 0 0 5 5 re f Q ${TEXT}`, { gs }))).toEqual([]);
  });

  test("text in a plain isolated group at alpha 1 is eligible (Chromium's wrapper)", async () => {
    const forms = { Grp: { content: TEXT, group: true }, Plain: { content: TEXT } };
    expect(await pagesWithUnsplittableText(await pdf("/Grp Do", { forms }))).toEqual([]);
    expect(await pagesWithUnsplittableText(await pdf("/Plain Do", { forms }))).toEqual([]);
  });

  test("text in an opacity group (alpha set outside, reset inside) is flagged", async () => {
    // What Chromium emits for `opacity: .15`: the alpha is on the Do, the form resets it.
    const gs = { A: { ca: 0.15 }, One: { ca: 1 } };
    const forms = { Grp: { content: `/One gs ${TEXT}`, group: true } };
    expect(await pagesWithUnsplittableText(await pdf("q /A gs /Grp Do Q", { gs, forms }))).toEqual([1]);
  });

  test("text in a knockout group is flagged, and so is text nested inside one", async () => {
    const forms = {
      Plain: { content: TEXT },
      Knock: { content: "/Plain Do", group: true, knockout: true },
    };
    expect(await pagesWithUnsplittableText(await pdf("/Knock Do", { forms }))).toEqual([1]);
  });

  test("a plain form inherits the state it is drawn in", async () => {
    const gs = { A: { ca: 0.15 } };
    const forms = { Plain: { content: TEXT } };
    expect(await pagesWithUnsplittableText(await pdf("q /A gs /Plain Do Q", { gs, forms }))).toEqual([1]);
  });
});

describe("pagesWithUnsplittableText: text paint", () => {
  const TEXT = "BT /F1 12 Tf 10 50 Td (Hello) Tj ET";
  async function pdf(content: string, pattern = false): Promise<Uint8Array> {
    const { PDFDocument, PDFName, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    const { context } = doc;
    const font = doc.embedStandardFont(StandardFonts.Helvetica);
    const patterns = context.obj({});
    if (pattern) {
      const tile = context.stream("1 0 0 rg 0 0 5 10 re f 0 0 1 rg 5 0 5 10 re f", {
        Type: "Pattern", PatternType: 1, PaintType: 1, TilingType: 1,
        BBox: [0, 0, 10, 10], XStep: 10, YStep: 10, Resources: {},
      });
      patterns.set(PDFName.of("P0"), context.register(tile));
    }
    page.node.set(PDFName.of("Resources"), context.obj({ Font: { F1: font.ref }, Pattern: patterns }));
    page.node.set(PDFName.of("Contents"), context.register(context.stream(content)));
    return doc.save();
  }

  test("text filled with a tiling pattern is flagged", async () => {
    expect(await pagesWithUnsplittableText(await pdf(`/Pattern cs /P0 scn ${TEXT}`, true))).toEqual([1]);
  });

  test("a plain fill colour after the pattern, or Q, makes text eligible again", async () => {
    expect(await pagesWithUnsplittableText(await pdf(`/Pattern cs /P0 scn 0 g ${TEXT}`, true))).toEqual([]);
    expect(await pagesWithUnsplittableText(await pdf(`q /Pattern cs /P0 scn Q ${TEXT}`, true))).toEqual([]);
  });

  test("text used as a clip (render modes 4-7) is flagged; invisible text (3) is not", async () => {
    expect(await pagesWithUnsplittableText(await pdf("BT 7 Tr /F1 12 Tf 10 50 Td (Hello) Tj ET"))).toEqual([1]);
    expect(await pagesWithUnsplittableText(await pdf("BT 3 Tr /F1 12 Tf 10 50 Td (Hello) Tj ET"))).toEqual([]);
  });
});
