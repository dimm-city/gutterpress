/**
 * Azure Static Web Apps publish provider (#35) — deploys the HTML static-site
 * export via the SWA CLI (`swa deploy`), Azure's only supported deployment
 * surface for SWA (there is no raw REST/ZIP endpoint; the CLI wraps the
 * Oryx/Kudu pipeline).
 *
 * The SWA CLI is an npm tool aimed at web developers; unlike butler we do NOT
 * auto-download it (it needs a Node runtime anyway) — we locate `swa` on the
 * PATH (or $SWA_CLI_PATH) and give friendly install guidance when missing.
 *
 * Auth: the deployment token, via SWA_CLI_DEPLOYMENT_TOKEN in the child env
 * (never argv). Token source: injected TokenStore (host "azure-swa") or the
 * same env var in CI.
 */
import { commandExists, defaultCommandRunner } from "../command-runner.ts";
import {
  resolvePublishCredential,
  type PreflightIssue,
  type PublishAuthStatus,
  type PublishOutcome,
  type PublishProvider,
  type PublishProviderInfo,
  type PublishRequest,
} from "../types.ts";

export const AZURE_SWA_HOST = "azure-swa";

const info: PublishProviderInfo = {
  id: "azure-swa",
  label: "Azure Static Web Apps",
  kind: "api",
  format: "html",
  description:
    "Deploy the HTML export as a website on Azure Static Web Apps (requires the SWA CLI).",
  configFields: [{ key: "env", label: "Environment", placeholder: "production" }],
  credential: {
    required: true,
    host: AZURE_SWA_HOST,
    envVar: "SWA_CLI_DEPLOYMENT_TOKEN",
    tokenUrl:
      "https://learn.microsoft.com/azure/static-web-apps/deployment-token-management",
    hint: "Paste the app's deployment token (Azure portal → your Static Web App → Manage deployment token).",
  },
};

async function resolveSwaCommand(req: PublishRequest): Promise<string | null> {
  const env = req.deps.env ?? process.env;
  const explicit = env.SWA_CLI_PATH?.trim();
  if (explicit) return explicit;
  const run = req.deps.runCommand ?? defaultCommandRunner;
  return (await commandExists("swa", run, req.deps.env)) ? "swa" : null;
}

const SWA_INSTALL_HINT =
  "Install the Azure SWA CLI first: `npm install -g @azure/static-web-apps-cli` " +
  "(needs Node.js), or set SWA_CLI_PATH to the swa binary.";

export const azureSwaProvider: PublishProvider = {
  info,

  async authenticate(req): Promise<PublishAuthStatus> {
    const resolved = await resolvePublishCredential(info, req.deps);
    if (!resolved) {
      return {
        ok: false,
        message:
          "No Azure deployment token found. Connect Azure Static Web Apps (or set SWA_CLI_DEPLOYMENT_TOKEN) first.",
      };
    }
    if (!(await resolveSwaCommand(req))) {
      return { ok: false, source: resolved.source, message: SWA_INSTALL_HINT };
    }
    // The deployment token is only verifiable by deploying; report presence.
    return { ok: true, source: resolved.source };
  },

  async preflight(req): Promise<PreflightIssue[]> {
    const issues: PreflightIssue[] = [];
    if (req.artifact.format !== "html") {
      issues.push({
        severity: "error",
        id: "azure-swa/needs-html",
        message:
          "Azure Static Web Apps publishes the HTML export. Build with `print-md build --format html` first.",
      });
    }
    if (!(await resolveSwaCommand(req))) {
      issues.push({
        severity: "error",
        id: "azure-swa/cli-missing",
        message: SWA_INSTALL_HINT,
      });
    }
    return issues;
  },

  async upload(req): Promise<PublishOutcome> {
    const resolved = await resolvePublishCredential(info, req.deps);
    if (!resolved) {
      throw new Error(
        "No Azure deployment token found. Connect Azure Static Web Apps (or set SWA_CLI_DEPLOYMENT_TOKEN) first.",
      );
    }
    const swa = await resolveSwaCommand(req);
    if (!swa) throw new Error(SWA_INSTALL_HINT);

    const cfg = req.config as { env?: string };
    const deployEnv = cfg.env?.trim() || "production";
    const run = req.deps.runCommand ?? defaultCommandRunner;
    req.deps.onProgress?.(`Deploying ${req.artifact.path} to Azure SWA (${deployEnv})…`);
    const result = await run(
      swa,
      ["deploy", req.artifact.path, "--env", deployEnv],
      {
        env: { SWA_CLI_DEPLOYMENT_TOKEN: resolved.credential.token },
        onOutput: req.deps.onProgress,
        // Idle timeout (audit B2): the runner defaults timeoutMs to
        // PUBLISH_IDLE_TIMEOUT_MS — only total output silence kills the deploy.
      },
    );
    if (result.code !== 0) {
      const tail = (result.stderr || result.stdout).trim().split("\n").slice(-3).join("\n");
      throw new Error(
        `swa deploy failed (exit ${result.code}).${tail ? `\n${tail}` : ""}`,
      );
    }
    // The SWA CLI prints the site URL on success; surface it when present.
    const urlMatch = result.stdout.match(/https:\/\/[^\s"']+\.azurestaticapps\.net[^\s"']*/);
    return {
      kind: "published",
      ...(urlMatch ? { url: urlMatch[0] } : {}),
      detail: `Deployed the HTML export to Azure Static Web Apps (${deployEnv}).`,
    };
  },
};
