/**
 * Google Drive publish provider (#221, docs/gdrive-publish-plan.md).
 *
 * Uploads the finished PDF — or, when the manifest selects the HTML format
 * (phase 3, D8), the website export packaged as a single ZIP — to a folder
 * in the author's Google Drive. Drive dropped site hosting in 2016, so it is
 * file delivery, not web hosting: Azure Static Web Apps remains the "publish
 * a website" provider, and the HTML outcome's follow-up copy says so.
 * Connects via browser OAuth consent (`google-auth.ts` — no pasted key);
 * uploads via the plain-fetch resumable protocol (`google-drive.ts`, D7).
 * Publishing again finds the previous file by name in the target folder and
 * updates it in place (D6), so a shared `webViewLink` stays valid across
 * republishes.
 */
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Zip, ZipDeflate, type DeflateOptions, type FlateError } from "fflate";
import { bookSlug } from "../../output-paths.ts";
import {
  GDRIVE_HOST,
  requireGoogleClientCredentials,
} from "../google-auth.ts";
import {
  createFolder,
  driveAbout,
  ensureFolder,
  findFileInFolder,
  getFolderById,
  listFolders,
  refreshAccessToken,
  resumableUpload,
  type DriveFolder,
} from "../google-drive.ts";
import {
  resolvePublishCredential,
  type PreflightIssue,
  type PublishAuthStatus,
  type PublishOutcome,
  type PublishProduct,
  type PublishProvider,
  type PublishProviderInfo,
  type PublishRequest,
} from "../types.ts";

/** Default folder name when the manifest sets neither `folder` nor
 * `folderId` (D5, ratified: one shared "Gutterpress" folder, not
 * per-book-title folders). */
const DEFAULT_FOLDER_NAME = "Gutterpress";

const NOT_CONNECTED_MESSAGE =
  "Google Drive isn't connected. Run `gutterpress publish --provider gdrive --connect` (or set GDRIVE_REFRESH_TOKEN) first.";

const info: PublishProviderInfo = {
  id: "gdrive",
  label: "Google Drive",
  kind: "api",
  format: "pdf",
  // #221 phase 3, D8: gdrive is the one provider that can publish either
  // build output. `format` above stays the default (PDF) so an unset
  // publish.gdrive.format keeps every existing book's behavior unchanged.
  formats: ["pdf", "html"],
  description:
    "Upload the finished PDF (or the website export, zipped) to a folder in your Google Drive — publishing again updates the same file, so shared links stay current. Drive delivers files, not live websites; use Azure Static Web Apps to publish the HTML export as a site.",
  configFields: [{ key: "folder", label: "Drive folder", placeholder: DEFAULT_FOLDER_NAME }],
  credential: {
    required: true,
    host: GDRIVE_HOST,
    envVar: "GDRIVE_REFRESH_TOKEN",
    connect: "oauth",
    hint: "Click Connect Google Drive and approve in your browser — nothing to paste.",
  },
  destinations: { label: "Folder", canCreate: true },
};

interface GDriveConfig {
  folder?: string;
  folderId?: string;
}

function readConfig(req: PublishRequest): GDriveConfig {
  const cfg = req.config as GDriveConfig;
  return {
    folder: cfg.folder?.trim() || undefined,
    folderId: cfg.folderId?.trim() || undefined,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Mint a fresh access token for this operation (D4: refresh-on-demand, never
 * persisted). Throws a friendly, token-free error when there's no stored
 * credential or no client configured. */
async function getAccessToken(
  req: PublishRequest,
): Promise<{ accessToken: string; source: "env" | "store" }> {
  const resolved = await resolvePublishCredential(info, req.deps);
  if (!resolved) throw new Error(NOT_CONNECTED_MESSAGE);
  const { clientId, clientSecret } = requireGoogleClientCredentials();
  const { accessToken } = await refreshAccessToken(req.deps.fetch ?? globalThis.fetch, {
    clientId,
    clientSecret,
    refreshToken: resolved.credential.token,
  });
  return { accessToken, source: resolved.source };
}

/** Resolve the target folder per D5: explicit `folderId` (verified alive) →
 * find-by-name → create at My Drive root. */
async function resolveFolder(
  fetchImpl: typeof fetch,
  accessToken: string,
  cfg: GDriveConfig,
): Promise<DriveFolder> {
  if (cfg.folderId) {
    const folder = await getFolderById(fetchImpl, accessToken, cfg.folderId);
    if (!folder) {
      throw new Error(
        `The Drive folder recorded in publish.gdrive.folderId ("${cfg.folderId}") can't be found — it may have been trashed or the id copied wrong. Pick the folder again.`,
      );
    }
    return folder;
  }
  return ensureFolder(fetchImpl, accessToken, cfg.folder || DEFAULT_FOLDER_NAME);
}

function folderUrl(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`;
}

function toDestination(folder: DriveFolder): PublishProduct {
  return { id: folder.id, title: folder.name, url: folderUrl(folder.id) };
}

/** What actually gets uploaded: a local file path + the Drive-visible name.
 * For the PDF format this IS the artifact; for HTML (D8) it's the zipped
 * export, in a temp file `cleanup` removes once the upload finishes (or
 * fails) — the upload path itself doesn't care which one it got. */
interface UploadSource {
  filePath: string;
  fileName: string;
  mimeType: string;
  cleanup: () => Promise<void>;
}

/** Bytes pushed into fflate's streaming `ZipDeflate` per `push()` call (see
 * `zipEntriesNonBlocking` below) — small enough that no single push blocks
 * the event loop for long, large enough not to dominate runtime with
 * per-chunk overhead. */
const ZIP_CHUNK_BYTES = 64 * 1024;

/** Yield one turn of the event loop. A `setImmediate` macrotask, not a
 * microtask (`queueMicrotask`/bare `await`) — a microtask-only yield still
 * starves timers/I/O and the WebSocket `onProgress` stream this exists to
 * keep alive. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Build a ZIP archive from `entries` without blocking the event loop for the
 * archive's whole build time — and WITHOUT ever touching fflate's
 * worker-based async API.
 *
 * This replaced a call to fflate's async `zip()` after a review finding
 * (#221 group A, A7 follow-up) showed that API is non-blocking only because
 * it hands any entry >= ~156 KB (`size < 160000` in fflate's own source) off
 * to a `worker_threads` Worker running an eval'd copy of fflate's source
 * (fflate's `wrk()`/`astrmify`, `node-worker.cjs`). That works under plain
 * Node, but under both `bun` and a `bun build --compile` binary — this
 * project's actual shipped artifact, see CLAUDE.md "What Gutterpress ships"
 * — the eval'd worker throws `TypeError: undefined is not an object
 * (evaluating 'dat.length')` for any such entry. Every real book's
 * `book.html` exceeds that threshold, so gdrive's HTML publish was broken in
 * the shipped CLI binary despite being claimed fixed. `zipSync()` doesn't
 * hit this — it never spawns a worker — but it blocks the event loop for the
 * archive's whole build, which is what non-blocking exists to avoid in the
 * first place (Electron MAIN process, desktop publish: a synchronous zip of
 * a large website export freezes the app UI and stalls the `onProgress`
 * stream for as long as the archive takes to build).
 *
 * The fix streams each entry through fflate's fully SYNCHRONOUS `ZipDeflate`
 * (backed by fflate's in-thread `Deflate` stream — no worker, ever, at any
 * size) in `ZIP_CHUNK_BYTES` pieces, yielding one event-loop turn between
 * chunks. That keeps the event loop responsive — the same goal the worker
 * API existed for — using only fflate code paths that run in-thread and are
 * therefore correct under `bun build --compile`.
 */
function zipEntriesNonBlocking(
  entries: Record<string, Uint8Array>,
  opts: DeflateOptions,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;

    const archive = new Zip((err: FlateError | null, chunk: Uint8Array | null, final: boolean | undefined) => {
      if (settled) return;
      if (err) {
        settled = true;
        reject(err);
        return;
      }
      if (chunk) {
        chunks.push(chunk);
        total += chunk.length;
      }
      if (final) {
        settled = true;
        const out = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          out.set(c, offset);
          offset += c.length;
        }
        resolve(out);
      }
    });

    (async () => {
      for (const [name, data] of Object.entries(entries)) {
        const stream = new ZipDeflate(name, opts);
        archive.add(stream);
        if (data.length === 0) {
          stream.push(new Uint8Array(0), true);
          continue;
        }
        for (let offset = 0; offset < data.length; offset += ZIP_CHUNK_BYTES) {
          const end = Math.min(offset + ZIP_CHUNK_BYTES, data.length);
          stream.push(data.subarray(offset, end), end >= data.length);
          await yieldToEventLoop();
        }
      }
      archive.end();
    })().catch((e) => {
      if (!settled) {
        settled = true;
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

/** Recursively collect every FILE under `dir` into `out`, keyed by its path
 * relative to `root` with forward slashes (the zip-entry name Drive/most
 * unzip tools expect regardless of host OS). A symlink's `Dirent` reports
 * neither `isFile()` nor `isDirectory()` (those reflect the link itself,
 * not its target), so it's resolved explicitly via `stat()` and followed —
 * a symlinked asset inside the export directory must not silently vanish
 * from the zip. A broken symlink, or any other non-file/dir/symlink entry
 * (socket, fifo, …), is skipped with a warning rather than silently. */
async function collectZipEntries(
  root: string,
  dir: string,
  out: Record<string, Uint8Array>,
  onWarn?: (message: string) => void,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectZipEntries(root, full, out, onWarn);
    } else if (entry.isFile()) {
      const rel = path.relative(root, full).split(path.sep).join("/");
      out[rel] = await readFile(full);
    } else if (entry.isSymbolicLink()) {
      const resolved = await stat(full).catch(() => null);
      if (resolved?.isFile()) {
        const rel = path.relative(root, full).split(path.sep).join("/");
        out[rel] = await readFile(full);
      } else if (resolved?.isDirectory()) {
        await collectZipEntries(root, full, out, onWarn);
      } else {
        onWarn?.(`Skipped "${path.relative(root, full)}" in the website export — it's a broken symlink.`);
      }
    } else {
      onWarn?.(`Skipped "${path.relative(root, full)}" in the website export — not a file, folder, or symlink.`);
    }
  }
}

/**
 * Package the HTML export directory into a single ZIP (D8: Drive is file
 * delivery, not web hosting — no N-file folder mirroring). Built via
 * `zipEntriesNonBlocking` (fflate is already a dependency, see
 * theme-import.ts for the sibling unzip-side usage) so building the archive
 * doesn't block the event loop, then written to a temp file so the existing
 * file-based `resumableUpload` (google-drive.ts) can read it incrementally
 * like any other artifact. Note this is true only of the UPLOAD step — the
 * ZIP-BUILD step above necessarily holds the whole compressed archive in
 * memory before it's written out below.
 */
export async function zipHtmlExport(
  exportDir: string,
  title: string,
  onWarn?: (message: string) => void,
  // Test-only seam (same DI convention as google-drive.ts's fetchImpl/
  // sleepImpl): lets a test force a failure in the write step, after
  // mkdtemp, without touching the real filesystem's failure modes.
  writeArchiveImpl: (filePath: string, data: Uint8Array) => Promise<void> = writeFile,
): Promise<UploadSource> {
  const entries: Record<string, Uint8Array> = {};
  await collectZipEntries(exportDir, exportDir, entries, onWarn);
  const fileName = `${bookSlug(title)}-website.zip`;
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "gutterpress-gdrive-"));
  try {
    const filePath = path.join(tmpRoot, fileName);
    const zipped = await zipEntriesNonBlocking(entries, { level: 6 });
    await writeArchiveImpl(filePath, zipped);
    return {
      filePath,
      fileName,
      mimeType: "application/zip",
      cleanup: () => rm(tmpRoot, { recursive: true, force: true }),
    };
  } catch (e) {
    // mkdtemp() ran inside this function, before the caller's own
    // try/finally that owns `source.cleanup()` — a failure anywhere below
    // this point must not leak the temp directory it created.
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

export const gdriveProvider: PublishProvider = {
  info,

  async authenticate(req): Promise<PublishAuthStatus> {
    const resolved = await resolvePublishCredential(info, req.deps);
    if (!resolved) return { ok: false, message: NOT_CONNECTED_MESSAGE };
    try {
      const { accessToken } = await getAccessToken(req);
      // Confirms the token actually works (not just present) — mirrors
      // shopify.ts's authenticate, which makes one real API call.
      await driveAbout(req.deps.fetch ?? globalThis.fetch, accessToken);
      return { ok: true, source: resolved.source };
    } catch (e) {
      return { ok: false, source: resolved.source, message: e instanceof Error ? e.message : String(e) };
    }
  },

  async preflight(_req): Promise<PreflightIssue[]> {
    // Offline-only, like shopify.ts. Nothing to check beyond the shared
    // artifact checks run-publish.ts already applies — folder resolution and
    // the quota check both need the network, so they run in upload().
    return [];
  },

  async listDestinations(req): Promise<PublishProduct[]> {
    const { accessToken } = await getAccessToken(req);
    const folders = await listFolders(req.deps.fetch ?? globalThis.fetch, accessToken);
    return folders.map(toDestination);
  },

  async createDestination(req, name): Promise<PublishProduct> {
    const { accessToken } = await getAccessToken(req);
    const folder = await createFolder(req.deps.fetch ?? globalThis.fetch, accessToken, name);
    return toDestination(folder);
  },

  async upload(req): Promise<PublishOutcome> {
    const fetchImpl = req.deps.fetch ?? globalThis.fetch;
    const cfg = readConfig(req);
    const { accessToken } = await getAccessToken(req);
    const isHtml = req.artifact.format === "html";

    // HTML exports are a whole directory; Drive is file delivery, not web
    // hosting (D8), so package it into ONE zip before anything else — the
    // quota check right below must see the zip's size, not the export
    // directory's (which stat() can't even give a meaningful total for).
    const source: UploadSource = isHtml
      ? await zipHtmlExport(req.artifact.path, req.project.title, (msg) => req.deps.onProgress?.(msg))
      : {
          filePath: req.artifact.path,
          fileName: path.basename(req.artifact.path),
          mimeType: "application/pdf",
          cleanup: async () => {},
        };

    try {
      // Quota fail-fast BEFORE any bytes move (D7).
      const artifactStat = await stat(source.filePath);
      const about = await driveAbout(fetchImpl, accessToken);
      if (about.quota.limitBytes != null && about.quota.freeBytes != null) {
        if (artifactStat.size > about.quota.freeBytes) {
          throw new Error(
            `Your Google Drive is full — this ${isHtml ? "website export" : "PDF"} needs ${formatBytes(artifactStat.size)} but only ${formatBytes(about.quota.freeBytes)} is free.`,
          );
        }
      }

      req.deps.onProgress?.("Resolving the Drive folder…");
      const folder = await resolveFolder(fetchImpl, accessToken, cfg);

      const fileName = source.fileName;
      const existing = await findFileInFolder(fetchImpl, accessToken, folder.id, fileName);

      req.deps.onProgress?.(
        existing ? `Updating "${fileName}" in "${folder.name}"…` : `Uploading "${fileName}" to "${folder.name}"…`,
      );

      let lastReported = -1;
      const file = await resumableUpload(fetchImpl, accessToken, {
        ...(existing ? { fileId: existing.id } : {}),
        name: fileName,
        parentFolderId: folder.id,
        filePath: source.filePath,
        totalBytes: artifactStat.size,
        mimeType: source.mimeType,
        onProgress: (uploaded, total) => {
          // Throttle to whole percent so a fast connection doesn't spam
          // onProgress once per 8 MiB chunk boundary at 100% granularity.
          const pct = total > 0 ? Math.floor((uploaded / total) * 100) : 100;
          if (pct !== lastReported) {
            lastReported = pct;
            req.deps.onProgress?.(`Uploaded ${formatBytes(uploaded)} of ${formatBytes(total)} (${pct}%)…`);
          }
        },
      });

      return {
        kind: "published",
        url: file.webViewLink,
        detail: `Uploaded "${fileName}" to the "${folder.name}" folder in your Google Drive${existing ? " (updated the existing file)" : ""}.`,
        followUp: [
          "To share it, open it in Drive and use the Share button — Gutterpress never changes who can see your files.",
          isHtml
            ? "Google Drive stores files, not live websites — download and unzip it to view the export, or publish it as a real site with the Azure Static Web Apps provider."
            : undefined,
          cfg.folderId
            ? undefined
            : `Tip (CLI): record the folder id in the manifest (publish.gdrive.folderId: "${folder.id}") so renaming the folder in Drive can never break publishing.`,
        ].filter((s): s is string => !!s),
      };
    } finally {
      await source.cleanup();
    }
  },
};
