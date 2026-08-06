import { defineCommand } from "citty";
import path from "node:path";
import fs from "node:fs";
import {
  log,
  startPreviewServer,
  runBuild,
  splitOutPath,
  BuildError,
  openPath,
} from "../index.ts";
import {
  parseEngine,
  parseFormat,
  parsePdfxFlavor,
  rejectExtraPositionals,
  rejectUnknownFlags,
  resolvePort,
  UsageError,
} from "../lib/cli-args.ts";
import { previewArgs } from "./preview-args.ts";

// Re-exported so existing importers (and preview.test.ts) can keep resolving it
// from this command module.
export { resolvePort };

export default defineCommand({
  meta: { name: "preview", description: "Live HTML preview with HMR (default), or one-shot build + open for --format pdf|pdfx" },
  args: previewArgs,
  async run({ args, rawArgs }) {
    try {
      rejectUnknownFlags(rawArgs, previewArgs, "preview");
      rejectExtraPositionals((args as { _: unknown[] })._, 1, "preview");

      const format = parseFormat(args.format, { default: "html" });
      log.info(`Format: ${format}`);

      const inputPath = args.input ? path.resolve(args.input as string) : undefined;

      if (inputPath !== undefined) {
        if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isDirectory()) {
          throw new UsageError(`Input directory does not exist: ${inputPath}`);
        }
      }

      const openFlag = args.open;
      const engine = parseEngine(args.engine);

      if (format === "html") {
        if (typeof args.manifest === "string") {
          throw new UsageError(
            "--manifest is only supported by preview --format pdf or pdfx; live HTML preview discovers the project manifest from its input directory."
          );
        }
        await startPreviewServer({
          input: inputPath,
          port: resolvePort(args.port),
          host: (args.host as string | undefined) || "127.0.0.1",
          noWatch: args.watch === false,
          verbose: !!args.verbose,
          openBrowser: openFlag,
          debug: !!args.debug,
          engine,
        });
        return;
      }

      if (inputPath === undefined) {
        throw new UsageError(`--format ${format} requires an input directory.`);
      }

      const pdfxFlavor = parsePdfxFlavor(args["pdfx-flavor"], format);
      const { outDir, pdfFileOverride } = splitOutPath(
        typeof args.out === "string" ? args.out : undefined,
        format
      );

      const result = await runBuild({
        inputDir: inputPath,
        format,
        outDir,
        pdfFileOverride,
        pdfxFlavor,
        iccPath: typeof args.icc === "string" ? args.icc : undefined,
        manifestPath: typeof args.manifest === "string" ? args.manifest : undefined,
        stripAnnotations: typeof args["strip-annotations"] === "boolean" ? args["strip-annotations"] : undefined,
        skipLint: !!args["skip-lint"],
        skipPreValidate: !!args["skip-pre-validate"],
        skipPostValidate: !!args["skip-post-validate"],
        engine,
        rawArgs: args as Record<string, unknown>,
      });

      if (openFlag && result.pdfPath) {
        log.info(`Opening ${result.pdfPath}`);
        try {
          await openPath(result.pdfPath);
        } catch (error) {
          const reason = error instanceof Error ? `: ${error.message}` : "";
          log.warn(
            `Could not open the PDF automatically${reason}. Open it manually: ${result.pdfPath}`
          );
        }
      }
    } catch (error) {
      if (error instanceof UsageError || error instanceof BuildError) {
        log.error(error.message);
        process.exit(error.exitCode);
      }
      throw error;
    }
  },
});
