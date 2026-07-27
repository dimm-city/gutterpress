/**
 * Host-side `.md` launch handling. Finder/Explorer/a desktop entry gives
 * Electron a file path; this module validates it, finds the nearest enclosing
 * print-md manifest, and queues the result until the renderer subscribes.
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MANIFEST_FILENAMES } from "@dimm-city/print-md";
import type { MarkdownFileLaunchEvent } from "./bridge-types";

export function isMarkdownFilePath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".md";
}

/** Convert one OS launch value to a local absolute Markdown path. */
export function markdownPathFromLaunchValue(
  raw: string,
  workingDirectory: string,
): string | null {
  const trimmed = raw.trim();
  let candidate =
    trimmed.length >= 2 &&
    trimmed[0] === trimmed.at(-1) &&
    (trimmed[0] === '"' || trimmed[0] === "'")
      ? trimmed.slice(1, -1)
      : trimmed;
  if (!candidate) return null;

  // Do not mistake a Windows drive prefix for a URL scheme. Every real scheme
  // except file: is remote/unsupported for an OS file-association launch.
  const windowsDrivePath = /^[a-z]:[\\/]/i.test(candidate);
  const scheme = windowsDrivePath ? null : /^([a-z][a-z\d+.-]*):/i.exec(candidate)?.[1];
  if (scheme) {
    if (scheme.toLowerCase() !== "file") return null;
    try {
      const url = new URL(candidate);
      if (url.hostname && url.hostname.toLowerCase() !== "localhost") return null;
      candidate = fileURLToPath(url);
    } catch {
      return null;
    }
  }

  if (!isMarkdownFilePath(candidate)) return null;
  return path.isAbsolute(candidate)
    ? path.normalize(candidate)
    : path.resolve(workingDirectory, candidate);
}

/** Extract absolute `.md` paths from Electron's initial/second-instance argv. */
export function markdownFilePathsFromArgv(
  argv: readonly string[],
  workingDirectory: string,
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const raw of argv) {
    const absolute = markdownPathFromLaunchValue(raw, workingDirectory);
    if (!absolute) continue;
    if (!seen.has(absolute)) {
      seen.add(absolute);
      paths.push(absolute);
    }
  }
  return paths;
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function unavailable(filePath: string): MarkdownFileLaunchEvent {
  return {
    type: "error",
    filePath,
    message: `print-md couldn't open "${path.basename(filePath)}" because the file isn't available. Check that it still exists and that you can read it.`,
  };
}

/** Resolve a selected chapter to its nearest manifest-bearing ancestor. */
export async function resolveMarkdownFileLaunch(
  filePath: string,
): Promise<MarkdownFileLaunchEvent> {
  const absolute = markdownPathFromLaunchValue(filePath, process.cwd());
  if (!absolute || !(await isRegularFile(absolute))) {
    return unavailable(absolute ?? filePath);
  }

  let dir = path.dirname(absolute);
  while (true) {
    for (const manifestName of MANIFEST_FILENAMES) {
      if (await isRegularFile(path.join(dir, manifestName))) {
        return { type: "open", filePath: absolute, projectDir: dir };
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return {
    type: "error",
    filePath: absolute,
    message:
      `"${path.basename(absolute)}" isn't inside a print-md project. ` +
      `Open a Markdown chapter from a folder that contains ${MANIFEST_FILENAMES[0]} ` +
      `(recognized legacy names: ${MANIFEST_FILENAMES.slice(1).join(", ")}).`,
  };
}

export interface MarkdownFileLaunchQueueDeps {
  resolve(filePath: string): Promise<MarkdownFileLaunchEvent>;
  emit(event: MarkdownFileLaunchEvent): void;
}

/**
 * Retains launch paths until the preload listener is installed. A `ready`
 * sentinel is emitted only after every path queued during startup has resolved.
 */
export class MarkdownFileLaunchQueue {
  private readonly pending: string[] = [];
  private activePath: string | null = null;
  private consumerReady = false;
  private drainPromise: Promise<void> | null = null;

  constructor(private readonly deps: MarkdownFileLaunchQueueDeps) {}

  enqueue(filePath: string): void {
    const absolute = markdownPathFromLaunchValue(filePath, process.cwd());
    if (!absolute) return;
    if (this.activePath === absolute || this.pending.includes(absolute)) return;
    this.pending.push(absolute);
    if (this.consumerReady) void this.drain();
  }

  enqueueMany(filePaths: readonly string[]): void {
    for (const filePath of filePaths) this.enqueue(filePath);
  }

  async markConsumerReady(): Promise<void> {
    this.consumerReady = true;
    await this.drain();
    if (this.consumerReady) this.deps.emit({ type: "ready" });
  }

  suspend(): void {
    this.consumerReady = false;
  }

  private drain(): Promise<void> {
    if (!this.consumerReady) return Promise.resolve();
    if (this.drainPromise) return this.drainPromise;

    const run = (async () => {
      while (this.consumerReady && this.pending.length > 0) {
        const filePath = this.pending.shift()!;
        this.activePath = filePath;
        const event = await this.deps.resolve(filePath).catch(() => unavailable(filePath));
        this.activePath = null;
        if (!this.consumerReady) {
          this.pending.unshift(filePath);
          return;
        }
        this.deps.emit(event);
      }
    })();

    this.drainPromise = run.finally(() => {
      this.activePath = null;
      this.drainPromise = null;
      if (this.consumerReady && this.pending.length > 0) void this.drain();
    });
    return this.drainPromise;
  }
}
