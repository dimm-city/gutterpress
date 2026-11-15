import { defineCommand } from "citty";
import path from "node:path";
import { constants as osConstants } from "node:os";
import {
  log,
  runBuild,
  splitOutPath,
  BuildError,
} from "../index.ts";
import {
  parseFormat,
  parsePdfxFlavor,
  rejectExtraPositionals,
  rejectUnknownFlags,
  UsageError,
} from "../lib/cli-args.ts";

const commandArgs = {
  input: { type: "positional", description: "Input directory containing markdown files (default: cwd)", required: false },
  format: { type: "string", description: "Output format: html | pdf | pdfx (default: pdf)" },
  out: { type: "string", description: "Output directory. For --format pdf|pdfx, --out may also be a .pdf file path." },
  title: { type: "string", description: "Document title (overrides manifest)" },
  "pdfx-flavor": { type: "string", description: "PDF/X flavor (x1a or x3). --format pdfx only." },
  icc: { type: "string", description: "CMYK output ICC profile for --format pdfx (default: the preset's pdfx.icc)" },
  manifest: { type: "string", description: "Path to manifest.yaml" },
  "strip-annotations": { type: "boolean", description: "Strip PDF annotations for PDF/X compliance" },
  "skip-lint": { type: "boolean", description: "Skip the CSS print-safety check (default: it runs for pdf/pdfx)" },
  "skip-pre-validate": { type: "boolean", description: "Skip pre-build validation" },
  "skip-post-validate": { type: "boolean", description: "Skip post-build PDF/X validation" },
  "allow-shrink": { type: "boolean", description: "Build anyway when content is wider than the page content box, instead of failing. Chromium then scales the WHOLE book down to fit; each offender is reported as a warning." },
} as const;

/**
 * Ctrl-C and SIGTERM stop the build through `runBuild`'s signal, so the
 * browser is closed and the work dir removed instead of being left behind;
 * the process then exits 128 + the signal number, as a shell expects. Only the
 * first signal is handled: a second one takes the default action and ends
 * the process at once.
 */
function abortOnSignals(): { signal: AbortSignal; exitCode: () => number; stop: () => void } {
  const ctl = new AbortController();
  let received: NodeJS.Signals | undefined;
  const listeners = (["SIGINT", "SIGTERM"] as const).map((name) => {
    const listener = () => {
      received = name;
      ctl.abort();
    };
    process.once(name, listener);
    return [name, listener] as const;
  });
  return {
    signal: ctl.signal,
    exitCode: () => 128 + (received ? osConstants.signals[received] : 0),
    stop: () => listeners.forEach(([name, listener]) => process.off(name, listener)),
  };
}

export default defineCommand({
  meta: {
    name: "build",
    description:
      "Build the book to HTML (static-site desktop), PDF, or PDF/X. Use --format to select. Default: pdf.",
  },
  args: commandArgs,
  async run({ args, rawArgs }) {
    const interrupt = abortOnSignals();
    try {
      rejectUnknownFlags(rawArgs, commandArgs, "build");
      rejectExtraPositionals((args as { _: unknown[] })._, 1, "build");

      const format = parseFormat(args.format, { default: "pdf" });
      log.info(`Format: ${format}`);
      const pdfxFlavor = parsePdfxFlavor(args["pdfx-flavor"], format);
      const { outDir, pdfFileOverride } = splitOutPath(
        typeof args.out === "string" ? args.out : undefined,
        format
      );
      const inputDir = path.resolve((args.input as string | undefined) ?? ".");
      const manifestPath = typeof args.manifest === "string" ? args.manifest : undefined;
      await runBuild({
        inputDir,
        format,
        outDir,
        pdfFileOverride,
        title: typeof args.title === "string" ? args.title : undefined,
        pdfxFlavor,
        iccPath: typeof args.icc === "string" ? args.icc : undefined,
        manifestPath,
        stripAnnotations: typeof args["strip-annotations"] === "boolean" ? args["strip-annotations"] : undefined,
        skipLint: !!args["skip-lint"],
        skipPreValidate: !!args["skip-pre-validate"],
        skipPostValidate: !!args["skip-post-validate"],
        allowShrink: !!args["allow-shrink"],
        rawArgs: args as Record<string, unknown>,
        signal: interrupt.signal,
      });
    } catch (error) {
      if (error instanceof UsageError || error instanceof BuildError) {
        log.error(error.message);
        process.exit(interrupt.signal.aborted ? interrupt.exitCode() : error.exitCode);
      }
      throw error;
    } finally {
      interrupt.stop();
    }
  },
});
