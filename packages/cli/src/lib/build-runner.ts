import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { loadManifestWithPath, MANIFEST_FILENAMES, resolveConfig } from "./manifest";
import { renderChaptersToFile } from "./markdown/index";
import { loadPluginsWithCss } from "./markdown/plugins";
import { type AssetCopy } from "./asset-inline";
import { resolveOutputDir, artifactName, BOOK_HTML } from "./output-paths";
import { prewarmBrowser, closeBrowser, RENDER_TIMEOUT_MS } from "./browser-pool";
import {
  convertToPdfxCmyk,
  hasLiveTransparency,
  stampCreator,
  stripAnnotations,
} from "./ghostscript";
import { writeBuildFingerprint, type BuildFingerprintInput } from "./build-fingerprint";
import { getAssetPath } from "./embedded-assets";
import { runLint } from "./lint-runner";
import { executeAndReport } from "./validation-exec";
import { log } from "../utils/logger";
import { BuildError } from "./build-error";
import type { BuildDiagnostic } from "../engine/compiler/build.ts";
import type { Browser as EngineBrowser, Session as EngineSession } from "../engine/shared/cdp.ts";
import { UsageError } from "./cli-args";
import {
  preflightBuildTools,
  rendersInPooledChromium,
  computeGates,
  verifyNativeChromiumMilestone,
  type Gates,
} from "./build-preflight";
import { shipViewerHtml, createStageRoot, stageBookAssets } from "./build-staging";

export { RENDER_TIMEOUT_MS };

// EngineBrowser/EngineSession are part of this module's long-standing public
// surface (re-exported through src/api/index.ts) — re-export so existing
// `import { type EngineBrowser } from "./build-runner"` call sites keep
// working unchanged. PdfRenderer/PdfRenderInput (the Paged.js renderer seam)
// were removed with the Paged.js pipeline (native-only-migration-plan.md
// Phase 6); the desktop's Electron PDF export now goes through the native
// engine's own Chromium seam (`engineBrowser`) instead.
export type { EngineBrowser, EngineSession };

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
   * Proceed past the engine's over-wide-content check (pdf/pdfx only), which
   * otherwise hard-errors because Chromium silently scales the WHOLE book down
   * to fit the offending box. Each offender is still reported as a warning +
   * diagnostic — this buys an eyes-open build, not a clean one.
   */
  allowShrink?: boolean;
  /**
   * Keep the pooled headless browser alive after the build returns. A one-shot
   * CLI build leaves this false so the process can exit; a long-lived
   * preview/watch server sets it true so the browser stays warm across rebuilds
   * (every rebuild then skips the ~1–2s Chromium launch). The server owns
   * `closeBrowser()` on shutdown.
   */
  keepBrowserAlive?: boolean;
  rawArgs: Record<string, unknown>;
  /**
   * CLI `--engine` override. Paged.js has been removed — the native engine is
   * the only engine — so this is a deprecated no-op accepted for backward
   * compatibility only: `"paged"` triggers a one-line warning
   * (`manifest.ts`'s resolution) and the build proceeds natively regardless.
   */
  engine?: "paged" | "native";
  /**
   * Optional injected engine-Chromium factory for native builds
   * (`engine.ts`'s `buildNativePdf`). When omitted (the CLI's default), the
   * native engine attaches to `browser-pool.ts`'s pooled external Chromium,
   * and the usual Chromium preflight / milestone check apply. When supplied
   * (the desktop, over its own Electron `BrowserWindow` — see
   * `packages/desktop/electron`'s engine-browser module), it is used
   * instead, no external Chromium is required, and both of those checks are
   * skipped.
   */
  engineBrowser?: () => Promise<EngineBrowser>;
}

export interface BuildRunnerResult {
  outDir: string;
  /**
   * The published `book.html`, or `null` for a one-file delivery (`--out x.pdf`,
   * a desktop export) where only the PDF is delivered and everything else is
   * discarded with the work dir. Returning a work-dir path here would hand the
   * caller a filename that is already deleted by the time they see it.
   */
  htmlPath: string | null;
  pdfPath: string | null;
  /** As {@link htmlPath}: `null` when nothing but the artifact was published. */
  fingerprintPath: string | null;
  /**
   * Author-facing print-quality findings from the render (native engine only
   * — Paged.js has no equivalent audit). Empty for a clean build. The desktop
   * maps these into the Problems panel; the CLI logs them.
   */
  diagnostics: BuildDiagnostic[];
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
/**
 * Where a finished build is delivered. The build itself always writes to a
 * scratch `workDir`; this says what happens to it afterwards.
 *
 * The distinction is structural, not a flag: `rm` appears in exactly one branch
 * of {@link publishBuild}, the `project` one, whose path is always computed by
 * `resolveOutputDir` from the manifest. A caller-supplied path is a different
 * variant that reaches different code, so no `--out` value can be deleted —
 * there is no code path that would do it.
 */
type PublishTarget =
  /** gutterpress's own `dist/<slug>/`. Replaced wholesale, so stale files vanish. */
  | { kind: "project"; dir: string }
  /** `--out <dir>`: the user's directory. Files are added; nothing is removed. */
  | { kind: "directory"; dir: string }
  /** `--out <file.pdf>` / the desktop's Save dialog: ONE file, nothing else. */
  | { kind: "file"; file: string };

export interface BuildContext {
  opts: BuildRunnerOptions;
  format: BuildFormat;
  /**
   * The directory the author pointed at (`gutterpress build <dir>`). Recorded in
   * the build fingerprint as the source dir; NOT an anchor for resolving
   * manifest-relative paths — see {@link BuildContext.renderDir}.
   */
  inputDir: string;
  /**
   * THE anchor every manifest-relative path resolves against: `styles:`,
   * `source.files`, authored plugin `path:` entries, and the lint gate's own
   * stylesheet resolution. Equal to {@link BuildContext.manifestDir}.
   *
   * These used to resolve against two different roots in one build (2026-07-29
   * audit): plugins, the lint gate, and the output dir anchored on
   * `manifestDir`, while `styles:`/`source.files` anchored on `inputDir`. They
   * are identical in the normative layout (the manifest lives in the book
   * folder) and diverge only under an explicit `--manifest` pointing outside
   * `--input` — where the docs are unambiguous that both are manifest-relative,
   * so the lint gate was checking a different set of stylesheets than the ones
   * that shipped.
   */
  renderDir: string;
  outDir: string;
  manifestDir: string;
  config: ReturnType<typeof resolveConfig>;
  gates: Gates;
  /**
   * Where the build actually writes. A build assembles a COMPLETE output tree
   * here and only then replaces `outDir` with it, so a build is atomic (a crash
   * leaves the previous output untouched) and stale files cannot survive — the
   * work dir starts empty, so whatever is not rebuilt simply is not there.
   *
   * It is a sibling of `outDir` rather than an OS temp dir so the final publish
   * is a same-filesystem `rename`.
   */
  workDir: string;
  /** What to do with `workDir` once the build succeeds. */
  target: PublishTarget;
  /**
   * Exact layout-marker findings already printed by pre-build validation.
   * Render-time parsing consults this set so only true duplicates disappear;
   * a disabled/failed/skipped marker check never suppresses a legitimate
   * warning from the final render path.
   */
  prevalidatedLayoutWarningKeys: Set<string>;
}

function layoutWarningKey(file: string, line: number | undefined, message: string): string {
  return `${path.resolve(file)}\0${line ?? 0}\0${message}`;
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
        "Run from your project folder or pass that folder with `gutterpress build <project-dir>`. " +
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
      pdfx: pdfxConfigOverride,
      engine: opts.engine,
    },
    manifest
  );

  // An explicit --out is already resolved (against the CWD, by splitOutPath in
  // commands/build.ts) before it reaches here — pass it through unchanged.
  // Otherwise the location is a CONVENTION, not configuration:
  // `<manifestDir>/dist/<title-slug>/`. Anchoring on the manifest dir keeps
  // multiple projects built from one CWD apart, and the per-book slug keeps
  // multiple books in ONE tree apart — the case a single shared `dist` could
  // never handle no matter how `output.dir` was configured.
  // A `--out something.pdf` names ONE artifact; only that file is delivered, so
  // a build can never scatter book.html/images/ into the folder someone picked
  // in a Save dialog. `--out <dir>` delivers the whole bundle but never deletes.
  const target: PublishTarget = opts.pdfFileOverride
    ? { kind: "file", file: path.resolve(opts.pdfFileOverride) }
    : opts.outDir
      ? { kind: "directory", dir: opts.outDir }
      : { kind: "project", dir: resolveOutputDir(manifestDir, config.title) };
  const outDir = target.kind === "file" ? path.dirname(target.file) : target.dir;
  const gates = computeGates(format, opts, config);
  // For our own `dist/`, the work dir is a sibling of the destination so the
  // publish is a same-filesystem atomic rename. For a caller-supplied target we
  // must not create scratch directories in someone else's folder, so it goes to
  // the OS temp dir and the publish is a copy.
  const workDir =
    target.kind === "project"
      ? path.join(
          path.dirname(target.dir),
          `.${path.basename(target.dir)}-build-${randomBytes(6).toString("hex")}`
        )
      : path.join(os.tmpdir(), `gutterpress-build-${randomBytes(6).toString("hex")}`);

  return {
    opts,
    format,
    inputDir,
    // One anchor for every manifest-relative path (see BuildContext.renderDir).
    renderDir: manifestDir,
    outDir,
    workDir,
    target,
    manifestDir,
    config,
    gates,
    prevalidatedLayoutWarningKeys: new Set(),
  };
}

/**
 * Stage 2 — run the CSS lint + pre-build validation gates. Each is skipped
 * unless its gate is on (see {@link computeGates} in ./build-preflight); a
 * failing gate throws a BuildError with the gate's historic exit code
 * (lint=2, pre-validate=1).
 */
async function runQualityGates(ctx: BuildContext): Promise<void> {
  const { gates, opts, renderDir } = ctx;

  if (gates.lint) {
    log.info("Lint: CSS print-safety");
    const lintResult = await runLint({
      manifest: opts.manifestPath ?? renderDir,
    });
    if (!lintResult.ok) {
      throw new BuildError("CSS lint failed", 2);
    }
  }

  if (gates.preValidate) {
    log.info("Pre-build validation");
    const result = await executeAndReport(
      {
        input: renderDir,
        phase: "pre-build",
        manifest: opts.manifestPath,
      },
      "text"
    );
    for (const finding of result.execution.report.results) {
      if (
        finding.checkId === "source.markdown.layout-markers" &&
        finding.file &&
        finding.code !== "inspect-failed"
      ) {
        ctx.prevalidatedLayoutWarningKeys.add(
          layoutWarningKey(finding.file, finding.line, finding.message),
        );
      }
    }
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
 * ARCH finding #4: Gutterpress's marker parser computes typed, line-numbered
 * author-mistake warnings (`env.layoutWarnings`) that every real render path
 * used to discard silently. `renderChaptersToFile`'s `onChapterWarnings`
 * threads them back out here so a final artifact never omits a marker
 * mistake without at least telling the author about it in the build log.
 * Exported (not just for the pipeline) so this stage is unit-testable
 * without driving the full `runBuild` pagination/PDF machinery.
 */
export async function renderBook(ctx: BuildContext): Promise<string> {
  const { config, gates, renderDir, workDir, opts } = ctx;

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
  const { plugins, pluginCss } = await loadPluginsWithCss(config.plugins, renderDir);
  if (plugins && plugins.length > 0) {
    log.success(`Loaded ${plugins.length} plugin(s)`);
  }

  // The render reports every asset the book actually references: image `src`
  // values (markdown tokens + raw HTML) and any CSS image too large to inline.
  // That report IS the copy plan — there is no separate author-maintained list
  // that could drift from it, which is what made assets silently go missing.
  const imageRefs: string[] = [];
  const cssAssets: AssetCopy[] = [];

  const htmlFile = await renderChaptersToFile(renderDir, workDir, {
    title: config.title,
    styles: config.styles,
    files: config.source.files,
    plugins,
    pluginCss,
    // Prevalidation may have reported these exact parser findings through
    // source.markdown.layout-markers. Suppress only an exact match: a disabled,
    // failed, or skipped check leaves this set empty and the final render still
    // tells the author about every legitimate marker mistake.
    onChapterWarnings: (file, warnings) => {
      for (const w of warnings) {
        const key = layoutWarningKey(path.resolve(renderDir, file), w.line, w.message);
        if (!ctx.prevalidatedLayoutWarningKeys.has(key)) {
          log.warn(`  ${file}, line ${w.line}: ${w.message}`);
        }
      }
    },
    onImageRefs: (refs) => imageRefs.push(...refs),
    onCssAssets: (copies) => cssAssets.push(...copies),
    onStyleWarnings: (warnings) => {
      for (const w of warnings) log.warn(`  ${w}`);
    },
  });
  log.success(`Wrote ${htmlFile}`);

  const { missing } = await stageBookAssets({
    renderDir,
    outDir: workDir,
    htmlFile,
    imageRefs,
    cssAssets,
    onPlan: ({ unresolved, copyCount }) => {
      if (unresolved.length > 0) {
        throw new BuildError(
          `Cannot resolve ${unresolved.length} image reference(s):\n` +
            unresolved.map((e) => `  - ${e}`).join("\n"),
          1
        );
      }
      if (copyCount > 0) log.info(`Copying ${copyCount} referenced asset(s)`);
    },
  });
  if (missing.length > 0) {
    log.warn(
      `${missing.length} referenced image(s) do not exist — a magenta placeholder ` +
        `was substituted so the build could finish. Each one is a visible hole ` +
        `in the PDF:`
    );
    for (const m of missing) log.warn(`  missing: ${m}`);
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
  paths: { htmlPath: string; pdfPath: string | null },
  artifactName: string | null = null,
  diagnostics: BuildDiagnostic[] = []
): Promise<BuildRunnerResult> {
  const workFingerprint = await writeBuildFingerprint({
    ...fingerprint,
    // The FILE goes into the work dir so the atomic publish carries it along;
    // the value RECORDED stays the destination the author can actually open
    // (`fingerprint.outputDir`, set by each output strategy).
    outputDir: ctx.workDir,
    recordedOutputDir: fingerprint.outputDir,
  });
  await publishBuild(ctx, artifactName);

  // A `file` target delivers ONE artifact; the fingerprint and book.html stay
  // in the work dir and are removed with it, so they are reported as absent
  // rather than as paths the caller cannot open.
  const delivered = ctx.target.kind !== "file";
  const fingerprintPath = delivered
    ? path.join(ctx.outDir, path.basename(workFingerprint))
    : null;

  log.success(wroteMessage);
  if (fingerprintPath) log.info(`Fingerprint: ${fingerprintPath}`);
  return {
    outDir: ctx.outDir,
    htmlPath: delivered
      ? path.join(ctx.outDir, path.relative(ctx.workDir, paths.htmlPath))
      : null,
    pdfPath: paths.pdfPath,
    fingerprintPath,
    diagnostics,
  };
}

/**
 * Deliver the completed work dir to its target.
 *
 * `rm` on a destination exists ONLY in the `project` branch, whose path always
 * came from `resolveOutputDir`. Neither caller-supplied variant can reach it,
 * so no `--out` path is deletable by construction rather than by a guard.
 */
async function publishBuild(ctx: BuildContext, artifactName: string | null): Promise<void> {
  const { workDir, target } = ctx;

  if (target.kind === "file") {
    // Exactly one artifact is delivered. Nothing else the build produced —
    // book.html, images/, the fingerprint — goes anywhere near the caller's
    // folder, which is what stops a Save dialog from being sprayed with output.
    if (!artifactName) throw new BuildError("No artifact to write for this format", 1);
    await fsp.mkdir(path.dirname(target.file), { recursive: true });
    await fsp.copyFile(path.join(workDir, artifactName), target.file);
    return;
  }

  if (target.kind === "directory") {
    // The user's directory: add files, never remove any.
    await fsp.mkdir(target.dir, { recursive: true });
    await fsp.cp(workDir, target.dir, { recursive: true, force: true });
    return;
  }

  // Our own dist/<slug>/: replaced wholesale, which is what makes stale files
  // vanish with no bookkeeping. Other formats' PDFs are carried across first so
  // building pdf and html accumulates both.
  for (const name of await listPdfs(target.dir)) {
    if (!fs.existsSync(path.join(workDir, name))) {
      await fsp.rename(path.join(target.dir, name), path.join(workDir, name));
    }
  }
  await fsp.rm(target.dir, { recursive: true, force: true });
  await fsp.mkdir(path.dirname(target.dir), { recursive: true });
  await fsp.rename(workDir, target.dir);
}

/** Top-level `*.pdf` filenames in `dir`; empty when it does not exist. */
async function listPdfs(dir: string): Promise<string[]> {
  try {
    return (await fsp.readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".pdf"))
      .map((e) => e.name);
  } catch {
    return [];
  }
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
 * `--format html` ships the self-contained `book.html` plus a copy of the
 * native engine's viewer bundle (`shipViewerHtml`) — the browser paginates on
 * load. No headless Chromium at build time.
 */
class HtmlOutput implements OutputStrategy {
  async finish(
    ctx: BuildContext,
    htmlFile: string
  ): Promise<BuildRunnerResult> {
    const { workDir, outDir, inputDir, config, opts } = ctx;

    log.info("Shipping self-contained HTML + viewer bundle (native engine)");
    await shipViewerHtml(htmlFile, workDir);

    // A minimal index.html redirects to book.html so static hosts (Azure SWA,
    // GitHub Pages, etc.) have a default entry point. This is not the desktop
    // chrome — the Electron desktop loads book.html directly by name.
    await fsp.writeFile(
      path.join(workDir, "index.html"),
      `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=book.html"><title>Gutterpress</title></head><body></body></html>\n`,
      "utf-8"
    );
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
      `Wrote: ${path.join(outDir, BOOK_HTML)}`,
      { htmlPath: htmlFile, pdfPath: null }
    );
  }
}

/**
 * `--format pdf` / `--format pdfx` — stage the rendered book, render it to PDF
 * via the Gutterpress engine's native Chromium pagination, then for plain pdf
 * stamp /Creator and for pdfx resolve the ICC, optionally strip annotations, and
 * convert to CMYK PDF/X. Runs post-build validation for pdfx, then finalizes.
 * The staging scratch dir is removed in a finally so it never leaks.
 */
class PdfOutput implements OutputStrategy {
  async finish(
    ctx: BuildContext,
    htmlFile: string
  ): Promise<BuildRunnerResult> {
    const { workDir, outDir, inputDir, config, opts, format, manifestDir, gates } = ctx;

    const pdfxMode: PdfxFlavor | undefined =
      format === "pdfx" ? (opts.pdfxFlavor ?? config.pdfx.flavor) : undefined;

    // Artifact name is a convention: `<title-slug>-<format>.pdf`. The format is
    // part of the NAME because the extension cannot distinguish a plain PDF
    // from a PDF/X one — previously both formats shared one configured
    // filename, so building both left only the last one on disk.
    const pdfName = artifactName(config.title, pdfxMode ? "pdfx" : "pdf");
    // ALWAYS built inside the work dir, whatever the destination is; publishing
    // is what decides where it lands. That keeps every format atomic and keeps
    // the "one file only" delivery rule in one place.
    const pdfFile = path.join(workDir, pdfName);
    const reportedPdf =
      ctx.target.kind === "file" ? ctx.target.file : path.join(outDir, pdfName);

    // Scratch dir under the OS temp dir, for PDF/X intermediates only — never
    // for staging assets. Removed in a finally so it cannot leak.
    const stage = await createStageRoot();
    try {
      const rawPdf = pdfxMode
        ? path.join(stage, "raw.pdf")
        : path.resolve(pdfFile);
      await fsp.mkdir(path.dirname(path.resolve(pdfFile)), { recursive: true });
      // The engine gets a direct call on the plain file — no HTTP staging —
      // see engine.ts's module doc for detail.
      log.info("Rendering HTML to PDF via the Gutterpress engine (native Chromium pagination)");
      const { buildNativePdf } = await import("./engine");
      const engineDiagnostics = await buildNativePdf(
        htmlFile,
        rawPdf,
        {
          title: config.title,
          author: config.authors.length > 0 ? config.authors.join(", ") : undefined,
          signature: config.print.signature,
          allowShrink: opts.allowShrink,
        },
        opts.engineBrowser
      );
      for (const d of engineDiagnostics) log.warn(d.message);

      if (!pdfxMode) {
        // stampCreator writes /Creator (Gutterpress) into the PDF's Info dict using
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

        // B.10: PDF/X-1a and PDF/X-3 are built at PDF 1.3 compatibility,
        // which cannot represent live transparency at all — an alpha-channel
        // image OR a CSS `opacity`/`mix-blend-mode` rule forces Ghostscript
        // to flatten whatever page it's on into a single raster (fonts and
        // searchable text lost on that page). This is not fixable without
        // changing PDF/X conformance (PDF/X-1a and PDF/X-3 are both
        // PDF-1.3-based by spec, not a Gutterpress default), so warn
        // precisely rather than let the author discover a fontless page
        // after the fact.
        if (await hasLiveTransparency(await fsp.readFile(rawPdf))) {
          log.warn(
            "This book uses transparency — an image with an alpha channel, or a CSS " +
              "rule like `opacity` or `mix-blend-mode`. " +
              `PDF/${pdfxMode === "x1a" ? "X-1a" : "X-3"} has no way to represent that ` +
              "(both are based on PDF 1.3, which predates PDF transparency), so " +
              "Ghostscript will flatten every page that uses it into a single raster " +
              "image — that page loses its embedded fonts and searchable text in the " +
              "PDF/X output. To keep vector text, remove the `opacity`/blend rule and " +
              "flatten any alpha-channel image against its intended background before " +
              "including it (export it with no alpha channel), or build --format pdf " +
              "instead of pdfx if this book doesn't need print-ready CMYK."
          );
        }

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
        `Wrote: ${reportedPdf}`,
        { htmlPath: htmlFile, pdfPath: reportedPdf },
        pdfName,
        engineDiagnostics
      );
    } finally {
      await fsp.rm(stage, { recursive: true, force: true });
    }
  }
}

/**
 * Orchestrate a build: resolve the context, mkdir the output, preflight tools
 * (non-html), pre-warm the browser when this build will render in Chromium,
 * run the quality gates, render the book, then hand off to the per-format output
 * strategy for rendering + finalize. The heavy lifting lives in the named
 * stages + strategies above (plus ./build-preflight and ./build-staging);
 * this reads as the pipeline it is.
 *
 * Everything from the prewarm decision onward runs inside a try/finally that
 * closes the pooled browser (unless `keepBrowserAlive` is set) — finding #50:
 * previously the close only happened on the success tail (inside
 * `finalizeBuild`), so a prewarmed Chromium leaked whenever a quality gate or
 * the render itself threw. `closeBrowser()` is a no-op if nothing was
 * launched (including the injected-`engineBrowser` path, which never uses
 * the pool), so it is safe to call unconditionally here.
 */
export async function runBuild(
  opts: BuildRunnerOptions
): Promise<BuildRunnerResult> {
  const ctx = await resolveBuildContext(opts);

  log.info(`Build (${ctx.format}): ${ctx.inputDir} -> ${ctx.outDir}`);

  // Pre-flight tool check.
  //
  // Without this we'd discover missing tools deep in the pipeline (30-90s in
  // for a real book) when ENOENT bubbles up from a child_process spawn. A 50ms
  // probe at the top gives an actionable error immediately.
  // Every build reuses this file's puppeteer pool (./engine.ts connects the
  // engine's raw-CDP client to the pool's browser) unless `opts.engineBrowser`
  // is supplied (the desktop's Electron path), which drives its own Chromium
  // and needs neither the pool nor an external binary; `preflightBuildTools`
  // itself skips its Chromium check in that case, but ghostscript/qpdf checks
  // for pdfx still apply, so this call stays unconditional.
  if (ctx.format !== "html") {
    await preflightBuildTools(ctx.format, opts, ctx.config);
  }

  // Pre-warm the headless browser NOW (fire-and-forget) so the ~1–2s Chromium
  // cold start overlaps with lint + validation + markdown render + asset staging
  // below, instead of sitting on the critical path at render time. Only when
  // this build will actually render in the POOLED Chromium: a PDF/PDFX build
  // with no injected `engineBrowser`. HTML builds never touch Chromium — the
  // native viewer bundle paginates in the reader's browser, not at build time.
  if (rendersInPooledChromium(ctx.format, opts)) prewarmBrowser(RENDER_TIMEOUT_MS);

  try {
    // Created INSIDE the try so the finally below always reclaims it. Creating
    // it earlier leaked a `.slug-build-*` directory on every build whose
    // preflight or prewarm threw — e.g. every attempt with Ghostscript missing.
    await fsp.mkdir(ctx.workDir, { recursive: true });

    await runQualityGates(ctx);

    // Verify the pooled Chromium meets the engine's minimum milestone BEFORE
    // rendering — a too-old browser previously surfaced only deep inside
    // buildNativePdf, after the render below had already run. Not folded into
    // preflightBuildTools() (which runs before quality gates): that would
    // force this build to await Chromium's cold start before lint/validate
    // even start, defeating prewarmBrowser()'s overlap. Placed here instead,
    // the common failure case (a quality gate throwing) never pays for it,
    // and by the time gates finish the prewarmed browser is usually already
    // warm. See verifyNativeChromiumMilestone's doc comment. Skipped when
    // `opts.engineBrowser` is supplied: that path never touches the pool (the
    // desktop drives its own Electron Chromium instead), so there is nothing
    // here for this check to verify.
    if (rendersInPooledChromium(ctx.format, opts)) {
      await verifyNativeChromiumMilestone();
    }

    const htmlFile = await renderBook(ctx);

    const strategy: OutputStrategy =
      ctx.format === "html" ? new HtmlOutput() : new PdfOutput();
    return await strategy.finish(ctx, htmlFile);
  } finally {
    if (!opts.keepBrowserAlive) await closeBrowser();
    // A failed build must leave the previous output untouched — the work dir is
    // the only thing it ever wrote to, so removing it is the whole rollback.
    await fsp.rm(ctx.workDir, { recursive: true, force: true });
  }
}
