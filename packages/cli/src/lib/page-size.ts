/**
 * A book's page geometry — size and margins — the ONE place that knows how it
 * is recorded, for both the new-book wizard (via `scaffoldProject`) and Book
 * setup (#357).
 *
 * It lives in the manifest and nowhere else:
 *
 *  - the size: `preset:` (dtrpg / book / custom — which also carries the
 *    print rules that go with the preset) and, for `custom` (or an explicit
 *    override), `page: { width, height, tolerance }` in points. These are
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
import { readExtensionCss } from "./extension-manager.ts";
import { loadManifest, resolveConfig } from "./manifest.ts";
import { loadManifestDoc, writeManifestDoc } from "./manifest-doc.ts";
import { PRESET_IDS, PRESETS, type PresetId } from "./presets.ts";
import { resolveActiveStyles } from "./style-resolver.ts";
import { extract, resolvePage } from "../engine/shared/gcpm-extract.ts";
import { DEFAULT_PAGE_MARGIN_PT, formatPageSize, isPositivePoints } from "../engine/shared/print-area.ts";
import type { PageMargin } from "../schema/manifest.types.ts";

// The point check and the `size` spelling are shared with the assembly's
// `@page` rule (engine/shared/print-area.ts), so there is one definition of
// each; re-exported for this module's callers.
export { formatPageSize, isPositivePoints };
export type { PageMargin };

/** Page bounds written to the manifest's `page:` block (points; 72pt = 1in). */
export interface CustomPageOptions {
  /** Trim width in points (72pt = 1in). */
  width: number;
  /** Trim height in points (72pt = 1in). */
  height: number;
  /** Allowed deviation in points when validating a built PDF. Default 0.5. */
  tolerance?: number;
}

/** A page size in points. */
export interface PageSizePoints {
  width: number;
  height: number;
}

/** What an author picks: a preset, the trim when the preset is `custom`, and the margins. */
export interface PageSizeChoice {
  preset: PresetId;
  /** Required for `custom`; ignored for `dtrpg` / `book` (the preset owns it). */
  page?: PageSizePoints;
  /** Written to `page.margin` when given; left out, the manifest's margins stay as they are. */
  margins?: PageMargin;
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
}

/** The margin the assembly writes when nothing sets one (print-area.ts). */
const DEFAULT_MARGIN_PT = DEFAULT_PAGE_MARGIN_PT;
/** Round to 3dp so 0.6in reads back as 43.2, not 43.199999999999996. */
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const MARGIN_EDGES = ["top", "bottom", "inside", "outside"] as const;

/**
 * Write the manifest's `page:` bounds. `tolerance` defaults to whatever the
 * block already carries, so re-sizing a book never silently resets a
 * hand-tuned tolerance. The block's other keys stay as written; a `page:`
 * that is not a map is replaced.
 */
export function writePageBounds(doc: Document, page: CustomPageOptions): void {
  const tolerance = page.tolerance ?? numberAt(doc, ["page", "tolerance"]);
  ensurePageMap(doc);
  doc.setIn(["page", "width"], page.width);
  doc.setIn(["page", "height"], page.height);
  if (tolerance !== undefined) doc.setIn(["page", "tolerance"], tolerance);
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

/** Write the manifest's `page.margin`, all four edges; the block's other keys stay as written. */
export function writePageMargin(doc: Document, margin: PageMargin): void {
  ensurePageMap(doc);
  if (!isMap(doc.getIn(["page", "margin"], true))) doc.setIn(["page", "margin"], doc.createNode({}));
  for (const edge of MARGIN_EDGES) doc.setIn(["page", "margin", edge], margin[edge]);
}

function ensurePageMap(doc: Document): void {
  if (!isMap(doc.get("page", true))) doc.set("page", doc.createNode({}));
}

function numberAt(doc: Document, keyPath: string[]): number | undefined {
  const v = doc.getIn(keyPath);
  return isPositivePoints(v) ? v : undefined;
}

/** A margin value: finite points, 0 allowed (a full-bleed edge). */
function isMarginPoints(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
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

/** The margins a choice records, checked against the size they must fit; undefined when it records none. */
function marginsForChoice(choice: PageSizeChoice, size: PageSizePoints): PageMargin | undefined {
  const m = choice.margins;
  if (m === undefined) return undefined;
  if (!MARGIN_EDGES.every((edge) => isMarginPoints(m[edge]))) {
    throw new UsageError(
      "Page margins need a top, bottom, inside and outside value in points (72pt = 1in), each 0 or more.",
    );
  }
  if (m.inside + m.outside >= size.width || m.top + m.bottom >= size.height) {
    throw new UsageError(
      `These margins leave no room for text on a ${formatPageSize(size)} page.`,
    );
  }
  return { top: m.top, bottom: m.bottom, inside: m.inside, outside: m.outside };
}

// ── Project ────────────────────────────────────────────────────────────────

/** Active stylesheets that exist on disk, as absolute paths (a shared sheet counts: it prints). */
async function activeStylesheets(projectDir: string): Promise<string[]> {
  const rels = await resolveActiveStyles(projectDir).catch(() => [] as string[]);
  return rels.map((rel) => path.resolve(projectDir, rel)).filter((abs) => existsSync(abs));
}

/**
 * The margins the book's stylesheets give its pages — every enabled
 * extension's CSS, then the book's own, read with the engine's `@page`
 * reader for a right-hand page, so `inside` is its left edge. Best-effort:
 * an extension that cannot be read, or CSS the reader rejects, counts as
 * setting nothing.
 */
async function stylesheetMargins(projectDir: string): Promise<Pick<PageSetup, "margins" | "marginsFrom">> {
  const fallback: Pick<PageSetup, "margins" | "marginsFrom"> = {
    margins: { top: DEFAULT_MARGIN_PT, bottom: DEFAULT_MARGIN_PT, inside: DEFAULT_MARGIN_PT, outside: DEFAULT_MARGIN_PT },
    marginsFrom: "default",
  };
  const parts: string[] = [];
  try {
    const config = resolveConfig({}, await loadManifest(projectDir));
    for (const ext of config.extensions) {
      parts.push(await readExtensionCss(projectDir, ext.use).catch(() => ""));
    }
  } catch {
    // A manifest the resolver rejects still has stylesheets worth reading.
  }
  for (const file of await activeStylesheets(projectDir)) {
    parts.push(await readFile(file, "utf8").catch(() => ""));
  }
  try {
    const page = resolvePage(extract(parts.join("\n\n")), { pseudos: ["right"] });
    const declared = Object.keys(page.decls).some((prop) => prop === "margin" || prop.startsWith("margin-"));
    if (!declared) return fallback;
    const m = page.geometry.margin;
    return {
      margins: { top: round3(m.top), bottom: round3(m.bottom), inside: round3(m.left), outside: round3(m.right) },
      marginsFrom: "stylesheet",
    };
  } catch {
    return fallback;
  }
}

/** Read a book's page geometry back from its manifest (and, for margins it does not set, its stylesheets). */
export async function readPageSetup(projectDir: string): Promise<PageSetup> {
  const { doc } = await loadManifestDoc(projectDir);
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
  const tolerance = numberAt(doc, ["page", "tolerance"]) ?? base?.tolerance ?? 0.5;
  const bounds = width !== undefined && height !== undefined ? { width, height, tolerance } : null;

  const at = (edge: (typeof MARGIN_EDGES)[number]) => doc.getIn(["page", "margin", edge]);
  if (MARGIN_EDGES.every((edge) => isMarginPoints(at(edge)))) {
    const margins = { top: at("top"), bottom: at("bottom"), inside: at("inside"), outside: at("outside") } as PageMargin;
    return { preset, bounds, margins, marginsFrom: "manifest" };
  }
  return { preset, bounds, ...(await stylesheetMargins(projectDir)) };
}

/**
 * Change a book's page geometry in the manifest. Mirrors what the wizard
 * records — `dtrpg` / `book` carry their own bounds (the `page:` block's
 * width, height and tolerance are removed so they cannot shadow them; its
 * other keys stay), `custom` records the typed trim — and writes `page.margin`
 * when the choice carries margins. Nothing is written unless the whole choice
 * validates.
 */
export async function setPageSetup(
  projectDir: string,
  choice: PageSizeChoice,
): Promise<PageSetup> {
  const size = pageSizeForChoice(choice);
  const margins = marginsForChoice(choice, size);

  const { doc, file } = await loadManifestDoc(projectDir);
  doc.set("preset", choice.preset);
  if (choice.preset === "custom") writePageBounds(doc, size);
  else deletePageBounds(doc);
  if (margins) writePageMargin(doc, margins);
  await writeManifestDoc(file, doc);
  return readPageSetup(projectDir);
}
