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
import { defaultConfigDir } from "../remote-auth/token-store.ts";
import { commandExists, defaultCommandRunner } from "./command-runner.ts";
import type { PublishDeps } from "./types.ts";

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
  const response = await fetchFn(butlerDownloadUrl(channel));
  if (!response.ok) {
    throw new Error(
      `Couldn't download butler from itch.io (HTTP ${response.status}). ` +
        `Check your connection, or install butler manually and set BUTLER_PATH.`,
    );
  }
  const archive = new Uint8Array(await response.arrayBuffer());
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
