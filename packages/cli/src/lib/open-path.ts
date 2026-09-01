import { spawn } from "node:child_process";

export interface OpenPathSpawnSpec {
  cmd: string;
  args: string[];
  options: { detached: boolean; stdio: "ignore"; windowsVerbatimArguments?: boolean };
}

/**
 * Build the {cmd, args, options} triple openPath() spawns, without actually
 * spawning anything — kept separate so the win32 quoting can be unit tested
 * on non-Windows CI/dev machines.
 *
 * win32 note: Node's default argv-to-command-line quoting (libuv) only
 * quotes an argument if it contains a space/tab/quote character. A bare
 * URL like a Google OAuth auth link has no spaces (everything is
 * percent-encoded) but does contain unescaped "&" between query params, so
 * libuv would pass it UNQUOTED. cmd.exe's own parser then treats the first
 * unescaped "&" as a command separator, truncating the URL. The fix is the
 * well-established Node technique for this cmd.exe/start quirk: pass
 * `windowsVerbatimArguments: true` (which disables Node's own quoting
 * entirely) and do the quoting ourselves — an empty quoted string for the
 * `start` window-title placeholder, and the target wrapped in quotes so
 * `start` doesn't mistake an unquoted first token for the title.
 */
export function buildOpenPathSpawnSpec(filePath: string, platform: NodeJS.Platform = process.platform): OpenPathSpawnSpec {
  switch (platform) {
    case "darwin":
      return { cmd: "open", args: [filePath], options: { detached: true, stdio: "ignore" } };
    case "win32":
      return {
        cmd: "cmd",
        args: ["/c", "start", '""', '"' + filePath + '"'],
        options: { detached: true, stdio: "ignore", windowsVerbatimArguments: true },
      };
    default:
      return { cmd: "xdg-open", args: [filePath], options: { detached: true, stdio: "ignore" } };
  }
}

/**
 * Open a file in the user's default OS desktop. Detached + unref'd so the
 * caller can exit immediately without waiting on the desktop process.
 */
export function openPath(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const { cmd, args, options } = buildOpenPathSpawnSpec(filePath);
    const child = spawn(cmd, args, options);
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
