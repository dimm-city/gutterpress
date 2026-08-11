/**
 * The Gutterpress compiler (§8). Drives the SYSTEM Chromium over raw CDP and runs
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
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launchChromium, type Browser, type Session } from "../shared/cdp.ts";
import { extract, resolvePage, type GcpmModel } from "../shared/gcpm-extract.ts";
import {
  counterStyleName,
  cssQuote,
  generatedContentCss,
  isRectoVersoBreak,
  leaderMarker,
  parseWhich,
  planRectoBlanks,
  restartedPageValues,
  stringSymbols,
  toFolioPage,
  wantsRecto,
  type StringEntry,
  type StringWhich,
} from "../shared/synthesis.ts";
import { evaluate, formatCounter, needsMeasurement, parseContent } from "../shared/content-value.ts";
import { inspectPdf } from "../shared/pdf-inspect.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import {
  classify,
  consumedStrings,
  pseudoVariants,
  synthesize,
  type Tier2Output,
} from "./tier2.ts";
import { postprocess, type PostprocessResult } from "./postprocess.ts";

/** Generated page name carrying the author's `@page :blank` rules. */
const BLANK_PAGE = "gp--blank";

/**
 * Shared element-description helper for every in-page audit's evaluated JS
 * (width offenders, abspos leaks, fragmenting multicol) — one implementation
 * of "name this element for a warning", not a copy per pass.
 */
const DESC_JS = `(el) => {
    const cls = typeof el.className === "string" && el.className
      ? "." + el.className.trim().split(/\\s+/).join(".") : "";
    const src = el.tagName === "IMG" ? " src=" + (el.getAttribute("src") || "").slice(-40) : "";
    return el.tagName.toLowerCase() + cls + src;
  }`;

/**
 * Codes are stable identifiers a UI can map to a plain-language label; the
 * set is closed here so a surface's label table can be asserted complete
 * against it rather than drifting silently as checks are added.
 */
export type BuildDiagnosticCode =
  | "engine.width.overflow"
  | "engine.width.intrinsic"
  | "engine.xref.broken"
  | "engine.abspos.leak"
  | "engine.multicol.dead-column"
  | "engine.content.overheight"
  | "engine.image.low-dpi";

export const BUILD_DIAGNOSTIC_CODES: readonly BuildDiagnosticCode[] = [
  "engine.width.overflow",
  "engine.width.intrinsic",
  "engine.xref.broken",
  "engine.abspos.leak",
  "engine.multicol.dead-column",
  "engine.content.overheight",
  "engine.image.low-dpi",
];

export interface BuildDiagnostic {
  code: BuildDiagnosticCode;
  severity: "warning" | "info";
  /** Plain-language, already naming the offending element. */
  message: string;
}

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
  /** raster resolution below which the audit warns; 0 disables. Default 300. */
  dpiFloor?: number;
  /** downgrade the pre-print width check from a build error to a warning */
  allowShrink?: boolean;
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
  /**
   * Engine-internal reasons (which tier ran, why tier 3 did not converge) —
   * developer-facing, printed by the engine dev CLI. Author-facing findings
   * live in {@link BuildResult.diagnostics}, never here: one finding, one
   * channel.
   */
  notes: string[];
  /**
   * Author-facing print-quality findings, carried to whatever surface the
   * caller has — the desktop's Problems panel, the CLI's build output. Each
   * carries a stable `code` so a surface can label it in plain language
   * without parsing the message.
   */
  diagnostics: BuildDiagnostic[];
  post: PostprocessResult;
  /** id -> 1-based page, the measurement channel's output (print/Chromium) */
  pageMap: Record<string, number>;
  converged: boolean;
  /** how many times Page.printToPDF actually ran (§10: 1 in the common case) */
  prints: number;
  /**
   * §10's predict-then-verify guess, read straight from the in-browser
   * viewer (`fragmentDocument()`) against the SAME target ids as
   * {@link BuildResult.pageMap} — i.e. the desktop preview's own
   * fragmenter's opinion of where each id landed. `null` when Tier 3 never
   * ran (no `needsMeasure` reason), so there is nothing to predict.
   * Exposed for the native-vs-print parity gate
   * (`scripts/native-parity-gate.ts`) — not consumed elsewhere.
   */
  predicted: { pageMap: Record<string, number>; pageCount: number } | null;
  /**
   * The deterministic device-pixel viewport (`sheetViewport`, §"deterministic
   * viewport = the sheet") this build pinned Chromium to. A caller that wants
   * to mount its OWN extra viewer page against the same document (the
   * native-vs-print parity gate's page-count check on a Tier-1/2 book, where
   * {@link BuildResult.predicted} is `null`) needs this to reproduce the same
   * fragmentation the build measured — an unpinned viewport free-sizes off
   * whatever window the browser happens to have open.
   */
  viewport: { width: number; height: number };
  /**
   * `counter-reset: page N` sites (id + declared start), resolved against
   * measured page numbers — the input `restartedPageValues()` needs to
   * convert either {@link BuildResult.pageMap} or
   * {@link BuildResult.predicted} into resolved `target-counter()` values
   * the same way {@link BuildResult.pageMap}'s own synthesis did.
   */
  resetSites: Array<{ id: string; start: number }>;
}

export async function build(opts: BuildOptions): Promise<BuildResult> {
  const log = opts.onProgress ?? (() => {});
  const AGENT = await readFile(await getAssetPath("engine/gutterpress-agent.js"), "utf8");
  const VIEWER = await readFile(await getAssetPath("engine/gutterpress-viewer.js"), "utf8");
  const browser = opts.browser ?? (await launchChromium());
  const ownsBrowser = !opts.browser;
  const page = await browser.newPage();
  const notes: string[] = [];
  const diagnostics: BuildDiagnostic[] = [];
  const diagnose = (code: BuildDiagnosticCode, message: string, severity: BuildDiagnostic["severity"] = "warning") =>
    diagnostics.push({ code, severity, message });
  let prints = 0;

  try {
    const url = /^(https?|file):\/\//.test(opts.input)
      ? opts.input
      : pathToFileURL(resolve(opts.input)).href;
    await page.navigate(url);
    await page.evaluate(AGENT);
    await page.waitForReady();

    // ---- read the author's CSS (never rewrite it) -----------------------
    const cssText = await page.evaluate<string>(`window.__gp.collectCss()`);
    const model: GcpmModel = extract(cssText);
    const { tier3Reasons } = classify(model);

    // ---- deterministic viewport = the sheet -----------------------------
    // Viewport-relative units (vw/vh — 143 uses in one real book) resolve
    // against the LAYOUT viewport even in print, so print output silently
    // depends on whatever window/emulation state the browser happens to be
    // in: an engine-launched window, a pooled puppeteer default, or the
    // width check's cleared override each gave DIFFERENT sizes — measured
    // as a 0.84x shrink-to-fit on one path and none on another, for the
    // same document. Pin the viewport to the author's page size (what the
    // Paged.js pipeline has always laid out at) before anything measures
    // or prints, and keep it pinned for the build's whole life.
    const baseGeom = resolvePage(model).geometry;
    const sheetViewport = {
      width: Math.max(1, Math.round((baseGeom.width * 96) / 72)),
      height: Math.max(1, Math.round((baseGeom.height * 96) / 72)),
      deviceScaleFactor: 1,
      mobile: false,
    };
    await page.send("Emulation.setDeviceMetricsOverride", sheetViewport);

    // Every audit below (the width check, the abspos/multicol passes, the
    // print-quality pass) reads computed styles through `getBoundingClientRect`/
    // `getComputedStyle` while `printToPDF` renders under the `print` media —
    // without this, a book with layout inside `@media print` (the normal
    // thing) is measured against a document that is not the one printed.
    // Set once, kept for the build's whole life, same as the viewport pin.
    await page.send("Emulation.setEmulatedMedia", { media: "print" });
    log(`print media emulated for audits and measurement`);

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
        `window.__gp.addCss("gp-gen-css", ${JSON.stringify(genCss)})`,
      );
      log(`tier 2: bleed/marks geometry`);
    }

    // ---- pre-print width check ------------------------------------------
    // Chromium's native print SILENTLY scales the whole document down when
    // any box's preferred (min-content) width exceeds the page content box
    // — measured 1.364x on a real book, with `pt` values quietly meaning
    // 73% of what they say (ENGINE.md §9). A book must never ship at a
    // mystery scale: fail loudly, name the offenders, and let the author
    // fix the CSS (or pass allowShrink to proceed eyes-open). Runs after
    // tier-2 synthesis so the limit includes the bleed/slug extension —
    // bleed art on a zero-margin page is LEGITIMATELY trim+2*bleed wide.
    const widthOffenders = await findWidthOffenders(
      page,
      model,
      2 * (tier2.geometry.bleed + tier2.geometry.slug),
      sheetViewport,
    );
    const describe = (list: Array<{ desc: string; px: number; left?: number }>) =>
      list
        .map((o) => {
          // The one-line fix depends on which edge the box is offending: a
          // negative `left` is a box pulled off the LEFT edge (undo the
          // offset/margin), an over-wide box is pushed past the RIGHT edge
          // (give it an explicit width that fits the content box).
          const fix =
            o.left !== undefined && o.left < -1
              ? "keep it inside the page content box"
              : "give it an explicit width";
          return `  ${o.desc} — ${Math.round(o.px)}px > ${Math.round(widthOffenders.limitPx)}px content box (${fix})`;
        })
        .join("\n");
    if (widthOffenders.boxes.length) {
      // Laid-out box overflow is a PROVEN trigger class (every measured
      // real-book shrink was one) — a hard error unless the caller opts out.
      const msg =
        `content wider than the page content box triggers Chromium print ` +
        `shrink-to-fit (the WHOLE book scales down, silently):\n${describe(widthOffenders.boxes)}`;
      if (opts.allowShrink) {
        for (const o of widthOffenders.boxes)
          diagnose(
            "engine.width.overflow",
            `${o.desc} is wider than the page — Chromium shrinks the WHOLE book to fit it. ${o.left < -1 ? "Keep it inside the page content box." : "Give it an explicit width that fits."}`,
          );
        log(`WARNING: ${msg}`);
      } else {
        throw new Error(`${msg}\nFix the offending widths, or pass allowShrink to build anyway.`);
      }
    }
    if (widthOffenders.intrinsics.length) {
      // Auto-width replaced elements with over-wide intrinsics are a
      // HEURISTIC class: real triggers exist (unconstrained placards,
      // fixed by `width: 100%`), but images otherwise constrained by
      // max-width/container measured as harmless on a real book — so this
      // warns and records, never blocks.
      const msg =
        `${widthOffenders.intrinsics.length} auto-width image(s) with an intrinsic width past the ` +
        `page content box — if the output prints smaller than the CSS declares, give these an ` +
        `explicit width (e.g. width: 100%):\n${describe(widthOffenders.intrinsics)}`;
      for (const o of widthOffenders.intrinsics)
        diagnose(
          "engine.width.intrinsic",
          `${o.desc} has no width set and is naturally wider than the page — if the printed output comes out smaller than your CSS says, give it an explicit width (e.g. width: 100%).`,
        );
      log(`WARNING: ${msg}`);
    }

    // Running heads, cross-references and recto/verso placement all need to
    // know which page things landed on, so all three go through the
    // measure -> synthesize -> fixpoint loop.
    const rectoDecls = model.breaks.filter(isRectoVersoBreak);
    const needsMeasure =
      tier3Reasons.length > 0 ||
      consumedStrings(model).size > 0 ||
      rectoDecls.length > 0 ||
      model.counterResets.length > 0;
    let tier: 1 | 2 | 3 =
      tier2.geometry.bleed > 0 || tier2.geometry.slug > 0 ? 2 : 1;
    let passes = 1;
    let pageMap: Record<string, number> = {};
    let converged = true;
    // Tier 1/2 print exactly once. When measurement runs, the loop's first
    // pass produces the first print — an up-front print here would be
    // discarded unread.
    let bytes: Uint8Array | undefined;
    let predictedForResult: { pageMap: Record<string, number>; pageCount: number } | null = null;
    let resetSitesForResult: Array<{ id: string; start: number }> = [];

    // ---- Tier 3: measure -> synthesize -> fixpoint -----------------------
    if (needsMeasure) {
      tier = 3;
      const maxPasses = opts.maxPasses ?? 4;
      const sources = await page.evaluate<any[]>(
        `window.__gp.stringSources(${JSON.stringify(
          model.stringSets.map((s) => ({ selector: s.selector, name: s.name, value: s.value })),
        )})`,
      );
      // recto/verso forced breaks: Chromium treats them as plain page breaks
      // (s10), so the blank pages have to be synthesized from the measured
      // page numbers, inside this same fixpoint.
      const rectoSites = rectoDecls.length
        ? await page.evaluate<any[]>(
            `window.__gp.forcedBreakSites(${JSON.stringify(rectoDecls)})`,
          )
        : [];
      // The blank pages Gutterpress inserts must be styled by the author's
      // `@page :blank` rules, which Chromium never matches on its own (s10).
      // Emitted LAST, in the same sheet as the running-string rewrite, and
      // through `counterStyleCss`'s shared rewrite (F1) so a restarted folio
      // counter or running string on a blank page agrees with print/viewer —
      // never a verbatim copy of the author's raw declarations.
      const hasBlankSites = rectoSites.length > 0;

      const xrefSelectors = model.xrefs
        .filter((x) => needsMeasurement(x.content))
        .map((x) => x.selector);
      const sites = await page.evaluate<any[]>(
        `window.__gp.xrefSites(${JSON.stringify(xrefSelectors)})`,
      );
      // front-matter -> body folio restart (`counter-reset: page N`, MIGRATION.md
      // gap #1): Chromium ignores the restart (ENGINE.md §8), so the elements
      // that declare it need ids too, to learn which page they land on.
      const resetSites = model.counterResets.length
        ? await page.evaluate<any[]>(
            `window.__gp.counterResetSites(${JSON.stringify(model.counterResets)})`,
          )
        : [];
      resetSitesForResult = resetSites;
      const targets = new Set<string>();
      for (const s of sources) targets.add(s.id);
      for (const s of sites) if (s.href.startsWith("#")) targets.add(s.href.slice(1));
      for (const s of rectoSites) targets.add(s.id);
      for (const s of resetSites) targets.add(s.id);
      await page.evaluate(
        `window.__gp.instrument(${JSON.stringify([...targets])})`,
      );
      const targetText = await page.evaluate<Record<string, string>>(
        `window.__gp.targetTexts(${JSON.stringify([...targets])})`,
      );

      // A typo'd `href="#..."` on a cross-reference is the single most likely
      // mistake a non-technical author makes, and today it renders a blank
      // or wrong page number with nothing in the CLI output naming it.
      // `targetText` only has an entry for ids that actually resolved to an
      // element, so a bare-fragment href missing from it names a dead xref.
      const brokenXrefs = findBrokenXrefRefs(sites, targetText);
      for (const href of brokenXrefs)
        diagnose(
          "engine.xref.broken",
          `The link "${href}" doesn't point at anything in this book, so its page number will print blank. Check the spelling, or add that id to the heading you meant.`,
        );
      if (brokenXrefs.length) log(`WARNING: ${brokenXrefs.length} broken cross-reference href(s): ${brokenXrefs.join(", ")}`);


      // ---- recto/verso placement, before anything quotes a page number ----
      // A blank page shifts every later page by exactly one and changes no
      // content, so the whole set can be computed from ONE clean measurement:
      // walk the sites in document order, keeping a running count of blanks
      // inserted so far. Toggling them one pass at a time instead oscillates —
      // the spacer fixes the parity, the next pass sees it fixed and removes it.
      if (rectoSites.length) {
        const measure = async () => {
          prints++;
          const facts = await inspectPdf(await printPdf(page));
          return Object.fromEntries(
            Object.entries(facts.namedDests).map(([k, v]) => [k, v + 1]),
          ) as Record<string, number>;
        };
        let map = await measure();
        const wrong = (site: { value: string }, p: number) =>
          wantsRecto(site.value) ? p % 2 === 0 : p % 2 === 1;

        const plan = planRectoBlanks(
          rectoSites.map((site: any) => ({
            page: map[site.id] ?? 0,
            wantsRecto: wantsRecto(site.value),
          })),
        );
        const planned: string[] = rectoSites
          .filter((_: any, i: number) => plan[i])
          .map((site: any) => site.id);
        if (planned.length) {
          const earlyBlankCss = counterStyleCss(model, [], {}, 0, [], true);
          if (earlyBlankCss) {
            await page.evaluate(
              `window.__gp.addCss("gp-gen-strings", ${JSON.stringify(earlyBlankCss)})`,
            );
          }
        }
        if (planned.length) {
          await page.evaluate(
            `window.__gp.applyRectoSpacers(${JSON.stringify(planned)}, ${JSON.stringify(BLANK_PAGE)})`,
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
              `window.__gp.applyRectoSpacers(${JSON.stringify(planned)}, ${JSON.stringify(BLANK_PAGE)})`,
            );
            if (attempt === 2)
              notes.push(
                `Could not place ${bad.length} recto/verso break(s) after 3 attempts.`,
              );
          }
        }
      }

      // Apply cross-reference text and running-string CSS against a given page
      // map — the ONE synthesis step, called either against a PREDICTED map
      // (below, before the first print) or a just-MEASURED one (inside the
      // loop, the fallback path). Same function either way (ARCHITECTURE.md
      // §1): the two callers differ only in where the map came from.
      const applySynthesis = async (map: Record<string, number>, pageCount: number) => {
        // `target-counter(attr(href), page)` must resolve to the SAME folio
        // the target page's own margin box prints, not the raw physical page
        // (F3) — one shared conversion, `restartedPageValues`/`toFolioPage`,
        // also used by `counterStyleCss` below for the folios themselves.
        const pageValues = restartedPageValues(resetSites, map, pageCount);
        // (a) cross-reference text at the reference site
        const generated: Array<{ id: string; where: string; text: string }> = [];
        for (const site of sites) {
          const decl = model.xrefs.find((x) => x.selector === site.selector);
          if (!decl) continue;
          const where = /::?before$/.test(site.selector) ? "before" : "after";
          const text = evaluate(decl.content, {
            attr: (n) => (n === "href" ? site.href : undefined),
            targetPage: (u) => {
              const physical = map[u.replace(/^#/, "")];
              return physical === undefined ? undefined : toFolioPage(physical, pageValues);
            },
            targetText: (u) => targetText[u.replace(/^#/, "")],
            leader: leaderMarker,
          });
          generated.push({ id: site.id, where, text });
        }
        if (generated.length) {
          const contentCss = generatedContentCss(model.xrefs.map((x) => x.selector));
          await page.evaluate(
            `window.__gp.setGenerated(${JSON.stringify(generated)}, ${JSON.stringify(contentCss)})`,
          );
          const g = tier2.geometry;
          const contentWidthPx =
            ((g.trim.width - resolvePage(model).geometry.margin.left -
              resolvePage(model).geometry.margin.right) * 96) / 72;
          await page.evaluate(`window.__gp.fillLeaders(${contentWidthPx})`);
        }

        // (b) page-granular running strings via a fixed counter-style map
        // (the gp--blank named page is emitted through this SAME call —
        // F1 — so a restarted folio counter agrees on the inserted blanks).
        const mapCss = counterStyleCss(model, sources, map, pageCount, resetSites, hasBlankSites);
        if (mapCss) {
          await page.evaluate(
            `window.__gp.addCss("gp-gen-strings", ${JSON.stringify(mapCss)})`,
          );
          genCss = genCss.split("\n/* Tier 3 */")[0] + `\n/* Tier 3 */\n${mapCss}`;
        }
      };

      // §10 predict-then-verify: guess the page map from the viewer's multicol
      // layout (no print — ~0.11s) instead of a throwaway print purely to read
      // `/Dests`. Synthesis is applied against the guess BEFORE the first
      // print, so that print is both the verification print and — if the
      // guess holds — the shipped bytes. `predicted` is null only if the
      // predict page itself fails (e.g. a malformed document); the fixpoint
      // loop below is unchanged and is the fallback either way.
      const predicted = await predictPageMap(
        browser,
        url,
        AGENT,
        VIEWER,
        {
          stringSets: model.stringSets.map((s) => ({ selector: s.selector, name: s.name, value: s.value })),
          rectoDecls,
          xrefSelectors,
          resets: model.counterResets,
          targets: [...targets],
        },
        sheetViewport,
      );
      if (predicted) predictedForResult = { pageMap: predicted.pageMap, pageCount: predicted.pageCount };
      let previous = "";
      if (predicted) {
        log(
          `tier 3: predicted page map from the viewer in ${predicted.ms.toFixed(0)}ms ` +
            `(${predicted.pageCount}pp, ${Object.keys(predicted.pageMap).length}/${targets.size} targets resolved)`,
        );
        await applySynthesis(predicted.pageMap, predicted.pageCount);
        previous = mapSignature(predicted.pageMap, predicted.pageCount);
      }

      converged = false;
      for (let pass = 1; pass <= maxPasses; pass++) {
        passes = pass;
        prints++;
        bytes = await printPdf(page);
        const facts = await inspectPdf(bytes);
        // Chromium creates a /Dest for every id ANY link in the document
        // resolves to, not just Gutterpress's instrumented targets — a book with
        // real in-content cross-references (`[text](#heading)`) litters
        // `facts.namedDests` with ids no synthesis step reads. Scope to
        // `targets`: that is the actual contract (id -> page for exactly the
        // ids `applySynthesis` consumes), and it is what the predicted map
        // is scoped to as well, so the two are comparable.
        pageMap = Object.fromEntries(
          Object.entries(facts.namedDests)
            .filter(([k]) => targets.has(k))
            .map(([k, v]) => [k, v + 1]),
        );
        log(
          `tier 3: pass ${pass} measured ${Object.keys(pageMap).length}/${targets.size} targets (${facts.pageCount}pp)`,
        );
        const signature = mapSignature(pageMap, facts.pageCount);
        if (signature === previous) {
          converged = true;
          log(
            `tier 3: fixpoint after ${pass} pass${pass === 1 ? "" : "es"}` +
              (predicted && pass === 1 ? " — the predicted print shipped, no reprint" : ""),
          );
          break;
        }
        previous = signature;
        await applySynthesis(pageMap, facts.pageCount);
      }
      if (!converged) {
        notes.push(
          `Tier 3 did not reach a fixpoint in ${passes} passes — page numbers in generated text may be one pass stale.`,
        );
        log(`tier 3: NOT converged after ${passes} passes`);
      }
      // No de-instrumentation, no final reprint: measurement never touches an
      // author-visible attribute (elements are measured through their own ids
      // or through injected zero-size <gp-anchor> children), so the last
      // printed bytes ARE the output. The measured document and the shipped
      // document cannot diverge, structurally.
    }

    // Print-quality audit against the settled layout, just before the artifact
    // is final: content taller than the page (where screen and print diverge)
    // and rasters below the print resolution bar.
    const base = resolvePage(model);
    const contentHeightPx =
      ((base.geometry.height - base.geometry.margin.top - base.geometry.margin.bottom) * 96) / 72;
    // Minimum content height across every page context (base + named pages),
    // for the multicol fragmentation check below: that check needs a
    // conservative (never too generous) threshold, since a named page with
    // smaller margins has a shorter content box than the default page and
    // would otherwise under-report fragmentation there.
    const pageContexts = [base, ...model.pageNames.map((n) => resolvePage(model, { name: n }))];
    const minContentHeightPx =
      (Math.min(
        ...pageContexts.map((c) => c.geometry.height - c.geometry.margin.top - c.geometry.margin.bottom),
      ) * 96) / 72;
    {
      const audit = await page.evaluate<Array<{ kind: string; what: string; detail: string }>>(
        `window.__gp.auditContent(${contentHeightPx}, ${opts.dpiFloor ?? 300})`,
      );
      for (const w of audit) {
        if (w.kind === "overheight")
          diagnose(
            "engine.content.overheight",
            `${w.what} is taller than one page (${w.detail}): print splits it across pages while the on-screen preview clips it, so the two will not agree here.`,
          );
        else
          diagnose(
            "engine.image.low-dpi",
            `${w.what} is below the ${opts.dpiFloor ?? 300} DPI print bar (${w.detail}) — it may look soft or pixelated in print.`,
          );
      }
      if (audit.length) log(`audit: ${audit.length} print-quality warning(s)`);
    }

    // Abspos containing-block leak + fragmenting-multicol warnings — one
    // shared `querySelectorAll("*")` walk with a single `getComputedStyle`
    // call per element (was two separate document-wide walks).
    //
    // Abspos: independent of the width/height passes above. A
    // `position: absolute` element whose `offsetParent` is the document (or
    // nothing) positions against the WHOLE canvas, not the page it appears
    // on: it can paint clipped on the last page of a 300-page book while the
    // page it belongs to renders empty. Scoped to `.page`/`.spread` becoming
    // positioned (PAGED_CSS) would make most of these go silent by finding a
    // containing block again — but only for pages that DON'T fragment across
    // sheets; that refinement needs fragmentation info this pass doesn't have
    // cheaply, so it is left for later, not guessed at.
    //
    // Multicol: `column-fill: balance` (the initial value) only balances
    // columns on the LAST fragment — a balanced container that fragments
    // across sheets leaves dead columns on every page before the last one.
    // Explicitly scoped to actual multicol containers (`column-count` OR
    // `column-width` set — `columns: 20em` resolves to `column-width` with
    // `column-count: auto`, so checking `columnCount` alone misses it), not a
    // relaxation of auditContent's leaf guard — that would make every wrapper
    // div in a 300-page book a candidate.
    {
      const { leaks, multicol } = JSON.parse(
        await page.evaluate<string>(`(() => {
          const desc = ${DESC_JS};
          const leaks = [];
          const multicol = [];
          for (const el of document.querySelectorAll("*")) {
            const cs = getComputedStyle(el);
            if (leaks.length < 20) {
              const tag = el.tagName;
              const id = el.id || "";
              const cls = typeof el.className === "string" ? el.className : "";
              if (
                tag !== "GP-ANCHOR" &&
                !id.startsWith("gp-") &&
                !id.startsWith("__gp") &&
                // gp-* CLASSES are author-facing vocabulary (PAGED_CSS's
                // .gp-pin is abspos by design and must stay visible to this
                // leak check); only the engine's own print-document class is
                // excluded. Engine-internal DOM identifies itself via ids or
                // __gp classes, never bare gp-* classes.
                !/(^|\\s)(gp-recto-spacer|__gp)/.test(cls) &&
                !el.closest("#gp-instrumentation") &&
                cs.position === "absolute" &&
                el.getClientRects().length !== 0 // not a display:none subtree
              ) {
                const op = el.offsetParent;
                if (op === null || op === document.body) leaks.push(desc(el));
              }
            }
            if (
              multicol.length < 20 &&
              !(cs.columnCount === "auto" && cs.columnWidth === "auto") &&
              cs.columnFill === "balance" &&
              el.getBoundingClientRect().height > ${minContentHeightPx} + 1
            ) {
              multicol.push(desc(el));
            }
          }
          return JSON.stringify({ leaks, multicol });
        })()`),
      ) as { leaks: string[]; multicol: string[] };
      for (const d of leaks)
        diagnose(
          "engine.abspos.leak",
          `${d} uses position: absolute with nothing positioned around it, so it is placed against the whole document rather than the page it sits on in your markdown — it can print on a completely different page.`,
        );
      if (leaks.length) log(`audit: ${leaks.length} abspos containing-block leak(s)`);
      for (const d of multicol)
        diagnose(
          "engine.multicol.dead-column",
          `${d} runs over more than one page in columns, and only the last page's columns get balanced — earlier pages are left with an empty column. Add column-fill: auto to ${d}.`,
        );
      if (multicol.length) log(`audit: ${multicol.length} fragmenting multicol warning(s)`);
    }

    if (bytes === undefined) {
      prints++;
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
      diagnostics,
      post,
      pageMap,
      converged,
      prints,
      predicted: predictedForResult,
      resetSites: resetSitesForResult,
      viewport: { width: sheetViewport.width, height: sheetViewport.height },
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
 * Canonical (key-order-independent) signature for a page map, for fixpoint
 * comparison. Includes `pageCount` (F2): the id->page map can stabilize
 * while the total page count is still one print behind (an under-predicted
 * count sizes the fixed @counter-style symbol lists too short, and a page
 * beyond the list silently degrades to a decimal fallback) — the loop must
 * not call that a fixpoint.
 */
/**
 * Pre-print width check, in two passes — each matching a MEASURED
 * shrink-to-fit trigger class, and nothing broader:
 *
 * 1. REAL-WIDTH box overflow: with the viewport at the widest page content
 *    box, any element whose border box extends past the limit (fixed-width
 *    blocks, negative-margin pulls, absolutely-positioned protrusions —
 *    every one of these triggered the scale on the real field guide).
 * 2. REPLACED-ELEMENT intrinsics: an `img` (canvas/video likewise) with an
 *    auto width contributes its INTRINSIC width to Chromium's print
 *    preferred-width even when `max-width: 100%` clamps the rendered box
 *    (measured: `width: 100%` fixes it, `min-width: 0` does not; max-width
 *    alone does not). Detected via CSS Typed OM — `computedStyleMap()`
 *    returns the PRE-LAYOUT computed value, so `width: auto` is visible
 *    where getComputedStyle only shows used pixels — combined with the
 *    loaded intrinsic width. Scoped to replaced elements ONLY: min-content
 *    heuristics on flex/grid containers produced measured false positives
 *    (a 2524px "offender" on a book whose real print is uncompressed).
 *
 * Images are awaited (decode/complete) before either pass — intrinsic
 * widths only exist once loaded, and skipping the wait made the check
 * nondeterministic (measured: same book passing or failing by load race).
 *
 * Viewport emulation only — the DOM is never touched (ARCHITECTURE.md §2),
 * and the override is cleared before any print. Known approximation, on
 * purpose: elements are compared against the WIDEST page context (a
 * margin-0 full-bleed page raises the limit for the whole document).
 */
async function findWidthOffenders(
  page: Session,
  model: GcpmModel,
  bleedSlugExtensionPt: number,
  restoreViewport: Record<string, unknown>,
): Promise<{
  limitPx: number;
  boxes: Array<{ desc: string; px: number; left: number }>;
  intrinsics: Array<{ desc: string; px: number }>;
}> {
  const contexts = [
    resolvePage(model),
    // Exclude core's own `gp-` reserved-namespace pages (markdown-it-paged.js
    // PAGED_CSS — today `gp-full-bleed`): they are injected into EVERY
    // document with zero side margins so `.full-bleed` art can reach the
    // sheet edge, which would otherwise raise this Math.max to the full
    // sheet width for every book and silently disable the shrink-to-fit
    // hard error project-wide. Filtering the whole reserved prefix (not the
    // one literal name) keeps the guard intact when core adds another
    // injected page; `gp-` is core's documented namespace, so an
    // author-declared named page still (correctly) raises the limit.
    ...model.pageNames
      .filter((n) => !n.startsWith("gp-"))
      .map((n) => resolvePage(model, { name: n })),
  ];
  const maxContentPt =
    Math.max(
      ...contexts.map((c) => c.geometry.width - c.geometry.margin.left - c.geometry.margin.right),
    ) + bleedSlugExtensionPt;
  const limitPx = (maxContentPt * 96) / 72;
  await page.evaluate(`Promise.allSettled(
    [...document.images].map((i) => i.decode().catch(() => {}))
  )`);
  try {
    // pass 1 — laid-out box overflow at the real content width
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: Math.ceil(limitPx),
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const boxes: Array<{ desc: string; px: number; left: number }> = JSON.parse(
      await page.evaluate<string>(`(() => {
        const LIMIT = ${limitPx} + 1;
        const desc = ${DESC_JS};
        const out = [];
        for (const el of document.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          const right = Math.max(r.right, r.left + r.width);
          // Flag right-edge overflow (fixed-width blocks, negative-margin
          // pulls) AND left-edge protrusion (negative left with an ordinary
          // width) — both trigger the same whole-document shrink-to-fit,
          // measured: a left bleed alone cost 16%.
          if (right <= LIMIT && r.width <= LIMIT && r.left >= -1) continue;
          let deepest = true;
          for (const c of el.children) {
            if (c.getBoundingClientRect().width >= r.width - 1) { deepest = false; break; }
          }
          if (!deepest) continue;
          out.push({ desc: desc(el), px: Math.max(r.width, right), left: r.left });
          if (out.length >= 20) break;
        }
        return JSON.stringify(out);
      })()`),
    );
    // pass 2 — replaced elements whose width computes to auto with an
    // over-wide intrinsic (Typed OM shows the pre-layout "auto")
    const replaced: Array<{ desc: string; px: number }> = JSON.parse(
      await page.evaluate<string>(`(() => {
        const LIMIT = ${limitPx} + 1;
        const desc = ${DESC_JS};
        const out = [];
        for (const el of document.querySelectorAll("img, canvas, video")) {
          const intrinsic = el.naturalWidth ?? el.videoWidth ?? el.width ?? 0;
          if (!intrinsic || intrinsic <= LIMIT) continue;
          let widthIsAuto = true;
          try {
            widthIsAuto = String(el.computedStyleMap().get("width")) === "auto";
          } catch (_) { /* Typed OM unavailable: keep the conservative flag */ }
          if (!widthIsAuto) continue;
          out.push({ desc: desc(el), px: intrinsic });
          if (out.length >= 20) break;
        }
        return JSON.stringify(out);
      })()`),
    );
    return { limitPx, boxes, intrinsics: replaced };
  } finally {
    // Restore the pinned sheet viewport — never clear: a cleared override
    // reverts to the browser's window size, and vw/vh units make print
    // layout depend on it (the measured 0.84x path divergence).
    await page.send("Emulation.setDeviceMetricsOverride", restoreViewport);
  }
}

/**
 * Bare-fragment xref hrefs (`#foo`) among `sites` whose target id never
 * resolved to an element, i.e. is absent from `resolved` (the id -> text map
 * `targetTexts` only populates for ids it actually found). Non-bare hrefs
 * (`other.html#x`, `https://…`) are the author linking elsewhere on purpose —
 * skipped by construction, since only `#...` hrefs are compared. Deduped by
 * href, first-seen order — one typo'd target should not produce a note per
 * link site.
 */
export function findBrokenXrefRefs(
  sites: Array<{ href: string }>,
  resolved: Record<string, string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sites) {
    if (!s.href.startsWith("#")) continue;
    if (s.href.slice(1) in resolved) continue;
    if (seen.has(s.href)) continue;
    seen.add(s.href);
    out.push(s.href);
  }
  return out;
}

export function mapSignature(map: Record<string, number>, pageCount: number): string {
  return (
    Object.keys(map)
      .sort()
      .map((k) => `${k}=${map[k]}`)
      .join("|") + `|pageCount=${pageCount}`
  );
}

interface PredictedPageMap {
  pageMap: Record<string, number>;
  pageCount: number;
  ms: number;
}

/**
 * §10 predict-then-verify: guess the Tier 3 page map from the viewer's own
 * multicol fragmentation instead of a throwaway print. Runs on a SEPARATE
 * page/tab — never on the page that is about to print — so it cannot
 * perturb the document the compiler ships.
 *
 * Reuses the compiler agent's own id-assignment functions
 * (`stringSources`/`forcedBreakSites`/`xrefSites`/`counterResetSites`), in
 * the SAME order the compiler already called them in on the print page, so
 * the synthetic `gp-m-N` ids line up between the two pages (each page's
 * counter starts fresh at 0; same calls, same order, same document ⇒ same
 * ids) — no id needs to travel between pages. Then reuses the viewer's own
 * `fragmentDocument()` (`ARCHITECTURE.md` §1: one function, not a twin) to
 * read where each target id landed.
 *
 * Returns null if the predict page itself fails for any reason — the caller
 * falls back to today's measure-first loop, at today's cost.
 */
async function predictPageMap(
  browser: Browser,
  url: string,
  agentScript: string,
  viewerScript: string,
  args: {
    stringSets: Array<{ selector: string; name: string }>;
    rectoDecls: Array<{ selector: string; prop: string; value: string }>;
    xrefSelectors: string[];
    resets: Array<{ selector: string; start: number }>;
    targets: string[];
  },
  sheetViewport: Record<string, unknown>,
): Promise<PredictedPageMap | null> {
  const t0 = performance.now();
  let page: Session | undefined;
  try {
    page = await browser.newPage();
    // Same pinned viewport as the print page — vw/vh-sized content must
    // measure identically on both sides or the prediction always misses.
    await page.send("Emulation.setDeviceMetricsOverride", sheetViewport);
    await page.navigate(url);
    await page.evaluate(agentScript);
    await page.waitForReady();
    await page.evaluate(`window.__GP_MANUAL__ = true;`);
    await page.evaluate(viewerScript);

    // Same calls, same order as the print page (build()'s Tier 3 setup):
    // stringSources -> forcedBreakSites -> xrefSites -> counterResetSites.
    await page.evaluate(`window.__gp.stringSources(${JSON.stringify(args.stringSets)})`);
    if (args.rectoDecls.length)
      await page.evaluate(
        `window.__gp.forcedBreakSites(${JSON.stringify(args.rectoDecls)})`,
      );
    await page.evaluate(`window.__gp.xrefSites(${JSON.stringify(args.xrefSelectors)})`);
    if (args.resets.length)
      await page.evaluate(
        `window.__gp.counterResetSites(${JSON.stringify(args.resets)})`,
      );

    const result = await page.evaluate<{
      pageMap: Record<string, number>;
      pageCount: number;
    }>(`(async () => {
      const api = await window.Gutterpress.fragmentDocument({});
      const pageMap = {};
      for (const id of ${JSON.stringify(args.targets)}) {
        const el = document.getElementById(id);
        if (!el) continue;
        // an id may name an injected zero-size <gp-anchor>; measure its
        // host instead (same as the compiler agent's own anchorHost()).
        const target = el.tagName === "GP-ANCHOR" ? el.parentElement ?? el : el;
        pageMap[id] = api.pageOf(target) + 1;
      }
      return { pageMap, pageCount: api.totalPages };
    })()`);
    return { ...result, ms: performance.now() - t0 };
  } catch {
    return null;
  } finally {
    if (page) await page.close();
  }
}

/**
 * Per-page running strings, without touching page names.
 *
 * `string-set`/`string()` is unimplemented in Chromium, so the value a margin
 * box should show changes page by page with nothing in CSS to express it. The
 * fix is a generated `@counter-style { system: fixed; symbols: … }` with one
 * symbol per page, consumed as `counter(page, gp-<name>)` — verified in S3.
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
  resetSites: Array<{ id: string; start: number }> = [],
  hasBlank = false,
): string {
  const consumed = consumedStrings(model);

  const byName = new Map<string, StringEntry[]>();
  for (const s of sources) {
    const page = pageMap[s.id];
    if (!page || !consumed.has(s.name)) continue;
    const list = byName.get(s.name) ?? [];
    list.push({ page, value: s.text });
    byName.set(s.name, list);
  }
  for (const entries of byName.values()) entries.sort((a, b) => a.page - b.page);

  // Front-matter -> body folio restart (`counter-reset: page N`, MIGRATION.md
  // gap #1). `pageCounterValues` fixes the NUMBER; the fixed-symbol map below
  // formats it per the `counter(page[, style])` style each context actually
  // requests, so `gp-page--lower-roman` and `gp-page--decimal` can carry
  // the SAME restarted numbering with different symbols.
  const pageValues = restartedPageValues(resetSites, pageMap, pageCount);

  // `hasBlank` keeps this function from bailing out early when the ONLY
  // thing it needs to emit is the `gp--blank` named page's rewritten
  // content (F1): a document with no running strings/restart still needs
  // its inserted blanks routed through the same rewrite as everything else.
  if (!consumed.size && !pageValues && !hasBlank) return "";
  if (!byName.size && !pageValues && !hasBlank) return "";

  // A `string(name, which)` needs one fixed-symbol map per (name, which) pair
  // actually consumed — the shared `stringValueAt` policy sampled at every
  // page (the viewer evaluates the same function live).
  const pairs = new Map<string, { name: string; which: StringWhich }>();
  for (const rule of model.pageRules) {
    for (const decls of Object.values(rule.marginBoxes)) {
      if (!decls.content) continue;
      for (const part of parseContent(decls.content)) {
        if (part.type !== "string" || !byName.has(part.name)) continue;
        const which = parseWhich(part.which);
        pairs.set(counterStyleName(part.name, which), { name: part.name, which });
      }
    }
  }

  const out: string[] = [];
  for (const [styleName, pair] of pairs) {
    const symbols = stringSymbols(byName.get(pair.name)!, pageCount, pair.which);
    out.push(
      `@counter-style ${styleName} { system: fixed; suffix: ""; symbols: ${symbols
        .map(cssQuote)
        .join(" ")}; }`,
    );
  }

  // One `@counter-style` per distinct `counter(page, <style>)` keyword the
  // author actually uses, keyed by style so front matter's `lower-roman` and
  // the body's plain decimal both replay the SAME restarted number sequence.
  const pageCounterStyles = new Map<string, string[]>();
  const pageCounterStyleName = (style: string) => `gp-page--${style}`;

  const rewrite = (content: string): string =>
    parseContent(content)
      .map((part) => {
        if (part.type === "string")
          return `counter(page, ${counterStyleName(part.name, parseWhich(part.which))})`;
        if (part.type === "literal") return cssQuote(part.value);
        if (part.type === "counter") {
          if (part.name === "page" && pageValues) {
            const styleName = pageCounterStyleName(part.style);
            if (!pageCounterStyles.has(styleName))
              pageCounterStyles.set(styleName, pageValues.map((v) => formatCounter(v, part.style)));
            return `counter(page, ${styleName})`;
          }
          return `counter(${part.name}${part.style !== "decimal" ? `, ${part.style}` : ""})`;
        }
        if (part.type === "keyword") return part.value;
        return "";
      })
      .filter(Boolean)
      .join(" ");

  // One flat block per page context, carrying EVERY margin box's resolved
  // content — including the suppressions. A context that needs no rewrite
  // still has to be emitted: the generated unnamed `@page` block would
  // otherwise leak onto it (Chromium ignores page-selector specificity across
  // stylesheets) and put a running head on the cover or the TOC.
  const names: Array<string | undefined> = [undefined, ...model.pageNames];
  const variants = [[] as string[], ...pseudoVariants(model).map((p) => [p])];
  for (const name of names) {
    for (const pseudos of variants) {
      const resolved = resolvePage(model, { name, pseudos });
      const lines: string[] = [];
      for (const [box, decls] of Object.entries(resolved.marginBoxes)) {
        if (!decls.content) continue;
        const hasString = /\bstring\s*\(/.test(decls.content);
        const hasPageCounter = pageValues && /\bcounter\(\s*page\b(?!s)/.test(decls.content);
        const needsRewrite = hasString || hasPageCounter;
        lines.push(`  ${box} { content: ${needsRewrite ? rewrite(decls.content) : decls.content}; }`);
      }
      if (!lines.length) continue;
      const pseudo = pseudos.length ? `:${pseudos.join(":")}` : "";
      out.push(`@page ${name ?? ""}${pseudo} {\n${lines.join("\n")}\n}`.replace("@page  ", "@page "));
    }
  }

  // The blank spacer pages Gutterpress inserts for forced recto/verso breaks are
  // assigned `page: gp--blank` (s10: Chromium never matches the native
  // `:blank` pseudo against our own synthetic breaks), so the author's
  // `@page :blank` content has to be re-emitted under that name — through
  // the SAME `rewrite` used above, not a verbatim copy (F1: a verbatim copy
  // never gets the counter(page)->@counter-style rewrite and prints the raw
  // physical page number instead of the restarted folio).
  if (hasBlank) {
    const blank = resolvePage(model, { pseudos: ["blank"] });
    const lines: string[] = [];
    for (const [box, decls] of Object.entries(blank.marginBoxes)) {
      if (!decls.content) continue;
      const hasString = /\bstring\s*\(/.test(decls.content);
      const hasPageCounter = pageValues && /\bcounter\(\s*page\b(?!s)/.test(decls.content);
      const needsRewrite = hasString || hasPageCounter;
      lines.push(`  ${box} { content: ${needsRewrite ? rewrite(decls.content) : decls.content}; }`);
    }
    out.push(
      `@page ${BLANK_PAGE} {\n${lines.length ? lines.join("\n") : "  /* author declared no @page :blank */"}\n}`,
    );
  }

  for (const [styleName, symbols] of pageCounterStyles) {
    out.push(
      `@counter-style ${styleName} { system: fixed; suffix: ""; symbols: ${symbols
        .map(cssQuote)
        .join(" ")}; }`,
    );
  }
  return out.join("\n");
}
