/**
 * Tier 2 (§8) — compile-time synthesis, no measurement.
 *
 * Emits `gp.gen.css` (an inspectable build artifact; the author's files are
 * never modified) plus the DOM hooks it needs:
 *
 *  - running headers at CHAPTER granularity: when a `string-set` source also
 *    starts a named-page run, each run gets a generated named page whose
 *    margin-box `content` is the literal heading text — standard CSS Chromium
 *    executes natively, one pass, no measurement.
 *  - `bleed` / `marks`: rewrite `size` to trim + 2×bleed (+ 2×slug), shift
 *    margins so content stays put relative to trim, and compensate margin-box
 *    insets so headers/footers don't drift into the bleed.
 */
import {
  parseSize,
  resolvePage,
  toPt,
  type Declarations,
  type GcpmModel,
  type PageGeometry,
} from "../shared/gcpm-extract.ts";
import { needsMeasurement, parseContent } from "../shared/content-value.ts";

export const DEFAULT_SLUG_PT = 18; // 0.25in

export interface PageTrim {
  /** trim size (author's `size`) in pt */
  trim: { width: number; height: number };
  /** printed media size in pt (trim + 2*bleed + 2*slug) */
  media: { width: number; height: number };
  bleed: number;
  slug: number;
  marks: string[];
}

export interface Tier2Input {
  model: GcpmModel;
  /** finishing options; CSS values win when both exist (§10) */
  marks?: boolean;
  slugPt?: number;
  bleedPt?: number;
}

export interface Tier2Output {
  css: string;
  geometry: PageTrim;
  /** true when the document uses constructs that need Tier 3 */
  needsTier3: boolean;
  notes: string[];
}

/** Which pages does the document need running strings on, and can Tier 2 do it? */
export function classify(model: GcpmModel): {
  tier2Strings: string[];
  tier3Strings: string[];
  tier3Reasons: string[];
} {
  const tier2Strings: string[] = [];
  const tier3Strings: string[] = [];
  const tier3Reasons: string[] = [];

  // Only strings a margin box actually consumes can force a tier: a
  // `string-set` nobody reads costs nothing and must not drag the whole
  // document into measurement.
  const consumed = consumedStrings(model);
  for (const decl of model.stringSets) {
    if (!consumed.has(decl.name)) continue;
    if (startsRun(model, decl.selector)) tier2Strings.push(decl.name);
    else {
      tier3Strings.push(decl.name);
      tier3Reasons.push(
        `string "${decl.name}" is set by \`${decl.selector}\` outside a named-page run — page granularity requires measurement`,
      );
    }
  }
  for (const x of model.xrefs) {
    if (needsMeasurement(x.content))
      tier3Reasons.push(`\`${x.selector}\` uses ${x.fn}() — requires measurement`);
  }
  return { tier2Strings, tier3Strings, tier3Reasons };
}

/** Pseudo-pages the author actually used, e.g. ["left", "right", "blank"]. */
export function pseudoVariants(model: GcpmModel): string[] {
  const set = new Set<string>();
  for (const rule of model.pageRules) for (const p of rule.pseudos) set.add(p);
  return [...set];
}

/** String names referenced by a `string()` in some margin box. */
export function consumedStrings(model: GcpmModel): Set<string> {
  const names = new Set<string>();
  for (const rule of model.pageRules)
    for (const decls of Object.values(rule.marginBoxes))
      if (decls.content)
        for (const part of parseContent(decls.content))
          if (part.type === "string") names.add(part.name);
  return names;
}

/**
 * Does this selector start a run Tier 2 can own? True when the same selector
 * also carries a page assignment, or a forced page break (the `h1` chapter
 * shape) — matched structurally, since the DOM check happens in the agent.
 */
function startsRun(model: GcpmModel, selector: string): boolean {
  const sel = selector.trim();
  if (model.pageAssignments.some((a) => a.selector.trim() === sel)) return true;
  return model.breaks.some(
    (b) =>
      b.selector.trim() === sel &&
      b.prop === "break-before" &&
      /^(page|always|left|right|recto|verso)$/.test(b.value.trim()),
  );
}

export function pageGeometry(model: GcpmModel, opts: Tier2Input): PageTrim {
  const base = resolvePage(model);
  const trim = { width: base.geometry.width, height: base.geometry.height };
  const bleed = opts.bleedPt ?? base.geometry.bleed;
  const wantsMarks = base.geometry.marks.length > 0 || opts.marks === true;
  const slug = wantsMarks ? (opts.slugPt ?? DEFAULT_SLUG_PT) : 0;
  return {
    trim,
    bleed,
    slug,
    marks: base.geometry.marks.length ? base.geometry.marks : wantsMarks ? ["crop"] : [],
    media: {
      width: trim.width + 2 * (bleed + slug),
      height: trim.height + 2 * (bleed + slug),
    },
  };
}

const declsToCss = (d: Declarations, indent = "    ") =>
  Object.entries(d)
    .map(([k, v]) => `${indent}${k}: ${v};`)
    .join("\n");

/**
 * The emitted page margin for one side.
 *
 * Normally the authored margin plus the bleed+slug the compiler added to the
 * page size, so content stays where the author put it RELATIVE TO TRIM.
 *
 * A zero authored margin is different in kind: it means "content fills the
 * page", and inflating it would put a white border exactly where the author
 * asked for full-bleed art — the one thing bleed exists for. Chromium clips
 * content to the content box (measured: nothing paints outside it, not even
 * `html { background }`), so a bleeding page must have a content box that
 * REACHES the bleed area. Emitting the slug alone makes the content box
 * exactly the bleed box: art fills it, crop marks stay clear.
 */
export function bleedMargin(authored: number, g: PageTrim): number {
  return authored === 0 ? g.slug : authored + g.bleed + g.slug;
}

/**
 * Shift a margin box's content back toward the trim box by `inset` pt, so the
 * bleed/slug the compiler added to the page size does not push running heads
 * and folios outward.
 */
export function marginBoxInset(name: string, inset: number): Declarations {
  if (!inset) return {};
  if (name.startsWith("@top")) return { "padding-top": `${inset}pt` };
  if (name.startsWith("@bottom")) return { "padding-bottom": `${inset}pt` };
  if (name.startsWith("@left")) return { "padding-left": `${inset}pt` };
  if (name.startsWith("@right")) return { "padding-right": `${inset}pt` };
  return {};
}

export function synthesize(input: Tier2Input): Tier2Output {
  const { model } = input;
  const geometry = pageGeometry(model, input);
  const inset = geometry.bleed + geometry.slug;
  const { tier3Reasons } = classify(model);
  const notes: string[] = [];
  const out: string[] = [
    "/* gp.gen.css — generated by the Gutterpress compiler (Tier 2).",
    "   Derived from the author's own @page/GCPM declarations; the author's",
    "   files are never modified. Inspect freely, do not edit. */",
    "",
  ];

  // ---- 1. bleed / marks geometry ----------------------------------------
  if (inset > 0) {
    // One block per page CONTEXT, not a single unnamed block.
    //
    // Chromium does not apply page-selector specificity across stylesheets, so
    // a generated unnamed `@page { margin-* }` silently beats the author's
    // `@page :left`/`:right` gutters — every page of a bound book collapses to
    // the same margin and the book mirrors the wrong way. Resolving each
    // context here and emitting it explicitly is the same fix the running-head
    // rewrite uses (see counterStyleCss).
    const names: Array<string | undefined> = [undefined, ...model.pageNames];
    const variants = [[] as string[], ...pseudoVariants(model).map((p) => [p])];
    for (const name of names) {
      for (const pseudos of variants) {
        // The base context is always emitted (it carries the new page size);
        // every other context only if the author actually wrote it, so the
        // generated sheet stays small and never invents a page context.
        const isBase = name === undefined && pseudos.length === 0;
        const authorWroteIt = model.pageRules.some(
          (r) =>
            r.name === name &&
            r.pseudos.length === pseudos.length &&
            r.pseudos.every((p) => pseudos.includes(p)),
        );
        if (!isBase && !authorWroteIt) continue;
        const resolved = resolvePage(model, { name, pseudos });
        const pseudo = pseudos.length ? `:${pseudos.join(":")}` : "";
        const lines = [
          `  size: ${round(geometry.media.width)}pt ${round(geometry.media.height)}pt;`,
        ];
        for (const side of ["top", "right", "bottom", "left"] as const) {
          lines.push(
            `  margin-${side}: ${round(bleedMargin(resolved.geometry.margin[side], geometry))}pt;`,
          );
        }
        out.push(`@page ${name ?? ""}${pseudo} {`, ...lines, `}`.replace("@page  ", "@page "));
      }
    }

    // margin boxes must stay where the author put them relative to trim
    const seen = new Set<string>();
    for (const rule of model.pageRules)
      for (const name of Object.keys(rule.marginBoxes)) seen.add(name);
    for (const name of seen) {
      const d = marginBoxInset(name, inset);
      if (!Object.keys(d).length) continue;
      out.push(`@page {`, `  ${name} {`, declsToCss(d, "    "), `  }`, `}`);
    }
    notes.push(
      `bleed ${round(geometry.bleed)}pt + slug ${round(geometry.slug)}pt: media ${round(geometry.media.width)}×${round(geometry.media.height)}pt, trim ${round(geometry.trim.width)}×${round(geometry.trim.height)}pt`,
    );
    if (geometry.bleed > 0)
      notes.push(
        "Chromium clips page content to the content box, so art can only reach the bleed area on " +
          "pages whose authored margin is 0 (covers, plates) — those keep a slug-only margin so the " +
          "content box IS the bleed box. On pages with real margins, bleed is geometry only.",
      );
  }

  // Running heads are NOT synthesized here. They used to be: each run got a
  // generated `@page <name>--N` carrying literal text, which meant the compiler
  // had to re-implement the `@page` cascade (four separate bugs). They are
  // now produced by the Tier 3 counter-style map,
  // which leaves the author's `@page` rules exactly as written. Measured on the
  // Gutterpress user guide: identical output, 64.5 KB of generated CSS down to
  // 4.7 KB, at the cost of one extra print pass.

  return {
    css: out.join("\n") + "\n",
    geometry,
    needsTier3: tier3Reasons.length > 0,
    notes: [...notes, ...tier3Reasons],
  };
}

/**
 * Declarations for a generated `@page`: the RESOLVED geometry as longhands
 * (never the author's shorthand/longhand mix, which would re-introduce the
 * cascade order problem inside a single flat block), plus everything else the
 * author declared, minus the descriptors the compiler consumes itself.
 */
function pageDecls(
  resolved: { decls: Declarations; geometry: PageGeometry },
  inset: number,
): Declarations {
  const out: Declarations = {};
  for (const [prop, value] of Object.entries(resolved.decls)) {
    if (prop === "margin" || prop.startsWith("margin-") || prop === "size") continue;
    if (prop === "bleed" || prop === "marks") continue;
    out[prop] = value;
  }
  const g = resolved.geometry;
  out.size = `${round(g.width + 2 * inset)}pt ${round(g.height + 2 * inset)}pt`;
  for (const side of ["top", "right", "bottom", "left"] as const)
    out[`margin-${side}`] = `${round(g.margin[side] + inset)}pt`;
  return out;
}

/** Named-page rules must carry the author's margins + the bleed inset. */
function withInset(decls: Declarations, inset: number, model: GcpmModel): Declarations {
  if (!inset) return decls;
  const out: Declarations = { ...decls };
  const base = resolvePage(model);
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const own = decls[`margin-${side}`];
    const value = own !== undefined ? (toPt(own) ?? base.geometry.margin[side]) : undefined;
    if (value !== undefined) out[`margin-${side}`] = `${round(value + inset)}pt`;
  }
  if (decls.margin) {
    delete out.margin;
    const m = resolvePage(model, {}).geometry.margin;
    for (const side of ["top", "right", "bottom", "left"] as const)
      out[`margin-${side}`] = `${round(m[side] + inset)}pt`;
  }
  if (decls.size) {
    const s = parseSize(decls.size);
    if (s)
      out.size = `${round(s.width + 2 * inset)}pt ${round(s.height + 2 * inset)}pt`;
  }
  delete out.bleed;
  delete out.marks;
  return out;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
