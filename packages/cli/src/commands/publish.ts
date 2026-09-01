import { defineCommand } from "citty";
import path from "node:path";
import { fstatSync } from "node:fs";
import {
  log,
  FileTokenStore,
  connectPublishProvider,
  connectGoogleDrive,
  disconnectPublishCredential,
  listPublishProviders,
  publishProviderFor,
  publishConnectionStatus,
  publishCredentialKey,
  listPublishAccounts,
  runPublish,
  openPath,
  loadManifestWithPath,
  resolvePublishFormat,
  type PublishDeps,
  type RunPublishResult,
} from "../index.ts";
import {
  EXIT_CODES,
  UsageError,
  rejectExtraPositionals,
  rejectUnknownFlags,
} from "../lib/cli-args.ts";

/**
 * `gutterpress publish` (#35) — push a built artifact to a publishing platform,
 * headlessly (CI-safe). One command, four modes:
 *
 *   gutterpress publish --list                         # providers + connection status
 *   gutterpress publish --provider itch --connect      # store an API key (token via
 *                                                   #   --token, env var, or piped stdin)
 *   gutterpress publish --provider gdrive --connect    # oauth providers: opens the
 *                                                   #   browser instead — nothing to paste
 *   gutterpress publish --provider itch --disconnect   # forget the stored key
 *   gutterpress publish --provider itch [dir]          # publish (add --dry-run / --json)
 *
 * Credentials live in the 0600 user-config credential store (never in the
 * project); provider env vars (BUTLER_API_KEY, SWA_CLI_DEPLOYMENT_TOKEN,
 * SHOPIFY_ADMIN_TOKEN, GDRIVE_REFRESH_TOKEN) override it for CI.
 */

async function readTokenFromStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

/**
 * Cheap, non-blocking check for "the caller redirected something into
 * stdin" (a pipe or a `< file` redirect) — used only to detect a likely
 * `--token`-style paste attempt aimed at an oauth provider (B1). Unlike
 * {@link readTokenFromStdin} this never reads/consumes the stream: it just
 * stats fd 0, so it can't block waiting on a stdin that's open but idle
 * (an interactive TTY session, or a plain inherited stdin with nothing
 * piped in) — the exact shape a real "run --connect and let the browser
 * flow start" invocation has.
 */
function stdinLooksPiped(): boolean {
  if (process.stdin.isTTY) return false;
  try {
    const st = fstatSync(0);
    return st.isFIFO() || st.isFile();
  } catch {
    return false;
  }
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

const commandArgs = {
  project: {
    type: "positional",
    description: "Project directory (default: cwd)",
    required: false,
  },
  provider: {
    type: "string",
    description: "Provider id: itch | drivethrurpg | kdp | azure-swa | shopify | gdrive",
  },
  list: { type: "boolean", description: "List providers and connection status" },
  connect: {
    type: "boolean",
    description:
      "Store an API key for --provider (from --token, the provider's env var, or piped stdin)",
  },
  disconnect: { type: "boolean", description: "Forget the stored key for --provider" },
  account: {
    type: "string",
    description:
      "Named-credential label for --connect/--disconnect, so you can keep several accounts per provider (e.g. --account studio). Omit for the default account.",
  },
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
} as const;

export default defineCommand({
  meta: {
    name: "publish",
    description:
      "Publish the built PDF/HTML to a platform (itch.io, DriveThruRPG, Amazon KDP, Azure Static Web Apps, Shopify, Google Drive)",
  },
  args: commandArgs,
  async run({ args, rawArgs }) {
    try {
      rejectUnknownFlags(rawArgs, commandArgs, "publish");
      rejectExtraPositionals((args as { _: unknown[] })._, 1, "publish");
    } catch (error) {
      if (error instanceof UsageError) {
        log.error(error.message);
        process.exit(error.exitCode);
      }
      throw error;
    }

    const json = !!args.json;
    const store = new FileTokenStore();
    const deps: PublishDeps = {
      tokenStore: store,
      onProgress: json ? undefined : (line) => log.info(line),
    };

    if (args.list) {
      // B2: a provider that declares a `formats` array (today, only gdrive)
      // can have its EFFECTIVE format overridden per-project by the manifest
      // (`publish.<id>.format`) — resolvePublishFormat (run-publish.ts) is
      // the one place that logic lives, shared with the actual publish run.
      // --list takes the same project-dir/--manifest inputs every other
      // subcommand does, so that context IS available here; load the
      // manifest best-effort (a missing/unreadable one just falls back to
      // each provider's static default, same as before this fix).
      const projectDir = path.resolve((args.project as string | undefined) ?? ".");
      const manifestArg = typeof args.manifest === "string" ? args.manifest : undefined;
      let publishSettings: Record<string, unknown> = {};
      try {
        const { manifest } = await loadManifestWithPath(manifestArg ?? projectDir, {
          explicit: manifestArg !== undefined,
        });
        publishSettings = (manifest.publish ?? {}) as Record<string, unknown>;
      } catch {
        // No manifest, or an invalid --manifest path: fall back to each
        // provider's static `format` below, exactly like before this fix.
      }

      const providers = listPublishProviders();
      const rows = await Promise.all(
        providers.map(async (p) => {
          const status = await publishConnectionStatus(p, deps);
          // Saved named accounts (default + named) for a credentialed provider.
          const accounts = p.credential.required ? await listPublishAccounts(p, deps) : [];
          const providerConfig =
            (publishSettings[p.id] as Record<string, unknown> | undefined) ?? {};
          return {
            id: p.id,
            label: p.label,
            kind: p.kind,
            format: resolvePublishFormat(p, providerConfig),
            connected: status.connected,
            accounts,
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
          // List saved accounts so the user can see/reuse named credentials.
          for (const acc of r.accounts) {
            log.info(`    • ${acc.account ? acc.account : "(default)"}`);
          }
        }
      }
      return;
    }

    const providerId = typeof args.provider === "string" ? args.provider : "";
    if (!providerId) {
      log.error(
        "Specify a provider: gutterpress publish --provider <itch|drivethrurpg|kdp|azure-swa|shopify|gdrive> (or --list).",
      );
      process.exit(EXIT_CODES.USAGE);
    }
    let provider;
    try {
      provider = publishProviderFor(providerId);
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e));
      process.exit(EXIT_CODES.USAGE);
    }
    const projectDir = path.resolve((args.project as string | undefined) ?? ".");

    const account = typeof args.account === "string" ? args.account.trim() : "";

    if (args.disconnect) {
      const key = publishCredentialKey(provider.info.credential.host, account);
      // Best-effort revoke at Google before returning (D4/D6) — the CLI is a
      // one-shot process, so unlike the desktop's disconnect routes it can
      // afford to wait for the whole thing to finish before printing success.
      await disconnectPublishCredential(key, deps, { awaitRevoke: true });
      log.success(`Disconnected ${provider.info.label}${account ? ` (${account})` : ""}.`);
      return;
    }

    if (args.connect) {
      if (!provider.info.credential.required) {
        log.info(
          `${provider.info.label} is a guided provider — no API key needed. Just run: gutterpress publish --provider ${provider.info.id}`,
        );
        return;
      }
      if (provider.info.credential.connect === "oauth") {
        // No key to paste — an interactive browser consent flow instead.
        // Today gdrive is the only oauth provider; connectGoogleDrive() is
        // the shared implementation (CLI here, desktop in Phase 2).
        //
        // B1: an author who reaches for --token out of habit (it works for
        // every other provider) — or who has the provider's env var set, or
        // pipes a key via stdin — gets no explanation today: this branch
        // used to return before connectPublishProvider's own oauth rejection
        // could ever run. Catch the same three signals here and fail with
        // the same guidance, WITHOUT starting the browser flow. When none of
        // the three are present, fall through to the browser flow exactly as
        // before — no opt-out flag required for the common case.
        const envVar = provider.info.credential.envVar;
        const tokenGiven = typeof args.token === "string" && args.token.trim().length > 0;
        const envGiven = !!(envVar && process.env[envVar]?.trim());
        const stdinGiven = tokenGiven || envGiven ? false : stdinLooksPiped();
        if (tokenGiven || envGiven || stdinGiven) {
          log.error(
            `${provider.info.label} connects through your browser, not a pasted key — ` +
              `drop --token${envVar ? ` and unset ${envVar}` : ""}${stdinGiven ? " and remove the piped input" : ""}, then run ` +
              `"gutterpress publish --provider ${provider.info.id} --connect".`,
          );
          process.exit(EXIT_CODES.USAGE);
        }
        try {
          const result = await connectGoogleDrive(
            { ...(account ? { account } : {}) },
            deps,
            {
              onAuthUrl: (url) => {
                log.info("Opening your browser to connect Google Drive…");
                log.info(`If it didn't open, visit: ${url}`);
              },
            },
          );
          log.success(
            `Connected ${provider.info.label}${account ? ` (${account})` : ""}${result.email ? ` — ${result.email}` : ""}.`,
          );
        } catch (e) {
          log.error(e instanceof Error ? e.message : String(e));
          process.exit(EXIT_CODES.FINDINGS);
        }
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
        process.exit(EXIT_CODES.USAGE);
      }
      // Shared verify-before-store flow: the pasted key is checked with the
      // platform first, so a bad paste can't clobber a working credential.
      try {
        await connectPublishProvider(
          {
            projectDir,
            providerId: provider.info.id,
            token,
            ...(account ? { account } : {}),
            manifestPath: typeof args.manifest === "string" ? args.manifest : undefined,
          },
          deps,
        );
      } catch (e) {
        log.error(e instanceof Error ? e.message : String(e));
        process.exit(e instanceof UsageError ? e.exitCode : EXIT_CODES.FINDINGS);
      }
      log.success(
        `Connected ${provider.info.label}${account ? ` (${account})` : ""}. The key is stored in your user config, not the project.`,
      );
      return;
    }

    let result: RunPublishResult;
    try {
      result = await runPublish(
        {
          projectDir,
          providerId: provider.info.id,
          manifestPath: typeof args.manifest === "string" ? args.manifest : undefined,
          artifactPath: typeof args.file === "string" ? args.file : undefined,
          dryRun: !!args["dry-run"],
        },
        deps,
      );
    } catch (e) {
      if (e instanceof UsageError) {
        log.error(e.message);
        process.exit(e.exitCode);
      }
      throw e;
    }
    emitResult(result, json);

    if (result.ok && args.open && result.outcome) {
      const target =
        result.outcome.kind === "guided"
          ? result.outcome.openUrl
          : result.outcome.url;
      if (target) await openPath(target).catch(() => {});
    }
    if (!result.ok) process.exit(EXIT_CODES.FINDINGS);
  },
});
