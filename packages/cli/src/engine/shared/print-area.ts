/**
 * The project's print area: the manifest's `page` block, carried into every
 * assembled book (preview, build, publish) as ONE
 * `<meta name="gp-print-area">` by the markdown assembly
 * (lib/markdown/assemble.ts) and read back here by everything that needs it:
 * the preview's print overlays (viewer/overlay.ts) and both engines' pinned
 * art (pin-edges.ts — a pin sits on the printer's art-safe line).
 *
 * Only the manifest feeds it — `page.width` x `page.height` (the sheet),
 * `page.bleed` (a bleed the sheet already contains on the top, bottom and
 * OUTER edge; the binding edge has none, as DriveThruRPG cuts it),
 * `page.safe` (the TEXT rule: its inset from the trim on every edge),
 * `page.artSafe` (the ART rule: its inset on the top, bottom and outer edge;
 * absent = `safe`) and `page.gutter` (the binding edge's inset, for text and
 * art alike; absent = `safe`) — plus the preset's id and the printer spec it
 * follows, which only word what the overlay finds.
 * No book or plugin CSS feeds it: not the `@page` margins (they are where the
 * author put the TEXT, which is not the printer's safe area), not
 * `@page { bleed }`.
 *
 * The meta is metadata: it changes nothing a browser renders on its own.
 * Node-safe: the writer is pure, and the reader takes the document it reads.
 */

/** The project's page geometry, in pt — the manifest's `page` block. */
export interface PrintArea {
  width: number;
  height: number;
  /** in-sheet bleed on the top, bottom and outer edge; 0 = none */
  bleed: number;
  /** the TEXT rule: inset from the trim on every edge, the binding edge too unless `gutter` is set; 0 = none */
  safe: number;
  /** the ART rule: inset on the top, bottom and outer edge (the binding edge takes `gutter`) */
  artSafe: number;
  /** the binding allowance: inset from the trim at the binding edge, for text and art alike; absent in the manifest = `safe` */
  gutter: number;
  /** the manifest's preset id, and the printer spec it follows: they only word what is found */
  preset?: string;
  spec?: { label: string; url: string };
}

/** Which side of the spread a page is: page 1 is a recto, so every odd page is one. */
export type PageSide = "recto" | "verso";

/** What a host knows from its resolved config: the `page` block, the preset and its spec. */
export interface PrintAreaSource {
  width: number;
  height: number;
  bleed?: number;
  safe?: number;
  artSafe?: number;
  gutter?: number;
  preset?: string;
  spec?: { label: string; url: string };
}

/**
 * The `<meta>` tag for one book. An unset bleed or text rule is written as 0,
 * never left out; an unset art rule or gutter stays out (the reader takes each
 * as `safe`).
 * Anything else the config's `page` block holds (`tolerance`) is not part of it.
 */
export function printAreaMeta(page: PrintAreaSource): string {
  const area = JSON.stringify({
    width: page.width,
    height: page.height,
    bleed: page.bleed ?? 0,
    safe: page.safe ?? 0,
    artSafe: page.artSafe,
    gutter: page.gutter,
    preset: page.preset,
    spec: page.spec,
  });
  // single-quoted attribute: escape what could end it or read as an entity
  return `<meta name="gp-print-area" content='${area.replace(/&/g, "&amp;").replace(/'/g, "&#39;")}'>`;
}

/** The one DOM call the reader makes: a `Document` satisfies it. */
export interface MetaDocument {
  querySelector(selector: string): { getAttribute(name: string): string | null } | null;
}

/** The book's print area from its `<meta name="gp-print-area">`; `null` without one. */
export function printAreaFromMeta(doc: MetaDocument): PrintArea | null {
  const raw = doc.querySelector('meta[name="gp-print-area"]')?.getAttribute("content");
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PrintArea>;
    const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);
    if (!n(v.width) || !n(v.height)) return null;
    const safe = n(v.safe);
    // the spec becomes a link in the legend: only a web address is one
    const spec =
      v.spec && typeof v.spec.label === "string" && typeof v.spec.url === "string" && /^https?:\/\//i.test(v.spec.url)
        ? v.spec
        : undefined;
    return {
      width: n(v.width),
      height: n(v.height),
      bleed: n(v.bleed),
      safe,
      artSafe: typeof v.artSafe === "number" ? n(v.artSafe) : safe,
      gutter: typeof v.gutter === "number" ? n(v.gutter) : safe,
      preset: typeof v.preset === "string" ? v.preset : undefined,
      spec,
    };
  } catch {
    return null;
  }
}
