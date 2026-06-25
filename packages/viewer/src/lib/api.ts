/**
 * Typed fetch client for SvelteKit +server.ts API routes.
 *
 * Each method corresponds to a route under src/routes/api/. Methods are added
 * here in each phase as IPC handlers are migrated to server routes. The
 * platform adapter (getPlatform()) remains in use for all handlers not yet
 * migrated.
 *
 * All methods throw on non-OK responses (with the response body as the message).
 */

async function post<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => r.statusText);
    throw new Error(msg || r.statusText);
  }
  return r.json() as Promise<T>;
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) {
    const msg = await r.text().catch(() => r.statusText);
    throw new Error(msg || r.statusText);
  }
  return r.json() as Promise<T>;
}

// ── Local type declarations (mirrors from contract.ts — no import to keep SPA clean) ─

export interface FileWriteResult {
  mtimeMs: number;
}

export interface FileStat {
  mtimeMs: number;
  size: number;
  exists: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface ProjectFileEntry {
  md: string[];
  css: string[];
}

/**
 * Typed API client. Methods are added here as IPC handlers are migrated
 * to +server.ts routes in Phase 2 and beyond.
 */
export const api = {
  /** Low-level helpers exposed for direct use when needed. */
  _post: post,
  _get: get,

  dialog: {
    /** Open native directory picker. Resolves null when cancelled. */
    openDirectory: () => post<string | null>('/api/dialog/open-directory'),
    /** Open native PDF save dialog. Resolves null when cancelled. */
    savePdf: (defaultName?: string) =>
      post<string | null>('/api/dialog/save-pdf', defaultName !== undefined ? { defaultName } : {}),
    /** Open native single image file picker. Resolves null when cancelled. */
    pickImageFile: () => post<string | null>('/api/dialog/pick-image-file'),
    /** Open native multi-select image file picker. Resolves [] when cancelled. */
    pickImageFiles: () => post<string[]>('/api/dialog/pick-image-files'),
  },

  shell: {
    /** Open a URL in the system browser. */
    openExternal: (url: string) => post<{ ok: boolean }>('/api/shell/open-external', { url }),
    /** Reveal a file in the OS file manager. */
    showInFolder: (filePath: string) =>
      post<{ ok: boolean }>('/api/shell/show-in-folder', { filePath }),
  },

  log: {
    /** Read an operation log file. Returns null when the file doesn't exist. */
    read: (logPath: string) => post<string | null>('/api/log/read', { logPath }),
  },

  fs: {
    /** Read a file as UTF-8 text. Path must be absolute. */
    readFile: (filePath: string) => post<string>('/api/fs/read-file', { path: filePath }),
    /**
     * Write UTF-8 content to a file. Path must be absolute. Triggers
     * auto-snapshot/sync debounce if the file is inside the open project.
     * Returns { mtimeMs } of the post-write stat.
     */
    writeFile: (filePath: string, content: string) =>
      post<FileWriteResult>('/api/fs/write-file', { path: filePath, content }),
    /** Stat a file. Returns { exists: false } instead of throwing when absent. */
    statFile: (filePath: string) => post<FileStat>('/api/fs/stat-file', { path: filePath }),
    /** List the immediate entries of a directory. Path must be absolute. */
    listDir: (dirPath: string) => post<DirEntry[]>('/api/fs/list-dir', { path: dirPath }),
    /** Copy a file into a destination directory. Creates destDir if absent. Returns the dest path. */
    copyFile: (src: string, dest: string) =>
      post<string>('/api/fs/copy-file', { src, dest }),
    /** Start watching a folder for changes. Only one watch at a time. */
    watchFolder: (dirPath: string) => post<{ ok: boolean }>('/api/fs/watch-folder', { path: dirPath }),
    /** Stop watching the currently watched folder. */
    unwatchFolder: (dirPath?: string) =>
      post<{ ok: boolean }>('/api/fs/unwatch-folder', dirPath ? { path: dirPath } : {}),
    /** List top-level .md and .css files in a project directory. */
    listProjectFiles: (projectDir: string) =>
      post<ProjectFileEntry>('/api/fs/list-project-files', { projectDir }),
  },
};
