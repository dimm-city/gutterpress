/**
 * export/controller.ts — the PDF/HTML export pipeline behind the `api:build` IPC
 * channel, as an injectable, unit-testable class.
 *
 * Every external touch-point (the active export session, the token store, the
 * progress sender, the Electron PDF renderer, …) is INJECTED via `deps`, so
 * tests drive the validation, the pre-export sync SAFETY GATE (§5.3), the
 * temp-file rename, the progress events, and the BuildError/ENOENT/cancel
 * error mapping with fakes. `format: "html"` takes a different delivery leg: `out` is a DIRECTORY and the lib's
 * own directory target writes the bundle into it (no temp file, no rename). The live
 * BrowserWindow interaction lives ENTIRELY in the injected `engineBrowser`
 * (electron/engine-browser.ts) — this controller never touches a window
 * directly.
 *
 * Node/lib-side ONLY — never imported by the renderer.
 */

import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { GitIdentityArgs } from "../git-identity";
import type { ExportProgressEvent, ExportSession } from "../pdf-export";
import type { EngineBrowser, TokenStore } from "gutterpress";

type LibModule = typeof import("gutterpress");

export interface ExportBuildArgs {
  input: string;
  format?: "pdf" | "html" | "pdfx";
  out?: string;
  title?: string;
  pdfxFlavor?: string;
  icc?: string;
  manifest?: string;
  stripAnnotations?: boolean;
  skipLint?: boolean;
  skipPreValidate?: boolean;
  skipPostValidate?: boolean;
  /**
   * Proceed past the engine's over-wide-content check instead of failing on
   * it. The engine's error tells the author to pass this; without it here the
   * advice is unreachable from the desktop, which is the only export path a
   * non-technical author has. Opt-in per export — the build still reports the
   * whole-document shrink scale and every offender as diagnostics.
   */
  allowShrink?: boolean;
}

/**
 * One print-quality finding, mirrored from the lib's `BuildDiagnostic`
 * (defined locally — Electron main does not import the lib's engine types
 * across the layering boundary; kept in lockstep with
 * `src/lib/platform/shared-types.ts`'s `BuildDiagnosticDto`).
 */
export interface ExportBuildDiagnostic {
  code: string;
  severity: "warning" | "info";
  message: string;
}

export interface ExportBuildResult {
  exportId: string;
  outDir: string;
  htmlPath?: string;
  /** The delivered PDF. Absent for `format: "html"`, which delivers a folder. */
  pdfPath?: string;
  fingerprintPath?: string;
  diagnostics?: ExportBuildDiagnostic[];
}

/** External touch-points injected into the controller (all faked in tests). */
export interface ExportControllerDeps {
  /** Lazily load gutterpress. Cached by the caller. */
  loadLib: () => Promise<LibModule>;
  /** Credential store passed to lib.diagnoseProjectRemote / lib.syncProject. */
  tokenStore: TokenStore;
  /**
   * The author's configured commit identity, read live. The pre-export sync
   * gate's `lib.syncProject` snapshots-first, so it commits — and that commit
   * must be attributed to the author like every other commit path.
   */
  gitIdentity: () => Promise<GitIdentityArgs>;
  /** Network reachability (Electron net.isOnline in production). */
  isOnline: () => boolean;
  /**
   * Electron-native engine browser factory (electron/engine-browser.ts).
   * Threaded through to `lib.runBuild` as `engineBrowser` — `build-runner.ts`
   * calls it in place of its own Chromium launcher (one hidden
   * `BrowserWindow` per build) and closes what it returns. The desktop has
   * exactly one PDF path: Electron's bundled Chromium.
   */
  engineBrowser: () => Promise<EngineBrowser>;
  /** Single active export session accessors (electron/pdf-export.ts). */
  getActiveExportSession: () => ExportSession | null;
  setActiveExportSession: (session: ExportSession | null) => void;
  /** Forward a progress event to the live main window (electron/pdf-export.ts). */
  sendProgress: (event: ExportProgressEvent) => void;
  /** Throw ExportCanceledError when the session is cancelled. */
  throwIfCanceled: (session: ExportSession) => void;
  /** True when the thrown value is an ExportCanceledError. */
  isExportCanceledError: (e: unknown) => boolean;
  /** fs.promises.rename — atomically move temp → final on success. */
  rename: (from: string, to: string) => Promise<void>;
  /** fs.promises.rm(path, { force: true }) — clean up the temp file. */
  rm: (path: string) => Promise<void>;
  /**
   * Authorize AND consume (one-time) a `SavePathHooks` capability for the
   * requested `out` path. Must
   * return `true` only for a path the `dialog:savePdf` route itself just
   * registered — i.e. one the native Save dialog actually returned — and
   * `false` for anything else (never chosen, already consumed, or expired).
   * `api:build` refuses to write/rename onto an `out` this rejects, so a
   * renderer-controlled `out` can never overwrite an arbitrary file.
   */
  consumeSavePath: (absPath: string) => boolean;
  /**
   * True when `absPath` lies inside one of the fs-guard's `projectRoots()`
   * (the open book), compared symlink-safely (`isWithinAnyRootCanonical`).
   * The second way an `out` is authorized: the Publish wizard builds into a
   * folder inside the book (default `<project>/dist`) with no Save dialog in
   * the loop. Not an escalation — the fs routes already let the renderer
   * write anywhere inside the open book.
   */
  isWithinProject: (absPath: string) => Promise<boolean>;
  /**
   * Record the path this export actually WROTE (the PDF, or the html output
   * folder) as a picked-path capability. `shell/show-in-folder` confines its reveal target to
   * the open project plus the read-only roots, but a Save-dialog destination
   * is deliberately outside the project — so the export's "Show in Folder"
   * toast would otherwise be refused. Registering the path the HOST wrote
   * means the reveal never has to trust a renderer-supplied path. Called only
   * after the artifact is delivered: a failed export authorizes nothing. For
   * an html build this is also what lets `publish:run` accept the output
   * folder as its upload artifact.
   */
  registerPickedPath: (absPath: string) => void;
}

export class ExportController {
  constructor(private readonly deps: ExportControllerDeps) {}

  /**
   * Run one PDF/HTML export: validate → single-export guard → pre-export sync
   * safety gate → build → atomic rename → progress/error mapping. Throws typed
   * errors (OUT_NOT_AUTHORIZED / BUILD_ERROR / TOOL_MISSING / EXPORT_CANCELED).
   */
  async build(args: ExportBuildArgs): Promise<ExportBuildResult> {
    if (!args?.input) throw new Error("Missing 'input'");
    const format = args.format ?? "pdf";
    if (format === "pdfx" && !args.icc) {
      throw new Error("PDF/X format requires 'icc' (ICC profile path)");
    }

    const lib = await this.deps.loadLib();
    if (this.deps.getActiveExportSession()) {
      throw new Error("A PDF export is already in progress");
    }
    const requestedOutPath = args.out;
    if (!requestedOutPath) {
      throw new Error("Missing 'out' for export");
    }
    // `out` must be a path a
    // native dialog itself just returned (registered as a one-time
    // capability by the `dialog:savePdf` / `dialog:pickOutputFolder`
    // routes), not merely any absolute path the renderer happens to send —
    // OR a path inside the open book. The latter is not an escalation: the
    // fs routes already let the renderer write anywhere inside the open book,
    // so building into `<project>/dist` grants nothing new. Checked BEFORE
    // the session is minted below, so an unauthorized `out` never occupies
    // the single-export slot or emits a progress event. Consuming here (not
    // just checking) means a second `api:build` call replaying the same
    // out-of-project `out` — without a fresh dialog round-trip — is rejected
    // too.
    if (
      !this.deps.consumeSavePath(requestedOutPath) &&
      !(await this.deps.isWithinProject(requestedOutPath))
    ) {
      const err = new Error(
        "The save location wasn't chosen in a dialog and isn't inside your book. " +
        "Pick a destination in the dialog, then try again.",
      );
      (err as Error & { code?: string }).code = "OUT_NOT_AUTHORIZED";
      throw err;
    }

    // Mint the session and register it as active BEFORE the pre-export sync
    // safety gate below (M28): Cancel is gated on the renderer knowing an
    // exportId, so an id minted after the gate would leave a slow/flaky sync
    // as an uncancelable "Preparing PDF…" stall. The "started" progress event
    // (the existing wire state + free-text `message`) lets the renderer adopt
    // the id — lighting up Cancel immediately — and label the pill "Syncing
    // latest changes…" for as long as the gate takes.

    // HTML takes none of the temp/workspace machinery below: `out` is a
    // DIRECTORY the author chose (or one inside the book) and IS the
    // delivery target — the lib's directory target stages the bundle in a
    // sibling work dir and copies book.html/index.html/assets/fingerprint
    // into it only once the build succeeds, so there is no partial output to
    // rename into place or clean up.
    const isHtml = format === "html";
    const tempOutPath = isHtml ? undefined : `${requestedOutPath}.Gutterpress.tmp.pdf`;
    // WORKSPACE vs DESTINATION split. `runBuild` writes book.html,
    // build-fingerprint.json, and every asset the book references into
    // `outDir`; deriving that from the Save-dialog destination would drop the
    // whole build workspace into the author's chosen folder (their Desktop,
    // say), overwriting same-named files there. A fresh OS-temp directory is
    // the workspace instead; only the PDF (`pdfFileOverride`) still lands next to
    // the chosen destination — same filesystem as `requestedOutPath`, so the
    // atomic rename below can't hit a cross-device error — and the workspace
    // is removed in the outer `finally`, alongside the temp PDF, regardless of
    // which path below the export exits through (including the sync gate's
    // own early throws).
    const workspaceDir = isHtml
      ? null
      : await fsp.mkdtemp(path.join(os.tmpdir(), "Gutterpress-export-"));
    const outDir = workspaceDir ?? requestedOutPath;
    const pdfFileOverride = tempOutPath ? path.resolve(tempOutPath) : undefined;
    const exportSession: ExportSession = {
      id: randomUUID(),
      canceled: false,
      outPath: requestedOutPath,
      tempOutPath,
      win: null,
    };
    this.deps.setActiveExportSession(exportSession);
    this.deps.sendProgress({
      exportId: exportSession.id,
      state: "started",
      message: "Syncing latest changes…",
    });

    try {
      // ── PDF-export safety gate (transparent-sync plan §5.3) ────────────────
      // Before building, a local-git project that can sync (canSync, i.e. an
      // HTTPS remote + credential) and is online syncs first, so the PDF
      // includes teammate changes; anything else builds from local content.
      // Sync always converges — there is no conflict state to block on; the
      // PDF is built from whatever the converged local content is, which is
      // always valid and fully snapshotted. Gate errors are non-fatal.
      const exportDir = path.resolve(args.input);
      try {
        const exportSource = await lib.detectProjectSource(exportDir);
        this.deps.throwIfCanceled(exportSession);
        if (exportSource.type === "local-git-folder") {
          // Credential-aware gate — NOT capabilitiesFor().canSync,
          // which is hasRemote-only and would attempt a pre-export syncProject
          // (returning auth) for SSH or uncredentialed-HTTPS projects on every export.
          const exportDiag = await lib.diagnoseProjectRemote(exportDir, {
            tokenStore: this.deps.tokenStore,
          });
          this.deps.throwIfCanceled(exportSession);
          if (exportDiag.canSync && this.deps.isOnline()) {
            const syncOutcome = await lib.syncProject({
              projectDir: exportDir,
              tokenStore: this.deps.tokenStore,
              ...(await this.deps.gitIdentity()),
            });
            this.deps.throwIfCanceled(exportSession);
            void syncOutcome;
            // synced / up-to-date / offline / auth / error → export proceeds with
            // local content (the ambient pill already reflects the sync state).
          }
        }
      } catch (gateErr) {
        // M28: a Cancel click during the gate — the exportId exists this
        // early, so Cancel can fire mid-sync. Honour it the same way the
        // post-build cancel path does, rather than falling into the "swallow
        // non-fatal gate errors" branch below.
        if (exportSession.canceled || this.deps.isExportCanceledError(gateErr)) {
          this.deps.setActiveExportSession(null);
          this.deps.sendProgress({ exportId: exportSession.id, state: "canceled" });
          const err = new Error("PDF export canceled");
          (err as Error & { code?: string }).code = "EXPORT_CANCELED";
          throw err;
        }
        // Swallow all gate errors (non-fatal for export — sync converges).
        const msg = gateErr instanceof Error ? gateErr.message : String(gateErr);
        console.warn(`[api:build] pre-export sync gate failed (non-fatal): ${msg}`);
      }
      // ── end PDF-export safety gate ──────────────────────────────────────────

      try {
        this.deps.throwIfCanceled(exportSession);
        this.deps.sendProgress({ exportId: exportSession.id, state: "started" });
        const result = await lib.runBuild({
          inputDir: args.input,
          format,
          outDir,
          pdfFileOverride,
          title: args.title,
          pdfxFlavor: args.pdfxFlavor as never,
          iccPath: args.icc,
          manifestPath: args.manifest,
          stripAnnotations: args.stripAnnotations,
          skipLint: args.skipLint,
          skipPreValidate: args.skipPreValidate,
          skipPostValidate: args.skipPostValidate,
          allowShrink: args.allowShrink,
          // Render with Electron's own Chromium.
          engineBrowser: this.deps.engineBrowser,
          rawArgs: { input: args.input, format, out: args.out },
        });
        this.deps.throwIfCanceled(exportSession);
        if (isHtml) {
          // The lib already delivered the bundle into `out`. Authorize
          // revealing it and publishing it as an upload artifact.
          this.deps.registerPickedPath(requestedOutPath);
          this.deps.sendProgress({
            exportId: exportSession.id,
            state: "success",
            message: requestedOutPath,
          });
          return {
            exportId: exportSession.id,
            outDir: requestedOutPath,
            htmlPath: result.htmlPath ?? undefined,
            pdfPath: undefined,
            fingerprintPath: result.fingerprintPath ?? undefined,
            diagnostics: result.diagnostics,
          };
        }
        await this.deps.rename(tempOutPath!, exportSession.outPath);
        // The PDF now exists at the author's chosen destination — authorize
        // revealing it (see `registerPickedPath`'s doc comment). After the
        // rename, so nothing is authorized unless a file was really written.
        this.deps.registerPickedPath(exportSession.outPath);
        this.deps.sendProgress({
          exportId: exportSession.id,
          state: "success",
          message: exportSession.outPath,
        });
        // A desktop export is a one-file delivery, so runBuild reports these as
        // null — book.html and the fingerprint stay in its work dir and are
        // discarded. Normalise to `undefined` for this optional-field contract
        // rather than handing the renderer paths that do not exist.
        return {
          exportId: exportSession.id,
          outDir: result.outDir,
          htmlPath: result.htmlPath ?? undefined,
          pdfPath: exportSession.outPath,
          fingerprintPath: result.fingerprintPath ?? undefined,
          diagnostics: result.diagnostics,
        };
      } catch (e: unknown) {
        if (exportSession.canceled || this.deps.isExportCanceledError(e)) {
          this.deps.sendProgress({ exportId: exportSession.id, state: "canceled" });
          const err = new Error("PDF export canceled");
          (err as Error & { code?: string }).code = "EXPORT_CANCELED";
          throw err;
        }
        // BuildError carries actionable multi-line text from the lib's
        // preflightBuildTools / requireChromiumExecutable — preserve it.
        if (e instanceof lib.BuildError) {
          const err = new Error(e.message);
          (err as Error & { code?: string }).code = "BUILD_ERROR";
          throw err;
        }
        // Generic spawn ENOENT: wrap with a friendlier message identifying
        // the missing tool. (Preflight should have caught this earlier, but
        // some downstream tools — e.g. when a tool exists but errors out —
        // can still surface raw ENOENT here.)
        if (e instanceof Error && (e as Error & { code?: string }).code === "ENOENT") {
          const syscall = (e as Error & { syscall?: string }).syscall ?? "";
          const failedPath = (e as Error & { path?: string }).path ?? "";
          const tool = failedPath || syscall.replace(/^spawn /, "");
          const err = new Error(
            `Required system tool not found: ${tool}\n\n` +
            `Install it and re-run. See User Guide Chapter 7 (examples/gutterpress-user-guide/07-system-setup.md) for per-platform instructions.\n\n` +
            `Underlying error: ${e.message}`
          );
          (err as Error & { code?: string }).code = "TOOL_MISSING";
          throw err;
        }
        this.deps.sendProgress({
          exportId: exportSession.id,
          state: "error",
          message: e instanceof Error ? e.message : String(e),
        });
        throw e;
      } finally {
        this.deps.setActiveExportSession(null);
        if (tempOutPath) await this.deps.rm(tempOutPath).catch(() => {});
      }
    } finally {
      // The workspace is scratch space — only the PDF (renamed into place
      // above) may survive in the author's chosen folder.
      if (workspaceDir) {
        await fsp.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}
