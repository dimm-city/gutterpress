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
import type { GitIdentityArgs } from "../git-identity";
import type { ExportProgressEvent, ExportSession } from "../pdf-export";
import type { ConflictFile, PdfRenderer, TokenStore } from "@dimm-city/print-md";

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

/**
 * The minimal slice of AutoSyncOrchestrator the pre-export gate needs — two
 * methods, both owned by the orchestrator itself: a read (isConflictLatched)
 * and the ONE mutation surface (latchConflict), which also cancels the
 * project's timers, stamps lastSyncAt, and emits the conflict status. Finding
 * #7 (2026-07-10 architecture review): this used to be `getState`/
 * `getOrCreateState` returning the orchestrator's mutable state bag directly,
 * which let the gate below reach in and hand-write `conflictLatched`.
 */
export interface ExportSyncGate {
  isConflictLatched(dir: string): boolean;
  latchConflict(dir: string, files: ConflictFile[]): void;
}

/** External touch-points injected into the controller (all faked in tests). */
export interface ExportControllerDeps {
  /** Lazily load @dimm-city/print-md. Cached by the caller. */
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
  /**
   * Authorize AND consume (one-time) a `SavePathHooks` capability for the
   * requested `out` path (finding #4, 2026-07-13 maintainer review). Must
   * return `true` only for a path the `dialog:savePdf` route itself just
   * registered — i.e. one the native Save dialog actually returned — and
   * `false` for anything else (never chosen, already consumed, or expired).
   * `api:build` refuses to write/rename onto an `out` this rejects, closing
   * the arbitrary-file-overwrite gap where a renderer-controlled `out` was
   * previously trusted with no proof it came from the Save dialog.
   */
  consumeSavePath: (absPath: string) => boolean;
}

export class ExportController {
  constructor(private readonly deps: ExportControllerDeps) {}

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
    // Finding #4 (2026-07-13 maintainer review): `out` must be a path the
    // native Save dialog itself just returned (registered as a one-time
    // capability by the `dialog:savePdf` route), not merely any absolute
    // path the renderer happens to send. Checked BEFORE the session is
    // minted below, so an unauthorized `out` never occupies the single-export
    // slot or emits a progress event. Consuming here (not just checking) means
    // a second `api:build` call replaying the same `out` — without a fresh
    // Save dialog round-trip — is rejected too.
    if (!this.deps.consumeSavePath(requestedOutPath)) {
      const err = new Error(
        "The PDF's save location wasn't chosen via the Save dialog. " +
        "Use \"Save PDF\" and pick a destination, then try again.",
      );
      (err as Error & { code?: string }).code = "OUT_NOT_AUTHORIZED";
      throw err;
    }

    // Mint the session and register it as active BEFORE the pre-export sync
    // safety gate below (M28). The exportId used to only exist AFTER the gate
    // finished, so Cancel — gated on the renderer knowing an exportId at all —
    // stayed dead through a slow/flaky network sync, leaving an uncancelable
    // "Preparing PDF…" stall. Sending this "started" progress event right away
    // (reusing the existing wire state + free-text `message` field rather than
    // adding a new state value, so ExportProgressEvent's `state` union is
    // unchanged end-to-end) lets the renderer adopt the id — lighting up
    // Cancel immediately — and label the pill "Syncing latest changes…" for
    // as long as the gate takes.
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
    this.deps.sendProgress({
      exportId: exportSession.id,
      state: "started",
      message: "Syncing latest changes…",
    });

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
    // Use exportDir (already path.resolve'd) as the canonical key into the
    // orchestrator's state map so both the hard-block read and the mid-gate
    // conflict latch below use the same key — regardless of whether exportDir
    // happens to equal watchedDir.
    if (this.deps.sync.isConflictLatched(exportDir)) {
      // Hard block: the author MUST resolve before a PDF can be trusted.
      this.deps.setActiveExportSession(null);
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
      this.deps.throwIfCanceled(exportSession);
      if (exportSource.type === "local-git-folder") {
        // Credential-aware gate (ADR 0006 D4) — NOT capabilitiesFor().canSync,
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
          if (syncOutcome.status === "conflict") {
            // A conflict surfaced mid-export-gate: latch (cancels timers,
            // stamps lastSyncAt, and emits the conflict status) and block.
            this.deps.sync.latchConflict(exportDir, syncOutcome.files);
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
      // M28: a Cancel click during the gate — the exportId now exists this
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
      // Re-throw conflict blocks; swallow all other gate errors (non-fatal for export).
      const blockErr = preExportSyncGateBlockError(gateErr);
      if (blockErr) {
        this.deps.setActiveExportSession(null);
        throw blockErr;
      }
      const msg = gateErr instanceof Error ? gateErr.message : String(gateErr);
      console.warn(`[api:build] pre-export sync gate failed (non-fatal): ${msg}`);
    }
    // ── end PDF-export safety gate ────────────────────────────────────────────

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
