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
 * Spawn and capture stdout/stderr. Rejects on non-zero exit, on spawn
 * error, or — when `timeoutMs` is given — if the child hasn't exited in
 * time (it is then SIGKILLed). This is the lib's single "spawn, buffer
 * stdout/stderr, resolve on exit" implementation; build-fingerprint.ts,
 * diagnostics.ts, and tool-probe.ts all call this instead of keeping their
 * own copies (previously four parallel copies existed with different bug
 * profiles — see docs/reviews 2026-07-10-architecture-critical-review.md,
 * finding #16). The kill timer, when set, is cleared on every settle path
 * and `unref()`d so a pending call can never keep the process alive on its
 * own.
 */
export function execCapture(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: opts.cwd,
      env: enhancedEnv(),
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };

    if (opts.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        settle(() => {
          p.kill("SIGKILL");
          reject(new Error(`${cmd} ${args.join(" ")} timed out after ${opts.timeoutMs}ms`));
        });
      }, opts.timeoutMs);
      timer.unref();
    }

    p.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    p.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    p.on("error", (err) => settle(() => reject(err)));
    p.on("exit", (code, signal) => {
      settle(() => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(
          new Error(
            code === null
              ? `${cmd} was killed by signal ${signal}\n${stderr}`
              : `${cmd} exited ${code}\n${stderr}`
          )
        );
      });
    });
  });
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
