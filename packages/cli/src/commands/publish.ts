import { defineCommand } from "citty";
import path from "node:path";
import {
  log,
  FileTokenStore,
  listPublishProviders,
  publishProviderFor,
  resolvePublishRequest,
  runPublish,
  openPath,
  type PublishDeps,
  type RunPublishResult,
} from "../index.ts";

/**
 * `print-md publish` (#35) — push a built artifact to a publishing platform,
 * headlessly (CI-safe). One command, four modes:
 *
 *   print-md publish --list                         # providers + connection status
 *   print-md publish --provider itch --connect      # store an API key (token via
 *                                                   #   --token, env var, or piped stdin)
 *   print-md publish --provider itch --disconnect   # forget the stored key
 *   print-md publish --provider itch [dir]          # publish (add --dry-run / --json)
 *
 * Credentials live in the 0600 user-config credential store (never in the
 * project); provider env vars (BUTLER_API_KEY, SWA_CLI_DEPLOYMENT_TOKEN,
 * SHOPIFY_ADMIN_TOKEN) override it for CI.
 */

async function readTokenFromStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

function emitResult(result: RunPublishResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  for (const issue of result.issues) {
    const line = `[${issue.id}] ${issue.message}`;
    if (issue.severity === "error") log.error(line);
    else if (issue.severity === "warning") log.warn(line);
    else log.info(line);
  }
  if (!result.ok) {
    log.error(result.error ?? "Publish failed.");
    return;
  }
  const outcome = result.outcome;
  if (!outcome) {
    log.success("Preflight passed — ready to publish.");
    return;
  }
  if (outcome.kind === "published") {
    log.success(outcome.detail ?? "Published.");
    if (outcome.url) log.info(`View it at: ${outcome.url}`);
    for (const step of outcome.followUp ?? []) log.info(`Next: ${step}`);
  } else {
    log.success(outcome.detail ?? "Upload package prepared.");
    log.info(`Package folder: ${outcome.packageDir}`);
    log.info(`Upload page:    ${outcome.openUrl}`);
    outcome.checklist.forEach((step, i) => log.info(`  ${i + 1}. ${step}`));
  }
}

export default defineCommand({
  meta: {
    name: "publish",
    description:
      "Publish the built PDF/HTML to a platform (itch.io, DriveThruRPG, Amazon KDP, Azure Static Web Apps, Shopify)",
  },
  args: {
    project: {
      type: "positional",
      description: "Project directory (default: cwd)",
      required: false,
    },
    provider: {
      type: "string",
      description: "Provider id: itch | drivethrurpg | kdp | azure-swa | shopify",
    },
    list: { type: "boolean", description: "List providers and connection status" },
    connect: {
      type: "boolean",
      description:
        "Store an API key for --provider (from --token, the provider's env var, or piped stdin)",
    },
    disconnect: { type: "boolean", description: "Forget the stored key for --provider" },
    token: {
      type: "string",
      description:
        "API key for --connect (prefer piping via stdin or the provider env var to keep it out of shell history)",
    },
    file: {
      type: "string",
      description:
        "Artifact to publish (PDF path, or HTML export dir). Default: the manifest's output location",
    },
    manifest: { type: "string", description: "Path to manifest.yaml" },
    "dry-run": { type: "boolean", description: "Preflight only; don't contact the platform" },
    json: { type: "boolean", description: "Machine-readable JSON output (CI)" },
    open: {
      type: "boolean",
      description: "Open the result page / guided upload page in the browser",
    },
  },
  async run({ args }) {
    const json = !!args.json;
    const store = new FileTokenStore();
    const deps: PublishDeps = {
      tokenStore: store,
      onProgress: json ? undefined : (line) => log.info(line),
    };

    if (args.list) {
      const providers = listPublishProviders();
      const rows = await Promise.all(
        providers.map(async (p) => {
          const stored = p.credential.required
            ? await store.get(p.credential.host)
            : null;
          const envSet = p.credential.envVar
            ? !!process.env[p.credential.envVar]?.trim()
            : false;
          return {
            id: p.id,
            label: p.label,
            kind: p.kind,
            format: p.format,
            connected: !p.credential.required || !!stored || envSet,
          };
        }),
      );
      if (json) {
        console.log(JSON.stringify(rows, null, 2));
      } else {
        for (const r of rows) {
          const status =
            r.kind === "guided" ? "no key needed" : r.connected ? "connected" : "not connected";
          log.info(
            `${r.id.padEnd(13)} ${r.label.padEnd(22)} ${r.kind.padEnd(6)} ${r.format.padEnd(4)} ${status}`,
          );
        }
      }
      return;
    }

    const providerId = typeof args.provider === "string" ? args.provider : "";
    if (!providerId) {
      log.error(
        "Specify a provider: print-md publish --provider <itch|drivethrurpg|kdp|azure-swa|shopify> (or --list).",
      );
      process.exit(2);
    }
    let provider;
    try {
      provider = publishProviderFor(providerId);
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e));
      process.exit(2);
    }
    const projectDir = path.resolve((args.project as string | undefined) ?? ".");

    if (args.disconnect) {
      await store.delete(provider.info.credential.host);
      log.success(`Disconnected ${provider.info.label}.`);
      return;
    }

    if (args.connect) {
      if (!provider.info.credential.required) {
        log.info(
          `${provider.info.label} is a guided provider — no API key needed. Just run: print-md publish --provider ${provider.info.id}`,
        );
        return;
      }
      const envVar = provider.info.credential.envVar;
      const token =
        (typeof args.token === "string" && args.token.trim()) ||
        (envVar && process.env[envVar]?.trim()) ||
        (await readTokenFromStdin());
      if (!token) {
        log.error(
          `No API key given. Pass --token, set ${envVar ?? "the provider env var"}, or pipe the key via stdin.` +
            (provider.info.credential.tokenUrl
              ? `\nCreate one at: ${provider.info.credential.tokenUrl}`
              : ""),
        );
        process.exit(2);
      }
      await store.set(provider.info.credential.host, {
        host: provider.info.credential.host,
        kind: "token",
        token,
        label: provider.info.label,
        createdAt: Date.now(),
      });
      // Verify the stored key with the provider before declaring success.
      const req = await resolvePublishRequest(
        {
          projectDir,
          providerId: provider.info.id,
          manifestPath: typeof args.manifest === "string" ? args.manifest : undefined,
        },
        deps,
      );
      const auth = await provider.authenticate(req);
      if (!auth.ok) {
        await store.delete(provider.info.credential.host);
        log.error(auth.message ?? `${provider.info.label} rejected the key.`);
        process.exit(1);
      }
      log.success(`Connected ${provider.info.label}. The key is stored in your user config, not the project.`);
      return;
    }

    const result = await runPublish(
      {
        projectDir,
        providerId: provider.info.id,
        manifestPath: typeof args.manifest === "string" ? args.manifest : undefined,
        artifactPath: typeof args.file === "string" ? args.file : undefined,
        dryRun: !!args["dry-run"],
      },
      deps,
    );
    emitResult(result, json);

    if (result.ok && args.open && result.outcome) {
      const target =
        result.outcome.kind === "guided"
          ? result.outcome.openUrl
          : result.outcome.url;
      if (target) await openPath(target).catch(() => {});
    }
    if (!result.ok) process.exit(1);
  },
});
