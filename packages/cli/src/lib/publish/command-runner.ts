/**
 * Default {@link CommandRunner}: spawn a child process, stream line-buffered
 * output, resolve with the exit code (callers decide whether non-zero is an
 * error — butler/swa diagnostics live in the captured output).
 *
 * Unlike lib/exec.ts this seam accepts an env override, because publish
 * providers pass secrets (BUTLER_API_KEY, SWA_CLI_DEPLOYMENT_TOKEN) through
 * the environment — NEVER through argv, which is world-readable in process
 * lists.
 */
import { spawn } from "node:child_process";
import type { CommandResult, CommandRunner } from "./types.ts";

export const defaultCommandRunner: CommandRunner = (
  cmd,
  args,
  options = {},
): Promise<CommandResult> => {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let carry = "";
    const emitLines = (chunk: string) => {
      if (!options.onOutput) return;
      carry += chunk;
      const lines = carry.split(/\r?\n/);
      carry = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) options.onOutput(line);
      }
    };

    child.stdout.on("data", (d: Buffer) => {
      const text = d.toString();
      stdout += text;
      emitLines(text);
    });
    child.stderr.on("data", (d: Buffer) => {
      const text = d.toString();
      stderr += text;
      emitLines(text);
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (carry.trim() && options.onOutput) options.onOutput(carry);
      if (code === null) {
        reject(new Error(`${cmd} was killed by signal ${signal}`));
      } else {
        resolve({ code, stdout, stderr });
      }
    });
  });
};

/** True when `cmd` resolves to an executable on the current PATH. */
export async function commandExists(
  cmd: string,
  runCommand: CommandRunner = defaultCommandRunner,
): Promise<boolean> {
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    const result = await runCommand(probe, [cmd]);
    return result.code === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}
