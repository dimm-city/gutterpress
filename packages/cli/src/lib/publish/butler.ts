/**
 * Butler (the official itch.io upload CLI) acquisition.
 *
 * Butler is not on npm and has no JS SDK — itch.io's supported automation
 * surface is the butler binary itself (https://itch.io/docs/butler/). To keep
 * the "nothing pre-installed" promise, we resolve it in order:
 *
 *   1. `$BUTLER_PATH` — an explicit binary path (power users, tests)
 *   2. `butler` already on the PATH
 *   3. A copy previously cached under `<configDir>/tools/butler/`
 *   4. Auto-download from itch.io's official broth channel into that cache
 *
 * The download is a zip served from broth.itch.ovh (itch.io's own
 * distribution service, the documented integration path). Extraction uses
 * fflate (pure JS — bundles cleanly under `bun build --compile`, CLAUDE.md §3).
 */
import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { FriendlyHttpError, withFetchTimeout } from "../fetch-timeout.ts";
import { defaultConfigDir } from "../remote-auth/token-store.ts";
import { commandExists, defaultCommandRunner } from "./command-runner.ts";
import type { PublishDeps } from "./types.ts";

/** Total deadline for the one-time butler binary download (audit B2; a TOTAL
 * budget, not idle — must cover the full archive on a slow link). */
const BUTLER_DOWNLOAD_TIMEOUT_MS = 300_000;

/** broth channel for the running platform; null when unsupported. */
export function butlerBrothChannel(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  if (platform === "win32" && arch === "x64") return "windows-amd64";
  if (platform === "darwin") return "darwin-amd64"; // universal via Rosetta on arm64
  if (platform === "linux" && arch === "x64") return "linux-amd64";
  return null;
}

export function butlerDownloadUrl(channel: string): string {
  return `https://broth.itch.ovh/butler/${channel}/LATEST/archive/default`;
}

function butlerBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "butler.exe" : "butler";
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve a runnable butler command, downloading it into the tool cache when
 * necessary. Returns the command to spawn (an absolute path, or plain
 * "butler" when found on the PATH).
 */
export async function ensureButler(deps: PublishDeps): Promise<string> {
  const env = deps.env ?? process.env;
  const runCommand = deps.runCommand ?? defaultCommandRunner;

  const explicit = env.BUTLER_PATH?.trim();
  if (explicit) {
    if (!(await fileExists(explicit))) {
      throw new Error(
        `BUTLER_PATH is set to "${explicit}" but no file exists there.`,
      );
    }
    return explicit;
  }

  if (await commandExists("butler", runCommand, deps.env)) return "butler";

  const cacheDir = path.join(
    deps.configDir ?? defaultConfigDir(),
    "tools",
    "butler",
  );
  const cached = path.join(cacheDir, butlerBinaryName());
  if (await fileExists(cached)) return cached;

  const channel = butlerBrothChannel();
  if (!channel) {
    throw new Error(
      `itch.io's butler tool has no build for ${process.platform}/${process.arch}. ` +
        `Install butler manually (https://itch.io/docs/butler/installing.html) and set BUTLER_PATH.`,
    );
  }

  deps.onProgress?.("Downloading itch.io's butler upload tool (one-time setup)…");
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const hint = "Check your connection, or install butler manually and set BUTLER_PATH.";
  // Bound the one-time download (audit B2): without a deadline a stalled CDN
  // connection hangs the whole publish. The deadline is TOTAL (fetch-timeout.ts)
  // and keeps ticking through the body read, so the budget must cover the whole
  // ~25MB archive on a slow link — 5 minutes ≈ works down to ~0.7 Mbit/s — and
  // the body read sits inside `run` so a mid-body abort gets the friendly message.
  const archive = await withFetchTimeout(
    {
      timeoutMs: BUTLER_DOWNLOAD_TIMEOUT_MS,
      timeoutMessage: `Downloading butler from itch.io timed out. ${hint}`,
      offlineMessage: (e) =>
        `Couldn't download butler from itch.io (${e instanceof Error ? e.message : String(e)}). ${hint}`,
    },
    async (signal) => {
      const response = await fetchFn(butlerDownloadUrl(channel), { signal });
      if (!response.ok) {
        // Already friendly — the marker type keeps it out of the offline wrap.
        throw new FriendlyHttpError(
          `Couldn't download butler from itch.io (HTTP ${response.status}). ${hint}`,
        );
      }
      return new Uint8Array(await response.arrayBuffer());
    },
  );
  const files = unzipSync(archive);

  await mkdir(cacheDir, { recursive: true });
  let foundBinary = false;
  for (const [name, data] of Object.entries(files)) {
    // The archive is flat (butler + its 7z companion libs); ignore any
    // directory entries defensively.
    if (name.endsWith("/")) continue;
    const target = path.join(cacheDir, path.basename(name));
    await writeFile(target, data);
    if (path.basename(name) === butlerBinaryName()) {
      await chmod(target, 0o755).catch(() => {});
      foundBinary = true;
    }
  }
  if (!foundBinary) {
    throw new Error(
      "The butler download from itch.io didn't contain the expected binary. " +
        "Install butler manually (https://itch.io/docs/butler/installing.html) and set BUTLER_PATH.",
    );
  }
  deps.onProgress?.(`butler installed to ${cached}`);
  return cached;
}
