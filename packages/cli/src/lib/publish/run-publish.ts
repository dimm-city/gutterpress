/**
 * Publish orchestrator (#35): resolve the project + artifact from the
 * manifest, run the provider's preflight → authenticate → upload pipeline,
 * and return one structured result both front-ends (CLI command, desktop
 * routes) render.
 *
 * The orchestrator does NOT build. Publishing consumes an existing artifact;
 * front-ends that want build-then-publish call `runBuild` (build-runner.ts)
 * themselves first — `gutterpress publish` has no build flag of its own, and the
 * desktop's export flow builds via its own Save-PDF pipeline before handing the
 * chosen path to this module as an explicit `artifactPath`. This keeps
 * the engine (and its Chromium launcher) out of the publish path (CLAUDE.md §2).
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { loadManifestWithPath, resolveConfig } from "../manifest.ts";
import { artifactName, BOOK_HTML, resolveOutputDir } from "../output-paths.ts";
import { canonicalTargetId } from "../targets.ts";
import { resolvePublishProvider } from "./plugin-provider.ts";
import { publishProviderFor } from "./registry.ts";
import { publishConnectionStatus } from "./types.ts";
import type {
  PreflightIssue,
  PublishArtifact,
  PublishArtifactFormat,
  PublishDeps,
  PublishOutcome,
  PublishProvider,
  PublishProviderInfo,
  PublishRequest,
} from "./types.ts";

export interface RunPublishOptions {
  projectDir: string;
  providerId: string;
  manifestPath?: string;
  /**
   * Explicit artifact path (a PDF file, or the HTML export directory).
   * Default: the manifest's resolved output location.
   */
  artifactPath?: string;
  /** Stop after preflight — report issues without contacting the platform. */
  dryRun?: boolean;
  /**
   * Provider settings for this run only, laid over the saved ones and never
   * written anywhere: the CLI's `--folder-id` / `--folder` (#452).
   */
  settings?: Record<string, string>;
  /**
   * The provider, when the caller has already resolved it (the CLI does, to
   * map a failed restore to its own exit code): no second lookup or restore.
   * Default: {@link resolvePublishProvider}(`providerId`).
   */
  provider?: PublishProvider;
}

export interface RunPublishResult {
  ok: boolean;
  providerId: string;
  issues: PreflightIssue[];
  /** Present when the upload ran (not on dry runs / preflight failures). */
  outcome?: PublishOutcome;
  /** Friendly failure summary when `ok` is false. */
  error?: string;
}

/**
 * The file a publish request sends (ADR 0012). A target that defines its file
 * (no `info.formats`) always gets `info.format`. One that offers a pick gets
 * the saved `publish.<id>.format` when it is on offer; an unset, invalid or
 * typo'd value is IGNORED and falls back to `info.format` rather than
 * blocking publish with a preflight error over one bad manifest field.
 */
/**
 * A target's settings as the manifest's `publish:` holds them: its own
 * section laid over any section kept under an older name for it.
 */
export function targetSettings(publish: unknown, targetId: string): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  if (!publish || typeof publish !== "object") return merged;
  const sections = Object.entries(publish as Record<string, unknown>).filter(
    ([key, value]) => canonicalTargetId(key) === targetId && value && typeof value === "object",
  );
  // Older names first, so the target's own section wins.
  sections.sort(([a], [b]) => Number(a === targetId) - Number(b === targetId));
  for (const [, section] of sections) Object.assign(merged, section);
  return merged;
}

export function resolvePublishFormat(
  info: PublishProviderInfo,
  providerConfig: Record<string, unknown>,
): PublishArtifactFormat {
  if (info.formats && info.formats.length > 0) {
    const configured =
      typeof providerConfig.format === "string" ? providerConfig.format.trim() : "";
    if (configured && info.formats.includes(configured as PublishArtifactFormat)) {
      return configured as PublishArtifactFormat;
    }
  }
  return info.format;
}

type RequestOptions = Pick<
  RunPublishOptions,
  "projectDir" | "providerId" | "manifestPath" | "artifactPath" | "settings"
>;

/**
 * Resolve the {@link PublishRequest} for a BUILT-IN provider from the
 * project's manifest — for hosts that call individual provider methods
 * (authenticate, listProducts, destinations) outside a full publish.
 */
export async function resolvePublishRequest(
  options: RequestOptions,
  deps: PublishDeps,
): Promise<PublishRequest> {
  return requestFor(publishProviderFor(options.providerId), options, deps);
}

/** The {@link PublishRequest} for an already-resolved provider. */
async function requestFor(
  provider: PublishProvider,
  options: RequestOptions,
  deps: PublishDeps,
): Promise<PublishRequest> {
  const { manifest, manifestDir } = await loadManifestWithPath(
    options.manifestPath ?? options.projectDir,
    { explicit: options.manifestPath !== undefined },
  );
  const config = resolveConfig({}, manifest);
  // The manifest `publish:` section is keyed by the provider id itself —
  // one spelling everywhere (`--provider azure-swa` ↔ `publish.azure-swa:`).
  // The person's PRIVATE values for this book (deps.selections) win over what
  // the manifest shares: this run's, then private, then manifest, then the
  // provider's default.
  // A section under an older name for the target (`drivethrurpg`) still
  // applies, beneath the one under its own.
  const providerConfig = {
    ...targetSettings(manifest.publish, provider.info.id),
    ...((await deps.selections?.settings(options.projectDir))?.[provider.info.id] ?? {}),
    ...options.settings,
  };

  // Which SAVED credential (account label) to use for this provider: the
  // private choice, else the manifest's `publish.<id>.credential` (older
  // books), else the front-end's default (`deps.credentialAccount`); empty
  // means the default (bare-host) credential.
  const bookAccount =
    typeof providerConfig.credential === "string"
      ? providerConfig.credential.trim()
      : "";
  const effectiveAccount = bookAccount || deps.credentialAccount;
  const effectiveDeps: PublishDeps = effectiveAccount
    ? { ...deps, credentialAccount: effectiveAccount }
    : deps;

  // Output location is the shared convention (../output-paths.ts), anchored
  // on the MANIFEST's directory — the same anchor `resolveBuildContext`
  // (build-runner.ts) uses for the build that actually produced the artifact.
  // Previously this resolved against `options.projectDir` instead, which
  // silently disagreed with the build whenever `--manifest` pointed outside
  // the project positional (e.g. a shared manifest one level up) and left
  // publish preflight looking for an artifact in the wrong directory.
  const outDir = resolveOutputDir(manifestDir, config.title);
  const effectiveFormat = resolvePublishFormat(provider.info, providerConfig);
  // Each file has its own name (`-pdf.pdf`, `-pdfx.pdf`), so a target is
  // sent the one it needs, never whichever was built last.
  const defaultArtifact =
    effectiveFormat === "html" ? outDir : path.join(outDir, artifactName(config.title, effectiveFormat));
  const artifact: PublishArtifact = {
    path: options.artifactPath
      ? path.resolve(options.projectDir, options.artifactPath)
      : defaultArtifact,
    format: effectiveFormat,
  };

  return {
    project: {
      projectDir: options.projectDir,
      // Raw manifest values, not resolveConfig's — that fills title with the
      // "Document" placeholder, which would defeat the providers' missing-
      // title preflight checks and end up as a live product name.
      title: manifest.title?.trim() ?? "",
      authors: config.authors,
    },
    config: providerConfig,
    artifact,
    deps: effectiveDeps,
  };
}

// Host-neutral build hints — the CLI user runs a command, the desktop user
// exports from the app; the message must make sense to both.
const PDF_HINT =
  "Build the PDF first (gutterpress build, or export it from the app).";
const PDFX_HINT =
  "Build the PDF/X first (gutterpress build --format pdfx).";
const HTML_HINT =
  "Build the website export first (gutterpress build --format html).";

const SCREEN_HINT = "Publish the book to make it (gutterpress publish, or Publish in the app).";

const ARTIFACT_HINTS: Record<PublishArtifactFormat, string> = {
  pdf: PDF_HINT,
  "pdf-screen": SCREEN_HINT,
  pdfx: PDFX_HINT,
  html: HTML_HINT,
};
const ARTIFACT_NAMES: Record<PublishArtifactFormat, string> = {
  pdf: "PDF",
  "pdf-screen": "PDF for screens",
  pdfx: "PDF/X",
  html: "HTML export",
};

/** Artifact-existence checks shared by every provider. */
async function artifactIssues(artifact: PublishArtifact): Promise<PreflightIssue[]> {
  const hint = ARTIFACT_HINTS[artifact.format];
  try {
    const s = await stat(artifact.path);
    if (artifact.format !== "html" && !s.isFile()) {
      return [
        {
          severity: "error",
          id: "publish/artifact-not-file",
          message: `${artifact.path} is not a file. ${hint}`,
        },
      ];
    }
    if (artifact.format === "html" && !s.isDirectory()) {
      return [
        {
          severity: "error",
          id: "publish/artifact-not-dir",
          message: `${artifact.path} is not a directory. ${HTML_HINT}`,
        },
      ];
    }
    if (artifact.format !== "html" && s.size === 0) {
      return [
        {
          severity: "error",
          id: "publish/artifact-empty",
          message: `${artifact.path} is empty. ${hint}`,
        },
      ];
    }
    if (artifact.format === "html") {
      return htmlDirIssues(artifact.path);
    }
  } catch {
    return [
      {
        severity: "error",
        id: "publish/artifact-missing",
        message: `No built ${ARTIFACT_NAMES[artifact.format]} at ${artifact.path}. ${hint}`,
      },
    ];
  }
  return [];
}

/** The build fingerprint every build writes into its output dir (build-fingerprint.ts's
 * private FINGERPRINT_FILENAME — not exported there, so mirrored here as a literal
 * rather than touching that module for this change). */
const BUILD_FINGERPRINT_FILENAME = "build-fingerprint.json";

/**
 * The html "artifact" is a whole directory that gets deployed AS-IS, so it
 * must actually contain the site — and the author must know when unrelated
 * build outputs would go public with it.
 *
 * Previously this checked a hard-coded two-name list (`book.pdf`, `publish`).
 * Both the PDF filename and the output directory are conventions now
 * (`<title-slug>-pdf.pdf` / `-pdfx.pdf`, see ../output-paths.ts) rather than
 * one fixed name, and `build-fingerprint.json` sits in the same directory
 * unwarned-about — so the gate scans the directory's own entries for
 * anything that LOOKS like a stray build artifact (any `*.pdf` file, or the
 * fingerprint file) instead of matching specific names.
 */
async function htmlDirIssues(dir: string): Promise<PreflightIssue[]> {
  const issues: PreflightIssue[] = [];
  const isThere = async (rel: string) =>
    stat(path.join(dir, rel)).then(
      () => true,
      () => false,
    );
  if (!(await isThere(BOOK_HTML))) {
    issues.push({
      severity: "error",
      id: "publish/html-export-missing",
      message: `${dir} has no ${BOOK_HTML} — it isn't an HTML export. ${HTML_HINT}`,
    });
  }

  const entries = await readdir(dir).catch(() => [] as string[]);
  const extras = entries.filter(
    (name) => name.toLowerCase().endsWith(".pdf") || name === BUILD_FINGERPRINT_FILENAME,
  );
  if (extras.length > 0) {
    issues.push({
      severity: "warning",
      id: "publish/html-dir-extras",
      // This check is shared by every "publish an html export directory"
      // provider (azure-swa and gdrive's zip-upload) — the wording must hold
      // for BOTH "deployed as a live site" and "zipped and uploaded" without
      // assuming either one specifically, rather than being fixed here per new
      // consumer.
      message:
        `${dir} also contains ${extras.join(" and ")} — everything in the folder gets bundled and published along with the website. ` +
        "Use a dedicated output folder for the website (gutterpress build --format html --out <dir>) if that isn't intended.",
    });
  }
  return issues;
}

/**
 * What a target needs before anything is built (ADR 0012 §5, step 1): its
 * file, whether its account is connected, and what its own setup check finds
 * (a missing itch.io page, …). Reads settings only: nothing is contacted and
 * no file need exist yet.
 */
export async function checkTargetSetup(
  provider: PublishProvider,
  options: RequestOptions,
  deps: PublishDeps,
): Promise<{ format: PublishArtifactFormat; connected: boolean; issues: PreflightIssue[] }> {
  const req = await requestFor(provider, options, deps);
  const { connected } = await publishConnectionStatus(provider.info, req.deps);
  return { format: req.artifact.format, connected, issues: await provider.preflight(req) };
}

/** Preflight → authenticate → upload, with structured results throughout. */
export async function runPublish(
  options: RunPublishOptions,
  deps: PublishDeps,
): Promise<RunPublishResult> {
  // Built-in or publishing plugin (experimental, #381). A plugin that can't
  // be found or restored is a result the author reads, not a thrown error.
  let provider: PublishProvider;
  try {
    provider =
      options.provider ??
      (await resolvePublishProvider(options.providerId, {
        projectDir: options.projectDir,
        ...(options.manifestPath !== undefined ? { manifestPath: options.manifestPath } : {}),
      }));
  } catch (e) {
    return {
      ok: false,
      providerId: options.providerId,
      issues: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const req = await requestFor(provider, options, deps);

  const issues = [
    ...(await artifactIssues(req.artifact)),
    ...(await provider.preflight(req)),
  ];
  const hasErrors = issues.some((i) => i.severity === "error");
  if (hasErrors || options.dryRun) {
    return {
      ok: !hasErrors,
      providerId: provider.info.id,
      issues,
      ...(hasErrors
        ? { error: issues.filter((i) => i.severity === "error").map((i) => i.message).join(" ") }
        : {}),
    };
  }

  if (provider.info.credential.required) {
    const auth = await provider.authenticate(req);
    if (!auth.ok) {
      return {
        ok: false,
        providerId: provider.info.id,
        issues,
        error: auth.message ?? "Authentication failed.",
      };
    }
  }

  try {
    const outcome = await provider.upload(req);
    return { ok: true, providerId: provider.info.id, issues, outcome };
  } catch (e) {
    return {
      ok: false,
      providerId: provider.info.id,
      issues,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
