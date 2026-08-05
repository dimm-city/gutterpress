/**
 * Tier 2 (§8) — compile-time synthesis, no measurement.
 *
 * Emits `folio.gen.css` (an inspectable build artifact; the author's files are
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

export interface ChapterString {
  /** generated page name, e.g. "chapter--2" */
  pageName: string;
  /** the author's page name this run belongs to (undefined = default page) */
  basePage?: string;
  /** DOM hook attribute value */
  hook: string;
  /** string name -> literal value for this run */
  strings: Record<string, string>;
}

export interface Tier2Input {
  model: GcpmModel;
  /** chapter runs discovered in the DOM (from the browser) */
  chapters: Array<{
    hook: string;
    page?: string;
    strings: Record<string, string>;
    /** every page name used inside the run (stamped as data-folio-page) */
    names?: string[];
  }>;
  /** finishing options; CSS values win when both exist (§10) */
  marks?: boolean;
  slugPt?: number;
  bleedPt?: number;
}

export interface PageRename {
  hook: string;
  /** author page name stamped on the element */
  from: string;
  /** generated page name for this run */
  to: string;
}

export interface Tier2Output {
  css: string;
  /** applied inline by the agent, so the cascade can't strand an element */
  renames: PageRename[];
  geometry: PageTrim;
  /** true when the document uses constructs that need Tier 3 */
  needsTier3: boolean;
  chapters: ChapterString[];
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
    "/* folio.gen.css — generated by the Folio compiler (Tier 2).",
    "   Derived from the author's own @page/GCPM declarations; the author's",
    "   files are never modified. Inspect freely, do not edit. */",
    "",
  ];

  // ---- 1. bleed / marks geometry ----------------------------------------
  if (inset > 0) {
    out.push(
      `@page {`,
      `  size: ${round(geometry.media.width)}pt ${round(geometry.media.height)}pt;`,
    );
    const base = resolvePage(model);
    for (const side of ["top", "right", "bottom", "left"] as const) {
      out.push(`  margin-${side}: ${round(base.geometry.margin[side] + inset)}pt;`);
    }
    out.push(`}`);
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
  }

  // ---- 2. chapter-granularity running strings ---------------------------
  const chapters: ChapterString[] = [];
  const renames: PageRename[] = [];
  const consumers = model.pageRules.filter((r) =>
    Object.values(r.marginBoxes).some((d) =>
      d.content ? parseContent(d.content).some((p) => p.type === "string") : false,
    ),
  );

  // GCPM `string(x)` on a page with no assignment carries the value forward, so
  // a chapter's BODY run (which sets nothing) still has to head with the
  // chapter's title. Tier 2 threads the running values through the runs in
  // document order and gives every run the values in effect on it.
  let carried: Record<string, string> = {};

  for (const [i, run] of input.chapters.entries()) {
    carried = { ...carried, ...run.strings };
    const chapter = { ...run, strings: carried };
    if (!Object.keys(chapter.strings).length) continue;
    const base = chapter.page;

    // Renaming a run's page is only worth it when some margin box on it
    // actually reads a `string()`.
    const consumesHere = consumers.filter((r) => (r.name ? r.name === base : true));
    if (!consumesHere.length) continue;

    const suffix = `--${i + 1}`;
    const generatedName = (name?: string) => `${name ?? "folio"}${suffix}`;

    /**
     * Emit one merged block per pseudo-page variant of `<name><suffix>`.
     *
     * Copying the author's rules verbatim into the generated name would invert
     * the spec's page-selector specificity: an unnamed `@page :left` copied to
     * `@page chapter--3:left` suddenly outranks the named `@page chapter--3`
     * it was supposed to lose to, and a cover would get its folio back. So the
     * cascade is resolved HERE (the same resolver the viewer uses) and the
     * result is emitted as a single flat block per variant.
     */
    const emit = (name: string | undefined) => {
      const variants = [[] as string[], ...pseudoVariants(model).map((p) => [p])];
      for (const pseudos of variants) {
        const resolved = resolvePage(model, { name, pseudos });
        const boxes = Object.entries(resolved.marginBoxes)
          .map(([box, decls]) => {
            const out: Declarations = { ...decls };
            if (decls.content) out.content = literalise(decls.content, chapter.strings);
            Object.assign(out, marginBoxInset(box, inset));
            return `  ${box} {\n${declsToCss(out)}\n  }`;
          })
          .join("\n");
        const own = declsToCss(pageDecls(resolved, inset), "  ");
        const pseudo = pseudos.length ? `:${pseudos.join(":")}` : "";
        out.push(`@page ${generatedName(name)}${pseudo} {`, own, boxes, `}`);
      }
    };

    // Every page name used inside the run is renamed together, so the run's
    // internal page-name changes (and therefore its breaks) stay as authored.
    const names = chapter.names?.length ? chapter.names : base ? [base] : [];
    for (const name of names) {
      emit(name);
      renames.push({ hook: chapter.hook, from: name, to: generatedName(name) });
    }
    if (!names.length) {
      emit(base);
      out.push(`[data-folio-run="${chapter.hook}"] { page: ${generatedName(base)}; }`);
    }

    chapters.push({ pageName: generatedName(base), basePage: base, hook: chapter.hook, strings: chapter.strings });
  }
  if (chapters.length)
    notes.push(`generated ${chapters.length} chapter page templates with literal running heads`);

  return {
    css: out.join("\n") + "\n",
    renames,
    geometry,
    needsTier3: tier3Reasons.length > 0,
    chapters,
    notes: [...notes, ...tier3Reasons],
  };
}

/** Replace `string(name)` with the run's literal text; keep everything else. */
export function literalise(content: string, strings: Record<string, string>): string {
  const parts = parseContent(content);
  return parts
    .map((p) => {
      if (p.type === "string") {
        const v = strings[p.name] ?? "";
        return `"${v.replace(/["\\]/g, "\\$&")}"`;
      }
      if (p.type === "literal") return `"${p.value.replace(/["\\]/g, "\\$&")}"`;
      if (p.type === "counter")
        return `counter(${p.name}${p.style && p.style !== "decimal" ? `, ${p.style}` : ""})`;
      if (p.type === "keyword") return p.value;
      return "";
    })
    .filter(Boolean)
    .join(" ");
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
