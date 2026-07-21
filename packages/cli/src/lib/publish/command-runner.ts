/**
 * Default {@link CommandRunner}: spawn a child process, stream line-buffered
 * output, resolve with the exit code (callers decide whether non-zero is an
 * error — butler/swa diagnostics live in the captured output).
 *
 * A thin adapter over exec.ts's shared {@link spawnCapture} core — the
 * spawn/buffer/timeout/settle machinery lives THERE, once (arch finding #16;
 * this file previously kept a drifting mirror of it). What this seam adds:
 * an env override (publish providers pass secrets — BUTLER_API_KEY,
 * SWA_CLI_DEPLOYMENT_TOKEN — through the environment, NEVER through argv,
 * which is world-readable in process lists), per-line output streaming, and
 * a default idle timeout.
 */
import { spawnCapture } from "../exec.ts";
import type { CommandResult, CommandRunner } from "./types.ts";

/**
 * Captured stdout/stderr are kept only for a short error tail and a URL
 * scan — bound them so an hours-long `butler push` progress stream can't
 * grow two unbounded strings in memory.
 */
const CAPTURE_LIMIT = 64 * 1024;

/**
 * Default idle budget (audit B2 / review): applied BY THE RUNNER whenever
 * `timeoutMs` is omitted, so no call site (a provider upload, a
 * `commandExists` probe) can silently regain hang-forever behavior by
 * forgetting to pass it. `timeoutMs: 0` is the explicit opt-out. Idle, not
 * total — the timer re-arms on every output chunk, so only total silence
 * kills the child. 5 minutes tolerates upload CLIs that quiet their progress
 * stream when piped (butler/swa run with stdio piped, not a TTY).
 */
export const PUBLISH_IDLE_TIMEOUT_MS = 300_000;

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

// Settling: spawnCapture resolves on 'close' (stdio flushed) rather than
// 'exit', with an idle grace (EXIT_FLUSH_GRACE_MS, re-armed per chunk) for
// a grandchild that holds the pipes open — so output a delegating CLI's
// grandchild streams as/after the parent exits (the SWA CLI spawns
// StaticSitesClient) is captured, not truncated, and a silent detached
// daemon can't hang the runner.
//
// KNOWN LIMIT (review): the idle-timeout SIGKILL reaches the direct child
// only; a grandchild can be left briefly orphaned. The fix — detached
// process groups + negative-pid kill — would stop Ctrl+C from reaching the
// child in normal CLI use, a worse trade for a rarer case.
export const defaultCommandRunner: CommandRunner = async (
  cmd,
  args,
  options = {},
): Promise<CommandResult> => {
  // Each stream gets its own carry buffer — interleaved stdout/stderr
  // chunks must not be glued into one garbled progress line.
  const noop = () => {};
  const outLines = lineEmitter(options.onOutput ?? noop);
  const errLines = lineEmitter(options.onOutput ?? noop);
  try {
    const { code, signal, stdout, stderr } = await spawnCapture(cmd, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      timeoutMs: options.timeoutMs ?? PUBLISH_IDLE_TIMEOUT_MS,
      timeoutMode: "idle",
      captureLimit: CAPTURE_LIMIT,
      onChunk: options.onOutput
        ? (stream, text) => (stream === "stdout" ? outLines : errLines).push(text)
        : undefined,
    });
    if (code === null) {
      throw new Error(`${cmd} was killed by signal ${signal}`);
    }
    return { code, stdout, stderr };
  } finally {
    if (options.onOutput) {
      outLines.flush();
      errLines.flush();
    }
  }
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
