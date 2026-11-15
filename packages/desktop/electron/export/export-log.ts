/**
 * What the app log records about an export: that it started, and how it ended.
 *
 * A failed export shows the author one line. The rest (the whole message, the
 * stack, how long it ran) is written here, because a packaged app has no
 * console and a long build's failure is otherwise gone when the toast is.
 */
import { redactUrlCredentials } from "../server-bridge/friendly-errors";

export interface ExportLog {
  /** An ordinary event (started, finished, canceled). */
  event(line: string): void;
  /** A fault. */
  error(line: string): void;
}

/** "12s", "3m 02s", "1h 04m". */
function elapsed(ms: number): string {
  const total = Math.round(ms / 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${two(total % 60)}s`;
  return `${Math.floor(total / 3600)}h ${two(Math.floor((total % 3600) / 60))}m`;
}

/** Run one export, logging its start and its outcome. The outcome itself is untouched. */
export async function loggedExport<T>(
  run: () => Promise<T>,
  log: ExportLog,
  now: () => number = Date.now,
): Promise<T> {
  const what = "[export] pdf build";
  const startedAt = now();
  log.event(`${what} started`);
  try {
    const result = await run();
    log.event(`${what} finished in ${elapsed(now() - startedAt)}`);
    return result;
  } catch (e) {
    const took = elapsed(now() - startedAt);
    const code = (e as { code?: unknown } | null)?.code;
    if (code === "EXPORT_CANCELED") {
      log.event(`${what} canceled after ${took}`);
      throw e;
    }
    const detail = (e as { detail?: unknown } | null)?.detail;
    const message = `${e instanceof Error ? e.message : String(e)}${typeof detail === "string" ? ` ${detail}` : ""}`;
    log.error(
      `${what} failed after ${took}${typeof code === "string" ? ` (${code})` : ""}: ${redactUrlCredentials(message)}`,
    );
    if (e instanceof Error && e.stack) log.error(redactUrlCredentials(e.stack));
    throw e;
  }
}
