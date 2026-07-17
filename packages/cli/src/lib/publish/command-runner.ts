/**
 * Default {@link CommandRunner}: spawn a child process, stream line-buffered
 * output, resolve with the exit code (callers decide whether non-zero is an
 * error — butler/swa diagnostics live in the captured output).
 *
 * Unlike lib/exec.ts this seam accepts an env override, because publish
 * providers pass secrets (BUTLER_API_KEY, SWA_CLI_DEPLOYMENT_TOKEN) through
 * the environment — NEVER through argv, which is world-readable in process
 * lists. (tool-probe.ts exists for PATH probing but spawns directly; publish
 * needs the injectable-runner seam so tests can fake tool presence.)
 */
import { spawn } from "node:child_process";
import type { CommandResult, CommandRunner } from "./types.ts";

/**
 * Captured stdout/stderr are kept only for a short error tail and a URL
 * scan — bound them so an hours-long `butler push` progress stream can't
 * grow two unbounded strings in memory.
 */
const CAPTURE_LIMIT = 64 * 1024;

/**
 * Default idle budget for provider uploads (audit B2 / review): the value
 * every publish provider should pass as `timeoutMs` unless it has a reason to
 * differ, so the next provider can't silently regain hang-forever behavior by
 * inventing its own number. Idle, not total — the timer re-arms on every
 * output line, so only total silence kills the child. 5 minutes tolerates
 * upload CLIs that quiet their progress stream when piped (butler/swa run
 * with stdio piped, not a TTY).
 */
export const PUBLISH_IDLE_TIMEOUT_MS = 300_000;

function keepTail(buffer: string, chunk: string): string {
  const joined = buffer + chunk;
  return joined.length > CAPTURE_LIMIT ? joined.slice(-CAPTURE_LIMIT) : joined;
}

/** Per-stream line splitter: \n, \r\n, and bare \r (progress redraws) all flush. */
function lineEmitter(onOutput: (line: string) => void) {
  let carry = "";
  const push = (chunk: string) => {
    carry += chunk;
    const lines = carry.split(/\r\n|\r|\n/);
    carry = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) onOutput(line);
    }
  };
  const flush = () => {
    if (carry.trim()) onOutput(carry);
    carry = "";
  };
  return { push, flush };
}

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
    // Each stream gets its own carry buffer — interleaved stdout/stderr
    // chunks must not be glued into one garbled progress line.
    const noop = () => {};
    const outLines = lineEmitter(options.onOutput ?? noop);
    const errLines = lineEmitter(options.onOutput ?? noop);

    // Idle-kill timer (audit B2): a stalled butler/swa upload (connection open,
    // no bytes moving) would otherwise hang publish forever. Mirrors exec.ts's
    // execCapture: the timer is re-armed on every chunk of output (so a slow
    // BUT progressing upload is never killed), cleared on settle, and unref'd
    // so a pending call can't keep the process alive on its own.
    let settled = false;
    let idleTimer: NodeJS.Timeout | undefined;
    const clearIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = undefined;
    };
    const armIdle = () => {
      // Falsy (undefined OR 0) = no timeout. A bare undefined-check would turn
      // `timeoutMs: 0` — the natural encoding of "disabled" — into an instant
      // SIGKILL on the first tick (review finding).
      if (!options.timeoutMs) return;
      clearIdle();
      idleTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        if (options.onOutput) {
          outLines.flush();
          errLines.flush();
        }
        reject(
          new Error(
            `${cmd} produced no output for ${options.timeoutMs}ms and was stopped`,
          ),
        );
      }, options.timeoutMs);
      idleTimer.unref();
    };
    armIdle();

    child.stdout.on("data", (d: Buffer) => {
      const text = d.toString();
      stdout = keepTail(stdout, text);
      if (options.onOutput) outLines.push(text);
      armIdle();
    });
    child.stderr.on("data", (d: Buffer) => {
      const text = d.toString();
      stderr = keepTail(stderr, text);
      if (options.onOutput) errLines.push(text);
      armIdle();
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearIdle();
      reject(err);
    });
    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearIdle();
      if (options.onOutput) {
        outLines.flush();
        errLines.flush();
      }
      if (code === null) {
        reject(new Error(`${cmd} was killed by signal ${signal}`));
      } else {
        resolve({ code, stdout, stderr });
      }
    });
  });
};

/**
 * True when `cmd` resolves to an executable on the PATH. `env` (typically
 * {@link PublishDeps.env}) is forwarded to the probe so a host-injected PATH
 * influences resolution the same way it will influence the eventual spawn.
 */
export async function commandExists(
  cmd: string,
  runCommand: CommandRunner = defaultCommandRunner,
  env?: Record<string, string | undefined>,
): Promise<boolean> {
  // where.exe, not where: PowerShell aliases bare `where` to Where-Object
  // (same choice as lib/tool-probe.ts).
  const probe = process.platform === "win32" ? "where.exe" : "which";
  try {
    const result = await runCommand(probe, [cmd], env ? { env } : undefined);
    return result.code === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}
