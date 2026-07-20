import { spawn } from "node:child_process";
import { readdir, mkdir, copyFile } from "node:fs/promises";
import { join, resolve as resolvePath, delimiter } from "node:path";

/**
 * Join `dir` onto the front of `existingPath` using `sep` (defaults to the
 * current platform's `node:path` delimiter — `:` on POSIX, `;` on Windows).
 * A pure function so the delimiter behavior is unit-testable without
 * needing to actually run on every OS — see exec.test.ts.
 */
export function buildEnhancedPath(
  dir: string,
  existingPath: string,
  sep: string = delimiter
): string {
  return `${dir}${sep}${existingPath}`;
}

/** print-md's own node_modules/.bin so locally installed tools are found. */
export const localBin = resolvePath(join(import.meta.dirname, "..", "..", "node_modules", ".bin"));

/**
 * PATH with `localBin` prepended, correctly delimiter-joined. Single source
 * of truth for every spawn in the lib — `run` and `execCapture` below use
 * it, and tool-probe.ts's `isToolAvailable`/`findTool` get it for free by
 * calling `execCapture` instead of keeping their own copy (previously a
 * literal `:` here corrupted PATH on Windows while tool-probe.ts's copy of
 * the same logic used `delimiter` correctly — see docs/reviews
 * 2026-07-10-architecture-critical-review.md, finding #3).
 */
export const enhancedPath = buildEnhancedPath(localBin, process.env.PATH ?? "");

function enhancedEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: enhancedPath };
}

/**
 * Spawn a child process, inherit stdio, reject on non-zero exit.
 */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", cwd: opts.cwd, env: enhancedEnv() });
    p.on("error", reject);
    p.on("exit", (code) => {
      if (code === 0) return resolve();
      const cwd = opts.cwd ?? process.cwd();
      reject(new Error(`${cmd} ${args.join(" ")} (cwd=${cwd}) exited ${code}`));
    });
  });
}

/**
 * After the child's 'exit', stdio data can still be in flight — buffered in
 * the pipes, or written by a grandchild that inherited them (the SWA CLI
 * spawns StaticSitesClient). Settling on 'exit' truncates that output, so we
 * settle on 'close' (stdio flushed) — but a detached grandchild can hold the
 * pipes open forever, so 'exit' arms this bounded grace and we settle with
 * whatever has arrived when it expires.
 */
export const EXIT_FLUSH_GRACE_MS = 2000;

export interface SpawnCaptureOptions {
  cwd?: string;
  /** Full child environment — callers compose it (no ambient default here). */
  env?: NodeJS.ProcessEnv;
  /** Kill budget in ms. 0/undefined = no timer. */
  timeoutMs?: number;
  /** "total" (default): one-shot deadline. "idle": re-armed on every chunk,
   * so only complete output silence kills the child. */
  timeoutMode?: "total" | "idle";
  /** Raw chunk tap, called per stream as data arrives. */
  onChunk?: (stream: "stdout" | "stderr", text: string) => void;
  /** Keep only the trailing N chars of each captured stream (unbounded when
   * unset) — bounds memory for hours-long progress streams. */
  captureLimit?: number;
  /** Override {@link EXIT_FLUSH_GRACE_MS} (tests). */
  exitGraceMs?: number;
}

function keepTail(buffer: string, chunk: string, limit: number | undefined): string {
  const joined = buffer + chunk;
  return limit !== undefined && joined.length > limit ? joined.slice(-limit) : joined;
}

/**
 * The lib's single "spawn, buffer stdout/stderr, settle" core. Resolves with
 * the exit code/signal for ANY exit (callers decide whether non-zero is an
 * error); rejects only on spawn error or timeout kill. Every timer is cleared
 * on settle and `unref()`d so a pending call can never keep the process alive
 * on its own. `execCapture` below and publish's `defaultCommandRunner` are
 * thin adapters over this — do not grow parallel spawn loops elsewhere
 * (previously four copies existed with different bug profiles — see
 * docs/reviews 2026-07-10-architecture-critical-review.md, finding #16).
 */
export function spawnCapture(
  cmd: string,
  args: string[],
  opts: SpawnCaptureOptions = {}
): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: opts.cwd,
      env: opts.env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let exited = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let killTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (graceTimer) clearTimeout(graceTimer);
      fn();
    };

    const armKill = (): void => {
      if (!opts.timeoutMs) return;
      if (killTimer) clearTimeout(killTimer);
      killTimer = setTimeout(() => {
        settle(() => {
          p.kill("SIGKILL");
          reject(
            new Error(
              opts.timeoutMode === "idle"
                ? `${cmd} produced no output for ${opts.timeoutMs}ms and was stopped`
                : `${cmd} ${args.join(" ")} timed out after ${opts.timeoutMs}ms`
            )
          );
        });
      }, opts.timeoutMs);
      killTimer.unref();
    };
    armKill();

    const onData = (stream: "stdout" | "stderr") => (d: Buffer) => {
      const text = d.toString();
      if (stream === "stdout") stdout = keepTail(stdout, text, opts.captureLimit);
      else stderr = keepTail(stderr, text, opts.captureLimit);
      opts.onChunk?.(stream, text);
      if (opts.timeoutMode === "idle" && !exited) armKill();
    };
    p.stdout.on("data", onData("stdout"));
    p.stderr.on("data", onData("stderr"));
    p.on("error", (err) => settle(() => reject(err)));

    const finish = (): void =>
      settle(() => resolve({ code: exitCode, signal: exitSignal, stdout, stderr }));

    p.on("exit", (code, signal) => {
      exited = true;
      exitCode = code;
      exitSignal = signal;
      // The child is gone — the kill timer's job is done. Wait for 'close'
      // (stdio flushed) up to a bounded grace: see EXIT_FLUSH_GRACE_MS.
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = undefined;
      }
      graceTimer = setTimeout(finish, opts.exitGraceMs ?? EXIT_FLUSH_GRACE_MS);
      graceTimer.unref();
    });
    p.on("close", finish);
  });
}

/**
 * Spawn and capture stdout/stderr. Rejects on non-zero exit, on spawn
 * error, or — when `timeoutMs` is given — if the child hasn't exited in
 * time (it is then SIGKILLed). A thin adapter over {@link spawnCapture};
 * build-fingerprint.ts, diagnostics.ts, and tool-probe.ts all call this
 * instead of keeping their own copies.
 */
export async function execCapture(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  const { code, signal, stdout, stderr } = await spawnCapture(cmd, args, {
    cwd: opts.cwd,
    env: enhancedEnv(),
    timeoutMs: opts.timeoutMs,
  });
  if (code === 0) return { stdout, stderr };
  throw new Error(
    code === null
      ? `${cmd} was killed by signal ${signal}\n${stderr}`
      : `${cmd} exited ${code}\n${stderr}`
  );
}

/**
 * Recursively copy a directory tree.
 */
export async function copyDir(src: string, dst: string): Promise<void> {
  await mkdir(dst, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = join(src, e.name);
    const d = join(dst, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d);
    } else {
      await copyFile(s, d);
    }
  }
}
