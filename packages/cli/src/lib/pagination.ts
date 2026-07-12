import path from "node:path";
import fsp from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import type { Page } from "puppeteer-core";
import { getBrowser } from "./browser-pool";
import { resolveStaticPath, serveFile } from "./static-serve";
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

/**
 * Start a localhost static file server rooted at `dir`, serving `defaultFile`
 * for the `/` path. Returns the chosen port and a `close()` that resolves once
 * the server has shut down.
 *
 * Path-traversal protection, the MIME map, and the actual file response are
 * the shared `./static-serve` primitives (`resolveStaticPath` + `serveFile`)
 * also used by preview/http-server.ts — a request that resolves outside `dir`
 * gets 403; a missing file gets 404 from `serveFile` itself. Shared by the
 * static-HTML pagination pass and the PDF render pass — both stage HTML +
 * assets into a temp dir and need a real HTTP origin so relative asset URLs
 * resolve.
 */
function createStaticFileServer(
  dir: string,
  defaultFile: string
): Promise<{ port: number; close: () => Promise<void> }> {
  const root = path.resolve(dir);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1");
    // Both current callers navigate straight to `/${filename}`, so the `"/"`
    // → defaultFile branch is a convenience fallback (e.g. a future caller
    // hitting the bare origin); it is not exercised on the render path today.
    const pathname = url.pathname === "/" ? "/" + defaultFile : url.pathname;
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
   * static viewer HTML, so screen and PDF come from the same artifact. The
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
 * The Electron viewer injects one backed by its own `webContents.printToPDF`,
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
 * `window.__PAGED_RENDERED__ === true` (best-effort — falls through on timeout
 * exactly as the original callers did).
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
 * Shared navigate+wait sequence for BOTH render paths. Callers keep their own
 * tails: the PDF path calls `page.pdf()`; the static-HTML path serializes the
 * DOM. Per-caller knobs (viewport, timeout) are passed in so behavior is never
 * silently changed.
 */
async function paginateAndCapture(
  page: Page,
  url: string,
  timeoutMs: number,
  viewport: { width: number; height: number } = { width: 1920, height: 1080 }
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
          STALL_WINDOW_MS
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
  }, STALL_POLL_INTERVAL_MS);

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
          // ONLY a wait timeout is tolerable: Paged.js never signaled
          // __PAGED_RENDERED__ in time, so proceed with whatever rendered but
          // warn (an unsignaled run can ship a blank/partial PDF). Any OTHER
          // failure — page crash, execution-context loss, navigation teardown
          // — is a real error and must propagate; masking it would silently
          // emit broken output. puppeteer-core throws a TimeoutError
          // (identified by name to avoid a runtime import of the class,
          // keeping §2 lazy-loading intact).
          if ((err as { name?: string } | undefined)?.name !== "TimeoutError") {
            throw err;
          }
          return "timeout" as const;
        }),
      stallSignal.then((): "stalled" => "stalled"),
    ]);

    if (outcome === "stalled") {
      // Distinguish a truly-dead chunker from a slow finalizer. When ZERO
      // pages ever rendered (stalledAtCount === 0), Paged.js wedged before
      // producing anything — a blank PDF is useless, so fail fast (the
      // finding #19 case). When pages DO exist, the count has merely plateaued
      // — most often Paged.js is in a long post-layout pass (footnotes, TOC)
      // before signaling __PAGED_RENDERED__, or a single large page is still
      // laying out. Killing the whole build there would false-positive on a
      // legitimately slow book; instead ship what rendered with the same
      // warning the timeout path uses (partial output is recoverable, a hard
      // failure is not).
      if (!stalledAtCount) {
        throw new BuildError(
          `Pagination produced no pages within ${Math.round(
            STALL_WINDOW_MS / 1000
          )}s — check plugin/CSS errors`,
          1
        );
      }
      log.warn(
        `Pagination stopped advancing at ${stalledAtCount} page(s) — output may be incomplete (check plugin/CSS errors if it looks truncated).`
      );
    }
    if (outcome === "timeout") {
      log.warn(
        `Pagination did not complete within ${Math.round(
          timeoutMs / 1000
        )}s — output may be incomplete.`
      );
    }
  } finally {
    clearInterval(pollTimer);
  }
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
    // viewer renders the identical artifact the PDF was printed from. Read-only,
    // after page.pdf() — does not perturb the PDF.
    if (captureStaticHtmlTo) {
      const staticHtml = await page.evaluate(
        () => "<!DOCTYPE html>\n" + document.documentElement.outerHTML
      );
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
export async function paginateToStaticHtml(stagedHtml: string): Promise<string> {
  const stageDir = path.dirname(path.resolve(stagedHtml));
  const htmlFilename = path.basename(stagedHtml);

  const server = await createStaticFileServer(stageDir, htmlFilename);

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

      const result = await page.evaluate(() => {
        const count = document.querySelectorAll(".pagedjs_page").length;
        return {
          count,
          html: "<!DOCTYPE html>\n" + document.documentElement.outerHTML,
        };
      });
      log.info(
        `Paged.js paginated ${result.count} pages → serialized to static HTML`
      );
      return result.html;
    } finally {
      await page.close();
    }
  } finally {
    await server.close();
  }
}

export async function renderHtmlToPdf(
  inputHtml: string,
  outPdf: string,
  renderer: PdfRenderer = puppeteerPdfRenderer,
  captureStaticHtmlTo?: string
) {
  const stageDir = path.dirname(path.resolve(inputHtml));
  const htmlFilename = path.basename(inputHtml);

  const server = await createStaticFileServer(stageDir, htmlFilename);

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
