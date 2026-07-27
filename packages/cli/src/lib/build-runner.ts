import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { loadManifestWithPath, MANIFEST_FILENAMES, resolveConfig } from "./manifest";
import { renderChaptersToFile } from "./markdown/index";
import { loadPluginsWithCss } from "./markdown/plugins";
import { copyAssets } from "./assets";
import { requireChromiumExecutable, resolveChromiumExecutable } from "./chromium";
import { prewarmBrowser, closeBrowser } from "./browser-pool";
import {
  convertToPdfxCmyk,
  stampCreator,
  stripAnnotations,
} from "./ghostscript";
import { writeBuildFingerprint, type BuildFingerprintInput } from "./build-fingerprint";
import { getAssetPath } from "./embedded-assets";
import { runLint } from "./lint-runner";
import { executeAndReport } from "./validation-exec";
import { log } from "../utils/logger";
import { BuildError } from "./build-error";
import { UsageError } from "./cli-args";
import { preflightBuildTools, computeGates, type Gates } from "./build-preflight";
import {
  finalizeStaticBook,
  shipRuntimePaginatedHtml,
  stagePaginationInput,
  createStageRoot,
} from "./build-staging";
import {
  paginateToStaticHtml,
  renderHtmlToPdf,
  RENDER_TIMEOUT_MS,
  type PdfRenderer,
  type PdfRenderInput,
} from "./pagination";

// PdfRenderer/PdfRenderInput now live in ./pagination (ARCH finding #9) but are
// part of this module's long-standing public surface (re-exported through
// src/api/index.ts) — re-export so existing `import { type PdfRenderer } from
// "./build-runner"` call sites keep working unchanged.
export type { PdfRenderer, PdfRenderInput };

export type BuildFormat = "html" | "pdf" | "pdfx";
export type PdfxFlavor = "x1a" | "x3";

// BuildError now lives in its own dependency-free module (./build-error) so lean
// consumers like utils/file-utils.ts (used by the preview server) can import the
// error type without dragging in this file's whole build-pipeline graph. It is
// re-exported here so existing `import { BuildError } from "./build-runner"`
// call sites (api, commands, tests) keep working unchanged.
export { BuildError };

export interface BuildRunnerOptions {
  inputDir: string;
  format: BuildFormat;
  outDir?: string;
  pdfFileOverride?: string | null;
  title?: string;
  pdfxFlavor?: PdfxFlavor;
  iccPath?: string;
  manifestPath?: string;
  stripAnnotations?: boolean;
  skipLint?: boolean;
  skipPreValidate?: boolean;
  skipPostValidate?: boolean;
  /**
   * Optional PDF renderer override. When provided, the build uses it instead of
   * launching Chromium via puppeteer, and the Chromium preflight is skipped.
   * The Electron viewer injects one backed by `webContents.printToPDF`.
   */
  pdfRenderer?: PdfRenderer;
  /**
   * Keep the pooled headless browser alive after the build returns. A one-shot
   * CLI build leaves this false so the process can exit; a long-lived
   * preview/watch server sets it true so the browser stays warm across rebuilds
   * (every rebuild then skips the ~1–2s Chromium launch). The server owns
   * `closeBrowser()` on shutdown.
   */
  keepBrowserAlive?: boolean;
  rawArgs: Record<string, unknown>;
}

export interface BuildRunnerResult {
  outDir: string;
  htmlPath: string;
  pdfPath: string | null;
  fingerprintPath: string;
}

export interface SplitOutPath {
  outDir?: string;
  pdfFileOverride: string | null;
}

/**
 * Split --out into outDir + optional pdfFileOverride.
 *  - For pdf/pdfx, accept "*.pdf" forms (file path) and split into dirname + path.
 *  - For html or any non-.pdf string, treat as a directory.
 */
export function splitOutPath(
  outArg: string | undefined,
  format: BuildFormat
): SplitOutPath {
  if (typeof outArg !== "string" || outArg.length === 0) {
    return { outDir: undefined, pdfFileOverride: null };
  }
  const resolved = path.resolve(outArg);
  if (
    (format === "pdf" || format === "pdfx") &&
    resolved.toLowerCase().endsWith(".pdf")
  ) {
    return { outDir: path.dirname(resolved), pdfFileOverride: resolved };
  }
  return { outDir: resolved, pdfFileOverride: null };
}

/**
 * Everything the build stages + output strategies need, resolved once up front:
 * the requested format, absolute input/output dirs, the manifest dir (for
 * plugin + ICC resolution), the merged config, and the lint/validate gates.
 * Assembled by {@link resolveBuildContext}; consumed by {@link runQualityGates},
 * {@link renderBook}, and the {@link OutputStrategy} implementations.
 */
export interface BuildContext {
  opts: BuildRunnerOptions;
  format: BuildFormat;
  inputDir: string;
  outDir: string;
  manifestDir: string;
  config: ReturnType<typeof resolveConfig>;
  gates: Gates;
}

/**
 * Stage 1 — load the manifest, merge CLI overrides into the resolved config,
 * pick the output dir, and compute the lint/validate gates. Pure planning: no
 * filesystem writes, no browser, no logging beyond computeGates' own
 * flags-ignored notice. Everything downstream reads from the returned context.
 */
export async function resolveBuildContext(
  opts: BuildRunnerOptions
): Promise<BuildContext> {
  const { format } = opts;
  const inputDir = path.resolve(opts.inputDir);

  // An explicit --manifest typo is rejected by the loader. Discovery remains
  // tolerant there for preview and other callers, but a final build requires a
  // real manifest so running from the wrong folder cannot produce an empty book.
  const { manifest, manifestDir, manifestPath } = await loadManifestWithPath(
    opts.manifestPath ?? inputDir,
    { explicit: opts.manifestPath !== undefined }
  );
  if (manifestPath === null) {
    throw new UsageError(
      `No project manifest found in ${inputDir}. Looked for ${MANIFEST_FILENAMES.join(" or ")}. ` +
        "Run from your project folder or pass that folder with `print-md build <project-dir>`. " +
        "For a custom manifest filename, pass `--manifest <path>`."
    );
  }

  const pdfxConfigOverride =
    format === "pdfx"
      ? {
          flavor: opts.pdfxFlavor,
          icc: opts.iccPath,
          stripAnnotations: opts.stripAnnotations,
        }
      : undefined;

  const config = resolveConfig(
    {
      title: opts.title,
      output: opts.outDir ? { dir: opts.outDir } : undefined,
      pdfx: pdfxConfigOverride,
    },
    manifest
  );

  // An explicit --out is already resolved (against the CWD, by splitOutPath
  // in commands/build.ts) before it reaches here — pass it through unchanged.
  // Otherwise, config.output.dir (relative by default, e.g. "dist") must
  // resolve against the PROJECT being built (manifestDir), not the command's
  // CWD — see maintainer P1 (PR #98): building multiple absolute-path projects
  // from one CWD collided on a single shared <cwd>/dist. An absolute
  // config.output.dir stays absolute (path.resolve ignores the base in that
  // case).
  const outDir = opts.outDir ?? path.resolve(manifestDir, config.output.dir);
  const gates = computeGates(format, opts, config);

  return { opts, format, inputDir, outDir, manifestDir, config, gates };
}

/**
 * Stage 2 — run the CSS lint + pre-build validation gates. Each is skipped
 * unless its gate is on (see {@link computeGates} in ./build-preflight); a
 * failing gate throws a BuildError with the gate's historic exit code
 * (lint=2, pre-validate=1).
 */
async function runQualityGates(ctx: BuildContext): Promise<void> {
  const { gates, opts, inputDir } = ctx;

  if (gates.lint) {
    log.info("Lint: CSS print-safety");
    const lintResult = await runLint({
      manifest: opts.manifestPath ?? inputDir,
    });
    if (!lintResult.ok) {
      throw new BuildError("CSS lint failed", 2);
    }
  }

  if (gates.preValidate) {
    log.info("Pre-build validation");
    const result = await executeAndReport(
      {
        input: inputDir,
        phase: "pre-build",
        manifest: opts.manifestPath,
      },
      "text"
    );
    if (!result.ok) {
      throw new BuildError("Pre-build validation failed", 1);
    }
  }
}

/**
 * Stage 3 — load configured plugins, render the markdown chapters to
 * `outDir/book.html`, and copy user asset directories. Returns the path to the
 * rendered book.html both output strategies then paginate. This is the shared
 * pre-format work; the per-format tails live in the strategies.
 *
 * ARCH finding #4: markdown-it-paged computes typed, line-numbered
 * author-mistake warnings (`env.layoutWarnings`) that every real render path
 * used to discard silently. `renderChaptersToFile`'s `onChapterWarnings`
 * threads them back out here so a final artifact never omits a marker
 * mistake without at least telling the author about it in the build log.
 * Exported (not just for the pipeline) so this stage is unit-testable
 * without driving the full `runBuild` pagination/PDF machinery.
 */
export async function renderBook(ctx: BuildContext): Promise<string> {
  const { config, manifestDir, inputDir, outDir } = ctx;

  if (config.source.files && config.source.files.length > 0) {
    log.info(`Using specified files (${config.source.files.length} total)`);
  } else {
    log.info("Using all .md files in alphabetical order");
  }

  // ARCH finding #53: fail-fast (no onError) — a final artifact must never
  // silently omit author-configured formatting, so a bad plugin here aborts
  // the whole build/export instead of degrading (see loadPlugins' doc comment
  // and the LIVE PREVIEW's degrade-and-report counterpart in
  // preview/file-watcher.ts's renderPreviewBook).
  if (config.plugins.length > 0) {
    log.info(`Loading ${config.plugins.length} plugin(s)...`);
  }
  const { plugins, pluginCss } = await loadPluginsWithCss(config.plugins, manifestDir);
  if (plugins && plugins.length > 0) {
    log.success(`Loaded ${plugins.length} plugin(s)`);
  }

  const htmlFile = await renderChaptersToFile(inputDir, outDir, {
    title: config.title,
    styles: config.styles,
    files: config.source.files,
    plugins,
    pluginCss,
    onChapterWarnings: (file, warnings) => {
      for (const w of warnings) {
        log.warn(`  ${file}, line ${w.line}: ${w.message}`);
      }
    },
  });
  log.success(`Wrote ${htmlFile}`);

  const assetDirs = config.source.assets;
  if (assetDirs.length > 0) {
    log.info("Copying assets");
    await copyAssets(inputDir, outDir, assetDirs, {
      onCopy: (assetPath) => log.info(`  Copied ${assetPath}/`),
      onSkip: (assetPath, srcPath) =>
        log.warn(`  ${assetPath}/ not found at ${srcPath} (skipping)`),
      onCollision: ({ destName, fileName, winnerAsset, loserAsset }) =>
        log.warn(
          `  Asset collision: "${winnerAsset}/${fileName}" overwrites "${loserAsset}/${fileName}" ` +
            `(both flatten to ${destName}/${fileName}). Last entry wins — rename the file or reorder ` +
            `manifest assets if this is not intended.`
        ),
    });
  }

  return htmlFile;
}

/**
 * Resolve the effective ICC profile for a PDF/X build (extracted from the pdfx
 * branch so it is unit-testable in isolation). Relative paths are tried against
 * the manifest dir first, then cwd. As a convenience the unspecified default
 * profile (`CGATS21_CRPC1.icc`, no explicit `--icc`) falls back to the embedded
 * copy shipped in the binary. Throws BuildError(exitCode 2) if nothing resolves.
 */
export async function resolveIccProfile(
  icc: string,
  manifestDir: string,
  explicitIccPath: string | undefined
): Promise<string> {
  const iccCandidates = path.isAbsolute(icc)
    ? [icc]
    : [path.resolve(manifestDir, icc), path.resolve(icc)];
  let effectiveIccPath =
    iccCandidates.find((candidate) => fs.existsSync(candidate)) ?? null;

  if (
    !effectiveIccPath &&
    !explicitIccPath &&
    path.basename(icc) === "CGATS21_CRPC1.icc"
  ) {
    effectiveIccPath = await getAssetPath("profiles/CGATS21_CRPC1.icc");
  }

  if (!effectiveIccPath) {
    throw new BuildError(
      `Missing ICC profile at ${icc}. Place the ICC profile or specify --icc <path>`,
      2
    );
  }

  return effectiveIccPath;
}

/**
 * The shared build tail every output strategy ends with: write the build
 * fingerprint and log `Wrote:` + the fingerprint path. De-duplicates the
 * identical fingerprint-writing sequence the HTML and PDF branches used to
 * inline. `wroteMessage` and the fingerprint/paths differ per format, so they
 * are passed in.
 *
 * Does NOT close the pooled browser (finding #50) — that used to happen here,
 * on the success-only path, which leaked the pre-warmed Chromium whenever a
 * quality gate or render step threw before reaching this function. The close
 * is now a single try/finally around the whole pipeline in {@link runBuild}
 * so it runs on every exit, not just this one.
 */
async function finalizeBuild(
  ctx: BuildContext,
  fingerprint: BuildFingerprintInput,
  wroteMessage: string,
  paths: { htmlPath: string; pdfPath: string | null }
): Promise<BuildRunnerResult> {
  const fingerprintPath = await writeBuildFingerprint(fingerprint);
  log.success(wroteMessage);
  log.info(`Fingerprint: ${fingerprintPath}`);
  return {
    outDir: ctx.outDir,
    htmlPath: paths.htmlPath,
    pdfPath: paths.pdfPath,
    fingerprintPath,
  };
}

/**
 * A per-format output strategy owns the tail of the build: paginate the rendered
 * book.html into the shippable artifact for its format, then finalize (write the
 * fingerprint + close the browser). {@link runBuild} picks one from the format
 * and hands it the resolved context + the rendered book.
 */
interface OutputStrategy {
  finish(ctx: BuildContext, htmlFile: string): Promise<BuildRunnerResult>;
}

/**
 * `--format html` — Pre-paginate at BUILD time (static-site-generator model):
 * run Paged.js once in headless Chromium, serialize the fully-fragmented DOM,
 * and ship that static HTML so the browser renders pages with NO runtime
 * pagination JS. This inverts the pre-SSG model (shipping the polyfill so the
 * browser re-paginates on every load). The navigation toolbar scripts are kept
 * — they only scroll between already-laid-out pages; they do not paginate. With
 * no Chromium at build we fall back to shipping the runtime-pagination polyfill.
 */
class HtmlOutput implements OutputStrategy {
  async finish(
    ctx: BuildContext,
    htmlFile: string
  ): Promise<BuildRunnerResult> {
    const { outDir, inputDir, config, opts } = ctx;
    const assetDirs = config.source.assets;

    const chromium = await resolveChromiumExecutable();
    if (!chromium) {
      // No headless browser at build → fall back to runtime pagination so the
      // build still succeeds (the browser paginates on load — pre-SSG behavior).
      log.warn(
        "Chromium not found — shipping runtime-paginated HTML (the browser will " +
          "paginate on load). Install Chromium or set CHROMIUM_PATH for " +
          "pre-paginated static output."
      );
      await shipRuntimePaginatedHtml(htmlFile, outDir);
    } else {
      // Stage a working copy for the build-time pagination pass (assets +
      // polyfill) under the OS temp dir — never in the caller's cwd. Cleaned up
      // in finally so it does not leak on the error path either.
      const htmlStage = await createStageRoot();
      try {
        const stagedBook = await stagePaginationInput(
          htmlFile,
          outDir,
          assetDirs,
          htmlStage
        );

        log.info("Pre-paginating HTML via Chromium + Paged.js (build-time)");
        const paginated = await paginateToStaticHtml(stagedBook);
        await finalizeStaticBook(paginated, htmlFile, outDir);
      } finally {
        await fsp.rm(htmlStage, { recursive: true, force: true });
      }
    }

    // Write a minimal index.html that redirects to book.html so static hosts
    // (Azure SWA, GitHub Pages, etc.) have a default entry point. This is not
    // the viewer chrome — the Electron viewer loads book.html directly by name.
    const indexPath = path.join(outDir, "index.html");
    if (!fs.existsSync(indexPath)) {
      await fsp.writeFile(
        indexPath,
        `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=book.html"><title>print-md</title></head><body></body></html>\n`,
        "utf-8"
      );
    }

    return finalizeBuild(
      ctx,
      {
        command: "build",
        outputDir: outDir,
        sourceDir: inputDir,
        args: opts.rawArgs,
        pdfx: {
          requestedFlavor: null,
          resolvedFlavor: config.pdfx.flavor,
          iccPath: null,
          stripAnnotations: null,
        },
      },
      `Wrote: ${path.join(outDir, "book.html")}`,
      { htmlPath: htmlFile, pdfPath: null }
    );
  }
}

/**
 * `--format pdf` / `--format pdfx` — stage the rendered book, render it to PDF
 * via Chromium+Paged.js (or an injected renderer), then for plain pdf stamp
 * /Creator and for pdfx resolve the ICC, optionally strip annotations, and
 * convert to CMYK PDF/X. Runs post-build validation for pdfx, then finalizes.
 * The staging scratch dir is removed in a finally so it never leaks.
 */
class PdfOutput implements OutputStrategy {
  async finish(
    ctx: BuildContext,
    htmlFile: string
  ): Promise<BuildRunnerResult> {
    const { outDir, inputDir, config, opts, format, manifestDir, gates } = ctx;
    const assetDirs = config.source.assets;

    const pdfxMode: PdfxFlavor | undefined =
      format === "pdfx" ? (opts.pdfxFlavor ?? config.pdfx.flavor) : undefined;

    const pdfFile =
      opts.pdfFileOverride ?? path.join(outDir, config.output.filename);

    // Stage build directory under the OS temp dir — never in the caller's cwd
    // (runBuild is exported and driven by the viewer host). Cleaned up in finally
    // so it does not leak on the success path OR any error/throw below.
    const stage = await createStageRoot();
    try {
      const stagedHtml = await stagePaginationInput(
        htmlFile,
        outDir,
        assetDirs,
        stage
      );

      const rawPdf = pdfxMode
        ? path.join(stage, "raw.pdf")
        : path.resolve(pdfFile);
      log.info("Rendering HTML to PDF via Chromium+Paged.js");
      await fsp.mkdir(path.dirname(path.resolve(pdfFile)), { recursive: true });
      // PDF unification: the default renderer prints the PDF and, from the SAME
      // pagination pass, serializes the static viewer book.html — so the on-screen
      // pages and the PDF come from one paginated artifact. The PDF call itself is
      // unchanged, so the PDF is pixel-identical to the pre-SSG pipeline. Injected
      // renderers (e.g. the Electron viewer) print only.
      const staticHtmlRaw = opts.pdfRenderer
        ? undefined
        : path.join(stage, "book-static-raw.html");
      await renderHtmlToPdf(stagedHtml, rawPdf, opts.pdfRenderer, staticHtmlRaw);
      if (staticHtmlRaw && fs.existsSync(staticHtmlRaw)) {
        await finalizeStaticBook(
          await fsp.readFile(staticHtmlRaw, "utf-8"),
          htmlFile,
          outDir
        );
        log.success(`Wrote static viewer: ${path.join(outDir, "book.html")}`);
      }

      if (!pdfxMode) {
        // stampCreator writes /Creator (print-md) into the PDF's Info dict using
        // pdf-lib (in-process, no system tool). The information is cosmetic — if it
        // fails for any reason, keep the raw Chromium output as the final PDF rather
        // than failing the build. `rawPdf` equals the final `pdfFile` when !pdfxMode.
        try {
          await stampCreator(rawPdf);
        } catch (err) {
          log.warn(
            `Skipping /Creator stamp: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      let effectiveIccPath: string | null = null;
      let shouldStripAnnotations: boolean | null = null;

      if (pdfxMode) {
        const icc = opts.iccPath ?? config.pdfx.icc;
        effectiveIccPath = await resolveIccProfile(icc, manifestDir, opts.iccPath);

        const shouldStrip = opts.stripAnnotations ?? config.pdfx.stripAnnotations;
        shouldStripAnnotations = shouldStrip;
        if (shouldStrip) {
          log.info("Stripping annotations for PDF/X compliance");
          await stripAnnotations(rawPdf, stage);
        }

        log.info(`Converting to CMYK PDF/X (${pdfxMode})`);
        await convertToPdfxCmyk(rawPdf, path.resolve(pdfFile), {
          iccPath: effectiveIccPath,
          pdfx: pdfxMode,
          title: config.title,
          maxTac: config.ink.maxTac,
          stagingDir: stage,
        });
      }

      // Post-build validation (pdfx only)
      if (gates.postValidate) {
        log.info("Post-build validation");
        const result = await executeAndReport(
          {
            pdf: pdfFile,
            phase: "post-build",
            manifest: opts.manifestPath,
          },
          "text"
        );
        if (!result.ok) {
          throw new BuildError("Post-build validation failed", 1);
        }
      }

      return await finalizeBuild(
        ctx,
        {
          command: "build",
          outputDir: outDir,
          sourceDir: inputDir,
          args: opts.rawArgs,
          pdfx: {
            requestedFlavor: pdfxMode ?? null,
            resolvedFlavor: config.pdfx.flavor,
            iccPath: effectiveIccPath,
            stripAnnotations: shouldStripAnnotations,
          },
        },
        `Wrote: ${pdfFile}`,
        { htmlPath: htmlFile, pdfPath: pdfFile }
      );
    } finally {
      await fsp.rm(stage, { recursive: true, force: true });
    }
  }
}

/**
 * Orchestrate a build: resolve the context, mkdir the output, preflight tools
 * (non-html), pre-warm the browser when this build will paginate in Chromium,
 * run the quality gates, render the book, then hand off to the per-format output
 * strategy for pagination + finalize. The heavy lifting lives in the named
 * stages + strategies above (plus ./build-preflight, ./build-staging, and
 * ./pagination); this reads as the pipeline it is.
 *
 * Everything from the prewarm decision onward runs inside a try/finally that
 * closes the pooled browser (unless `keepBrowserAlive` is set) — finding #50:
 * previously the close only happened on the success tail (inside
 * `finalizeBuild`), so a prewarmed Chromium leaked whenever a quality gate,
 * the render, or pagination itself threw. `closeBrowser()` is a no-op if
 * nothing was launched (including the injected-renderer path, which never
 * uses the pool), so it is safe to call unconditionally here.
 */
export async function runBuild(
  opts: BuildRunnerOptions
): Promise<BuildRunnerResult> {
  const ctx = await resolveBuildContext(opts);

  log.info(`Build (${ctx.format}): ${ctx.inputDir} -> ${ctx.outDir}`);
  await fsp.mkdir(ctx.outDir, { recursive: true });

  // Pre-flight tool check.
  //
  // Without this we'd discover missing tools deep in the pipeline (30-90s in
  // for a real book) when ENOENT bubbles up from a child_process spawn. A 50ms
  // probe at the top gives an actionable error immediately.
  if (ctx.format !== "html") {
    await preflightBuildTools(ctx.format, opts, ctx.config);
  }

  // Pre-warm the headless browser NOW (fire-and-forget) so the ~1–2s Chromium
  // cold start overlaps with lint + validation + markdown render + asset staging
  // below, instead of sitting on the critical path at pagination time. Only when
  // this build will actually paginate in Chromium: a PDF/PDFX build with no
  // injected renderer, or an HTML build with a browser available.
  const willPaginateInChromium =
    (ctx.format !== "html" && !opts.pdfRenderer) ||
    (ctx.format === "html" && !!(await resolveChromiumExecutable()));
  if (willPaginateInChromium) prewarmBrowser(RENDER_TIMEOUT_MS);

  try {
    await runQualityGates(ctx);

    const htmlFile = await renderBook(ctx);

    const strategy: OutputStrategy =
      ctx.format === "html" ? new HtmlOutput() : new PdfOutput();
    return await strategy.finish(ctx, htmlFile);
  } finally {
    if (!opts.keepBrowserAlive) await closeBrowser();
  }
}
