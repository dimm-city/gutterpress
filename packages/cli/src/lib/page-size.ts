/**
 * A book's page size — the ONE place that knows how the size is recorded, for
 * both the new-book wizard (via `scaffoldProject`) and Book settings (#357).
 *
 * A book's page size lives in two places that must agree:
 *
 *  - the manifest: `preset:` (dtrpg / book / custom — which also carries the
 *    print rules that go with the preset) and, for `custom` (or an explicit
 *    override), `page: { width, height, tolerance }` in points. These are the
 *    VALIDATION BOUNDS the built PDF is checked against; and
 *  - the stylesheet: the plain `@page { size: … }` rule, which is what Chrome
 *    actually prints at.
 *
 * Creating a book writes the manifest half (the starter stylesheet is empty,
 * the look supplies `@page`); changing the size later writes both halves
 * together. The CSS edit is a postcss round-trip that rewrites the existing
 * rule's `size` value in place and leaves every other byte of the file alone;
 * when no plain `@page` rule sets a size, a minimal one is appended to the
 * book's own (last) stylesheet — it loads after every look, so it wins.
 *
 * Host-side (node:fs + postcss). Bundle-safe (CLAUDE.md §1/§3): no runtime
 * package.json reads, no computed dynamic imports, no bundlers.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import { Scalar } from "yaml";
import type { Document } from "yaml";
import { UsageError } from "./cli-args.ts";
import { ensureSeq, loadManifestDoc, writeManifestDoc } from "./manifest-doc.ts";
import { PRESET_IDS, PRESETS, type PresetId } from "./presets.ts";
import { resolveActiveStyles } from "./style-resolver.ts";
import { parseSize } from "../engine/shared/gcpm-extract.ts";

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

/** What an author picks: a preset, plus the trim when the preset is `custom`. */
export interface PageSizeChoice {
  preset: PresetId;
  /** Required for `custom`; ignored for `dtrpg` / `book` (the preset owns it). */
  page?: PageSizePoints;
}

/** A book's page size as currently recorded, read back for the settings UI. */
export interface PageSetup {
  /** The manifest's preset (`dtrpg` when undeclared — the product default); null when unrecognised. */
  preset: PresetId | null;
  /** The validation bounds the manifest resolves to, or null (custom with no `page:`). */
  bounds: (PageSizePoints & { tolerance: number }) | null;
  /** What the book's stylesheets print at, or null when no plain `@page` sets a size. */
  css: (PageSizePoints & { file: string }) | null;
}

export function isPositivePoints(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Write the manifest's `page:` bounds. `tolerance` defaults to whatever the
 * block already carries, so re-sizing a book never silently resets a
 * hand-tuned tolerance.
 */
export function writePageBounds(doc: Document, page: CustomPageOptions): void {
  const out: Record<string, number> = { width: page.width, height: page.height };
  const tolerance = page.tolerance ?? numberAt(doc, ["page", "tolerance"]);
  if (tolerance !== undefined) out.tolerance = tolerance;
  doc.set("page", doc.createNode(out));
}

function numberAt(doc: Document, keyPath: string[]): number | undefined {
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

// ── CSS ────────────────────────────────────────────────────────────────────

/** Round to 3dp so 8.27in doesn't print as 8.270000000000001in. */
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** CSS length for a point value: inches when exact to 3dp (612 -> 8.5in), else points. */
function cssLength(pt: number): string {
  const inches = round3(pt / 72);
  return Math.abs(inches * 72 - pt) < 1e-6 ? `${inches}in` : `${round3(pt)}pt`;
}

/** The `size` value written for a page: `8.5in 11in`, `595pt 842pt`. */
export function formatPageSize(page: PageSizePoints): string {
  return `${cssLength(page.width)} ${cssLength(page.height)}`;
}

/** Points two sizes may differ by and still count as the same page. */
const SAME_SIZE_PT = 0.5;

function sameSize(a: PageSizePoints, b: PageSizePoints): boolean {
  return Math.abs(a.width - b.width) < SAME_SIZE_PT && Math.abs(a.height - b.height) < SAME_SIZE_PT;
}

/** The unqualified `@page` rules (no name, no `:first`/`:left`…) — the book's base geometry. */
function plainPageRules(root: postcss.Root): postcss.AtRule[] {
  const rules: postcss.AtRule[] = [];
  root.walkAtRules("page", (rule) => {
    if (rule.params.trim() === "") rules.push(rule);
  });
  return rules;
}

function sizeDeclsOf(rule: postcss.AtRule): postcss.Declaration[] {
  const decls: postcss.Declaration[] = [];
  rule.each((node) => {
    if (node.type === "decl" && node.prop.toLowerCase() === "size") decls.push(node);
  });
  return decls;
}

/** The size the LAST plain `@page { size }` in the stylesheet sets (cascade: last wins), or null. */
export function readPageSizeFromCss(css: string): PageSizePoints | null {
  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch {
    return null;
  }
  const decls = plainPageRules(root).flatMap(sizeDeclsOf);
  const last = decls[decls.length - 1];
  return last ? (parseSize(last.value) ?? null) : null;
}

/**
 * Point a stylesheet's plain `@page` rule at `page`. Rewrites the existing
 * `size` declaration's value in place — comments, whitespace, other rules and
 * `!important` untouched — or, when no plain `@page` sets a size, appends a
 * minimal rule. An already-matching size leaves the text exactly as it was.
 * Throws when the CSS does not parse (it must never be half-rewritten).
 */
export function setPageSizeInCss(css: string, page: PageSizePoints): string {
  const root = postcss.parse(css);
  const decls = plainPageRules(root).flatMap(sizeDeclsOf);
  const last = decls[decls.length - 1];
  const value = formatPageSize(page);
  if (last) {
    const current = parseSize(last.value);
    if (current && sameSize(current, page)) return css;
    // Only the winning declaration changes; an earlier one it overrides is
    // left as the author wrote it.
    last.value = value;
    return root.toString();
  }
  const rule = `@page {\n  size: ${value};\n}\n`;
  if (css.trim() === "") return css + rule;
  return `${css}${css.endsWith("\n") ? "" : "\n"}\n${rule}`;
}

// ── Project ────────────────────────────────────────────────────────────────

/** Active stylesheets that live inside the book (a shared sheet is never edited), as absolute paths. */
async function ownStylesheets(projectDir: string): Promise<string[]> {
  const rels = await resolveActiveStyles(projectDir).catch(() => [] as string[]);
  return rels
    .map((rel) => path.resolve(projectDir, rel))
    .filter((abs) => {
      const inside = path.relative(projectDir, abs);
      return !inside.startsWith("..") && !path.isAbsolute(inside) && existsSync(abs);
    });
}

const relDisplay = (projectDir: string, abs: string) =>
  path.relative(projectDir, abs).split(path.sep).join("/");

/** The last of the book's own stylesheets that sets a plain `@page` size, with that size. */
async function findCssSize(
  projectDir: string,
  sheets: string[],
): Promise<{ file: string; size: PageSizePoints } | null> {
  let found: { file: string; size: PageSizePoints } | null = null;
  for (const file of sheets) {
    const size = readPageSizeFromCss(await readFile(file, "utf8"));
    if (size) found = { file, size };
  }
  return found;
}

/** Read a book's page size back from its manifest and stylesheets. */
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

  const found = await findCssSize(projectDir, await ownStylesheets(projectDir));
  return {
    preset,
    bounds: width !== undefined && height !== undefined ? { width, height, tolerance } : null,
    css: found ? { ...found.size, file: relDisplay(projectDir, found.file) } : null,
  };
}

/**
 * Change a book's page size: the manifest's `preset:` + `page:` bounds and the
 * stylesheet's `@page` size, together. Mirrors what the wizard records —
 * `dtrpg` / `book` carry their own bounds (any `page:` block is removed so it
 * cannot shadow them), `custom` records the typed trim. Nothing is written
 * unless the whole choice validates and the stylesheet parses.
 */
export async function setPageSetup(
  projectDir: string,
  choice: PageSizeChoice,
): Promise<PageSetup> {
  const size = pageSizeForChoice(choice);

  const sheets = await ownStylesheets(projectDir);
  const found = await findCssSize(projectDir, sheets);
  // The sheet to rewrite: the one holding the winning `size`, else the book's
  // own (last) sheet, else a new `styles/book.css` the manifest will list.
  const newSheet = path.join(projectDir, "styles", "book.css");
  const target = found?.file ?? sheets[sheets.length - 1] ?? newSheet;
  const before = existsSync(target) ? await readFile(target, "utf8") : "";
  let after: string;
  try {
    after = setPageSizeInCss(before, size);
  } catch (e) {
    throw new UsageError(
      `Could not update the page size: ${relDisplay(projectDir, target)} has a CSS error ` +
        `(${e instanceof Error ? e.message : String(e)}). Fix it, then try again.`,
    );
  }

  const { doc, file } = await loadManifestDoc(projectDir);
  doc.set("preset", choice.preset);
  if (choice.preset === "custom") writePageBounds(doc, size);
  else doc.delete("page");
  if (target === newSheet && !sheets.includes(newSheet)) {
    ensureSeq(doc, "styles").add(new Scalar("styles/book.css"));
  }
  await writeManifestDoc(file, doc);

  if (after !== before || !existsSync(target)) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, after, "utf8");
  }
  return readPageSetup(projectDir);
}
