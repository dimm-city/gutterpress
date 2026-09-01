/**
 * Diagnostic-log reads for the "app lifecycle / diagnostics" IPC capability
 * (SFE-P5c1).
 *
 * Ports `src/routes/api/log/{list,read}/+server.ts` verbatim.
 */
import { readdir, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { getFsGuardHooks } from "../server-bridge/fs-guard";
import { requireWithinProjectRoot } from "./validation";

export interface LogFileEntry {
  name: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
}

/** Enumerate the app's diagnostic `.log` files (newest first), confined to
 *  the fs-guard's read-only roots (userData/logs). */
export async function logList(): Promise<LogFileEntry[]> {
  const roots = getFsGuardHooks()?.readOnlyRoots() ?? [];
  const entries: LogFileEntry[] = [];
  for (const root of roots) {
    let names: string[];
    try {
      names = await readdir(root);
    } catch {
      continue; // a root that doesn't exist yet simply has no logs
    }
    for (const name of names) {
      if (!name.endsWith(".log")) continue;
      const abs = path.join(root, name);
      try {
        const s = await stat(abs);
        if (!s.isFile()) continue;
        entries.push({ name, path: abs, sizeBytes: s.size, modifiedAt: new Date(s.mtimeMs).toISOString() });
      } catch {
        // vanished between readdir and stat — skip
      }
    }
  }
  entries.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
  return entries;
}

/** Read an operation log file. Returns null when the file doesn't exist (or
 *  no path was given). */
export async function logRead(rawLogPath: unknown): Promise<string | null> {
  if (!rawLogPath || typeof rawLogPath !== "string" || !path.isAbsolute(rawLogPath)) return null;
  await requireWithinProjectRoot(rawLogPath, "log:read", { includeReadOnlyRoots: true });
  try {
    return await readFile(rawLogPath, "utf-8");
  } catch {
    return null;
  }
}
