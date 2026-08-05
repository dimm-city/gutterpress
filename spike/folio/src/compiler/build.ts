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
import { extract, type GcpmModel } from "../shared/gcpm-extract.ts";
import { evaluate, needsMeasurement, parseContent } from "../shared/content-value.ts";
import { inspectPdf } from "../shared/pdf-inspect.ts";
import { ensureBundles } from "../bundles.ts";
import { classify, synthesize, type Tier2Output } from "./tier2.ts";
import { postprocess, type PostprocessResult } from "./postprocess.ts";

const AGENT_PATH = join(import.meta.dir, "..", "..", "dist", "folio-agent.js");

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

    // ---- Tier 2: chapter runs + synthesis -------------------------------
    const runs = await page.evaluate<any[]>(
      `window.__folio.discoverRuns(${JSON.stringify(model.pageAssignments)}, ${JSON.stringify(
        model.stringSets.map((s) => ({ selector: s.selector, name: s.name })),
      )})`,
    );
    const tier2 = synthesize({
      model,
      chapters: runs,
      marks: opts.marks,
      slugPt: opts.slugPt,
      bleedPt: opts.bleedPt,
    });
    notes.push(...tier2.notes);
    let genCss = tier2.css;
    if (genCss.trim()) {
      await page.evaluate(
        `window.__folio.addCss("folio-gen-css", ${JSON.stringify(genCss)})`,
      );
      log(`tier 2: ${tier2.chapters.length} generated page templates`);
    }

    let tier: 1 | 2 | 3 =
      tier2.chapters.length > 0 || tier2.geometry.bleed > 0 || tier2.geometry.slug > 0
        ? 2
        : 1;
    let passes = 1;
    let pageMap: Record<string, number> = {};
    let converged = true;
    let bytes = await printPdf(page);

    // ---- Tier 3: measure -> synthesize -> fixpoint -----------------------
    if (tier3Reasons.length) {
      tier = 3;
      const maxPasses = opts.maxPasses ?? 4;
      const sources = await page.evaluate<any[]>(
        `window.__folio.stringSources(${JSON.stringify(
          model.stringSets.map((s) => ({ selector: s.selector, name: s.name })),
        )})`,
      );
      const xrefSelectors = model.xrefs
        .filter((x) => needsMeasurement(x.content))
        .map((x) => x.selector);
      const sites = await page.evaluate<any[]>(
        `window.__folio.xrefSites(${JSON.stringify(xrefSelectors)})`,
      );
      const targets = new Set<string>();
      for (const s of sources) targets.add(s.id);
      for (const s of sites) if (s.href.startsWith("#")) targets.add(s.href.slice(1));
      await page.evaluate(
        `window.__folio.instrument(${JSON.stringify([...targets])})`,
      );

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
        const mapCss = counterStyleCss(model, sources, pageMap, facts.pageCount, tier2.chapters);
        if (mapCss) {
          await page.evaluate(
            `window.__folio.addCss("folio-gen-strings", ${JSON.stringify(mapCss)})`,
          );
          genCss += `\n/* Tier 3 */\n${mapCss}`;
        }
      }
      if (!converged) {
        notes.push(
          `Tier 3 did not reach a fixpoint in ${passes} passes — page numbers in generated text may be one pass stale.`,
        );
        log(`tier 3: NOT converged after ${passes} passes`);
      }
      // final print with the last synthesis applied
      bytes = await printPdf(page);
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
 * Per-page running strings: emit one symbol per page and consume it as
 * `counter(page, folio-<name>)` — verified in S3, keeps rendering inside
 * Chromium with the document's own fonts.
 */
export function counterStyleCss(
  model: GcpmModel,
  sources: Array<{ name: string; id: string; text: string }>,
  pageMap: Record<string, number>,
  pageCount: number,
  generatedPages: Array<{ pageName: string; basePage?: string }> = [],
): string {
  const consumers = model.pageRules.filter((r) =>
    Object.values(r.marginBoxes).some((d) =>
      d.content ? parseContent(d.content).some((p) => p.type === "string") : false,
    ),
  );
  if (!consumers.length) return "";

  const byName = new Map<string, Array<{ page: number; text: string }>>();
  for (const s of sources) {
    const page = pageMap[s.id];
    if (!page) continue;
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
    let cursor = 0;
    for (let p = 1; p <= pageCount; p++) {
      // GCPM `string(x)` default is `first`: the first value SET on the page,
      // else the value carried over from earlier pages.
      const onPage = entries.filter((e) => e.page === p);
      if (onPage.length) current = onPage[0].text;
      else {
        const before = entries.filter((e) => e.page < p);
        current = before.length ? before[before.length - 1].text : current;
      }
      symbols.push(current);
      cursor++;
    }
    void cursor;
    out.push(
      `@counter-style folio-${name} { system: fixed; suffix: ""; symbols: ${symbols
        .map((s) => `"${s.replace(/["\\]/g, "\\$&")}"`)
        .join(" ")}; }`,
    );
  }

  for (const rule of consumers) {
    const pseudo = rule.pseudos.length ? `:${rule.pseudos.join(":")}` : "";
    const boxes = Object.entries(rule.marginBoxes)
      .filter(([, d]) => d.content && /\bstring\s*\(/.test(d.content))
      .map(([box, d]) => {
        const content = parseContent(d.content!)
          .map((p) => {
            if (p.type === "string") return `counter(page, folio-${p.name})`;
            if (p.type === "literal") return `"${p.value.replace(/["\\]/g, "\\$&")}"`;
            if (p.type === "counter")
              return `counter(${p.name}${p.style !== "decimal" ? `, ${p.style}` : ""})`;
            return "";
          })
          .filter(Boolean)
          .join(" ");
        return `  ${box} { content: ${content}; }`;
      })
      .join("\n");
    if (!boxes) continue;
    const names = [
      rule.name ?? "",
      // Tier 2 may already have moved these pages onto generated names; the
      // rewrite has to follow them there or it lands on dead rules.
      ...generatedPages.filter((g) => (g.basePage ?? "") === (rule.name ?? "")).map((g) => g.pageName),
    ];
    for (const name of names)
      out.push(`@page ${name}${pseudo} {\n${boxes}\n}`.replace("@page  ", "@page "));
  }
  return out.join("\n");
}
