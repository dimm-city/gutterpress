import { requireChromiumExecutable, resolveChromiumExecutable } from "./chromium";
import { isToolAvailable } from "./tool-probe";
import { resolveGhostscript } from "./ghostscript";
import { INSTALL_HINTS as CANONICAL_INSTALL_HINTS } from "./install-hints";
import { BuildError } from "./build-error";
import { log } from "../utils/logger";
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
 * Ghostscript is REQUIRED for pdfx (CMYK conversion); for plain pdf it
 * only adds /Creator metadata — best-effort downstream — so we warn but
 * don't block.
 * qpdf is REQUIRED for pdfx + stripAnnotations (default true).
 */
export async function preflightBuildTools(
  format: BuildFormat,
  opts: { stripAnnotations?: boolean; pdfRenderer?: PdfRenderer },
  config: { pdfx: { stripAnnotations: boolean } }
): Promise<void> {
  const missing: MissingTool[] = [];

  // Chromium — required for any rendered output, UNLESS an external PDF renderer
  // is injected (the Electron viewer renders with its own bundled Chromium).
  if (!opts.pdfRenderer && !(await resolveChromiumExecutable())) {
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
    `Required system tools not found:\n\n${list}\n\nInstall the missing tools and re-run, or set GHOSTSCRIPT_PATH, CHROMIUM_PATH, or system PATH so print-md can find them. See the User Guide Chapter 8 (System Setup) at examples/print-md-user-guide/08-system-setup.md for the full per-feature matrix.`,
    2
  );
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
