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
 * puppeteer-core out of the publish path (CLAUDE.md §2).
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { loadManifestWithPath, resolveConfig } from "../manifest.ts";
import { artifactName, BOOK_HTML, resolveOutputDir } from "../output-paths.ts";
import { publishProviderFor } from "./registry.ts";
import type {
  PreflightIssue,
  PublishArtifact,
  PublishDeps,
  PublishOutcome,
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
 * Resolve the {@link PublishRequest} for a provider from the project's
 * manifest — shared by `runPublish` and by hosts that call individual
 * provider methods (authenticate, listProducts) outside a full publish.
 */
export async function resolvePublishRequest(
  options: Pick<RunPublishOptions, "projectDir" | "providerId" | "manifestPath" | "artifactPath">,
  deps: PublishDeps,
): Promise<PublishRequest> {
  const provider = publishProviderFor(options.providerId);
  const { manifest, manifestDir } = await loadManifestWithPath(
    options.manifestPath ?? options.projectDir,
    { explicit: options.manifestPath !== undefined },
  );
  const config = resolveConfig({}, manifest);
  // The manifest `publish:` section is keyed by the provider id itself —
  // one spelling everywhere (`--provider azure-swa` ↔ `publish.azure-swa:`).
  const publishSettings = (manifest.publish ?? {}) as Record<string, unknown>;
  const providerConfig =
    (publishSettings[provider.info.id] as Record<string, unknown> | undefined) ??
    {};

  // Which SAVED credential (account label) to use for this provider. The
  // book's own manifest (`publish.<id>.credential`) is the most specific and
  // overrides the front-end's project/global default (passed in via
  // `deps.credentialAccount`); empty means the default (bare-host) credential.
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
  const defaultArtifact =
    provider.info.format === "pdf"
      ? path.join(outDir, artifactName(config.title, "pdf"))
      : outDir;
  const artifact: PublishArtifact = {
    path: options.artifactPath
      ? path.resolve(options.projectDir, options.artifactPath)
      : defaultArtifact,
    format: provider.info.format,
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
const HTML_HINT =
  "Build the website export first (gutterpress build --format html).";

/** Artifact-existence checks shared by every provider. */
async function artifactIssues(artifact: PublishArtifact): Promise<PreflightIssue[]> {
  try {
    const s = await stat(artifact.path);
    if (artifact.format === "pdf" && !s.isFile()) {
      return [
        {
          severity: "error",
          id: "publish/artifact-not-file",
          message: `${artifact.path} is not a file. ${PDF_HINT}`,
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
    if (artifact.format === "pdf" && s.size === 0) {
      return [
        {
          severity: "error",
          id: "publish/artifact-empty",
          message: `${artifact.path} is empty. ${PDF_HINT}`,
        },
      ];
    }
    if (artifact.format === "html") {
      return htmlDirIssues(artifact.path);
    }
  } catch {
    const hint = artifact.format === "html" ? HTML_HINT : PDF_HINT;
    return [
      {
        severity: "error",
        id: "publish/artifact-missing",
        message: `No built ${artifact.format === "pdf" ? "PDF" : "HTML export"} at ${artifact.path}. ${hint}`,
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
      message:
        `${dir} also contains ${extras.join(" and ")} — everything in the folder is deployed and becomes publicly downloadable. ` +
        "Use a dedicated output folder for the website (gutterpress build --format html --out <dir>) if that isn't intended.",
    });
  }
  return issues;
}

/** Preflight → authenticate → upload, with structured results throughout. */
export async function runPublish(
  options: RunPublishOptions,
  deps: PublishDeps,
): Promise<RunPublishResult> {
  const provider = publishProviderFor(options.providerId);
  const req = await resolvePublishRequest(options, deps);

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
        ? { error: "Preflight found problems that block publishing." }
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
