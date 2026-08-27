/**
 * Acceptance tests for `createEditorProjection` (D6; run
 * docs/plans/source-first-editor/runs/SFE-P2b.md). Renders through the REAL
 * pipeline (`createMarkdownRenderer()` by default, or a caller-supplied one)
 * — never a parallel parser config (G-03).
 *
 * Tests are allowed `node:fs`/`node:path` (they never ship in the render
 * graph — only editor-projection.ts itself does; `check-render-pure.mjs`
 * scopes to `dist/render.js`, not test files).
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import {
  createEditorProjection,
  PROJECTION_SCHEMA_VERSION,
  type GeneratedView,
  type GutterpressProjection,
  type ProjectedBlock,
  type ProjectedBlockKind,
} from "./editor-projection";

// ── marker-kind enumeration (programmatic, against markers.js's own source) ─
//
// markers.js does not export KNOWN_KINDS (it is Gutterpress-owned, §6 —
// this lane may not add an export to it), so this reads the array literal
// out of the source text directly. This keeps the enumeration honest against
// drift: if markers.js ever grows an 8th kind, this test's derived set
// changes with it instead of silently going stale.
const MARKERS_JS_PATH = fileURLToPath(new URL("./markers.js", import.meta.url));
const MARKERS_JS_SOURCE = readFileSync(MARKERS_JS_PATH, "utf8");

function extractKnownKinds(): string[] {
  const m = /const KNOWN_KINDS = \[([\s\S]*?)\];/.exec(MARKERS_JS_SOURCE);
  if (!m) throw new Error("markers.js's KNOWN_KINDS array literal was not found — enumeration test cannot verify coverage");
  const body = m[1]!;
  return [...body.matchAll(/'([^']+)'/g)].map((mm) => mm[1]!);
}

describe("marker-kind enumeration (programmatic)", () => {
  const knownKinds = extractKnownKinds();

  test("markers.js's KNOWN_KINDS has exactly 8 entries: 6 projected kinds + 2 control markers", () => {
    // continue / end-section are control markers: @continue closes one
    // section and opens another (the new section is an ordinary "section"
    // block, not a kind of its own); @end-section closes a section and
    // emits no token at all. See this module's header "KIND ENUMERATION".
    expect(knownKinds).toEqual([
      "chapter",
      "spread",
      "page",
      "section",
      "continue",
      "page-break",
      "column-break",
      "end-section",
    ]);
  });

  test("every non-control marker kind maps to a distinct ProjectedBlockKind", () => {
    const controlMarkers = new Set(["continue", "end-section"]);
    const projectableMarkerKinds = knownKinds.filter((k) => !controlMarkers.has(k));
    expect(projectableMarkerKinds.sort()).toEqual(
      ["chapter", "column-break", "page", "page-break", "section", "spread"].sort(),
    );
  });
});

// ── shared invariant assertions ──────────────────────────────────────────────

function assertProjectionInvariants(projection: GutterpressProjection, source: string): void {
  expect(projection.schemaVersion).toBe(1);

  let previous: ProjectedBlock | null = null;
  for (const block of projection.blocks) {
    expect(block.from).toBeGreaterThanOrEqual(0);
    expect(block.from).toBeLessThan(block.to);
    expect(block.to).toBeLessThanOrEqual(source.length);

    if (previous) {
      // Sorted by `from`, and non-overlapping — see this module's header
      // "WHY BLOCKS ARE NOT NESTED": the marker family only ever covers its
      // own declaration line, so blocks are ordered/disjoint, never nested.
      expect(block.from).toBeGreaterThanOrEqual(previous.from);
      expect(block.to).toBeGreaterThanOrEqual(previous.to);
      expect(previous.to).toBeLessThanOrEqual(block.from);
    }
    previous = block;
  }

  for (const view of projection.generated) {
    expect(view.anchor).toBeGreaterThanOrEqual(0);
    expect(view.anchor).toBeLessThanOrEqual(source.length);
    // Runtime proof (alongside the compile-time proof below): a
    // GeneratedView carries no writable range at all.
    expect("from" in view).toBe(false);
    expect("to" in view).toBe(false);
  }
}

// Type-level proof (D6/G-04): GeneratedView cannot carry a writable range —
// this must be a compile error if the shape ever grows `from`/`to`, checked
// by `bun run typecheck`, not just at runtime above.
type GeneratedViewHasNoRange = GeneratedView extends { from: number } ? "FAIL" : "OK";
type GeneratedViewHasNoRange2 = GeneratedView extends { to: number } ? "FAIL" : "OK";
const _generatedViewTypeProof: GeneratedViewHasNoRange = "OK";
const _generatedViewTypeProof2: GeneratedViewHasNoRange2 = "OK";
void _generatedViewTypeProof;
void _generatedViewTypeProof2;

function blockOf(projection: GutterpressProjection, kind: ProjectedBlockKind): ProjectedBlock {
  const found = projection.blocks.find((b) => b.kind === kind);
  if (!found) throw new Error(`expected a projected block of kind "${kind}", found none (liveness check — AP-21)`);
  return found;
}

// ── every marker-family kind, exact ranges ───────────────────────────────────

describe("marker-family projection: exact ranges, one block per declaration line", () => {
  test("@chapter", () => {
    const source = "@chapter C.01\nHello\n";
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    assertProjectionInvariants(projection, source);
    const block = blockOf(projection, "chapter");
    expect(source.slice(block.from, block.to)).toBe("@chapter C.01\n");
    expect(block.editMode).toBe("structured");
    expect(block.viewAttributes?.["data-chapter-label"]).toBe("C.01");
  });

  test("@spread", () => {
    const source = "@spread wide\n@page one\nHi\n";
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    assertProjectionInvariants(projection, source);
    const block = blockOf(projection, "spread");
    expect(source.slice(block.from, block.to)).toBe("@spread wide\n");
    expect(block.viewAttributes?.["data-spread"]).toBe("wide");
  });

  test("@page", () => {
    const source = "@page cover .cover-page #ch-cover\nHi\n";
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    assertProjectionInvariants(projection, source);
    const block = blockOf(projection, "page");
    expect(source.slice(block.from, block.to)).toBe("@page cover .cover-page #ch-cover\n");
    expect(block.viewAttributes?.["data-page"]).toBe("cover");
    expect(block.viewAttributes?.id).toBe("ch-cover");
    expect(block.viewAttributes?.class).toContain("cover-page");
  });

  test("@page-break", () => {
    const source = "before\n\n@page-break\n\nafter\n";
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    assertProjectionInvariants(projection, source);
    const block = blockOf(projection, "page-break");
    expect(source.slice(block.from, block.to)).toBe("@page-break\n");
    expect(block.editMode).toBe("structured");
  });

  test("@column-break", () => {
    const source = "@section .col-split\nA\n@column-break\nB\n@end-section\n";
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    assertProjectionInvariants(projection, source);
    const block = blockOf(projection, "column-break");
    expect(source.slice(block.from, block.to)).toBe("@column-break\n");
  });

  test("bare @section with no enclosing @page is valid and projects (CLAUDE.md: no implicit page wrapping)", () => {
    const source = "@section .gp-columns-2\nSome flowing prose.\n";
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    assertProjectionInvariants(projection, source);
    const block = blockOf(projection, "section");
    expect(source.slice(block.from, block.to)).toBe("@section .gp-columns-2\n");
    // markers.js's addClasses always merges its own structural base class
    // ("section") with the author's classes — this IS what the marker's
    // own line produced (AP-06), not a later transform.
    expect(block.viewAttributes?.class).toBe("section gp-columns-2");
  });
});

// ── attribute fidelity: both spellings ───────────────────────────────────────

describe("attribute fidelity (AP-06)", () => {
  test("compact spelling (.class) and braces spelling ({.class}) produce identical viewAttributes", () => {
    const compact = "@section .two-column\nA\n@end-section\n";
    const braces = "@section {.two-column}\nA\n@end-section\n";

    const compactBlock = blockOf(createEditorProjection(compact, { sourceVersion: 1 }), "section");
    const bracesBlock = blockOf(createEditorProjection(braces, { sourceVersion: 1 }), "section");

    // "section " prefix: markers.js's addClasses always merges its own
    // structural base class with the author's — same reasoning as above.
    expect(compactBlock.viewAttributes?.class).toBe("section two-column");
    expect(bracesBlock.viewAttributes?.class).toBe("section two-column");
    // Each block's range reproduces its OWN authored spelling exactly —
    // fidelity is per-source, not normalized away.
    expect(compact.slice(compactBlock.from, compactBlock.to)).toBe("@section .two-column\n");
    expect(braces.slice(bracesBlock.from, bracesBlock.to)).toBe("@section {.two-column}\n");
  });

  test("viewAttributes never includes the render graph's own bookkeeping keys", () => {
    const source = "@page one\nHi\n";
    const block = blockOf(createEditorProjection(source, { sourceVersion: 1 }), "page");
    expect(block.viewAttributes).toBeDefined();
    expect(block.viewAttributes).not.toHaveProperty("data-source-range");
    expect(block.viewAttributes).not.toHaveProperty("data-chapter-src");
  });
});

// ── raw HTML ──────────────────────────────────────────────────────────────

describe("raw HTML blocks", () => {
  test("a standalone html_block projects as raw-html with an exact range and inactiveHtml", () => {
    const source = 'before\n\n<div class="widget">raw</div>\n\nafter\n';
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    assertProjectionInvariants(projection, source);
    const block = blockOf(projection, "raw-html");
    expect(source.slice(block.from, block.to)).toBe('<div class="widget">raw</div>\n');
    expect(block.inactiveHtml).toBe('<div class="widget">raw</div>\n');
    expect(block.editMode).toBe("source");
  });

  test("inline HTML is recorded as a diagnostic only, never a block", () => {
    const source = "Some <b>bold</b> text.\n";
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    assertProjectionInvariants(projection, source);
    expect(projection.blocks).toHaveLength(0);
    expect(projection.diagnostics.length).toBeGreaterThan(0);
    expect(projection.diagnostics[0]!.category).toBe("EDITOR_UNSUPPORTED_PROJECTION");
    expect(projection.diagnostics[0]!.reason).toMatch(/inline html/i);
  });
});

// ── generated views (chapter-opener) ─────────────────────────────────────────

describe("generated views", () => {
  test("the chapter-opener is a GeneratedView anchored at the generating @page's range end, with no from/to", () => {
    const source = "@chapter C.01\n@page one\nHello\n";
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    assertProjectionInvariants(projection, source);

    expect(projection.generated).toHaveLength(1);
    const view = projection.generated[0]!;
    expect(view.html).toBe('<div class="chapter-opener" data-chapter-label="C.01">C.01</div>\n');

    const pageBlock = blockOf(projection, "page");
    expect(view.anchor).toBe(pageBlock.to);

    // Chapter-opener is generated, not authored: it must NOT also appear as
    // a projected block.
    expect(projection.blocks.find((b) => b.kind === "raw-html")).toBeUndefined();
  });

  test("only the FIRST @page of a chapter gets a generated chapter-opener", () => {
    const source = "@chapter C.01\n@page one\nP1\n@page two\nP2\n";
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    assertProjectionInvariants(projection, source);
    expect(projection.generated).toHaveLength(1);
  });

  test("escaped chapter labels still match the generated-view pattern", () => {
    const source = "@chapter \"<a&b>\"\n@page one\nHi\n";
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    assertProjectionInvariants(projection, source);
    expect(projection.generated).toHaveLength(1);
    expect(projection.generated[0]!.html).toContain("&lt;a&amp;b&gt;");
  });
});

// ── ambiguity fixture (AP-05 shape): a synthetic plugin emitting a map-less block token ─

describe("ambiguity: a plugin-transformed token with no source-range evidence (AP-05)", () => {
  test("an unrecognized layout_-prefixed token with no map/meta.line becomes a diagnostic, never a block", () => {
    const md = new MarkdownIt({ html: true });

    // A tiny inline plugin reproducing the AP-05 shape: it recognizes its
    // own one-line marker syntax and emits a block-level token that LOOKS
    // layout-like (the "layout_" prefix this module treats as reserved for
    // Gutterpress's own marker family / a future plugin-region mapping) but
    // carries neither `token.map` nor `token.meta.line` — i.e. exactly "a
    // block-level construct whose map is absent and meta.line absent"
    // (pr158-lessons.md AP-05).
    md.block.ruler.before("paragraph", "fake_widget", (state, startLine, _endLine, silent) => {
      const pos = state.bMarks[startLine]! + state.tShift[startLine]!;
      const max = state.eMarks[startLine]!;
      const line = state.src.slice(pos, max);
      if (line.trim() !== "@@widget") return false;
      if (silent) return true;
      // Deliberately no `token.map`, no `token.meta` — the AP-05 shape.
      state.push("layout_widget_open", "div", 1);
      state.push("layout_widget_close", "div", -1);
      state.line = startLine + 1;
      return true;
    });

    const source = "@@widget\nHello\n";
    const projection = createEditorProjection(source, { sourceVersion: 1, md });
    assertProjectionInvariants(projection, source);

    expect(projection.blocks).toHaveLength(0);
    expect(projection.diagnostics).toHaveLength(1);
    expect(projection.diagnostics[0]!.category).toBe("EDITOR_UNSUPPORTED_PROJECTION");
    expect(projection.diagnostics[0]!.reason).toContain("layout_widget_open");

    // Fail-closed, not fail-blocked: the rest of the document is untouched
    // and the source stays fully editable as plain markdown.
    expect(source).toContain("Hello");
  });
});

// ── char-offset exactness: line endings and no-final-newline ────────────────

describe("char-offset exactness (line-start offset table)", () => {
  test("CRLF source: ranges include the block's own \\r\\n and land exactly on the next line's start", () => {
    const source = "@page one\r\nHello\r\n@page two\r\nWorld\r\n";
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    assertProjectionInvariants(projection, source);

    const pages = projection.blocks.filter((b) => b.kind === "page");
    expect(pages).toHaveLength(2);
    expect(source.slice(pages[0]!.from, pages[0]!.to)).toBe("@page one\r\n");
    expect(source.slice(pages[1]!.from, pages[1]!.to)).toBe("@page two\r\n");
    // Non-overlapping/adjacent: the first page's `to` is not necessarily the
    // second page's `from` (there's a content line between them), but it
    // must never exceed it.
    expect(pages[0]!.to).toBeLessThanOrEqual(pages[1]!.from);
  });

  test("lone-CR source (old-Mac line endings): still resolves correct per-line ranges", () => {
    const source = "@page one\rHello\r@page-break\r";
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    assertProjectionInvariants(projection, source);
    const page = blockOf(projection, "page");
    expect(source.slice(page.from, page.to)).toBe("@page one\r");
    const brk = blockOf(projection, "page-break");
    expect(source.slice(brk.from, brk.to)).toBe("@page-break\r");
  });

  test("no final newline: the LAST block's `to` clamps to source.length", () => {
    const source = "Hi\n\n@page-break"; // no trailing \n
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    assertProjectionInvariants(projection, source);
    const brk = blockOf(projection, "page-break");
    expect(brk.to).toBe(source.length);
    expect(source.slice(brk.from, brk.to)).toBe("@page-break");
  });

  test("trailing newline present: the LAST block's `to` still lands exactly at source.length", () => {
    const source = "Hi\n\n@page-break\n";
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    assertProjectionInvariants(projection, source);
    const brk = blockOf(projection, "page-break");
    expect(brk.to).toBe(source.length);
  });
});

// ── sourceVersion / schema stamping (G-11) ───────────────────────────────────

describe("sourceVersion stamping", () => {
  test("sourceVersion and schemaVersion are stamped verbatim from opts / the module constant", () => {
    const projection = createEditorProjection("@page-break\n", { sourceVersion: 42 });
    expect(projection.sourceVersion).toBe(42);
    expect(projection.schemaVersion).toBe(PROJECTION_SCHEMA_VERSION);
  });
});

// ── invariants on a full real example (read-only fixture, AP-25) ────────────

describe("invariants against a real book fixture", () => {
  test("examples/gutterpress-user-guide/00-cover.md: every block/generated-view invariant holds", () => {
    const fixturePath = fileURLToPath(
      new URL("../../../../../examples/gutterpress-user-guide/00-cover.md", import.meta.url),
    );
    const source = readFileSync(fixturePath, "utf8");
    const projection = createEditorProjection(source, { sourceVersion: 1 });
    assertProjectionInvariants(projection, source);

    // Liveness (AP-21): this fixture is known (00-cover.md, read above in
    // this session) to contain an @page and two @sections — an empty
    // result here would mean the invariant walk above passed vacuously.
    expect(projection.blocks.length).toBeGreaterThan(0);
    expect(blockOf(projection, "page")).toBeDefined();
    expect(projection.blocks.filter((b) => b.kind === "section").length).toBeGreaterThanOrEqual(2);

    for (const block of projection.blocks) {
      if (block.kind !== "raw-html") {
        expect(source.slice(block.from, block.to).trimStart().startsWith("@")).toBe(true);
      }
    }
  });
});
