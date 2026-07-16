/**
 * itch.io publish provider (#35) — a real API upload via butler, itch.io's
 * official and only supported automation surface.
 *
 * Auth: `BUTLER_API_KEY` in the child environment (butler's documented
 * non-interactive mode). The key comes from the injected TokenStore (host
 * "itch.io") or the BUTLER_API_KEY env var in CI. It is NEVER placed in argv.
 */
import { ensureButler } from "../butler.ts";
import { defaultCommandRunner } from "../command-runner.ts";
import {
  resolvePublishCredential,
  type PreflightIssue,
  type PublishAuthStatus,
  type PublishOutcome,
  type PublishProvider,
  type PublishProviderInfo,
  type PublishRequest,
} from "../types.ts";

export const ITCH_HOST = "itch.io";
const TARGET_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

const info: PublishProviderInfo = {
  id: "itch",
  label: "itch.io",
  kind: "api",
  format: "pdf",
  description:
    "Upload the PDF to your itch.io project page (games, TTRPG supplements, zines).",
  configFields: [
    { key: "target", label: "Project (user/game)", placeholder: "you/your-book" },
    { key: "channel", label: "Channel", placeholder: "pdf" },
  ],
  credential: {
    required: true,
    host: ITCH_HOST,
    envVar: "BUTLER_API_KEY",
    tokenUrl: "https://itch.io/user/settings/api-keys",
    hint: "Create an API key under itch.io → Settings → API keys, then paste it here.",
  },
};

interface ItchConfig {
  target?: string;
  channel?: string;
}

function readConfig(req: PublishRequest): Required<ItchConfig> {
  const cfg = req.config as ItchConfig;
  return {
    target: (cfg.target ?? "").trim(),
    channel: (cfg.channel ?? "pdf").trim(),
  };
}

/** `user/game` → the public project page URL. */
export function itchProjectUrl(target: string): string {
  const [user, game] = target.split("/");
  return `https://${user}.itch.io/${game}`;
}

export const itchProvider: PublishProvider = {
  info,

  async authenticate(req): Promise<PublishAuthStatus> {
    const resolved = await resolvePublishCredential(info, req.deps);
    if (!resolved) {
      return {
        ok: false,
        message:
          "No itch.io API key found. Connect itch.io (or set BUTLER_API_KEY) first.",
      };
    }
    // Verify the key itself against itch.io's server-side API (the endpoint
    // butlerd uses). This works before the author has configured a target
    // and doesn't need butler at all — a `butler version` fallback would
    // succeed locally without ever checking the key.
    const fetchFn = req.deps.fetch ?? globalThis.fetch;
    let response: Response;
    try {
      response = await fetchFn("https://api.itch.io/profile", {
        headers: { Authorization: `Bearer ${resolved.credential.token}` },
      });
    } catch {
      return {
        ok: false,
        source: resolved.source,
        message: "Couldn't reach itch.io. Check your connection and try again.",
      };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        source: resolved.source,
        message:
          "itch.io didn't accept the API key. Create one under itch.io → Settings → API keys and try again.",
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        source: resolved.source,
        message: `itch.io answered unexpectedly (HTTP ${response.status}). Try again in a moment.`,
      };
    }
    return { ok: true, source: resolved.source };
  },

  async preflight(req): Promise<PreflightIssue[]> {
    const issues: PreflightIssue[] = [];
    const { target, channel } = readConfig(req);
    if (!target) {
      issues.push({
        severity: "error",
        id: "itch/target-missing",
        message:
          'Set the itch.io project in the manifest: publish.itch.target: "user/game".',
      });
    } else if (!TARGET_RE.test(target)) {
      issues.push({
        severity: "error",
        id: "itch/target-invalid",
        message: `publish.itch.target must look like "user/game" (got "${target}").`,
      });
    }
    if (!/^[A-Za-z0-9._-]+$/.test(channel)) {
      issues.push({
        severity: "error",
        id: "itch/channel-invalid",
        message: `publish.itch.channel may only contain letters, digits, ".", "_" and "-" (got "${channel}").`,
      });
    }
    return issues;
  },

  async upload(req): Promise<PublishOutcome> {
    const { target, channel } = readConfig(req);
    const resolved = await resolvePublishCredential(info, req.deps);
    if (!resolved) {
      throw new Error(
        "No itch.io API key found. Connect itch.io (or set BUTLER_API_KEY) first.",
      );
    }
    const butler = await ensureButler(req.deps);
    const run = req.deps.runCommand ?? defaultCommandRunner;
    req.deps.onProgress?.(`Uploading to ${target}:${channel} with butler…`);
    const result = await run(
      butler,
      ["push", req.artifact.path, `${target}:${channel}`],
      {
        env: { BUTLER_API_KEY: resolved.credential.token },
        onOutput: req.deps.onProgress,
        // Idle timeout (audit B2): butler streams progress continuously during
        // a healthy upload, so 2min of total silence means the transfer stalled.
        timeoutMs: 120_000,
      },
    );
    if (result.code !== 0) {
      // butler's own message is safe to surface (it never echoes the key),
      // but keep it short — the full log already streamed via onProgress.
      const tail = result.stderr.trim().split("\n").slice(-3).join("\n");
      throw new Error(
        `butler push failed (exit ${result.code}).${tail ? `\n${tail}` : ""}`,
      );
    }
    return {
      kind: "published",
      url: itchProjectUrl(target),
      detail: `Uploaded ${req.artifact.path} to ${target}:${channel}.`,
    };
  },
};
