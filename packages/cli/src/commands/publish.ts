import { defineCommand } from "citty";
import path from "node:path";
import { fstatSync } from "node:fs";
import { stat } from "node:fs/promises";
import {
  log,
  FileTokenStore,
  PublishSelectionsStore,
  connectPublishProvider,
  connectGoogleDrive,
  disconnectPublishCredential,
  listBookPublishProviders,
  resolvePublishProvider,
  publishConnectionStatus,
  publishCredentialKey,
  listPublishAccounts,
  publishBook,
  openPath,
  loadManifestWithPath,
  resolvePublishFormat,
  isPathSpecifier,
  BuildError,
  type FailureCode,
  type PublishBookResult,
  type PublishDeps,
  type TargetResult,
} from "../index.ts";
import { EXIT_CODES, UsageError, rejectUnknownFlags } from "../lib/cli-args.ts";

/**
 * `gutterpress publish` — the terminal's view of the one publish run
 * (ADR 0012). The run, its checks and its words live in the lib
 * (`publishBook`); this file reads flags and prints what the run reports.
 *
 *   gutterpress publish                      # make, check and send every target
 *   gutterpress publish itch gdrive          # only these targets
 *   gutterpress publish --dry-run            # make and check; send nothing
 *   gutterpress publish --skip-checks        # run no checks
 *   gutterpress publish --send-anyway        # send targets whose checks failed
 *   gutterpress publish --list               # targets and connection status
 *   gutterpress publish --connect itch       # save an API key (--token, env var
 *                                            #   or piped stdin); gdrive opens the
 *                                            #   browser instead
 *   gutterpress publish --disconnect itch    # forget the saved key
 *   gutterpress publish gdrive --folder-id <id>   # this run only: another Drive
 *                                            #   folder (or --folder <name>)
 *
 * A positional that is a folder (`.`, `./book`, `/path`) is the book; the
 * rest are targets. `--provider <id>` names one target, as before.
 *
 * Accounts live in the one per-person store the app shares (never in the
 * book); provider env vars (BUTLER_API_KEY, SWA_CLI_DEPLOYMENT_TOKEN,
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

/** The book's folder and the targets, from the positionals and `--provider`. */
async function readPositionals(
  positionals: string[],
  provider: string,
): Promise<{ projectDir: string; targets: string[] }> {
  let projectDir: string | undefined;
  const targets: string[] = [];
  for (const p of positionals) {
    const isDir =
      p === "." ||
      p === ".." ||
      path.isAbsolute(p) ||
      isPathSpecifier(p) ||
      (await stat(path.resolve(p)).then((s) => s.isDirectory()).catch(() => false));
    if (isDir && projectDir === undefined) projectDir = p;
    else if (isDir) throw new UsageError(`gutterpress publish: two book folders given: ${projectDir} and ${p}`);
    else targets.push(p);
  }
  if (provider) targets.push(provider);
  return { projectDir: path.resolve(projectDir ?? "."), targets };
}

/** Failures that mean the command was asked for something it cannot do. */
const USAGE_FAILURES: ReadonlySet<FailureCode> = new Set(["NO_MANIFEST", "UNKNOWN_TARGET"]);
/** Failures of the tools that make the files. */
const PIPELINE_FAILURES: ReadonlySet<FailureCode> = new Set(["TOOL_MISSING", "DISK_FULL", "PERMISSION", "BUILD_FAILED"]);

function exitCodeFor(result: PublishBookResult): number {
  if (result.ok) return EXIT_CODES.OK;
  const code = result.failure?.code;
  if (code && USAGE_FAILURES.has(code)) return EXIT_CODES.USAGE;
  if (code && PIPELINE_FAILURES.has(code)) return EXIT_CODES.PIPELINE;
  return EXIT_CODES.FINDINGS;
}

function where(f: { file?: string; line?: number; page?: number }): string {
  if (f.file) return ` (${f.file}${f.line ? `:${f.line}` : ""})`;
  return f.page ? ` (page ${f.page})` : "";
}

function printTarget(t: TargetResult): void {
  for (const issue of t.issues.filter((i) => i.severity !== "error")) {
    (issue.severity === "warning" ? log.warn : log.info)(`${t.label}: ${issue.message}`);
  }
  // A held target lists its errors below; any target's warnings are worth reading.
  for (const f of t.findings.filter((x) => x.severity === "warning")) {
    log.warn(`${t.label}: [${f.checkId}] ${f.message}${where(f)}`);
  }
  switch (t.status) {
    case "sent": {
      const outcome = t.outcome?.kind === "published" ? t.outcome : undefined;
      log.success(`${t.label}: ${outcome?.detail ?? "sent."}`);
      if (outcome?.url) log.info(`  View it at: ${outcome.url}`);
      for (const step of outcome?.followUp ?? []) log.info(`  Next: ${step}`);
      return;
    }
    case "prepared": {
      const outcome = t.outcome?.kind === "guided" ? t.outcome : undefined;
      log.success(`${t.label}: ${outcome?.detail ?? "upload package ready."}`);
      if (outcome) {
        log.info(`  Package folder: ${outcome.packageDir}`);
        log.info(`  Upload page:    ${outcome.openUrl}`);
        outcome.checklist.forEach((step, i) => log.info(`    ${i + 1}. ${step}`));
      }
      return;
    }
    case "checked":
      log.success(`${t.label}: checked; ready to send.${t.file ? ` ${t.file}` : ""}`);
      return;
    case "held":
      log.error(`${t.label}: ${t.failure?.message}`);
      for (const f of t.findings.filter((x) => x.severity === "error")) {
        log.error(`  [${f.checkId}] ${f.message}${where(f)}`);
      }
      log.info(`  To send it anyway: gutterpress publish ${t.id} --send-anyway`);
      return;
    case "not-connected":
      log.warn(`${t.label}: ${t.failure?.message}`);
      log.info(`  Connect an account: gutterpress publish --connect ${t.id}`);
      return;
    case "failed":
      log.error(`${t.label}: ${t.failure?.message}`);
      if (t.failure?.detail) log.error(t.failure.detail);
      return;
    case "waiting":
      log.info(`${t.label}: not reached.`);
  }
}

function printResult(result: PublishBookResult): void {
  // The render's own notes were logged as it ran.
  for (const f of result.sourceFindings.filter((x) => x.severity !== "info")) {
    (f.severity === "error" ? log.error : log.warn)(`[${f.checkId}] ${f.message}${where(f)}`);
  }
  for (const t of result.targets) printTarget(t);
  const failure = result.failure;
  if (failure && failure.code !== "CANCELED") {
    log.error(failure.message);
    if (failure.detail) log.error(failure.detail);
    if (failure.code === "TOO_WIDE") log.info("To build anyway: gutterpress publish --allow-shrink");
  }
}

const commandArgs = {
  targets: {
    type: "positional",
    description: "Targets to publish (default: the book's), and the book's folder (default: cwd)",
    required: false,
  },
  provider: {
    type: "string",
    description: "One target to publish, connect or disconnect (the same as naming it)",
  },
  list: { type: "boolean", description: "List targets and connection status" },
  connect: {
    type: "boolean",
    description:
      "Save an account for the named target (an API key from --token, its env var, or piped stdin; gdrive opens the browser)",
  },
  disconnect: { type: "boolean", description: "Forget the saved account for the named target" },
  account: {
    type: "string",
    description:
      "Named account for --connect/--disconnect, so you can keep several per target (e.g. --account studio). Omit for the default account.",
  },
  token: {
    type: "string",
    description:
      "API key for --connect (prefer piping via stdin or the target's env var to keep it out of shell history)",
  },
  "folder-id": {
    type: "string",
    description: "Google Drive: send to this folder id for this run only (the manifest is not changed)",
  },
  folder: {
    type: "string",
    description:
      "Google Drive: send to the folder with this name in your own Drive, found or created, for this run only (the manifest is not changed)",
  },
  manifest: { type: "string", description: "Path to manifest.yaml" },
  "dry-run": { type: "boolean", description: "Make and check the files; send nothing" },
  "skip-checks": { type: "boolean", description: "Run no checks" },
  "send-anyway": { type: "boolean", description: "Send targets whose file failed their checks" },
  "allow-shrink": {
    type: "boolean",
    description: "Build anyway when content is wider than the page; Chromium scales the whole book down to fit",
  },
  json: { type: "boolean", description: "Machine-readable JSON output (CI)" },
  open: {
    type: "boolean",
    description: "Open each result page / guided upload page in the browser",
  },
} as const;

export default defineCommand({
  meta: {
    name: "publish",
    description:
      "Make, check and send the book to its targets (a folder, Google Drive, itch.io, DriveThruRPG, Amazon KDP, Azure Static Web Apps, Shopify)",
  },
  args: commandArgs,
  async run({ args, rawArgs }) {
    let projectDir: string;
    let targets: string[];
    try {
      rejectUnknownFlags(rawArgs, commandArgs, "publish");
      ({ projectDir, targets } = await readPositionals(
        ((args as { _?: unknown[] })._ ?? []).map(String),
        typeof args.provider === "string" ? args.provider.trim() : "",
      ));
    } catch (error) {
      if (error instanceof UsageError) {
        log.error(error.message);
        process.exit(error.exitCode);
      }
      throw error;
    }

    const json = !!args.json;
    const manifestArg = typeof args.manifest === "string" ? args.manifest : undefined;
    const deps: PublishDeps = {
      tokenStore: new FileTokenStore(),
      // The person's own choices for each book (their account, their folder),
      // the same file the app keeps them in (ADR 0012).
      selections: new PublishSelectionsStore(),
    };

    if (args.list) {
      // A target's EFFECTIVE format can be set per book (`publish.<id>.format`);
      // resolvePublishFormat is the one place that logic lives. A missing or
      // unreadable manifest falls back to each target's own default.
      let publishSettings: Record<string, unknown> = {};
      try {
        const { manifest } = await loadManifestWithPath(manifestArg ?? projectDir, {
          explicit: manifestArg !== undefined,
        });
        publishSettings = (manifest.publish ?? {}) as Record<string, unknown>;
      } catch {
        // Each target's own default format, below.
      }

      const providers = await listBookPublishProviders({
        projectDir,
        ...(manifestArg !== undefined ? { manifestPath: manifestArg } : {}),
      });
      const rows = await Promise.all(
        providers.map(async (p) => {
          const status = await publishConnectionStatus(p, deps);
          const accounts = p.credential.required ? await listPublishAccounts(p, deps) : [];
          const providerConfig = (publishSettings[p.id] as Record<string, unknown> | undefined) ?? {};
          return {
            id: p.id,
            label: p.label,
            kind: p.kind,
            format: resolvePublishFormat(p, providerConfig),
            connected: status.connected,
            accounts,
            ...(p.experimental ? { experimental: true as const } : {}),
          };
        }),
      );
      if (json) {
        process.stdout.write(JSON.stringify(rows, null, 2) + "\n"); // not console.log: see checks/formatter.ts
      } else {
        for (const r of rows) {
          const status = r.experimental
            ? "experimental"
            : r.kind === "guided"
              ? "no key needed"
              : r.connected
                ? "connected"
                : "not connected";
          log.info(`${r.id.padEnd(18)} ${r.label.padEnd(30)} ${r.kind.padEnd(6)} ${r.format.padEnd(4)} ${status}`);
          for (const acc of r.accounts) log.info(`    • ${acc.account ? acc.account : "(default)"}`);
        }
      }
      return;
    }

    if (args.connect || args.disconnect) {
      if (targets.length !== 1) {
        log.error(`Name one target to ${args.connect ? "connect" : "disconnect"}: gutterpress publish --${args.connect ? "connect" : "disconnect"} <target> (see --list).`);
        process.exit(EXIT_CODES.USAGE);
      }
      let provider;
      try {
        provider = await resolvePublishProvider(targets[0]!, {
          projectDir,
          ...(manifestArg !== undefined ? { manifestPath: manifestArg } : {}),
        });
      } catch (e) {
        log.error(e instanceof Error ? e.message : String(e));
        process.exit(e instanceof BuildError ? e.exitCode : EXIT_CODES.USAGE);
      }
      const account = typeof args.account === "string" ? args.account.trim() : "";

      if (args.disconnect) {
        const key = publishCredentialKey(provider.info.credential.host, account);
        // Best-effort revoke at Google before returning: a one-shot process
        // can afford to wait for it before printing success.
        await disconnectPublishCredential(key, deps, { awaitRevoke: true });
        log.success(`Disconnected ${provider.info.label}${account ? ` (${account})` : ""}.`);
        return;
      }

      if (!provider.info.credential.required) {
        log.info(
          provider.info.experimental
            ? `${provider.info.label} is a publishing plugin — it manages its own credentials (see its documentation). Just run: gutterpress publish ${provider.info.id}`
            : `${provider.info.label} needs no account. Just run: gutterpress publish ${provider.info.id}`,
        );
        return;
      }
      if (provider.info.credential.connect === "oauth") {
        // No key to paste — a browser consent flow instead. An author who
        // reaches for --token out of habit, has the env var set, or pipes a
        // key must get an explanation, not a silently started browser flow.
        const envVar = provider.info.credential.envVar;
        const tokenGiven = typeof args.token === "string" && args.token.trim().length > 0;
        const envGiven = !!(envVar && process.env[envVar]?.trim());
        const stdinGiven = tokenGiven || envGiven ? false : stdinLooksPiped();
        if (tokenGiven || envGiven || stdinGiven) {
          log.error(
            `${provider.info.label} connects through your browser, not a pasted key — ` +
              `drop --token${envVar ? ` and unset ${envVar}` : ""}${stdinGiven ? " and remove the piped input" : ""}, then run ` +
              `"gutterpress publish --connect ${provider.info.id}".`,
          );
          process.exit(EXIT_CODES.USAGE);
        }
        try {
          const result = await connectGoogleDrive({ ...(account ? { account } : {}) }, deps, {
            onAuthUrl: (url) => {
              log.info("Opening your browser to connect Google Drive…");
              log.info(`If it didn't open, visit: ${url}`);
            },
          });
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
            (provider.info.credential.tokenUrl ? `\nCreate one at: ${provider.info.credential.tokenUrl}` : ""),
        );
        process.exit(EXIT_CODES.USAGE);
      }
      // Verify before storing, so a bad paste can't clobber a working account.
      try {
        await connectPublishProvider(
          {
            projectDir,
            providerId: provider.info.id,
            token,
            ...(account ? { account } : {}),
            manifestPath: manifestArg,
          },
          deps,
        );
      } catch (e) {
        log.error(e instanceof Error ? e.message : String(e));
        process.exit(e instanceof UsageError ? e.exitCode : EXIT_CODES.FINDINGS);
      }
      log.success(
        `Connected ${provider.info.label}${account ? ` (${account})` : ""}. The key is saved in your own settings, not the book.`,
      );
      return;
    }

    // A Drive folder for this run only (#452): the manifest is read, never
    // written, so a teammate who can't reach the book's folder publishes
    // elsewhere without changing it for everyone.
    const folderId = typeof args["folder-id"] === "string" ? args["folder-id"].trim() : "";
    const folder = typeof args.folder === "string" ? args.folder.trim() : "";
    if ((folderId || folder) && targets.length > 0 && !targets.includes("gdrive")) {
      log.error("--folder-id and --folder are for the gdrive target.");
      process.exit(EXIT_CODES.USAGE);
    }

    // With --json, stdout carries the result alone: the build's own log lines
    // go to stderr while the run lasts.
    const consoleLog = console.log;
    if (json) console.log = console.error;
    const result = await publishBook(
      {
        projectDir,
        ...(manifestArg !== undefined ? { manifestPath: manifestArg } : {}),
        ...(targets.length > 0 ? { targets } : {}),
        checkOnly: !!args["dry-run"],
        skipChecks: !!args["skip-checks"],
        ...(args["send-anyway"] ? { sendAnyway: targets.length > 0 ? targets : true } : {}),
        allowShrink: !!args["allow-shrink"],
        ...(folderId || folder ? { runSettings: { gdrive: { folderId, folder } } } : {}),
        ...(json ? {} : { onProgress: (p) => log.info(p.message) }),
      },
      { ...deps, ...(json ? {} : { onProgress: (line: string) => log.info(line) }) },
    ).finally(() => {
      console.log = consoleLog;
    });

    if (json) process.stdout.write(JSON.stringify(result, null, 2) + "\n"); // not console.log: see checks/formatter.ts
    else printResult(result);

    if (args.open) {
      for (const t of result.targets) {
        const url = t.outcome?.kind === "guided" ? t.outcome.openUrl : t.outcome?.url;
        if (url) await openPath(url).catch(() => {});
      }
    }
    const code = exitCodeFor(result);
    if (code !== EXIT_CODES.OK) process.exit(code);
  },
});
