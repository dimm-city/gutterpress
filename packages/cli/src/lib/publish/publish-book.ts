/**
 * The one publish run (ADR 0012 §5). The terminal (`gutterpress publish`) and
 * the app's Publish view both start it and show what it reports; neither
 * holds a publishing rule of its own.
 *
 * 1. Plan: which targets, each one's file and settings, whether its account is
 *    connected. Settings that would stop a send stop the run here, before the
 *    long build.
 * 2. Get the latest changes, for a book whose online copy Gutterpress can sync.
 * 3. Check the source. Problems that must be fixed stop the run.
 * 4–5. Render once and make each file once into `dist/<slug>/`: the plain PDF
 *    and the PDF/X come from one Chromium render; the website is its own build.
 * 6. Check each PDF against the rules of each target that receives it.
 *    Targets with the same rules share one check run.
 * 7. Send. A target whose file broke its rules is held, alone, unless the
 *    person says to send it anyway.
 *
 * Checks are on unless `skipChecks`. Every failure is explained by
 * explain.ts: a stable code, a plain sentence, the original text.
 */
import path from "node:path";
import { rm } from "node:fs/promises";
import type { BuildDiagnostic } from "../../engine/compiler/build.ts";
import { loadManifestWithPath, resolveConfig } from "../manifest.ts";
import { artifactName, resolveOutputDir } from "../output-paths.ts";
import { canonicalTargetId, hasOwnRules, PDFX_FILE_CHECKS, TARGETS, type TargetFileFormat } from "../targets.ts";
import { explainBuildFailure, explainSendFailure, type Failure } from "./explain.ts";
import { resolvePublishProvider } from "./plugin-provider.ts";
import { UsageError } from "../cli-args.ts";
import { checkTargetSetup, runPublish } from "./run-publish.ts";
import type { PreflightIssue, PublishDeps, PublishOutcome, PublishProvider } from "./types.ts";
import type { ValidationExecutionArgs, ValidationExecutionResult } from "../validation-exec.ts";
import type { BuildRunnerOptions, BuildRunnerResult, EngineBrowser } from "../build-runner.ts";

export type PublishStep = "plan" | "latest" | "source" | "render" | "file" | "check" | "send";

/** What the run is doing now, in words both views show as they are. */
export interface PublishProgress {
  step: PublishStep;
  message: string;
  /** The target this step is for, when it is for one. */
  target?: string;
}

/** One finding of a check, as both views list it. */
export interface CheckFinding {
  checkId: string;
  severity: "error" | "warning" | "info";
  message: string;
  detail?: string;
  /** The target whose rules raised it; absent for the book's own rules. */
  target?: string;
  file?: string;
  line?: number;
  column?: number;
  page?: number;
  edge?: string;
}

export interface PublishedFile {
  format: TargetFileFormat;
  /** The PDF file, or the website's folder. */
  path: string;
}

export type TargetStatus =
  /** Not reached: the run stopped first. */
  | "waiting"
  /** Uploaded. */
  | "sent"
  /** A package made for the person to upload by hand (DriveThruRPG). */
  | "prepared"
  /** Checked and ready (a check-only run). */
  | "checked"
  /** Its file broke its rules; not sent. */
  | "held"
  /** No account connected: its file is ready to upload by hand. */
  | "not-connected"
  /** Its settings or the send failed. */
  | "failed";

export interface TargetResult {
  id: string;
  label: string;
  format: TargetFileFormat;
  status: TargetStatus;
  /** Whether an account is connected (always true for a target that needs none). */
  connected: boolean;
  /** Its file, once made. */
  file?: string;
  /** What the checks found in its file, by its rules. */
  findings: CheckFinding[];
  /** What the target's own setup check found (missing settings, …). */
  issues: PreflightIssue[];
  outcome?: PublishOutcome;
  failure?: Failure;
}

export interface PublishBookResult {
  /** Every target was sent or prepared; for a check-only run, none was held or failed. */
  ok: boolean;
  /** Why the whole run stopped, when it did. */
  failure?: Failure;
  files: PublishedFile[];
  targets: TargetResult[];
  /** What checking the source found (step 3). */
  sourceFindings: CheckFinding[];
  /** The render's own print-quality notes. */
  diagnostics: BuildDiagnostic[];
}

export interface PublishBookOptions {
  projectDir: string;
  manifestPath?: string;
  /**
   * The targets to publish. Default: the book's targets, less the ones the
   * person has turned off for themselves (`send: off` in their own settings).
   */
  targets?: string[];
  /** Make and check the files; send nothing. */
  checkOnly?: boolean;
  /** Run no checks (the one switch). */
  skipChecks?: boolean;
  /** Send these targets (`true`: every target) even when their file broke their rules. */
  sendAnyway?: string[] | true;
  /**
   * Settings for this run only, by target (a Drive folder, a `local` folder),
   * laid over the saved ones and never saved.
   */
  runSettings?: Record<string, Record<string, string>>;
  /** Build past the too-wide-content check (the whole book shrinks to fit). */
  allowShrink?: boolean;
  /** The app's own Chromium; the terminal launches one. */
  engineBrowser?: () => Promise<EngineBrowser>;
  onProgress?: (progress: PublishProgress) => void;
  signal?: AbortSignal;
}

export interface PublishBookDeps extends PublishDeps {
  /** Who a snapshot made while getting the latest changes is by. */
  identity?: { authorName?: string; authorEmail?: string };
  /** Seams for tests; the real ones by default. */
  runBuild?: (opts: BuildRunnerOptions) => Promise<BuildRunnerResult>;
  executeValidation?: (args: ValidationExecutionArgs) => Promise<ValidationExecutionResult>;
  getLatest?: (projectDir: string) => Promise<void>;
}

const FORMAT_NAMES: Record<TargetFileFormat, string> = { pdf: "PDF", pdfx: "PDF/X", html: "website" };

class Stopped extends Error {
  constructor(readonly failure: Failure) {
    super(failure.message);
  }
}

interface Planned {
  /** The name the target was asked for by (an old id resolves to its target). */
  asked: string;
  provider: PublishProvider;
  result: TargetResult;
}

export async function publishBook(options: PublishBookOptions, deps: PublishBookDeps): Promise<PublishBookResult> {
  const result: PublishBookResult = { ok: false, files: [], targets: [], sourceFindings: [], diagnostics: [] };
  const say = (step: PublishStep, message: string, target?: string) =>
    options.onProgress?.({ step, message, ...(target ? { target } : {}) });
  const stopIfCanceled = () => {
    if (options.signal?.aborted) throw new Stopped({ code: "CANCELED", message: "" });
  };

  try {
    // ── 1. Plan ──────────────────────────────────────────────────────────────
    say("plan", "Getting ready…");
    const { manifest, manifestPath, manifestDir } = await loadManifestWithPath(
      options.manifestPath ?? options.projectDir,
      { explicit: options.manifestPath !== undefined },
    ).catch((e: unknown) => {
      throw new Stopped({ code: "NO_MANIFEST", message: e instanceof Error ? e.message : String(e) });
    });
    if (!manifestPath) {
      throw new Stopped({
        code: "NO_MANIFEST",
        message: 'Publishing needs the book\'s manifest.yaml. Choose "Set up as a book" first.',
      });
    }
    const config = resolveConfig({}, manifest);
    const ids = options.targets?.length
      ? options.targets
      : (await publishPlan({ projectDir: options.projectDir, ...(options.manifestPath ? { manifestPath: options.manifestPath } : {}) }, deps.selections)).sending;
    if (ids.length === 0) {
      throw new Stopped({
        code: "NO_TARGETS",
        message: "This book has no publishing targets yet. Add one under publish: in manifest.yaml, or in the app's Publish view.",
      });
    }
    const book = { projectDir: options.projectDir, ...(options.manifestPath ? { manifestPath: options.manifestPath } : {}) };
    const planned: Planned[] = [];
    for (const id of [...new Set(ids)]) {
      let provider: PublishProvider;
      try {
        provider = await resolvePublishProvider(id, book);
      } catch (e) {
        // An unknown name is the person's to fix; a plugin that could not be
        // restored is the book failing to load.
        if (e instanceof UsageError) throw new Stopped({ code: "UNKNOWN_TARGET", message: e.message });
        throw new Stopped({ ...explainBuildFailure(e), message: e instanceof Error ? e.message : String(e) });
      }
      const settings = options.runSettings?.[provider.info.id];
      const setup = await checkTargetSetup(
        provider,
        {
          projectDir: options.projectDir,
          providerId: provider.info.id,
          ...(options.manifestPath ? { manifestPath: options.manifestPath } : {}),
          ...(settings ? { settings } : {}),
        },
        deps,
      );
      planned.push({
        asked: id,
        provider,
        result: {
          id: provider.info.id,
          label: provider.info.label,
          format: setup.format,
          status: "waiting",
          connected: setup.connected,
          findings: [],
          issues: setup.issues,
        },
      });
    }
    result.targets = planned.map((p) => p.result);
    const unready = planned.filter((p) => p.result.issues.some((i) => i.severity === "error"));
    for (const p of unready) {
      p.result.status = "failed";
      p.result.failure = {
        code: "SETUP_INCOMPLETE",
        message: `${p.result.label} needs setting up first: ${p.result.issues.filter((i) => i.severity === "error").map((i) => i.message).join(" ")}`,
      };
    }
    if (unready.length > 0 && !options.checkOnly) {
      throw new Stopped({
        code: "SETUP_INCOMPLETE",
        message: `Finish setting up ${unready.map((p) => p.result.label).join(", ")} before publishing.`,
      });
    }

    // ── 2. Get the latest ───────────────────────────────────────────────────
    stopIfCanceled();
    await (deps.getLatest ?? ((dir) => getLatestChanges(dir, deps, () => say("latest", "Getting the latest changes…"))))(
      options.projectDir,
    ).catch((e: unknown) => deps.onProgress?.(`Could not get the latest changes; publishing what is here: ${String(e)}`));

    const validate = deps.executeValidation ?? (await import("../validation-exec.ts")).executeValidation;
    const targetIds = planned.map((p) => p.result.id);
    // The checks know the built-in targets; an extension's target adds no rules.
    const checkedIds = targetIds.filter((id) => TARGETS[canonicalTargetId(id)]);

    // ── 3. Check the source ─────────────────────────────────────────────────
    if (!options.skipChecks) {
      stopIfCanceled();
      say("source", "Checking the book…");
      const execution = await validate({
        input: options.projectDir,
        ...(options.manifestPath ? { manifest: options.manifestPath } : {}),
        phase: "pre-build",
        target: checkedIds.join(","),
      });
      result.sourceFindings = findingsOf(execution);
      const blocking = result.sourceFindings.filter((f) => f.severity === "error");
      if (blocking.length > 0) {
        throw new Stopped({
          code: "SOURCE_PROBLEMS",
          message: `The book has ${blocking.length} problem${blocking.length === 1 ? "" : "s"} to fix before it can be published.`,
        });
      }
    }

    // ── 4–5. Render once, make each file once ───────────────────────────────
    const formats = new Set(planned.map((p) => p.result.format));
    const build = deps.runBuild ?? (await import("../build-runner.ts")).runBuild;
    const files = new Map<TargetFileFormat, string>();
    const common: Omit<BuildRunnerOptions, "format"> = {
      inputDir: options.projectDir,
      ...(options.manifestPath ? { manifestPath: options.manifestPath } : {}),
      // The run does its own checks, against each target's rules.
      skipPreValidate: true,
      skipPostValidate: true,
      signal: options.signal,
      ...(options.allowShrink ? { allowShrink: true } : {}),
      rawArgs: { command: "publish", targets: targetIds },
    };
    const buildPdf = async (format: "pdf" | "pdfx", withPlainPdf: boolean, onConverting: () => void) => {
      const built = await build({
        ...common,
        format,
        ...(withPlainPdf ? { withPlainPdf: true } : {}),
        engineBrowser: renderPhases(options.engineBrowser ?? launchOwnChromium, (phase) =>
          say("render", phase === "layout" ? "Laying out the pages…" : "Writing the PDF…"),
        ),
        onStep: () => {
          onConverting();
          say("file", "Converting to print colours (PDF/X)…");
        },
      });
      result.diagnostics.push(...built.diagnostics);
      if (built.pdfPath) files.set(format, built.pdfPath);
      if (built.plainPdfPath) files.set("pdf", built.plainPdfPath);
    };
    const pdfFormat = formats.has("pdfx") ? "pdfx" : formats.has("pdf") ? "pdf" : null;
    if (pdfFormat) {
      stopIfCanceled();
      const what = pdfFormat === "pdfx" && formats.has("pdf") ? "PDF and PDF/X" : FORMAT_NAMES[pdfFormat];
      let converting = false;
      try {
        await buildPdf(pdfFormat, pdfFormat === "pdfx" && formats.has("pdf"), () => (converting = true));
      } catch (e) {
        const failure = explainBuildFailure(e, what);
        // A problem only the PDF/X has (its conversion, or the programs only
        // it needs) fails the targets that take the PDF/X, not the run.
        if (pdfFormat !== "pdfx" || failure.code === "CANCELED" || !(converting || failure.code === "TOOL_MISSING")) {
          throw new Stopped(failure);
        }
        const pdfxFailure = explainBuildFailure(e, "PDF/X");
        for (const p of planned) {
          if (p.result.format !== "pdfx") continue;
          p.result.status = "failed";
          p.result.failure = pdfxFailure;
        }
        if (formats.has("pdf")) {
          stopIfCanceled();
          try {
            await buildPdf("pdf", false, () => {});
          } catch (e2) {
            throw new Stopped(explainBuildFailure(e2, "PDF"));
          }
        }
        formats.delete("pdfx");
      }
    }
    const outDir = resolveOutputDir(manifestDir, config.title);
    // The website is sent as a whole folder, so it gets one of its own: the
    // book's output folder also holds its PDFs and upload packages. The
    // build's record of itself (paths on this computer) is left out too.
    const siteDir = `${outDir}-website`;
    if (formats.has("html")) {
      stopIfCanceled();
      say("file", "Making the website…");
      try {
        await rm(siteDir, { recursive: true, force: true });
        const built = await build({ ...common, format: "html", outDir: siteDir });
        await rm(path.join(built.outDir, "build-fingerprint.json"), { force: true });
        files.set("html", built.outDir);
      } catch (e) {
        throw new Stopped(explainBuildFailure(e, "website"));
      }
    }
    // Files the build placed by name, in case a build reports none.
    for (const format of formats) {
      if (!files.has(format)) files.set(format, format === "html" ? siteDir : path.join(outDir, artifactName(config.title, format)));
    }
    result.files = [...files].map(([format, file]) => ({ format, path: file }));
    for (const p of planned) p.result.file = files.get(p.result.format);

    // ── 6. Check each file against its targets' rules ───────────────────────
    if (!options.skipChecks) {
      for (const [format, file] of files) {
        if (format === "html") continue;
        for (const group of byRules(planned.filter((p) => p.result.format === format))) {
          stopIfCanceled();
          say("check", `Checking the ${FORMAT_NAMES[format]} for ${group.map((p) => p.result.label).join(", ")}…`);
          let findings: CheckFinding[];
          try {
            findings = findingsOf(
              await validate({
                input: options.projectDir,
                pdf: file,
                ...(options.manifestPath ? { manifest: options.manifestPath } : {}),
                phase: "post-build",
                target: group.map((p) => p.result.id).filter((id) => checkedIds.includes(id)).join(","),
                // Only the PDF/X is held to what only a PDF/X can pass.
                ...(format === "pdfx" ? {} : { skip: PDFX_FILE_CHECKS.join(",") }),
                pluginStylePaths: [],
              }),
            );
          } catch (e) {
            findings = [
              {
                checkId: "publish.checks",
                severity: "error",
                message: `The ${FORMAT_NAMES[format]} was made, but its checks could not run: ${e instanceof Error ? e.message : String(e)}`,
              },
            ];
          }
          // A finding about the file itself names no file: the target's result
          // already names it, and a PDF has no line for either view to go to.
          findings = findings.map((f) => {
            if (!f.file || path.resolve(options.projectDir, f.file) !== path.resolve(file)) return f;
            const { file: _madeFile, ...rest } = f;
            return rest;
          });
          for (const p of group) {
            p.result.findings = findings.filter((f) => !f.target || f.target === p.result.id);
          }
        }
      }
    }

    // ── 7. Send ─────────────────────────────────────────────────────────────
    const anyway = new Set(options.sendAnyway === true ? planned.map((p) => p.result.id) : (options.sendAnyway ?? []));
    for (const p of planned) {
      const r = p.result;
      if (r.status === "failed") continue;
      const broken = r.findings.filter((f) => f.severity === "error");
      if (broken.length > 0 && !anyway.has(r.id) && !anyway.has(p.asked)) {
        r.status = "held";
        r.failure = {
          code: "CHECKS_FAILED",
          message: `Held back: the ${FORMAT_NAMES[r.format]} breaks ${broken.length} rule${broken.length === 1 ? "" : "s"} it was checked against.`,
        };
        continue;
      }
      if (!r.connected) {
        r.status = "not-connected";
        r.failure = {
          code: "NOT_CONNECTED",
          message: `No ${r.label} account is connected, so it was not sent. The file is ready to upload by hand${r.file ? `: ${r.file}` : "."}`,
        };
        continue;
      }
      if (options.checkOnly) {
        r.status = "checked";
        continue;
      }
      stopIfCanceled();
      say("send", `Sending to ${r.label}…`, r.id);
      const sent = await runPublish(
        {
          projectDir: options.projectDir,
          providerId: r.id,
          provider: p.provider,
          ...(options.manifestPath ? { manifestPath: options.manifestPath } : {}),
          ...(r.file ? { artifactPath: r.file } : {}),
          ...(options.runSettings?.[r.id] ? { settings: options.runSettings[r.id] } : {}),
        },
        options.signal ? { ...deps, signal: options.signal } : deps,
      );
      r.issues = [...r.issues, ...sent.issues.filter((i) => !r.issues.some((j) => j.id === i.id))];
      if (sent.ok && sent.outcome) {
        r.outcome = sent.outcome;
        r.status = sent.outcome.kind === "guided" ? "prepared" : "sent";
      } else {
        r.status = "failed";
        r.failure = explainSendFailure(sent.error ?? "", r.label);
      }
    }
    result.ok = options.checkOnly
      ? result.targets.every((t) => t.status === "checked" || t.status === "not-connected")
      : result.targets.every((t) => t.status === "sent" || t.status === "prepared");
    return result;
  } catch (e) {
    // Stopping a render closes its window, so the build fails: that is the cancel.
    result.failure = options.signal?.aborted
      ? { code: "CANCELED", message: "" }
      : e instanceof Stopped
        ? e.failure
        : explainBuildFailure(e);
    result.ok = false;
    return result;
  }
}

/**
 * The book's plan as one person sees it: the book's targets (`publish:`, the
 * team's), and the ones they are sending this time — all but those their own
 * settings for the book turn off (`send: off`).
 */
export async function publishPlan(
  book: { projectDir: string; manifestPath?: string },
  selections?: PublishDeps["selections"],
): Promise<{ targets: string[]; sending: string[] }> {
  const { manifest } = await loadManifestWithPath(book.manifestPath ?? book.projectDir, {
    explicit: book.manifestPath !== undefined,
  });
  const targets = resolveConfig({}, manifest).targets;
  const mine = (await selections?.settings(book.projectDir)) ?? {};
  return { targets, sending: targets.filter((id) => mine[id]?.send !== "off") };
}

/** Targets that are checked by the same rules, together. */
function byRules(planned: Planned[]): Planned[][] {
  const groups = new Map<string, Planned[]>();
  for (const p of planned) {
    const target = TARGETS[canonicalTargetId(p.result.id)];
    const key = target && hasOwnRules(target) ? JSON.stringify([target.overlay, target.requiredChecks]) : "book";
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.values()];
}

/** A check run's findings, plus one note per check a missing program kept from running. */
function findingsOf(execution: Pick<ValidationExecutionResult, "report" | "tools">): CheckFinding[] {
  const findings: CheckFinding[] = execution.report.results.map((r) => {
    const page = r.data?.page;
    const edge = r.data?.edge;
    return {
      checkId: r.checkId,
      severity: r.severity,
      message: r.message,
      ...(r.detail ? { detail: r.detail } : {}),
      ...(r.target ? { target: r.target } : {}),
      ...(r.file ? { file: r.file } : {}),
      ...(typeof r.line === "number" ? { line: r.line } : {}),
      ...(typeof r.column === "number" ? { column: r.column } : {}),
      ...(typeof page === "number" ? { page } : {}),
      ...(typeof edge === "string" ? { edge } : {}),
    };
  });
  const reported = new Set(findings.map((f) => f.checkId));
  const skipped = new Set(execution.tools.skippedChecks);
  for (const tool of execution.tools.missing) {
    for (const checkId of execution.tools.toolToChecks.get(tool) ?? []) {
      if (!skipped.has(checkId) || reported.has(checkId)) continue;
      reported.add(checkId);
      findings.push({ checkId, severity: "info", message: `Skipped: ${tool} is not installed on this computer.` });
    }
  }
  return findings;
}

async function launchOwnChromium(): Promise<EngineBrowser> {
  return (await import("../../engine/shared/cdp.ts")).launchChromium();
}

/**
 * Report the render's phase: "layout" when a page starts loading the book,
 * "writing" when Chromium writes the PDF. Pages are laid out at print time,
 * so these are the progress there is to report. Phases only move forward.
 */
export function renderPhases(
  factory: () => Promise<EngineBrowser>,
  onPhase: (phase: "layout" | "writing") => void,
): () => Promise<EngineBrowser> {
  let reached: "none" | "layout" | "writing" = "none";
  const advance = (phase: "layout" | "writing") => {
    if (reached === "writing" || reached === phase) return;
    reached = phase;
    onPhase(phase);
  };
  return async () => {
    const browser = await factory();
    const newPage = browser.newPage.bind(browser);
    browser.newPage = async () => {
      const page = await newPage();
      const navigate = page.navigate.bind(page);
      const printToPDF = page.printToPDF.bind(page);
      page.navigate = async (url) => {
        advance("layout");
        return navigate(url);
      };
      page.printToPDF = async (opts) => {
        advance("writing");
        return printToPDF(opts);
      };
      return page;
    };
    return browser;
  };
}

/**
 * Bring in the online copy's latest changes before making the files, for a
 * book whose online copy Gutterpress can sync (connected and reachable).
 * Nothing is sent: a publish never pushes the book. Any other book is
 * published as it is on this computer.
 */
async function getLatestChanges(projectDir: string, deps: PublishBookDeps, starting: () => void): Promise<void> {
  const { detectProjectSource } = await import("../project-source.ts");
  const source = await detectProjectSource(projectDir);
  if (source.type !== "local-git-folder") return;
  const { diagnoseProjectRemote } = await import("../remote-auth/diagnose.ts");
  const diagnosis = await diagnoseProjectRemote(projectDir, { tokenStore: deps.tokenStore });
  if (!diagnosis.canSync) return;
  starting();
  const { syncProject } = await import("../remote-auth/sync.ts");
  await syncProject({ projectDir, tokenStore: deps.tokenStore, push: false, ...deps.identity });
}
