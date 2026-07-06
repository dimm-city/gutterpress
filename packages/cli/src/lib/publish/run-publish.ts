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
import type { PublishSettings } from "../../schema/manifest.types.ts";
import { publishProviderFor } from "./registry.ts";
import type {
  PreflightIssue,
  PublishArtifact,
  PublishDeps,
  PublishOutcome,
  PublishProviderId,
  PublishRequest,
} from "./types.ts";

/** Manifest `publish:` keys per provider id ("azure-swa" → `azureSwa`). */
const MANIFEST_KEYS: Record<PublishProviderId, keyof PublishSettings> = {
  itch: "itch",
  drivethrurpg: "drivethrurpg",
  kdp: "kdp",
  "azure-swa": "azureSwa",
  shopify: "shopify",
};

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

/** The provider's manifest `publish.<key>` section for `projectDir`. */
export function manifestKeyFor(providerId: string): string {
  const key = MANIFEST_KEYS[providerId as PublishProviderId];
  if (!key) throw new Error(`Unknown publish provider "${providerId}".`);
  return key;
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
  const publishSettings = (manifest.publish ?? {}) as Record<string, unknown>;
  const providerConfig =
    (publishSettings[manifestKeyFor(options.providerId)] as
      | Record<string, unknown>
      | undefined) ?? {};

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
      title: config.title,
      authors: config.authors,
    },
    config: providerConfig,
    artifact,
    deps,
  };
}

/** Artifact-existence checks shared by every provider. */
async function artifactIssues(artifact: PublishArtifact): Promise<PreflightIssue[]> {
  try {
    const s = await stat(artifact.path);
    if (artifact.format === "pdf" && !s.isFile()) {
      return [
        {
          severity: "error",
          id: "publish/artifact-not-file",
          message: `${artifact.path} is not a file. Build the PDF first: print-md build`,
        },
      ];
    }
    if (artifact.format === "html" && !s.isDirectory()) {
      return [
        {
          severity: "error",
          id: "publish/artifact-not-dir",
          message: `${artifact.path} is not a directory. Build the site first: print-md build --format html`,
        },
      ];
    }
    if (artifact.format === "pdf" && s.size === 0) {
      return [
        {
          severity: "error",
          id: "publish/artifact-empty",
          message: `${artifact.path} is empty. Rebuild it: print-md build`,
        },
      ];
    }
  } catch {
    const buildHint =
      artifact.format === "html" ? "print-md build --format html" : "print-md build";
    return [
      {
        severity: "error",
        id: "publish/artifact-missing",
        message: `No built ${artifact.format === "pdf" ? "PDF" : "HTML export"} at ${artifact.path}. Build it first: ${buildHint}`,
      },
    ];
  }
  return [];
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
