/**
 * export/controller.ts — the quick PDF export (Ctrl+Shift+E) behind the
 * `api:build` IPC channel, as an injectable, unit-testable class: a draft PDF
 * saved where the person chose, as `gutterpress build` makes one. Publishing
 * (checked files for each target) is the lib's publish run (publish-run.ts).
 *
 * Every external touch-point (the active export session, the token store, the
 * progress sender, the Electron PDF renderer, …) is INJECTED via `deps`, so
 * tests drive the pre-export sync SAFETY GATE (§5.3), the temp-file rename,
 * the progress events and the failures with fakes. The live BrowserWindow
 * interaction lives ENTIRELY in the injected `engineBrowser`
 * (electron/engine-browser.ts) — this controller never touches a window
 * directly. Step names and failure explanations are the lib's (ADR 0012).
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
  /** Where to save the PDF: a path the Save dialog just returned, or one inside the book. */
  out?: string;
  /**
   * Proceed past the engine's over-wide-content check instead of failing on
   * it, offered by that failure itself (TOO_WIDE). Opt-in per export — the
   * build still reports the whole-document shrink scale and every offender as
   * diagnostics.
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
  /** The delivered PDF. */
  pdfPath: string;
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
   * The second way an `out` is authorized. Not an escalation — the fs routes
   * already let the renderer write anywhere inside the open book.
   */
  isWithinProject: (absPath: string) => Promise<boolean>;
  /**
   * Record the path this export actually WROTE (the PDF, or the html output
   * folder) as a picked-path capability. `shell/show-in-folder` confines its reveal target to
   * the open project plus the read-only roots, but a Save-dialog destination
   * is deliberately outside the project — so the export's "Show in Folder"
   * toast would otherwise be refused. Registering the path the HOST wrote
   * means the reveal never has to trust a renderer-supplied path. Called only
   * after the PDF is delivered: a failed export authorizes nothing.
   */
  registerPickedPath: (absPath: string) => void;
}

export class ExportController {
  constructor(private readonly deps: ExportControllerDeps) {}

  /**
   * Run one quick PDF export: single-export guard → pre-export sync safety
   * gate → build → atomic rename → progress. A failure is thrown with the
   * lib's code, plain sentence and original text (`detail`); a stop is
   * EXPORT_CANCELED, and an `out` no dialog returned is OUT_NOT_AUTHORIZED.
   */
  async build(args: ExportBuildArgs): Promise<ExportBuildResult> {
    if (!args?.input) throw new Error("Missing 'input'");

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
    // capability by the `dialog:savePdf` route), not merely any absolute path the renderer happens to send —
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
    // the id — lighting up Cancel immediately. When the gate goes on to get the
    // latest changes, a second "started" event labels the pill "Getting the
    // latest changes…" for as long as that takes.

    const tempOutPath = `${requestedOutPath}.Gutterpress.tmp.pdf`;
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
    const workspaceDir = await fsp.mkdtemp(path.join(os.tmpdir(), "Gutterpress-export-"));
    const exportSession: ExportSession = {
      id: randomUUID(),
      canceled: false,
      outPath: requestedOutPath,
      tempOutPath,
      win: null,
    };
    this.deps.setActiveExportSession(exportSession);
    this.deps.sendProgress({ exportId: exportSession.id, state: "started" });

    try {
      // ── PDF-export safety gate (transparent-sync plan §5.3) ────────────────
      // Before building, a local-git project that can sync (canSync, i.e. an
      // HTTPS remote + credential) and is online gets the latest changes first
      // (`push: false`: an export never sends the book anywhere), so the PDF
      // includes teammate changes; anything else builds from local content.
      // Getting them always converges — there is no conflict state to block
      // on; the PDF is built from whatever the converged local content is,
      // which is always valid and fully snapshotted. Gate errors are non-fatal.
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
            this.deps.sendProgress({
              exportId: exportSession.id,
              state: "started",
              message: "Getting the latest changes…",
            });
            const syncOutcome = await lib.syncProject({
              projectDir: exportDir,
              tokenStore: this.deps.tokenStore,
              ...(await this.deps.gitIdentity()),
              push: false,
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
          format: "pdf",
          outDir: workspaceDir,
          pdfFileOverride: path.resolve(tempOutPath),
          // A quick draft, as `gutterpress build` makes one: the checks are
          // the publish run's.
          skipPreValidate: true,
          skipPostValidate: true,
          allowShrink: args.allowShrink,
          // Render with Electron's own Chromium, reporting the render's phase
          // so the author sees more than a ticking clock.
          engineBrowser: lib.renderPhases(this.deps.engineBrowser, (phase) =>
            this.deps.sendProgress({ exportId: exportSession.id, state: phase === "layout" ? "rendering" : "finalizing" }),
          ),
          rawArgs: { input: args.input, format: "pdf", out: args.out },
        });
        this.deps.throwIfCanceled(exportSession);
        await this.deps.rename(tempOutPath, exportSession.outPath);
        // The PDF now exists at the author's chosen destination — authorize
        // revealing it (see `registerPickedPath`'s doc comment). After the
        // rename, so nothing is authorized unless a file was really written.
        this.deps.registerPickedPath(exportSession.outPath);
        this.deps.sendProgress({
          exportId: exportSession.id,
          state: "success",
          message: exportSession.outPath,
        });
        return {
          exportId: exportSession.id,
          outDir: result.outDir,
          pdfPath: exportSession.outPath,
          diagnostics: result.diagnostics,
        };
      } catch (e: unknown) {
        if (exportSession.canceled || this.deps.isExportCanceledError(e)) {
          this.deps.sendProgress({ exportId: exportSession.id, state: "canceled" });
          const err = new Error("PDF export canceled");
          (err as Error & { code?: string }).code = "EXPORT_CANCELED";
          throw err;
        }
        // Why, in the lib's words, with the original text kept as the detail
        // (and the stack, which the app log records).
        const failure = lib.explainBuildFailure(e);
        this.deps.sendProgress({ exportId: exportSession.id, state: "error", message: failure.message });
        const err = Object.assign(new Error(failure.message), {
          code: failure.code,
          ...(failure.detail ? { detail: failure.detail } : {}),
        });
        if (e instanceof Error && e.stack) err.stack = e.stack;
        throw err;
      } finally {
        this.deps.setActiveExportSession(null);
        await this.deps.rm(tempOutPath).catch(() => {});
      }
    } finally {
      // The workspace is scratch space — only the PDF (renamed into place
      // above) may survive in the author's chosen folder.
      await fsp.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
