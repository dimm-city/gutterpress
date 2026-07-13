/**
 * Publish orchestrator (#35): resolve the project + artifact from the
 * manifest, run the provider's preflight → authenticate → upload pipeline,
 * and return one structured result both front-ends (CLI command, viewer
 * routes) render.
 *
 * The orchestrator does NOT build. Publishing consumes an existing artifact;
 * front-ends that want build-then-publish run `runBuild` first (the CLI's
 * `--build` flag does exactly that). This keeps puppeteer-core out of the
 * publish path (CLAUDE.md §2).
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import { loadManifestWithPath, resolveConfig } from "../manifest.ts";
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
  const { manifest } = await loadManifestWithPath(
    options.manifestPath ?? options.projectDir,
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

  const outDir = path.resolve(options.projectDir, config.output.dir);
  const defaultArtifact =
    provider.info.format === "pdf"
      ? path.join(outDir, config.output.filename)
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

// Host-neutral build hints — the CLI user runs a command, the viewer user
// exports from the app; the message must make sense to both.
const PDF_HINT =
  "Build the PDF first (print-md build, or export it from the app).";
const HTML_HINT =
  "Build the website export first (print-md build --format html).";

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

/**
 * The html "artifact" is a whole directory that gets deployed AS-IS, so it
 * must actually contain the site — and the author must know when unrelated
 * build outputs (the sellable PDF, staged publish packages) would go public
 * with it.
 */
async function htmlDirIssues(dir: string): Promise<PreflightIssue[]> {
  const issues: PreflightIssue[] = [];
  const isThere = async (rel: string) =>
    stat(path.join(dir, rel)).then(
      () => true,
      () => false,
    );
  if (!(await isThere("book.html"))) {
    issues.push({
      severity: "error",
      id: "publish/html-export-missing",
      message: `${dir} has no book.html — it isn't an HTML export. ${HTML_HINT}`,
    });
  }
  const extras = (
    await Promise.all(
      ["book.pdf", "publish"].map(async (rel) =>
        (await isThere(rel)) ? rel : null,
      ),
    )
  ).filter((rel): rel is string => rel !== null);
  if (extras.length > 0) {
    issues.push({
      severity: "warning",
      id: "publish/html-dir-extras",
      message:
        `${dir} also contains ${extras.join(" and ")} — everything in the folder is deployed and becomes publicly downloadable. ` +
        "Use a dedicated output folder for the website (print-md build --format html --out <dir>) if that isn't intended.",
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
