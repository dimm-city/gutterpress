/**
 * The Folio compiler (§8). Drives the SYSTEM Chromium over raw CDP and runs
 * the three tiers:
 *
 *   Tier 1  native print — a document using only supported features is done in
 *           one pass with zero synthesis.
 *   Tier 2  compile-time synthesis (running heads at chapter granularity,
 *           bleed/marks geometry) — still one pass, no measurement.
 *   Tier 3  measure → synthesize → fixpoint, only when the document uses
 *           target-counter()/leader()/page-granular strings.
 *
 * Then postprocess: PDF boxes, crop marks, signature padding, metadata.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launchChromium, type Browser, type Session } from "../shared/cdp.ts";
import { extract, resolvePage, type GcpmModel } from "../shared/gcpm-extract.ts";
import { evaluate, needsMeasurement, parseContent } from "../shared/content-value.ts";
import { inspectPdf } from "../shared/pdf-inspect.ts";
import { ensureBundles } from "../bundles.ts";
import {
  classify,
  consumedStrings,
  pseudoVariants,
  synthesize,
  type Tier2Output,
} from "./tier2.ts";
import { postprocess, type PostprocessResult } from "./postprocess.ts";

const AGENT_PATH = join(import.meta.dir, "..", "..", "dist", "folio-agent.js");

/** Generated page name carrying the author's `@page :blank` rules. */
const BLANK_PAGE = "folio--blank";

export interface BuildOptions {
  input: string;
  output?: string;
  signature?: number;
  marks?: boolean;
  slugPt?: number;
  bleedPt?: number;
  title?: string;
  author?: string;
  maxPasses?: number;
  /** reuse a warm browser (dev server) */
  browser?: Browser;
  onProgress?: (msg: string) => void;
}

export interface BuildResult {
  bytes: Uint8Array;
  tier: 1 | 2 | 3;
  passes: number;
  pageCount: number;
  genCss: string;
  geometry: Tier2Output["geometry"];
  notes: string[];
  post: PostprocessResult;
  /** id -> 1-based page, the measurement channel's output */
  pageMap: Record<string, number>;
  converged: boolean;
}

export async function build(opts: BuildOptions): Promise<BuildResult> {
  const log = opts.onProgress ?? (() => {});
  await ensureBundles();
  const AGENT = readFileSync(AGENT_PATH, "utf8");
  const browser = opts.browser ?? (await launchChromium());
  const ownsBrowser = !opts.browser;
  const page = await browser.newPage();
  const notes: string[] = [];

  try {
    const url = /^(https?|file):\/\//.test(opts.input)
      ? opts.input
      : pathToFileURL(resolve(opts.input)).href;
    await page.navigate(url);
    await page.evaluate(AGENT);
    await page.waitForReady();

    // ---- read the author's CSS (never rewrite it) -----------------------
    const cssText = await page.evaluate<string>(`window.__folio.collectCss()`);
    const model: GcpmModel = extract(cssText);
    const { tier3Reasons } = classify(model);

    // ---- Tier 2: geometry synthesis (bleed / marks) ---------------------
    const tier2 = synthesize({
      model,
      marks: opts.marks,
      slugPt: opts.slugPt,
      bleedPt: opts.bleedPt,
    });
    notes.push(...tier2.notes);
    let genCss = tier2.css;
    if (genCss.trim().length > 200) {
      await page.evaluate(
        `window.__folio.addCss("folio-gen-css", ${JSON.stringify(genCss)})`,
      );
      log(`tier 2: bleed/marks geometry`);
    }

    // Running heads, cross-references and recto/verso placement all need to
    // know which page things landed on, so all three go through the
    // measure -> synthesize -> fixpoint loop.
    const rectoDecls = model.breaks.filter(
      (b) => b.prop === "break-before" && /^(right|recto|left|verso)$/.test(b.value.trim()),
    );
    const needsMeasure =
      tier3Reasons.length > 0 || consumedStrings(model).size > 0 || rectoDecls.length > 0;
    let tier: 1 | 2 | 3 =
      tier2.geometry.bleed > 0 || tier2.geometry.slug > 0 ? 2 : 1;
    let passes = 1;
    let pageMap: Record<string, number> = {};
    let converged = true;
    let bytes = await printPdf(page);

    // ---- Tier 3: measure -> synthesize -> fixpoint -----------------------
    if (needsMeasure) {
      tier = 3;
      const maxPasses = opts.maxPasses ?? 4;
      const sources = await page.evaluate<any[]>(
        `window.__folio.stringSources(${JSON.stringify(
          model.stringSets.map((s) => ({ selector: s.selector, name: s.name })),
        )})`,
      );
      // recto/verso forced breaks: Chromium treats them as plain page breaks
      // (s10), so the blank pages have to be synthesized from the measured
      // page numbers, inside this same fixpoint.
      const rectoSites = rectoDecls.length
        ? await page.evaluate<any[]>(
            `window.__folio.forcedBreakSites(${JSON.stringify(rectoDecls)})`,
          )
        : [];
      // The blank pages Folio inserts must be styled by the author's
      // `@page :blank` rules, which Chromium never matches on its own (s10).
      // Emitted LAST, in the same sheet as the running-string rewrite: a
      // generated rule in an earlier sheet loses to a later one regardless of
      // page-selector specificity (see counterStyleCss).
      let blankCss = "";
      if (rectoSites.length) {
        const blank = resolvePage(model, { pseudos: ["blank"] });
        const boxes = Object.entries(blank.marginBoxes)
          .filter(([, d]) => d.content !== undefined)
          .map(([box, d]) => `  ${box} { content: ${d.content}; }`)
          .join("\n");
        blankCss = `@page ${BLANK_PAGE} {\n${boxes || "  /* author declared no @page :blank */"}\n}`;
      }

      const xrefSelectors = model.xrefs
        .filter((x) => needsMeasurement(x.content))
        .map((x) => x.selector);
      const sites = await page.evaluate<any[]>(
        `window.__folio.xrefSites(${JSON.stringify(xrefSelectors)})`,
      );
      const targets = new Set<string>();
      for (const s of sources) targets.add(s.id);
      for (const s of sites) if (s.href.startsWith("#")) targets.add(s.href.slice(1));
      for (const s of rectoSites) targets.add(s.id);
      await page.evaluate(
        `window.__folio.instrument(${JSON.stringify([...targets])})`,
      );

      // ---- recto/verso placement, before anything quotes a page number ----
      // A blank page shifts every later page by exactly one and changes no
      // content, so the whole set can be computed from ONE clean measurement:
      // walk the sites in document order, keeping a running count of blanks
      // inserted so far. Toggling them one pass at a time instead oscillates —
      // the spacer fixes the parity, the next pass sees it fixed and removes it.
      if (rectoSites.length) {
        const measure = async () => {
          const facts = await inspectPdf(await printPdf(page));
          return Object.fromEntries(
            Object.entries(facts.namedDests).map(([k, v]) => [k, v + 1]),
          ) as Record<string, number>;
        };
        let map = await measure();
        const wantsRecto = (v: string) => /^(right|recto)$/.test(v.trim());
        const wrong = (site: { value: string }, p: number) =>
          wantsRecto(site.value) ? p % 2 === 0 : p % 2 === 1;

        let shift = 0;
        const planned: string[] = [];
        for (const site of rectoSites) {
          const base = map[site.id];
          if (!base) continue;
          if (wrong(site, base + shift)) {
            planned.push(site.id);
            shift++;
          }
        }
        if (planned.length && blankCss) {
          await page.evaluate(
            `window.__folio.addCss("folio-gen-strings", ${JSON.stringify(blankCss)})`,
          );
        }
        if (planned.length) {
          await page.evaluate(
            `window.__folio.applyRectoSpacers(${JSON.stringify(planned)}, ${JSON.stringify(BLANK_PAGE)})`,
          );
          log(`tier 3: ${planned.length} blank page(s) so forced breaks land on the right side`);
          // verify, and repair any site the plan missed (bounded)
          for (let attempt = 0; attempt < 3; attempt++) {
            map = await measure();
            const bad = rectoSites.filter((site) => {
              const p = map[site.id];
              return p ? wrong(site, p) : false;
            });
            if (!bad.length) break;
            for (const site of bad) {
              const i = planned.indexOf(site.id);
              if (i >= 0) planned.splice(i, 1);
              else planned.push(site.id);
            }
            await page.evaluate(
              `window.__folio.applyRectoSpacers(${JSON.stringify(planned)}, ${JSON.stringify(BLANK_PAGE)})`,
            );
            if (attempt === 2)
              notes.push(
                `Could not place ${bad.length} recto/verso break(s) after 3 attempts.`,
              );
          }
        }
      }

      let previous = "";
      converged = false;
      for (let pass = 1; pass <= maxPasses; pass++) {
        passes = pass;
        bytes = await printPdf(page);
        const facts = await inspectPdf(bytes);
        pageMap = Object.fromEntries(
          Object.entries(facts.namedDests).map(([k, v]) => [k, v + 1]),
        );
        const signature = JSON.stringify(pageMap);
        if (signature === previous) {
          converged = true;
          log(`tier 3: fixpoint after ${pass} pass${pass === 1 ? "" : "es"}`);
          break;
        }
        previous = signature;

        // (a) cross-reference text at the reference site
        const generated: Array<{ id: string; where: string; text: string }> = [];
        for (const site of sites) {
          const decl = model.xrefs.find((x) => x.selector === site.selector);
          if (!decl) continue;
          const where = /::?before$/.test(site.selector) ? "before" : "after";
          const text = evaluate(decl.content, {
            attr: (n) => (n === "href" ? site.href : undefined),
            targetPage: (u) => pageMap[u.replace(/^#/, "")],
            targetText: () => undefined,
          });
          generated.push({ id: site.id, where, text });
        }
        if (generated.length)
          await page.evaluate(
            `window.__folio.setGenerated(${JSON.stringify(generated)})`,
          );

        // (b) page-granular running strings via a fixed counter-style map
        const mapCss = [counterStyleCss(model, sources, pageMap, facts.pageCount), blankCss]
          .filter(Boolean)
          .join("\n");
        if (mapCss) {
          await page.evaluate(
            `window.__folio.addCss("folio-gen-strings", ${JSON.stringify(mapCss)})`,
          );
          genCss = genCss.split("\n/* Tier 3 */")[0] + `\n/* Tier 3 */\n${mapCss}`;
        }
      }
      if (!converged) {
        notes.push(
          `Tier 3 did not reach a fixpoint in ${passes} passes — page numbers in generated text may be one pass stale.`,
        );
        log(`tier 3: NOT converged after ${passes} passes`);
      }
      // Take the instrumentation back out before the final print: the ids it
      // assigns are visible to author selectors (`h1[id] { counter-increment }`
      // in a real theme), so leaving them in would print a different document
      // than the author wrote.
      const removed = await page.evaluate<{ ids: number; hosts: number }>(
        `window.__folio.deinstrument()`,
      );
      const before = (await inspectPdf(bytes)).pageCount;
      bytes = await printPdf(page);
      const after = (await inspectPdf(bytes)).pageCount;
      if (removed.ids) log(`tier 3: removed ${removed.ids} instrumentation id(s)`);
      if (before !== after) {
        notes.push(
          `Instrumentation changed the layout: ${before} pages while measuring, ${after} after removing it. ` +
            `The page map may be one pass stale — check for selectors that depend on \`[id]\`.`,
        );
        log(`tier 3: WARNING instrumentation shifted the layout (${before} -> ${after} pages)`);
      }
    }

    // ---- postprocess -----------------------------------------------------
    const post = await postprocess(bytes, {
      geometry: tier2.geometry,
      signature: opts.signature,
      marks: opts.marks,
      title: opts.title,
      author: opts.author,
    });
    log(
      `postprocess: ${post.pageCount} pages` +
        (post.padded ? ` (+${post.padded} signature pad)` : ""),
    );

    return {
      bytes: post.bytes,
      tier,
      passes,
      pageCount: post.pageCount,
      genCss,
      geometry: tier2.geometry,
      notes,
      post,
      pageMap,
      converged,
    };
  } finally {
    await page.close();
    if (ownsBrowser) await browser.close();
  }
}

async function printPdf(page: Session): Promise<Uint8Array> {
  await page.waitForReady();
  return page.printToPDF();
}

/**
 * Per-page running strings, without touching page names.
 *
 * `string-set`/`string()` is unimplemented in Chromium, so the value a margin
 * box should show changes page by page with nothing in CSS to express it. The
 * fix is a generated `@counter-style { system: fixed; symbols: … }` with one
 * symbol per page, consumed as `counter(page, folio-<name>)` — verified in S3.
 * Rendering stays inside Chromium with the document's own fonts, and the
 * author's `@page` rules are never renamed or rewritten.
 *
 * Every page context is emitted with its FULLY RESOLVED content, including the
 * suppressions (`content: none`). That is not defensive style: Chromium does
 * not apply page-selector specificity ACROSS stylesheets, so an `@page :left {
 * @top-center { content: none } }` in the author's sheet does not beat a plain
 * `@page { @top-center { … } }` in the generated sheet — the head would be
 * drawn twice. Resolving here removes the dependency entirely.
 */
export function counterStyleCss(
  model: GcpmModel,
  sources: Array<{ name: string; id: string; text: string }>,
  pageMap: Record<string, number>,
  pageCount: number,
): string {
  const consumed = consumedStrings(model);
  if (!consumed.size) return "";

  // symbol maps: one entry per page, carrying the value forward (GCPM's
  // `string()` keeps the last assignment until the next one)
  const byName = new Map<string, Array<{ page: number; text: string }>>();
  for (const s of sources) {
    const page = pageMap[s.id];
    if (!page || !consumed.has(s.name)) continue;
    const list = byName.get(s.name) ?? [];
    list.push({ page, text: s.text });
    byName.set(s.name, list);
  }
  if (!byName.size) return "";

  const out: string[] = [];
  for (const [name, entries] of byName) {
    entries.sort((a, b) => a.page - b.page);
    const symbols: string[] = [];
    let current = "";
    for (let p = 1; p <= pageCount; p++) {
      const onPage = entries.filter((e) => e.page === p);
      if (onPage.length) current = onPage[0].text;
      symbols.push(current);
    }
    out.push(
      `@counter-style folio-${name} { system: fixed; suffix: ""; symbols: ${symbols
        .map((sym) => `"${sym.replace(/["\\]/g, "\\$&")}"`)
        .join(" ")}; }`,
    );
  }

  const rewrite = (content: string): string =>
    parseContent(content)
      .map((part) => {
        if (part.type === "string") return `counter(page, folio-${part.name})`;
        if (part.type === "literal") return `"${part.value.replace(/["\\]/g, "\\$&")}"`;
        if (part.type === "counter")
          return `counter(${part.name}${part.style !== "decimal" ? `, ${part.style}` : ""})`;
        if (part.type === "keyword") return part.value;
        return "";
      })
      .filter(Boolean)
      .join(" ");

  // One flat block per page context, carrying EVERY margin box's resolved
  // content — including the suppressions. A context that needs no rewrite
  // still has to be emitted: the generated unnamed `@page` block would
  // otherwise leak onto it (cross-stylesheet cascade, above) and put a running
  // head on the cover or the TOC.
  const names: Array<string | undefined> = [undefined, ...model.pageNames];
  const variants = [[] as string[], ...pseudoVariants(model).map((p) => [p])];
  for (const name of names) {
    for (const pseudos of variants) {
      const resolved = resolvePage(model, { name, pseudos });
      const lines: string[] = [];
      for (const [box, decls] of Object.entries(resolved.marginBoxes)) {
        if (!decls.content) continue;
        const hasString = /\bstring\s*\(/.test(decls.content);
        lines.push(`  ${box} { content: ${hasString ? rewrite(decls.content) : decls.content}; }`);
      }
      if (!lines.length) continue;
      const pseudo = pseudos.length ? `:${pseudos.join(":")}` : "";
      out.push(`@page ${name ?? ""}${pseudo} {\n${lines.join("\n")}\n}`.replace("@page  ", "@page "));
    }
  }
  return out.join("\n");
}
