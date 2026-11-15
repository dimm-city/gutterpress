/**
 * Google Drive publish provider (#221, ADR 0011).
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
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import type { Writable } from "node:stream";
import { tmpdir } from "node:os";
import path from "node:path";
import { Zip, ZipDeflate, type DeflateOptions, type FlateError } from "fflate";
import { bookSlug } from "../../output-paths.ts";
import { UsageError } from "../../cli-args.ts";
import { canonicalTargetId } from "../../targets.ts";
import {
  GDRIVE_HOST,
  requireGoogleClientCredentials,
} from "../google-auth.ts";
import {
  createFolder,
  driveAbout,
  findFileInFolder,
  listFolders,
  refreshAccessToken,
  resumableUpload,
} from "../google-drive.ts";
import {
  resolvePublishCredential,
  type PreflightIssue,
  type PublishAuthStatus,
  type PublishDestinationStatus,
  type PublishOutcome,
  type PublishProduct,
  type PublishProvider,
  type PublishProviderInfo,
  type PublishRequest,
} from "../types.ts";
import type { HostCredential } from "../../remote-auth/token-store.ts";
import { DEFAULT_FOLDER_NAME, resolveFolder, toDestination, uploadFolder } from "./gdrive-folder.ts";
import { targetInfo } from "../target-info.ts";

const NOT_CONNECTED_MESSAGE =
  "Google Drive isn't connected. Run `gutterpress publish --provider gdrive --connect` (or set GDRIVE_REFRESH_TOKEN) first.";

const info: PublishProviderInfo = {
  // The registry offers a pick of file here (PDF, PDF/X or the website); an
  // unset publish.gdrive.format is the PDF, as it always was.
  ...targetInfo("gdrive"),
  kind: "api",
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

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Exchange an already-resolved credential's refresh token for a fresh access
 * token (D4: refresh-on-demand, never persisted). Split out from
 * {@link getAccessToken} so `authenticate` — the one caller that also needs
 * `source` available on a LATER failure (refresh/driveAbout), not just on
 * success — can resolve the credential once itself and mint from that,
 * instead of paying for a second `resolvePublishCredential` (a token-store
 * read) inside `getAccessToken`. */
async function mintAccessToken(
  resolved: { credential: HostCredential; source: "env" | "store" },
  fetchImpl: typeof fetch,
): Promise<string> {
  const { clientId, clientSecret } = requireGoogleClientCredentials();
  const { accessToken } = await refreshAccessToken(fetchImpl, {
    clientId,
    clientSecret,
    refreshToken: resolved.credential.token,
  });
  return accessToken;
}

/** Mint a fresh access token for this operation. Throws a friendly,
 * token-free error when there's no stored credential or no client
 * configured. For callers (listDestinations/createDestination/upload) that
 * only need the token, not `source` on a failure path. */
async function getAccessToken(
  req: PublishRequest,
): Promise<{ accessToken: string; source: "env" | "store" }> {
  const resolved = await resolvePublishCredential(info, req.deps);
  if (!resolved) throw new Error(NOT_CONNECTED_MESSAGE);
  const accessToken = await mintAccessToken(resolved, req.deps.fetch ?? globalThis.fetch);
  return { accessToken, source: resolved.source };
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
 * `zipFilesToStream` below) — small enough that no single push blocks
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
 * Stream a ZIP archive of `files` (`[entry name, source path]`) into `out`
 * without blocking the event loop and without holding the site in memory:
 * each file is read in `ZIP_CHUNK_BYTES` pieces only when it is added, and
 * the archive's output goes straight to the write stream (pausing for
 * `drain` when the disk is slower than the compressor).
 *
 * Not fflate's async `zip()` (#221): that API hands any entry >= ~156 KB off
 * to a `worker_threads` Worker running an eval'd copy of fflate's source,
 * which throws under both `bun` and a `bun build --compile` binary (this
 * project's shipped artifact). `ZipDeflate` is fully synchronous and
 * in-thread at any size; yielding one event-loop turn per chunk keeps the
 * Electron main process responsive (and `onProgress` flowing).
 */
async function zipFilesToStream(
  files: Array<[string, string]>,
  out: Writable,
  opts: DeflateOptions,
): Promise<void> {
  let failure: Error | null = null;
  out.on("error", (e) => (failure ??= e));
  const archive = new Zip((err: FlateError | null, chunk: Uint8Array | null) => {
    if (err) failure ??= err;
    else if (chunk) out.write(chunk);
  });
  try {
    for (const [name, source] of files) {
      const stream = new ZipDeflate(name, opts);
      archive.add(stream);
      let pending: Uint8Array | null = null;
      // One chunk of lookahead so the LAST push can carry `final = true`.
      for await (const chunk of createReadStream(source, { highWaterMark: ZIP_CHUNK_BYTES })) {
        if (pending) stream.push(pending, false);
        pending = chunk as Uint8Array;
        if (failure) throw failure;
        // The property, not a flag set at write time: the buffer may have
        // drained (and emitted 'drain') while we awaited the next read.
        if (out.writableNeedDrain) await once(out, "drain");
        await yieldToEventLoop();
      }
      stream.push(pending ?? new Uint8Array(0), true);
    }
    archive.end();
    if (failure) throw failure;
    await finished(out.end());
  } catch (e) {
    // A failed read must not leave the output file open (a leaked fd per
    // failed publish, and an undeletable temp dir on Windows).
    out.destroy();
    throw e;
  }
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
  out: Array<[string, string]>,
  onWarn?: (message: string) => void,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectZipEntries(root, full, out, onWarn);
    } else if (entry.isFile()) {
      const rel = path.relative(root, full).split(path.sep).join("/");
      out.push([rel, full]);
    } else if (entry.isSymbolicLink()) {
      const resolved = await stat(full).catch(() => null);
      if (resolved?.isFile()) {
        const rel = path.relative(root, full).split(path.sep).join("/");
        out.push([rel, full]);
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
 * `zipFilesToStream` (fflate is already a dependency, see extension-import.ts
 * for the sibling unzip-side usage), which reads each file only as it is added
 * and writes straight to a temp file, so memory stays flat however big the
 * site is. The existing file-based `resumableUpload` (google-drive.ts) then
 * reads that file chunk by chunk like any other artifact.
 */
export async function zipHtmlExport(
  exportDir: string,
  title: string,
  onWarn?: (message: string) => void,
  // Test-only seam (same DI convention as google-drive.ts's fetchImpl/
  // sleepImpl): lets a test force a failure in the write step, after
  // mkdtemp, without touching the real filesystem's failure modes.
  openOutput: (filePath: string) => Writable = createWriteStream,
): Promise<UploadSource> {
  const entries: Array<[string, string]> = [];
  await collectZipEntries(exportDir, exportDir, entries, onWarn);
  const fileName = `${bookSlug(title)}-website.zip`;
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "gutterpress-gdrive-"));
  try {
    const filePath = path.join(tmpRoot, fileName);
    await zipFilesToStream(entries, openOutput(filePath), { level: 6 });
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
    // Resolved ONCE here (not via getAccessToken, which would re-resolve) —
    // `source` needs to be available for the catch below too, on a failure
    // that happens after a credential was found (an expired refresh token,
    // an offline driveAbout), not just on success.
    const resolved = await resolvePublishCredential(info, req.deps);
    if (!resolved) return { ok: false, message: NOT_CONNECTED_MESSAGE };
    try {
      const accessToken = await mintAccessToken(resolved, req.deps.fetch ?? globalThis.fetch);
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

  async destinationStatus(req): Promise<PublishDestinationStatus> {
    const { accessToken } = await getAccessToken(req);
    return resolveFolder(req, accessToken);
  },

  async upload(req): Promise<PublishOutcome> {
    const fetchImpl = req.deps.fetch ?? globalThis.fetch;
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
      const where = await resolveFolder(req, accessToken);
      const folder = await uploadFolder(where, fetchImpl, accessToken);

      const fileName = source.fileName;
      const existing = await findFileInFolder(fetchImpl, accessToken, folder.id, fileName);

      req.deps.onProgress?.(
        existing ? `Updating "${fileName}" in "${folder.title}"…` : `Uploading "${fileName}" to "${folder.title}"…`,
      );

      let lastReported = -1;
      const file = await resumableUpload(fetchImpl, accessToken, {
        ...(existing ? { fileId: existing.id } : {}),
        name: fileName,
        parentFolderId: folder.id,
        filePath: source.filePath,
        totalBytes: artifactStat.size,
        mimeType: source.mimeType,
        signal: req.deps.signal,
        onProgress: (uploaded, total) => {
          // Throttle to whole percent so a fast connection doesn't spam
          // onProgress once per chunk boundary at 100% granularity.
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
        detail:
          `Uploaded "${fileName}" to the "${folder.title}" folder in your Google Drive${existing ? " (updated the existing file)" : ""}.` +
          (where.state === "by-name" && where.several
            ? ` Several of your folders are named "${where.name}"; this is the most recently changed one: ${folder.url}`
            : ""),
        followUp: [
          "To share it, open it in Drive and use the Share button — Gutterpress never changes who can see your files.",
          isHtml
            ? "Google Drive stores files, not live websites — download and unzip it to view the export, or publish it as a real site with the Azure Static Web Apps provider."
            : undefined,
          where.state === "unset"
            ? `Tip (CLI): record the folder id in the manifest (publish.gdrive.folderId: "${folder.id}") so renaming the folder in Drive can never break publishing.`
            : undefined,
        ].filter((s): s is string => !!s),
      };
    } finally {
      await source.cleanup();
    }
  },
};

/**
 * The terminal's `--folder-id` / `--folder` (#452): another Drive folder for
 * this run only, as the run's settings. Refused when the run names targets
 * and Google Drive is not one of them.
 */
export function driveFolderForRun(
  targets: string[],
  folderId: string,
  folder: string,
): Record<string, Record<string, string>> | undefined {
  if (!folderId && !folder) return undefined;
  if (targets.length > 0 && !targets.map(canonicalTargetId).includes(GDRIVE_HOST)) {
    throw new UsageError(`--folder-id and --folder are for the ${GDRIVE_HOST} target.`);
  }
  return { [GDRIVE_HOST]: { folderId, folder } };
}
