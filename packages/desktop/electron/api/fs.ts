/**
 * Filesystem operations for the "files/dialog" IPC capability (SFE-P5c1).
 *
 * Ports `src/routes/api/fs/{read-file,write-file,stat-file,list-dir,
 * list-project-files,create-file,create-folder,rename,delete}/+server.ts`
 * verbatim: same validation order, same write-effect side calls
 * (`scheduleAutoWriteEffects`/`notifyPreviewSettledWrite`), same
 * snapshot-before-delete discipline. `fs/copy-file` is NOT ported — it had
 * zero callers (no `api.fs.*` wrapper ever existed for it; the SPA's
 * insert-image/import flows both go through `media:importImage`, a P5c4
 * route) and no test exercised it as a real caller-driven path, only as
 * route-level guard coverage — see the run report's "dead route" note.
 */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { gitIdentityFrom } from "../git-identity";
import { getPrefsHooks } from "../server-bridge/prefs-hooks";
import { getVcsHooks, type VcsHooks } from "../server-bridge/vcs-hooks";
import { notifyPreviewSettledWrite, scheduleAutoWriteEffects } from "../server-bridge/write-hooks";
import { deepMergeSettings } from "../../src/lib/settings-merge";
import { DEFAULT_SETTINGS, type AppSettings, type DeepPartial } from "../../src/lib/platform/shared-types";
import { requireAbsolute, requireSegment, requireWithinProjectRoot } from "./validation";

/**
 * The author's configured commit identity for a host-initiated (not
 * user-typed) snapshot. Mirrors the deleted `src/lib/server/settings.ts`'s
 * `gitIdentityArgs()` exactly (same `DEFAULT_SETTINGS` merge, same
 * `gitIdentityFrom` call) so this IPC path and every other commit path keep
 * agreeing on who the author is.
 */
async function gitIdentityArgs(): Promise<ReturnType<typeof gitIdentityFrom>> {
  const hooks = getPrefsHooks();
  if (!hooks) return gitIdentityFrom(DEFAULT_SETTINGS);
  const merged = deepMergeSettings(DEFAULT_SETTINGS, (await hooks.readSettings()) as DeepPartial<AppSettings>);
  return gitIdentityFrom(merged);
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface FileStat {
  mtimeMs: number;
  size: number;
  exists: boolean;
}

export interface FileWriteResult {
  mtimeMs: number;
}

export interface ProjectFileEntry {
  md: string[];
  css: string[];
}

/** Read a file as UTF-8 text. Path must be absolute and inside the open
 *  project (or a read-only root — the crash-recovery sidecar). */
export async function fsReadFile(rawPath: unknown): Promise<string> {
  const target = await requireWithinProjectRoot(
    requireAbsolute(rawPath, "fs:readFile"),
    "fs:readFile",
    { includeReadOnlyRoots: true },
  );
  return readFile(target, "utf-8");
}

/** Write UTF-8 content to a file inside the open project. Arms the
 *  auto-snapshot/sync debounce and notifies the active preview. */
export async function fsWriteFile(rawPath: unknown, content: unknown): Promise<FileWriteResult> {
  if (typeof content !== "string") throw new Error("content is required");
  const target = await requireWithinProjectRoot(requireAbsolute(rawPath, "fs:writeFile"), "fs:writeFile");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf-8");
  notifyPreviewSettledWrite(target, content);
  scheduleAutoWriteEffects(target);
  const s = await stat(target);
  return { mtimeMs: s.mtimeMs };
}

/** Stat a file. Returns `{ exists: false }` instead of throwing when absent. */
export async function fsStatFile(rawPath: unknown): Promise<FileStat> {
  const target = await requireWithinProjectRoot(requireAbsolute(rawPath, "fs:statFile"), "fs:statFile");
  try {
    const s = await stat(target);
    return { mtimeMs: s.mtimeMs, size: s.size, exists: true };
  } catch {
    return { mtimeMs: 0, size: 0, exists: false };
  }
}

/** List the immediate entries of a directory inside the open project. */
export async function fsListDir(rawPath: unknown): Promise<DirEntry[]> {
  const target = await requireWithinProjectRoot(requireAbsolute(rawPath, "fs:listDir"), "fs:listDir");
  const entries = await readdir(target, { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    path: path.join(target, entry.name),
    isDir: entry.isDirectory(),
  }));
}

/** List top-level `.md`/`.css` files in a project directory, sorted. */
export async function fsListProjectFiles(rawProjectDir: unknown): Promise<ProjectFileEntry> {
  const projectDir = await requireWithinProjectRoot(
    requireAbsolute(rawProjectDir, "fs:listProjectFiles"),
    "fs:listProjectFiles",
  );
  const entries = await readdir(projectDir, { withFileTypes: true });
  const md: string[] = [];
  const css: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (lower.endsWith(".md")) md.push(entry.name);
    else if (lower.endsWith(".css")) css.push(entry.name);
  }
  md.sort((a, b) => a.localeCompare(b));
  css.sort((a, b) => a.localeCompare(b));
  return { md, css };
}

/** Create a new file under `dir`. Fails (already-exists) rather than
 *  silently overwriting — this is a CREATE, not a save. */
export async function fsCreateFile(
  rawDir: unknown,
  rawName: unknown,
  rawContent: unknown,
): Promise<{ path: string; mtimeMs: number }> {
  const dir = await requireWithinProjectRoot(requireAbsolute(rawDir, "fs:createFile"), "fs:createFile");
  const name = requireSegment(rawName, "fs:createFile name");
  const content = typeof rawContent === "string" ? rawContent : "";
  const target = await requireWithinProjectRoot(path.join(dir, name), "fs:createFile");
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(target, content, { encoding: "utf-8", flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "EEXIST") {
      throw new Error(`"${name}" already exists here.`);
    }
    throw e;
  }
  scheduleAutoWriteEffects(target);
  const s = await stat(target);
  return { path: target, mtimeMs: s.mtimeMs };
}

/** Create a new folder under `dir`. Fails (already-exists) rather than
 *  silently merging into an existing entry. */
export async function fsCreateFolder(rawDir: unknown, rawName: unknown): Promise<{ path: string }> {
  const dir = await requireWithinProjectRoot(requireAbsolute(rawDir, "fs:createFolder"), "fs:createFolder");
  const name = requireSegment(rawName, "fs:createFolder name");
  const target = await requireWithinProjectRoot(path.join(dir, name), "fs:createFolder");
  try {
    await mkdir(target, { recursive: false });
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "EEXIST") {
      throw new Error(`"${name}" already exists here.`);
    }
    throw e;
  }
  scheduleAutoWriteEffects(target);
  return { path: target };
}

/** Rename a file/folder WITHIN the same parent directory (never a move). */
export async function fsRename(rawPath: unknown, rawNewName: unknown): Promise<{ path: string }> {
  const from = await requireWithinProjectRoot(requireAbsolute(rawPath, "fs:rename"), "fs:rename");
  const newName = requireSegment(rawNewName, "fs:rename newName");
  const dir = path.dirname(from);
  const to = await requireWithinProjectRoot(path.join(dir, newName), "fs:rename");
  if (path.resolve(to) === path.resolve(from)) {
    return { path: to }; // no-op rename
  }
  const exists = await stat(to).then(
    () => true,
    () => false,
  );
  if (exists) throw new Error(`"${newName}" already exists here.`);
  await rename(from, to);
  scheduleAutoWriteEffects(to);
  return { path: to };
}

// Local type — a narrow slice of the lib's real surface, ported verbatim
// from the deleted fs/delete/+server.ts (same rationale as that route's own
// comment: a hand-narrowed shape, not the full generated `LibModule`).
interface ProjectSourceLike {
  type: string;
}
interface DeleteLibModule {
  detectProjectSource: (dir: string) => Promise<ProjectSourceLike>;
  capabilitiesFor: (source: ProjectSourceLike) => { canSnapshot: boolean };
  repoRootForSource: (source: ProjectSourceLike, fallbackDir: string) => string;
  providerFor: (source: ProjectSourceLike) => {
    snapshot: (opts: {
      projectDir: string;
      message: string;
      logFile?: string;
      authorName?: string;
      authorEmail?: string;
    }) => Promise<unknown>;
  };
  isNoChangesError: (e: unknown) => boolean;
}

/**
 * Delete a file or folder (recursive). When the project has version history
 * the working tree is snapshotted FIRST — the delete does not proceed if
 * that safety snapshot fails, mirroring restoreSnapshot's discipline.
 */
export async function fsDeletePath(rawPath: unknown, rawProjectDir: unknown): Promise<{ ok: true }> {
  const projectDir = await requireWithinProjectRoot(requireAbsolute(rawProjectDir, "fs:delete"), "fs:delete");
  const target = await requireWithinProjectRoot(requireAbsolute(rawPath, "fs:delete"), "fs:delete");
  if (path.resolve(target) === path.resolve(projectDir)) {
    throw new Error("fs:delete cannot delete the project root");
  }

  const vcs = getVcsHooks<DeleteLibModule>() as VcsHooks<DeleteLibModule> | null;
  if (vcs) {
    const lib = await vcs.loadLib();
    try {
      const source = await lib.detectProjectSource(projectDir);
      if (lib.capabilitiesFor(source).canSnapshot) {
        const repoRoot = lib.repoRootForSource(source, projectDir);
        await lib.providerFor(source).snapshot({
          projectDir,
          message: `Before deleting ${path.basename(target)}`,
          ...(await gitIdentityArgs()),
          logFile: vcs.operationLogPath(path.basename(repoRoot)),
        });
      }
    } catch (e) {
      if (!lib.isNoChangesError(e)) {
        throw new Error(
          `Could not save a safety snapshot before deleting — nothing was deleted. (${
            e instanceof Error ? e.message : String(e)
          })`,
        );
      }
    }
  }

  await rm(target, { recursive: true, force: false });
  scheduleAutoWriteEffects(target);
  return { ok: true };
}
