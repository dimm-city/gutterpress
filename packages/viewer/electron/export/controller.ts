/**
 * export/controller.ts — the PDF/HTML export pipeline behind the `api:build` IPC
 * channel, extracted from electron/main.ts as an injectable, unit-testable class.
 *
 * WHY THIS EXISTS
 * ---------------
 * `api:build` used to be a ~200-line god-handler in main.ts closing over module
 * globals (the active export session, the auto-sync orchestrator, the token
 * store, the status emit, the Electron PDF renderer). That made the pre-export
 * sync SAFETY GATE (§5.3 — conflict hard-block, pre-export pull, offline-warn)
 * and the build/cancel/error mapping impossible to unit-test without a full
 * Electron + lib + network stack. This class owns the exact same control flow,
 * but every external touch-point is INJECTED via `deps`, so tests drive it with
 * fakes.
 *
 * The behavior is a faithful move of the original main.ts code: the validation,
 * the safety-gate branches, the temp-file rename, the progress events, and the
 * BuildError/ENOENT/cancel error mapping are preserved verbatim. The live
 * BrowserWindow interaction lives ENTIRELY in the injected `pdfRenderer`
 * (electron/pdf-export.ts) — this controller never touches a window directly.
 *
 * Node/lib-side ONLY — never imported by the renderer.
 */

import path from "node:path";
import { randomUUID } from "node:crypto";
import { preExportSyncGateBlockError } from "../recovery-bridge";
import type { SyncStatusPayload } from "../auto-sync/orchestrator";
import type { ExportProgressEvent, ExportSession } from "../pdf-export";
import type { PdfRenderer, TokenStore } from "@dimm-city/print-md";

type LibModule = typeof import("@dimm-city/print-md");

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
}

export interface ExportBuildResult {
  exportId: string;
  outDir: string;
  htmlPath?: string;
  pdfPath: string;
  fingerprintPath?: string;
}

/** The minimal slice of AutoSyncOrchestrator the pre-export gate needs. */
export interface ExportSyncGate {
  getState(dir: string): { conflictLatched: boolean } | undefined;
  getOrCreateState(dir: string): { conflictLatched: boolean };
  cancelTimer(dir: string): void;
  setLastSyncAt(dir: string, iso: string | null): void;
}

/** External touch-points injected into the controller (all faked in tests). */
export interface ExportControllerDeps {
  /** Lazily load @dimm-city/print-md. Cached by the caller. */
  loadLib: () => Promise<LibModule>;
  /** Credential store passed to lib.diagnoseProjectRemote / lib.syncProject. */
  tokenStore: TokenStore;
  /** Emit a sync status event (used by the pre-export conflict gate). */
  emit: (payload: SyncStatusPayload) => void;
  /** Network reachability (Electron net.isOnline in production). */
  isOnline: () => boolean;
  /** Injectable clock (epoch ms) for gate timestamps. */
  now: () => number;
  /** True when PRINTMD_VIEWER_PUPPETEER opts out of the Electron PDF renderer. */
  usePuppeteer: () => boolean;
  /** Electron-native PDF renderer (electron/pdf-export.ts). */
  pdfRenderer: PdfRenderer;
  /** Auto-sync state accessors (subset of AutoSyncOrchestrator). */
  sync: ExportSyncGate;
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
}

export class ExportController {
  constructor(private readonly deps: ExportControllerDeps) {}

  private nowIso(): string {
    return new Date(this.deps.now()).toISOString();
  }

  /**
   * Run one PDF/HTML export. Mirrors the original `api:build` handler exactly:
   * validate → single-export guard → pre-export sync safety gate → build →
   * atomic rename → progress/error mapping. Throws typed errors
   * (SYNC_CONFLICT / BUILD_ERROR / TOOL_MISSING / EXPORT_CANCELED) identical to
   * the original handler.
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
      throw new Error("Missing 'out' for PDF export");
    }

    // ── PDF-export safety gate (transparent-sync plan §5.3) ──────────────────
    // Before building, check the open project's sync state and act accordingly:
    //   synced / up-to-date  → proceed immediately.
    //   dirty + online       → sync first (so the PDF includes teammate changes).
    //   offline              → proceed but warn (renderer receives a message).
    //   conflict-latched     → block and return a typed error (author must resolve).
    // Only runs when the exported dir is the currently open project and auto-sync
    // is configured (canSync + credential). Local-only projects skip the gate.
    // path.resolve() normalises the export dir to match the autoSyncStates key,
    // which is always normalised at assignment time in startFolderWatch.
    const exportDir = path.resolve(args.input);
    // Use exportDir (already path.resolve'd) as the canonical key into
    // autoSyncStates so both the hard-block read and the mid-gate conflict write
    // (sync.getOrCreateState(exportDir) below) use the same key — regardless
    // of whether exportDir happens to equal watchedDir.
    const exportSyncState = this.deps.sync.getState(exportDir);
    if (exportSyncState?.conflictLatched) {
      // Hard block: the author MUST resolve before a PDF can be trusted.
      const err = new Error(
        "Cannot save a PDF while there are unresolved changes from two places. " +
        "Resolve the conflict first, then try again.",
      );
      (err as Error & { code?: string }).code = "SYNC_CONFLICT";
      throw err;
    }
    // Attempt a pre-export sync when online + canSync. Its only hard effect is
    // the conflict BLOCK below (a PDF must not be built over an unresolved
    // conflict); every other outcome is soft — the PDF uses local content,
    // which is always valid and fully snapshotted. Gate errors are non-fatal.
    try {
      const exportSource = await lib.detectProjectSource(exportDir);
      if (exportSource.type === "local-git-folder") {
        // Credential-aware gate (ADR 0006 D4) — NOT capabilitiesFor().canSync,
        // which is hasRemote-only and would attempt a pre-export syncProject
        // (returning auth) for SSH or uncredentialed-HTTPS projects on every export.
        const exportDiag = await lib.diagnoseProjectRemote(exportDir, {
          tokenStore: this.deps.tokenStore,
        });
        if (exportDiag.canSync && this.deps.isOnline()) {
          const syncOutcome = await lib.syncProject({
            projectDir: exportDir,
            tokenStore: this.deps.tokenStore,
          });
          if (syncOutcome.status === "conflict") {
            // A conflict surfaced mid-export-gate: latch and block.
            const state = this.deps.sync.getOrCreateState(exportDir);
            state.conflictLatched = true;
            this.deps.sync.cancelTimer(exportDir);
            const gateConflictAt = this.nowIso();
            this.deps.sync.setLastSyncAt(exportDir, gateConflictAt);
            this.deps.emit({
              state: "conflict",
              files: syncOutcome.files,
              projectDir: exportDir,
              lastSyncAt: gateConflictAt,
            });
            const conflictErr = new Error(
              "Changes happened in two places. Resolve the conflict first, then save the PDF.",
            );
            (conflictErr as Error & { code?: string }).code = "SYNC_CONFLICT";
            throw conflictErr;
          }
          // synced / up-to-date / offline / auth / error → export proceeds with
          // local content (the ambient pill already reflects the sync state).
        }
      }
    } catch (gateErr) {
      // Re-throw conflict blocks; swallow all other gate errors (non-fatal for export).
      const blockErr = preExportSyncGateBlockError(gateErr);
      if (blockErr) throw blockErr;
      const msg = gateErr instanceof Error ? gateErr.message : String(gateErr);
      console.warn(`[api:build] pre-export sync gate failed (non-fatal): ${msg}`);
    }
    // ── end PDF-export safety gate ────────────────────────────────────────────

    const tempOutPath = `${requestedOutPath}.print-md.tmp.pdf`;
    const { outDir, pdfFileOverride } = lib.splitOutPath(tempOutPath, format);
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
        // Render with Electron's own Chromium unless explicitly opted out.
        pdfRenderer: this.deps.usePuppeteer() ? undefined : this.deps.pdfRenderer,
        rawArgs: { input: args.input, format, out: args.out },
      });
      this.deps.throwIfCanceled(exportSession);
      await this.deps.rename(exportSession.tempOutPath, exportSession.outPath);
      this.deps.sendProgress({
        exportId: exportSession.id,
        state: "success",
        message: exportSession.outPath,
      });
      return {
        exportId: exportSession.id,
        outDir: result.outDir,
        htmlPath: result.htmlPath,
        pdfPath: exportSession.outPath,
        fingerprintPath: result.fingerprintPath,
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
          `Install it and re-run. See User Guide Chapter 8 (examples/print-md-user-guide/08-system-setup.md) for per-platform instructions.\n\n` +
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
      await this.deps.rm(exportSession.tempOutPath).catch(() => {});
    }
  }
}
