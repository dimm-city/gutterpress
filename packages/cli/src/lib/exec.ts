import { spawn } from "node:child_process";
import { readdir, mkdir, copyFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";

/** print-md's own node_modules/.bin so locally installed tools are found */
const localBin = resolvePath(join(import.meta.dirname, "..", "..", "node_modules", ".bin"));
const enhancedEnv = { ...process.env, PATH: `${localBin}:${process.env.PATH ?? ""}` };

/**
 * Spawn a child process, inherit stdio, reject on non-zero exit.
 */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", cwd: opts.cwd, env: enhancedEnv });
    p.on("error", reject);
    p.on("exit", (code) => {
      if (code === 0) return resolve();
      const cwd = opts.cwd ?? process.cwd();
      reject(new Error(`${cmd} ${args.join(" ")} (cwd=${cwd}) exited ${code}`));
    });
  });
}

/**
 * Spawn and capture stdout/stderr. Rejects on non-zero exit.
 */
export function execCapture(
  cmd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: enhancedEnv });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    p.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`${cmd} exited ${code}\n${stderr}`))
    );
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
