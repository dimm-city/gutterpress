/**
 * A book's page geometry — size and margins — the ONE place that knows how it
 * is recorded, for both the new-book wizard (via `scaffoldProject`) and Book
 * setup (#357).
 *
 * It lives in the manifest and nowhere else:
 *
 *  - the size: `preset:` (dtrpg / book / custom — which also carries the
 *    print rules that go with the preset) and, for `custom` (or an explicit
 *    override), `page: { width, height }` in points. These are
 *    the size the book prints at AND the validation bounds the built PDF is
 *    checked against: the markdown assembly writes them as the `@page { size }`
 *    after every stylesheet (`pageGeometryCss`, lib/markdown/assemble.ts), so
 *    a stylesheet's own `size` never wins (the print-safety check reports
 *    one); and
 *  - the margins: `page.margin` (top, bottom, inside, outside; points),
 *    written the same way as the book's `@page` margins for both page sides.
 *    Left out, the stylesheets' `@page` margins apply (a look's design), else
 *    the build's 1in default. `readPageSetup` reports whichever the book
 *    prints with, and the first change in Book setup records it here.
 *
 * The same `page:` block also carries the print area (`bleed`, `safe`,
 * `artSafe`, `gutter`); this module writes only its own keys and leaves the
 * rest as the author wrote them.
 *
 * Host-side (node:fs). Bundle-safe (CLAUDE.md §1/§3): no runtime package.json
 * reads, no computed dynamic imports, no bundlers.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isMap } from "yaml";
import type { Document } from "yaml";
import { UsageError } from "./cli-args.ts";
import { listProjectExtensions, readEntryCss } from "./extension-manager.ts";
import { MARGIN_EDGES, validatePageMargin } from "./manifest.ts";
import { loadManifestDoc, writeManifestDoc } from "./manifest-doc.ts";
import { PRESET_IDS, PRESETS, type PresetId } from "./presets.ts";
import { resolveActiveStyles } from "./style-resolver.ts";
import { DEFAULT_PAGE_MARGIN_PT, extract, resolvePage } from "../engine/shared/gcpm-extract.ts";
import { isNonNegativePoints, isPositivePoints, round3 } from "../engine/shared/print-area.ts";
import type { PageMargin } from "../schema/manifest.types.ts";

// The point check is the assembly's (engine/shared/print-area.ts); re-exported
// for the scaffold, which writes the same bounds.
export { isPositivePoints };
export type { PageMargin };

/** Page bounds written to the manifest's `page:` block (points; 72pt = 1in). */
export interface CustomPageOptions {
  /** Trim width in points (72pt = 1in). */
  width: number;
  /** Trim height in points (72pt = 1in). */
  height: number;
}

/** A page size in points. */
export interface PageSizePoints {
  width: number;
  height: number;
}

/** What an author picks for the size: a preset, and the trim when the preset is `custom`. */
export interface PageSizeChoice {
  preset: PresetId;
  /** Required for `custom`; ignored for `dtrpg` / `book` (the preset owns it). */
  page?: PageSizePoints;
}

/**
 * A change to a book's page geometry: the size, the margins, or both. A part
 * left out stays as recorded, so a margin edit never rewrites the size (nor
 * drops a preset's `page:` override) and a size change never invents margins.
 */
export interface PageSetupChange {
  size?: PageSizeChoice;
  /** New margins, or null to remove `page.margin` so the stylesheets' (or the default) apply again. */
  margins?: PageMargin | null;
}

/** A book's page geometry as currently recorded, read back for the settings UI. */
export interface PageSetup {
  /** The manifest's preset (`dtrpg` when undeclared — the product default); null when unrecognised. */
  preset: PresetId | null;
  /** The size the book prints at and is checked against, or null (custom with no `page:`). */
  bounds: (PageSizePoints & { tolerance: number }) | null;
  /** The margins the book prints with (points, `inside` at the binding edge). */
  margins: PageMargin;
  /** Where `margins` come from: the manifest's `page.margin` (the author's own), a stylesheet's `@page` (a look's design), or the engine's 1in default. */
  marginsFrom: "manifest" | "stylesheet" | "default";
  /** What the book prints with without `page.margin`: a stylesheet's `@page` margins or the default. Equals `marginsFrom` unless the manifest sets margins. */
  fallbackMarginsFrom: "stylesheet" | "default";
  /** True when `preset:` is `dtrpg` or `book` and `page.width`/`height` override its size: Details shows the preset, and choosing a size there replaces the override. */
  presetSizeOverridden: boolean;
}

/**
 * Write the manifest's `page:` bounds. A `tolerance` an older book carries
 * goes (the preset sets it); the block's other keys stay as written; a
 * `page:` that is not a map is replaced.
 */
export function writePageBounds(doc: Document, page: CustomPageOptions): void {
  ensurePageMap(doc);
  doc.setIn(["page", "width"], page.width);
  doc.setIn(["page", "height"], page.height);
  doc.deleteIn(["page", "tolerance"]);
}

/** Remove the bounds a preset owns and nothing else; a `page:` left empty goes too. */
export function deletePageBounds(doc: Document): void {
  const block = doc.get("page", true);
  if (!isMap(block)) {
    doc.delete("page");
    return;
  }
  for (const key of ["width", "height", "tolerance"]) block.delete(key);
  if (block.items.length === 0) doc.delete("page");
}

/** Remove the manifest's `page.margin` and nothing else; a `page:` left empty goes too. */
export function deletePageMargin(doc: Document): void {
  const block = doc.get("page", true);
  if (!isMap(block)) return;
  block.delete("margin");
  if (block.items.length === 0) doc.delete("page");
}

/** Write the manifest's `page.margin`, all four edges; the block's other keys stay as written. */
export function writePageMargin(doc: Document, margin: PageMargin): void {
  ensurePageMap(doc);
  if (!isMap(doc.getIn(["page", "margin"], true))) doc.setIn(["page", "margin"], doc.createNode({}));
  for (const edge of MARGIN_EDGES) doc.setIn(["page", "margin", edge], margin[edge]);
}

function ensurePageMap(doc: Document): void {
  if (!isMap(doc.get("page", true))) doc.set("page", doc.createNode({}));
}

/** A positive point value at `keyPath` in the manifest, or undefined. */
export function numberAt(doc: Document, keyPath: string[]): number | undefined {
  const v = doc.getIn(keyPath);
  return isPositivePoints(v) ? v : undefined;
}

/** The size (points) a choice means: `custom` brings its own, the others are the preset's. */
export function pageSizeForChoice(choice: PageSizeChoice): PageSizePoints {
  if (!(PRESET_IDS as readonly string[]).includes(choice.preset)) {
    throw new UsageError(
      `Unknown preset "${choice.preset}". Choose one of: ${PRESET_IDS.join(", ")}.`,
    );
  }
  if (choice.preset === "custom") {
    const { page } = choice;
    if (!page || !isPositivePoints(page.width) || !isPositivePoints(page.height)) {
      throw new UsageError(
        "A custom page size needs a positive width and height in points (72pt = 1in).",
      );
    }
    return { width: page.width, height: page.height };
  }
  const base = PRESETS[choice.preset].page!;
  return { width: base.width, height: base.height };
}

// ── Project ────────────────────────────────────────────────────────────────

/** What the manifest alone says: preset, bounds, and `page.margin` when it is complete. */
function manifestGeometry(
  doc: Document,
): Pick<PageSetup, "preset" | "bounds" | "presetSizeOverridden"> & { margins?: PageMargin } {
  const declared = doc.get("preset");
  const preset: PresetId | null =
    declared === undefined || declared === null
      ? "dtrpg"
      : (PRESET_IDS as readonly string[]).includes(String(declared))
        ? (declared as PresetId)
        : null;

  const base = preset ? PRESETS[preset].page : null;
  const width = numberAt(doc, ["page", "width"]) ?? base?.width;
  const height = numberAt(doc, ["page", "height"]) ?? base?.height;
  const tolerance = base?.tolerance ?? 0.5;
  const bounds = width !== undefined && height !== undefined ? { width, height, tolerance } : null;
  const presetSizeOverridden =
    base !== null && (numberAt(doc, ["page", "width"]) !== undefined || numberAt(doc, ["page", "height"]) !== undefined);

  const at = (edge: (typeof MARGIN_EDGES)[number]) => doc.getIn(["page", "margin", edge]);
  const margins = MARGIN_EDGES.every((edge) => isNonNegativePoints(at(edge)))
    ? ({ top: at("top"), bottom: at("bottom"), inside: at("inside"), outside: at("outside") } as PageMargin)
    : undefined;
  return { preset, bounds, presetSizeOverridden, ...(margins ? { margins } : {}) };
}

/**
 * The margins the book's stylesheets give its pages — every enabled
 * extension's CSS, then the book's own, read with the engine's `@page`
 * reader for a right-hand page, so `inside` is its left edge. Best-effort:
 * an extension that cannot be read, or CSS the reader rejects, counts as
 * setting nothing.
 */
async function stylesheetMargins(
  projectDir: string,
  manifestStyles: string[] | undefined,
): Promise<{ margins: PageMargin; marginsFrom: PageSetup["fallbackMarginsFrom"] }> {
  const d = DEFAULT_PAGE_MARGIN_PT;
  const fallback: { margins: PageMargin; marginsFrom: PageSetup["fallbackMarginsFrom"] } = {
    margins: { top: d, bottom: d, inside: d, outside: d },
    marginsFrom: "default",
  };
  const [entries, rels] = await Promise.all([
    listProjectExtensions(projectDir).catch(() => []),
    resolveActiveStyles(projectDir, manifestStyles).catch(() => [] as string[]),
  ]);
  const sheets = rels.map((rel) => path.resolve(projectDir, rel)).filter((abs) => existsSync(abs));
  const parts = await Promise.all([
    ...entries.filter((e) => e.enabled && e.carries.styles).map((e) => readEntryCss(e).catch(() => "")),
    ...sheets.map((file) => readFile(file, "utf8").catch(() => "")),
  ]);
  try {
    const page = resolvePage(extract(parts.join("\n\n")), { pseudos: ["right"] });
    const declared = Object.keys(page.decls).some((prop) => prop === "margin" || prop.startsWith("margin-"));
    if (!declared) return fallback;
    const m = page.geometry.margin;
    return {
      margins: { top: round3(m.top), bottom: round3(m.bottom), inside: round3(m.left), outside: round3(m.right) },
      marginsFrom: "stylesheet" as const,
    };
  } catch {
    return fallback;
  }
}

/** The setup a manifest document describes: its margins, and what the stylesheets would give without them. */
async function setupOf(projectDir: string, doc: Document): Promise<PageSetup> {
  const { margins, ...geometry } = manifestGeometry(doc);
  const styles = doc.toJS()?.styles;
  const sheets = await stylesheetMargins(projectDir, Array.isArray(styles) ? styles : undefined);
  return margins
    ? { ...geometry, margins, marginsFrom: "manifest", fallbackMarginsFrom: sheets.marginsFrom }
    : { ...geometry, ...sheets, fallbackMarginsFrom: sheets.marginsFrom };
}

/** Read a book's page geometry back from its manifest (and, for margins it does not set, its stylesheets). */
export async function readPageSetup(projectDir: string): Promise<PageSetup> {
  const { doc } = await loadManifestDoc(projectDir);
  return setupOf(projectDir, doc);
}

/**
 * Change a book's page geometry in the manifest. The size mirrors what the
 * wizard records — `dtrpg` / `book` carry their own bounds (the `page:` block's
 * width and height are removed so they cannot shadow them; its
 * other keys stay), `custom` records the typed trim. The margins go to
 * `page.margin`, validated against the size being written, else the recorded
 * one; `margins: null` removes `page.margin`. Nothing is written unless the
 * whole change validates.
 */
export async function setPageSetup(
  projectDir: string,
  change: PageSetupChange,
): Promise<PageSetup> {
  const { doc, file } = await loadManifestDoc(projectDir);
  const size = change.size ? pageSizeForChoice(change.size) : null;
  let margins: PageMargin | undefined;
  if (change.margins) {
    const against = size ?? manifestGeometry(doc).bounds;
    if (!against) throw new UsageError("Choose a page size before setting margins: the manifest records none.");
    margins = validatePageMargin(change.margins, against);
  }
  if (change.size && size) {
    doc.set("preset", change.size.preset);
    if (change.size.preset === "custom") writePageBounds(doc, size);
    else deletePageBounds(doc);
  }
  if (margins) writePageMargin(doc, margins);
  else if (change.margins === null) deletePageMargin(doc);
  await writeManifestDoc(file, doc);
  return setupOf(projectDir, doc);
}
