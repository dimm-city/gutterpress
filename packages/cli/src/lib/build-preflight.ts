import { requireChromiumExecutable, resolveChromiumExecutable } from "./chromium";
import { isToolAvailable } from "./tool-probe";
import { resolveGhostscript } from "./ghostscript";
import { INSTALL_HINTS as CANONICAL_INSTALL_HINTS } from "./install-hints";
import { BuildError } from "./build-error";
import { log } from "../utils/logger";
import { getBrowser, closeBrowser } from "./browser-pool";
import { RENDER_TIMEOUT_MS } from "./pagination";
import { REQUIRED_MILESTONE } from "../engine/shared/cdp";
import type { BuildFormat } from "./build-runner";
import type { PdfRenderer } from "./pagination";

/**
 * Tool preflight + gate computation (ARCH finding #9, extracted from
 * build-runner.ts): decide, BEFORE the pipeline starts doing real work,
 * whether every external tool a build will spawn is actually available, and
 * which of the lint/pre-validate/post-validate gates apply for the requested
 * format + CLI flags. Both are pure decisions over the resolved format/config
 * — no rendering, no staging.
 */

interface MissingTool {
  name: string;
  installHint: string;
}

// Body text (per-platform install commands, no header) from the single
// canonical source in ./install-hints.ts — see its docstring. Previously a
// hand-copied, independently-worded duplicate of diagnostics.ts's and
// chromium.ts's install hints.
const INSTALL_HINTS: Record<"gs" | "qpdf", string> = {
  gs: CANONICAL_INSTALL_HINTS.gs.body,
  qpdf: CANONICAL_INSTALL_HINTS.qpdf.body,
};

/**
 * Probe for every tool this build will actually spawn, BEFORE the pipeline
 * starts running for real. Fails fast with one error that lists every
 * missing tool plus per-platform install commands.
 *
 * Without this, the user waits for lint + render (30-90s) before hitting
 * `spawn gs ENOENT` from deep inside the post-processing. 50ms preflight
 * makes the failure actionable and immediate.
 *
 * Chromium is REQUIRED for any non-html format and surfaces the same
 * install-instructions error from requireChromiumExecutable() if missing.
 * Ghostscript is REQUIRED for pdfx (CMYK conversion) only — plain pdf's
 * /Creator metadata is stamped via pdf-lib in-process (see ghostscript.ts's
 * stampCreator) and needs no system tool at all.
 * qpdf is REQUIRED for pdfx + stripAnnotations (default true).
 */
export async function preflightBuildTools(
  format: BuildFormat,
  opts: { stripAnnotations?: boolean; pdfRenderer?: PdfRenderer; engineBrowser?: unknown },
  config: { pdfx: { stripAnnotations: boolean }; engine?: "paged" | "native" }
): Promise<void> {
  const missing: MissingTool[] = [];

  // Chromium — required for any rendered output, UNLESS an external PDF renderer
  // is injected (the Electron desktop renders with its own bundled Chromium).
  // The native engine ignores an injected `pdfRenderer` (build-runner.ts always
  // calls `buildNativePdf`, which drives the system/pooled Chromium directly),
  // so it still needs this check even with `opts.pdfRenderer` set — UNLESS
  // `opts.engineBrowser` is ALSO supplied, which drives the native engine's own
  // Electron Chromium instead of the pool and needs no external binary at all.
  if (
    (!opts.pdfRenderer || config.engine === "native") &&
    !opts.engineBrowser &&
    !(await resolveChromiumExecutable())
  ) {
    // requireChromiumExecutable() throws with multi-line install instructions
    // that include all three platforms. Defer to it for the canonical message.
    await requireChromiumExecutable();
  }

  // Ghostscript:
  //   - plain pdf  -> none (the /Creator stamp now uses pdf-lib, in-process)
  //   - pdfx       -> CMYK conversion, REQUIRED
  if (format === "pdfx" && !(await resolveGhostscript())) {
    missing.push({ name: "gs (Ghostscript)", installHint: INSTALL_HINTS.gs });
  }

  // qpdf — only when pdfx with stripAnnotations enabled (default true).
  if (format === "pdfx") {
    const stripAnnotations = opts.stripAnnotations ?? config.pdfx.stripAnnotations;
    if (stripAnnotations && !(await isToolAvailable("qpdf"))) {
      missing.push({ name: "qpdf", installHint: INSTALL_HINTS.qpdf });
    }
  }

  if (missing.length === 0) return;

  const list = missing
    .map((m) => `  • ${m.name}\n${m.installHint}`)
    .join("\n\n");
  throw new BuildError(
    `Required system tools not found:\n\n${list}\n\nInstall the missing tools and re-run, or set GHOSTSCRIPT_PATH, CHROMIUM_PATH, or system PATH so gutterpress can find them. See the User Guide Chapter 7 (System Setup) at examples/gutterpress-user-guide/07-system-setup.md for the full per-feature matrix.`,
    2
  );
}

/**
 * Native engine only: verify the browser-pool's Chromium meets
 * `engine/shared/cdp.ts`'s `REQUIRED_MILESTONE`, with an early, actionable
 * error instead of the late, cryptic one `connectChromium` throws from deep
 * inside `buildNativePdf` (reached only after quality gates + the markdown
 * render have already run). `preflightBuildTools`'s presence check
 * (`resolveChromiumExecutable`) doesn't catch a resolved-but-too-old binary —
 * this does.
 *
 * Deliberately NOT called from `preflightBuildTools` itself: that would
 * force `runBuild` to await a full Chromium cold start (~1-2s) BEFORE
 * lint/validate even start, defeating the whole point of `prewarmBrowser()`
 * firing in parallel with them. Call this instead right after quality gates
 * finish and before rendering — by then the prewarmed browser is usually
 * already warm, and any quality-gate failure (the common case) never pays
 * this cost at all. Reuses `getBrowser()` (the same cached instance
 * `buildNativePdf`'s `connectChromium` will reuse), so this is one cold
 * start, not two.
 *
 * Desktop native-engine exports hit this every time on the current Electron
 * pin: measured 2026-08-08, Electron 42.1.0 bundles Chromium 148.0.7778.97,
 * below `REQUIRED_MILESTONE` (151) — see `.reviews/adr/0002`'s 2026-08-08
 * addendum for the decision this backs.
 */
export async function verifyNativeChromiumMilestone(): Promise<void> {
  let version: string;
  try {
    const browser = await getBrowser(RENDER_TIMEOUT_MS);
    version = await browser.version();
  } catch (err) {
    throw new BuildError(
      `Could not launch a Chromium browser for --engine native: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      2
    );
  }
  const milestone = Number(/Chrome\/(\d+)/.exec(version)?.[1] ?? 0);
  if (milestone < REQUIRED_MILESTONE) {
    await closeBrowser();
    throw new BuildError(
      `The Gutterpress native engine requires Chromium ${REQUIRED_MILESTONE}+; found ${version}.\n\n` +
        `Install a newer Chrome, Chromium, or Edge, or point CHROMIUM_PATH ` +
        `(or PUPPETEER_EXECUTABLE_PATH) at a ${REQUIRED_MILESTONE}+ binary.\n\n` +
        // No doc path in this string on purpose: `.reviews/` is gitignored and
        // `docs/adr/0002` is not published either, so either pointer would send
        // a user of the shipped binary to a file that does not exist.
        `Note: the desktop app's own bundled Chromium does not satisfy this — ` +
        `--engine native always drives a separate, external Chromium.`,
      2
    );
  }
}

export interface Gates {
  lint: boolean;
  preValidate: boolean;
  postValidate: boolean;
}

export function computeGates(
  format: BuildFormat,
  opts: { skipLint?: boolean; skipPreValidate?: boolean; skipPostValidate?: boolean },
  config: { lint: { enabled: boolean }; validate: { enabled: boolean } }
): Gates {
  if (format === "html") {
    if (opts.skipLint || opts.skipPreValidate || opts.skipPostValidate) {
      log.info(
        "Validation/lint flags ignored for --format html (no validation phases apply)"
      );
    }
    return { lint: false, preValidate: false, postValidate: false };
  }

  const lint = !opts.skipLint && config.lint.enabled !== false;
  const preValidate = !opts.skipPreValidate && config.validate.enabled !== false;
  const postValidate =
    format === "pdfx" &&
    !opts.skipPostValidate &&
    config.validate.enabled !== false;

  return { lint, preValidate, postValidate };
}
