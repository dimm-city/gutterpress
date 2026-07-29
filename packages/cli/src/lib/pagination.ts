import path from "node:path";
import fsp from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import type { Page } from "puppeteer-core";
import { getBrowser } from "./browser-pool";
import { resolveStaticPath, serveFile } from "./static-serve";
import { patchHtmlStringForPagedjs } from "./pagedjs";
import { getAssetPath } from "./embedded-assets";
import { log } from "../utils/logger";
import { BuildError } from "./build-error";

/**
 * Render/pagination (ARCH finding #9, extracted from build-runner.ts): drives
 * headless Chromium through Paged.js to fully paginate a staged HTML document,
 * either printing it to PDF or serializing the paginated DOM to static HTML.
 * Owns: the embedded static HTTP file server both render paths need (a local
 * origin so relative asset URLs resolve), the shared navigate+wait+liveness
 * sequence (`paginateAndCapture`), the default PDF renderer, and build-time
 * static-HTML pagination. build-runner.ts's two `OutputStrategy` classes call
 * into this module for the actual pagination work and never touch a puppeteer
 * `Page` themselves.
 */

/** An in-memory response served instead of reading a file from disk. */
export interface ServerOverlay {
  body: string | Buffer;
  contentType: string;
}

/**
 * Start a localhost static file server rooted at `dir`, with optional in-memory
 * `overlays` keyed by URL path (e.g. `/book.html`).
 *
 * Overlays are what let the build paginate WITHOUT staging a second copy of the
 * project. `outDir` is served directly; the Paged.js-patched `book.html` and the
 * vendored polyfill are supplied from memory, so the engine never has to be
 * written into the shipped artifact and no asset is copied twice. This mirrors
 * the preview server, which has always served `/vendor/*` as a virtual overlay
 * rather than copying it per project.
 *
 * Path-traversal protection, the MIME map, and the actual file response are
 * the shared `./static-serve` primitives (`resolveStaticPath` + `serveFile`)
 * also used by preview/http-server.ts — a request that resolves outside `dir`
 * gets 403; a missing file gets 404 from `serveFile` itself.
 */
export function createStaticFileServer(
  dir: string,
  defaultFile: string,
  overlays: Record<string, ServerOverlay> = {}
): Promise<{ port: number; close: () => Promise<void> }> {
  const root = path.resolve(dir);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1");
    const pathname = url.pathname === "/" ? "/" + defaultFile : url.pathname;

    const overlay = overlays[pathname];
    if (overlay) {
      res.writeHead(200, { "Content-Type": overlay.contentType });
      res.end(overlay.body);
      return;
    }

    const filePath = resolveStaticPath(pathname, root);
    if (!filePath) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    await serveFile(filePath, res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/** Input handed to a PDF renderer: a URL serving the staged HTML + assets. */
export interface PdfRenderInput {
  /** URL of the staged HTML on a local HTTP server (assets resolve relative). */
  url: string;
  /** Absolute path the renderer must write the finished PDF to. */
  outPdf: string;
  /** Hard ceiling for navigation + pagination + PDF generation. */
  timeoutMs: number;
  /**
   * When set, after printing the PDF the renderer also serializes the
   * already-paginated DOM (the same DOM it just printed) and writes it to this
   * path as raw static HTML. Lets ONE pagination pass emit BOTH the PDF and the
   * static desktop HTML, so screen and PDF come from the same artifact. The
   * serialize is read-only and runs AFTER `page.pdf()`, so it cannot affect the
   * PDF. Optional; injected renderers that cannot serialize may ignore it.
   */
  captureStaticHtmlTo?: string;
}

/**
 * A PDF renderer drives a browser engine to load `url`, wait for fonts +
 * Paged.js (`window.__PAGED_RENDERED__ === true`), measure the first
 * `.pagedjs_page`, and write a borderless PDF at that exact page size to
 * `outPdf` with backgrounds printed.
 *
 * The default ({@link puppeteerPdfRenderer}) drives a system/bundled Chromium.
 * The Electron desktop injects one backed by its own `webContents.printToPDF`,
 * so the packaged app needs no external browser (ADR 0002, Phase 4).
 */
export type PdfRenderer = (input: PdfRenderInput) => Promise<void>;

/** Hard ceiling for navigation + pagination + PDF generation. Large books need
 *  this budget; it is also the puppeteer protocolTimeout for the pooled browser. */
export const RENDER_TIMEOUT_MS = 60 * 60 * 1000;

// ── Browser-context globals ─────────────────────────────────────────────────
// The callbacks passed to page.evaluate()/page.waitForFunction() below execute
// inside Chromium, not Node. The CLI tsconfig deliberately excludes lib.dom so
// Node-side code can never touch DOM globals by accident — declare (module-
// locally) just the browser globals those callbacks use, typed to exactly the
// shape they consume.
interface PagedPageElement {
  outerHTML: string;
}
declare const document: {
  fonts: { ready: Promise<unknown> };
  documentElement: PagedPageElement;
  querySelectorAll(selector: string): ArrayLike<PagedPageElement>;
};
declare function getComputedStyle(el: PagedPageElement): {
  width?: string;
  height?: string;
};

/** How often the liveness poller re-checks the `.pagedjs_page` count (finding #19). */
const STALL_POLL_INTERVAL_MS = 10_000;
/**
 * How long the page count must go without advancing before pagination is
 * declared stalled. Deliberately several poll intervals, not one: a single
 * flat poll is normal (a large/complex page can legitimately take one tick to
 * lay out); a full minute with zero new pages is not "still working", it is
 * "dead" (a plugin/CSS error wedged the chunker) — see finding #19.
 */
const STALL_WINDOW_MS = 60_000;

/** Tracks the last-seen `.pagedjs_page` count and when it last advanced. */
export interface PaginationLivenessState {
  count: number;
  lastAdvanceAt: number;
}

export interface PaginationLivenessResult {
  stalled: boolean;
  state: PaginationLivenessState;
}

/**
 * Pure stall-detection decision (finding #19), extracted out of the polling
 * loop below so it is unit-testable with a fake page-count source instead of
 * a real puppeteer `page`. Given the latest `.pagedjs_page` count poll and the
 * previously tracked state, decide whether pagination has stalled — the count
 * has not advanced for at least `stallWindowMs` — and return the updated
 * state (advancing resets the liveness clock; a flat or regressed count
 * leaves `lastAdvanceAt` untouched).
 */
export function evaluatePaginationLiveness(
  count: number,
  now: number,
  state: PaginationLivenessState,
  stallWindowMs: number
): PaginationLivenessResult {
  if (count > state.count) {
    return { stalled: false, state: { count, lastAdvanceAt: now } };
  }
  const stalled = now - state.lastAdvanceAt >= stallWindowMs;
  return { stalled, state };
}

/**
 * Drive a puppeteer `page` to fully paginate the document at `url`: set the
 * viewport + timeouts, navigate (waiting for network idle so vendored assets +
 * the polyfill load), wait for web fonts, then block until Paged.js signals
 * `window.__PAGED_RENDERED__ === true`.
 *
 * While waiting, a background poller checks the `.pagedjs_page` count every
 * `STALL_POLL_INTERVAL_MS` and logs it (so a long build visibly advances
 * instead of sitting silent), and fails fast with a BuildError the moment
 * `evaluatePaginationLiveness` decides the count has stopped advancing for
 * `STALL_WINDOW_MS` — instead of a wedged Paged.js run silently consuming the
 * full `timeoutMs` / `RENDER_TIMEOUT_MS` budget (up to an hour) before anyone
 * finds out. `timeoutMs` (== `RENDER_TIMEOUT_MS` at every call site) remains
 * the outer budget for legitimately slow-but-advancing books.
 *
 * Policy (owner's call, superseding an earlier "warn and ship partial output"
 * behavior): pagination either completes — `__PAGED_RENDERED__` fires — or the
 * build FAILS. A stall (count plateaus, whether at zero or after some pages)
 * and an outright wait timeout are BOTH treated as an incomplete render and
 * throw a `BuildError`; neither path falls through to let a caller print/
 * serialize whatever partial DOM exists. A silently-truncated "successful"
 * print-ready PDF is worse than a build that fails loudly — non-technical
 * authors have no way to notice half their book is missing. The stall check
 * still fails fast (within `stallWindowMs` of the last advance) rather than
 * waiting out the full `timeoutMs` budget.
 *
 * Shared navigate+wait sequence for BOTH render paths. Callers keep their own
 * tails: the PDF path calls `page.pdf()`; the static-HTML path serializes the
 * DOM — neither tail runs unless this function returns normally, i.e. unless
 * pagination actually completed. Per-caller knobs (viewport, timeout,
 * liveness window) are passed in so behavior is never silently changed;
 * `livenessConfig` defaults to the production constants and exists as a seam
 * for tests to shrink the poll/stall windows instead of waiting 60+ real
 * seconds.
 */
export async function paginateAndCapture(
  page: Page,
  url: string,
  timeoutMs: number,
  viewport: { width: number; height: number } = { width: 1920, height: 1080 },
  livenessConfig: { pollIntervalMs: number; stallWindowMs: number } = {
    pollIntervalMs: STALL_POLL_INTERVAL_MS,
    stallWindowMs: STALL_WINDOW_MS,
  }
): Promise<void> {
  await page.setViewport(viewport);
  page.setDefaultNavigationTimeout(timeoutMs);
  page.setDefaultTimeout(timeoutMs);

  await page.goto(url, { waitUntil: "networkidle0" });

  await page.evaluate(() => document.fonts.ready);

  let livenessState: PaginationLivenessState = { count: 0, lastAdvanceAt: Date.now() };
  let stalledAtCount: number | null = null;
  let resolveStall: (() => void) | undefined;
  const stallSignal = new Promise<void>((resolve) => {
    resolveStall = resolve;
  });

  const pollTimer = setInterval(() => {
    page
      .evaluate(() => document.querySelectorAll(".pagedjs_page").length)
      .then((count) => {
        const { stalled, state } = evaluatePaginationLiveness(
          count,
          Date.now(),
          livenessState,
          livenessConfig.stallWindowMs
        );
        livenessState = state;
        if (stalled) {
          stalledAtCount = count;
          clearInterval(pollTimer);
          resolveStall?.();
          return;
        }
        log.info(`Paginating… ${count} page(s) so far`);
      })
      .catch(() => {
        // A transient evaluate failure (e.g. mid-navigation) is not itself a
        // stall signal — the waitForFunction race below still catches a real
        // page crash / context loss and propagates it.
      });
  }, livenessConfig.pollIntervalMs);

  try {
    const outcome = await Promise.race([
      page
        .waitForFunction(
          () =>
            (globalThis as typeof globalThis & { __PAGED_RENDERED__?: boolean })
              .__PAGED_RENDERED__ === true,
          {
            timeout: timeoutMs,
          },
        )
        .then((): "rendered" => "rendered")
        .catch((err: unknown) => {
          // A wait timeout is a distinct OUTCOME, not tolerated silently: Paged.js
          // never signaled __PAGED_RENDERED__ in time, so the render is incomplete
          // and the outcome switch below throws a BuildError instead of letting a
          // caller print/serialize whatever partial DOM exists (an earlier
          // "warn and ship partial output" policy — superseded, see the owner's
          // policy note on this function's docstring). Any OTHER failure — page
          // crash, execution-context loss, navigation teardown — is a real error
          // and must propagate as-is; masking it would silently emit broken
          // output. puppeteer-core throws a TimeoutError (identified by name to
          // avoid a runtime import of the class, keeping §2 lazy-loading intact).
          if ((err as { name?: string } | undefined)?.name !== "TimeoutError") {
            throw err;
          }
          return "timeout" as const;
        }),
      stallSignal.then((): "stalled" => "stalled"),
    ]);

    if (outcome === "stalled") {
      // A stall is a build failure regardless of stalledAtCount. When ZERO
      // pages ever rendered, Paged.js wedged before producing anything (the
      // finding #19 case). When pages DO exist, the count merely plateaued —
      // most often Paged.js is stuck in a long post-layout pass (footnotes,
      // TOC) or a single large page is wedged — but either way
      // `__PAGED_RENDERED__` never fired, so the DOM is not the finished
      // document: printing/serializing it would ship a silently-truncated
      // artifact reported as success. Fail fast (within `stallWindowMs` of the
      // last advance) rather than waiting out the full `timeoutMs` budget.
      const detail = stalledAtCount
        ? `stalled at ${stalledAtCount} page(s) after ${Math.round(
            livenessConfig.stallWindowMs / 1000
          )}s with no further progress`
        : `produced no pages within ${Math.round(livenessConfig.stallWindowMs / 1000)}s`;
      throw new BuildError(
        `Pagination did not complete — output would be truncated (${detail}; check plugin/CSS errors).`
      );
    }
    if (outcome === "timeout") {
      throw new BuildError(
        `Pagination did not complete — output would be truncated (no __PAGED_RENDERED__ signal within ${Math.round(
          timeoutMs / 1000
        )}s).`
      );
    }
  } finally {
    clearInterval(pollTimer);
  }
}

/**
 * Close a CSS string value that Paged.js deliberately left unterminated.
 *
 * Paged.js's StringSets handler writes its string-set results as inline custom
 * properties with an OPENING quote and NO closing quote (paged.polyfill.js:
 * `fragment.style.setProperty(\`--pagedjs-string-first-${name}\`, \`"${…}\`)`).
 * Live that is harmless: `setProperty` parses each value in isolation and the
 * CSS tokenizer auto-closes a string token at end-of-value. But the moment the
 * DOM is SERIALIZED, all four of those properties land in ONE `style` attribute
 * joined by `;` — and on reparse the first unterminated string swallows the
 * declarations that follow it (`"1; --pagedjs-string-last-guideSection: "`).
 * The consumer, `content: "C." var(--pagedjs-string-first-guideSection)`, then
 * becomes invalid at computed-value time and the footer disappears.
 *
 * Given the raw property text, return it with a closing `"` appended when the
 * string token does not terminate. Rules follow CSS Syntax §4.3.5 "consume a
 * string token": a backslash escapes the next code point, and a backslash at
 * end-of-input is dropped (it cannot escape the quote we are about to add).
 * Values that are already terminated — including ones this function has already
 * fixed — are returned unchanged, so it is idempotent. Values that are not a
 * quoted string at all are left alone.
 */
export function closeUnterminatedCssString(value: string): string {
  const raw = value.trim();
  if (!raw.startsWith('"')) return value;
  let i = 1;
  while (i < raw.length) {
    const c = raw[i];
    if (c === "\\") {
      // Dangling escape at end-of-value: CSS discards it. Drop it too, or the
      // closing quote we append would be escaped and the string still open.
      if (i + 1 >= raw.length) return raw.slice(0, i) + '"';
      i += 2;
      continue;
    }
    // Already terminated — nothing to do (this is also the idempotent path).
    if (c === '"') return value;
    i += 1;
  }
  return raw + '"';
}

/** Inline custom properties written with the unterminated-quote idiom. */
const PAGEDJS_STRING_PROP_PREFIX = "--pagedjs-string-";

/**
 * Browser-context script run immediately before `outerHTML` capture: rewrite
 * every inline `--pagedjs-string-*` custom property so its value is a COMPLETE
 * quoted string, making the serialized `style` attribute survive a reparse.
 *
 * Built as a source string (rather than a `page.evaluate` callback) so the
 * single source of truth for the quote rule — {@link closeUnterminatedCssString}
 * — is shipped into the page instead of duplicated there. The function is
 * self-contained (no module-scope references), so `.toString()` is safe.
 *
 * `--pagedjs-string-{first,last,start,first-except}-*` are the ONLY properties
 * Paged.js writes this way; every other `--pagedjs-*` custom property holds a
 * length, count or color and needs no fixing (verified against the vendored
 * polyfill: those four `setProperty` calls are the only ones with a leading
 * quote).
 */
const NORMALIZE_PAGEDJS_STRING_PROPS = `(() => {
  const closeUnterminatedCssString = ${closeUnterminatedCssString.toString()};
  const PREFIX = ${JSON.stringify(PAGEDJS_STRING_PROP_PREFIX)};
  let fixed = 0;
  for (const el of document.querySelectorAll('[style*="' + PREFIX + '"]')) {
    const style = el.style;
    const names = [];
    for (let i = 0; i < style.length; i++) {
      const name = style.item(i);
      if (name.startsWith(PREFIX)) names.push(name);
    }
    for (const name of names) {
      const current = style.getPropertyValue(name);
      const closed = closeUnterminatedCssString(current);
      if (closed !== current) {
        style.setProperty(name, closed, style.getPropertyPriority(name));
        fixed++;
      }
    }
  }
  return fixed;
})()`;

/**
 * Serialize the paginated DOM to a static HTML document, first repairing the
 * unterminated Paged.js string custom properties that would otherwise be
 * corrupted by serialization (see {@link closeUnterminatedCssString}).
 *
 * Only touches those custom properties — every other inline style, attribute
 * and node is untouched — and only ever runs AFTER any `page.pdf()` call, so
 * the PDF is printed from the untouched live DOM exactly as before.
 */
async function serializePaginatedDom(page: Page): Promise<string> {
  const fixedCount = (await page.evaluate(
    NORMALIZE_PAGEDJS_STRING_PROPS
  )) as number;
  if (fixedCount > 0) {
    log.info(
      `Closed ${fixedCount} unterminated Paged.js string custom ${
        fixedCount === 1 ? "property" : "properties"
      } before serialization`
    );
  }
  return page.evaluate(
    () => "<!DOCTYPE html>\n" + document.documentElement.outerHTML
  );
}

/** Default renderer: system Chromium via puppeteer-core (pooled + pre-warmable). */
const puppeteerPdfRenderer: PdfRenderer = async ({
  url,
  outPdf,
  timeoutMs,
  captureStaticHtmlTo,
}) => {
  // Reuse the pre-warmed pooled browser; open a fresh page and close the PAGE
  // (not the browser) so the browser stays warm for the next render.
  const browser = await getBrowser(timeoutMs);
  const page = await browser.newPage();
  try {
    await paginateAndCapture(page, url, timeoutMs);

    const pagedInfo = await page.evaluate(() => {
      const pages = document.querySelectorAll(".pagedjs_page");
      const el = pages[0] ?? null;
      const s = el ? getComputedStyle(el) : null;
      return {
        pageCount: pages.length,
        width: s?.width,
        height: s?.height,
      };
    });
    log.info(
      `Paged.js rendered ${pagedInfo.pageCount} pages (${pagedInfo.width} × ${pagedInfo.height})`
    );

    await page.pdf({
      path: outPdf,
      printBackground: true,
      width: pagedInfo.width ?? "8.625in",
      height: pagedInfo.height ?? "11.25in",
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    // Unification: serialize the SAME printed DOM to static HTML so the on-screen
    // desktop renders the identical artifact the PDF was printed from. Read-only,
    // after page.pdf() — does not perturb the PDF.
    if (captureStaticHtmlTo) {
      const staticHtml = await serializePaginatedDom(page);
      await fsp.writeFile(captureStaticHtmlTo, staticHtml, "utf-8");
    }
  } finally {
    await page.close();
  }
};

/**
 * Build-time pagination (SSG model): drive headless Chromium to fully paginate
 * the staged HTML with Paged.js, then serialize the resulting already-fragmented
 * DOM to a static HTML string. Paged.js's polisher injects its layout CSS as
 * `<style>` elements INTO the DOM, so the serialized markup carries everything
 * needed to render the pages with NO runtime pagination engine.
 *
 * This is the same headless engine the PDF path uses — the only difference is we
 * capture `document.documentElement.outerHTML` instead of (or before) printing.
 */
/**
 * Build the overlay set that turns a plain `outDir` into a paginatable origin:
 * the Paged.js-patched `book.html` and the vendored polyfill, both in memory.
 *
 * Nothing is written to disk, so the shipped `book.html` never carries the
 * pagination engine and no asset is copied a second time just to be served.
 */
async function paginationOverlays(
  bookHtml: string,
  htmlFilename: string
): Promise<Record<string, ServerOverlay>> {
  const polyfill = await fsp.readFile(await getAssetPath("vendor/paged.polyfill.js"));
  return {
    [`/${htmlFilename}`]: {
      body: patchHtmlStringForPagedjs(bookHtml, "/vendor/paged.polyfill.js"),
      contentType: "text/html; charset=utf-8",
    },
    "/vendor/paged.polyfill.js": {
      body: polyfill,
      contentType: "application/javascript",
    },
  };
}

/**
 * Build-time pagination (SSG model): drive headless Chromium to fully paginate
 * the book with Paged.js, then serialize the resulting already-fragmented DOM
 * to a static HTML string. Paged.js's polisher injects its layout CSS as
 * `<style>` elements INTO the DOM, so the serialized markup carries everything
 * needed to render the pages with NO runtime pagination engine.
 *
 * Serves `outDir` itself (images resolve relative to `book.html`, exactly as
 * they will in the shipped artifact) with the engine supplied as overlays.
 */
export async function paginateToStaticHtml(htmlFile: string): Promise<string> {
  const outDir = path.dirname(path.resolve(htmlFile));
  const htmlFilename = path.basename(htmlFile);
  const bookHtml = await fsp.readFile(htmlFile, "utf-8");

  const server = await createStaticFileServer(
    outDir,
    htmlFilename,
    await paginationOverlays(bookHtml, htmlFilename)
  );

  try {
    // Reuse the pre-warmed pooled browser; open a fresh page, close the PAGE.
    const browser = await getBrowser(RENDER_TIMEOUT_MS);
    const page = await browser.newPage();
    try {
      await paginateAndCapture(
        page,
        `http://127.0.0.1:${server.port}/${htmlFilename}`,
        RENDER_TIMEOUT_MS
      );

      const html = await serializePaginatedDom(page);
      const count = await page.evaluate(
        () => document.querySelectorAll(".pagedjs_page").length
      );
      log.info(`Paged.js paginated ${count} pages → serialized to static HTML`);
      return html;
    } finally {
      await page.close();
    }
  } finally {
    await server.close();
  }
}

/**
 * Render `htmlFile` (in its own `outDir`) to a PDF, serving that directory with
 * the pagination engine supplied as in-memory overlays.
 */
export async function renderHtmlToPdf(
  htmlFile: string,
  outPdf: string,
  renderer: PdfRenderer = puppeteerPdfRenderer,
  captureStaticHtmlTo?: string
) {
  const outDir = path.dirname(path.resolve(htmlFile));
  const htmlFilename = path.basename(htmlFile);
  const bookHtml = await fsp.readFile(htmlFile, "utf-8");

  const server = await createStaticFileServer(
    outDir,
    htmlFilename,
    await paginationOverlays(bookHtml, htmlFilename)
  );

  try {
    await renderer({
      url: `http://127.0.0.1:${server.port}/${htmlFilename}`,
      outPdf,
      timeoutMs: RENDER_TIMEOUT_MS,
      captureStaticHtmlTo,
    });
  } finally {
    await server.close();
  }
}
