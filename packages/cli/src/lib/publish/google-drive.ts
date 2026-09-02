/**
 * Google Drive REST client for the `gdrive` publish provider (#221,
 * docs/gdrive-publish-plan.md D7). Plain `fetch` (injected — no SDK, per the
 * ratified D7 decision), wrapped in the shared `withFetchTimeout` /
 * `FriendlyHttpError` policy (../fetch-timeout.ts) exactly like
 * `providers/shopify.ts`. No module-level state — every function takes the
 * access token and an injected fetch explicitly.
 *
 * **Fixed-host gate (Shopify precedent):** every request in this module goes
 * to `oauth2.googleapis.com` or `www.googleapis.com` — literal string
 * constants below, never a host derived from manifest config — so a hostile
 * or typo'd project can never redirect a token.
 */
import { open } from "node:fs/promises";
import { FriendlyHttpError, withFetchTimeout } from "../fetch-timeout.ts";
import { RECONNECT_MESSAGE } from "./google-auth.ts";
import { googleApiFailure, readGoogleApiError } from "./google-errors.ts";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3/files";

const METADATA_TIMEOUT_MS = 30_000;
const TOKEN_REFRESH_TIMEOUT_MS = 15_000;
/** Per-chunk PUT timeout. Generous: an 8 MiB chunk on a slow connection can
 * legitimately take a while, and a stalled connection must still time out. */
const CHUNK_TIMEOUT_MS = 120_000;

export const OFFLINE_MESSAGE = "Couldn't reach Google Drive. Check your connection and try again.";

async function driveFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs = METADATA_TIMEOUT_MS,
): Promise<Response> {
  return withFetchTimeout(
    { timeoutMs, offlineMessage: OFFLINE_MESSAGE },
    (signal) => fetchImpl(url, { ...init, signal }),
  );
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** The error for a non-OK Drive answer: reads the body once and keeps
 * Google's own `reason` and message (google-errors.ts) rather than reporting
 * a bare status nobody can act on. `what` is the caller's "Couldn't …"
 * phrase, and names Google Drive — the desktop allowlist depends on it. */
async function driveFailure(res: Response, what: string): Promise<FriendlyHttpError> {
  return googleApiFailure(what, await readGoogleApiError(res));
}

/**
 * Escape a value for safe interpolation into a Drive API `q` search string.
 * Drive's query grammar uses single-quoted string literals with `\'` and
 * `\\` as the only escapes — an unescaped `'` in a folder/file name would
 * otherwise terminate the literal early and let the rest of the name be
 * interpreted as query syntax.
 */
export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ── Token refresh ────────────────────────────────────────────────────────────

export interface RefreshedToken {
  accessToken: string;
  expiresIn: number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

/** Mint a fresh access token from the stored refresh token. Maps Google's
 * `invalid_grant` to the D4 reconnect message; never logs the token values. */
export async function refreshAccessToken(
  fetchImpl: typeof fetch,
  params: { clientId: string; clientSecret: string; refreshToken: string },
): Promise<RefreshedToken> {
  const res = await driveFetch(
    fetchImpl,
    TOKEN_ENDPOINT,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: params.refreshToken,
        client_id: params.clientId,
        client_secret: params.clientSecret,
      }).toString(),
    },
    TOKEN_REFRESH_TIMEOUT_MS,
  );
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !body.access_token) {
    if (body.error === "invalid_grant") throw new Error(RECONNECT_MESSAGE);
    throw new FriendlyHttpError(
      `Google rejected the Drive connection (HTTP ${res.status}${body.error ? `: ${body.error}` : ""}). ${RECONNECT_MESSAGE}`,
    );
  }
  return { accessToken: body.access_token, expiresIn: body.expires_in ?? 3600 };
}

// ── about.get — email + quota ───────────────────────────────────────────────

export interface DriveQuota {
  /** null = unlimited (Workspace accounts with no cap report this). */
  limitBytes: number | null;
  usageBytes: number;
  freeBytes: number | null;
}

export interface DriveAbout {
  email?: string;
  quota: DriveQuota;
}

export async function driveAbout(
  fetchImpl: typeof fetch,
  accessToken: string,
): Promise<DriveAbout> {
  const res = await driveFetch(fetchImpl, `${DRIVE_API_BASE}/about?fields=user(emailAddress),storageQuota`, {
    method: "GET",
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw await driveFailure(res, "Couldn't read your Google Drive account info");
  const body = (await res.json()) as {
    user?: { emailAddress?: string };
    storageQuota?: { limit?: string; usage?: string };
  };
  const limit = body.storageQuota?.limit != null ? Number(body.storageQuota.limit) : null;
  const usage = Number(body.storageQuota?.usage ?? 0);
  return {
    email: body.user?.emailAddress,
    quota: {
      limitBytes: limit,
      usageBytes: usage,
      freeBytes: limit != null ? Math.max(0, limit - usage) : null,
    },
  };
}

// ── Folders ──────────────────────────────────────────────────────────────────

export interface DriveFolder {
  id: string;
  name: string;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

/** App-visible folders (drive.file scope: only ones this app created), most
 * recently modified first. Follows `nextPageToken` and accumulates every
 * page — an author with more than one page of app-created folders would
 * otherwise see the destinations picker silently miss folders past the
 * first 100. (`ensureFolder`'s find-by-name lookup uses its own single
 * server-side query, {@link findFolderByName} below, and doesn't paginate.) */
export async function listFolders(
  fetchImpl: typeof fetch,
  accessToken: string,
): Promise<DriveFolder[]> {
  const q = `mimeType='${FOLDER_MIME}' and trashed=false`;
  const all: DriveFolder[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q,
      fields: "nextPageToken,files(id,name)",
      orderBy: "modifiedTime desc",
      pageSize: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await driveFetch(fetchImpl, `${DRIVE_API_BASE}/files?${params.toString()}`, {
      method: "GET",
      headers: authHeaders(accessToken),
    });
    if (!res.ok) throw await driveFailure(res, "Couldn't list Google Drive folders");
    const body = (await res.json()) as { files?: DriveFolder[]; nextPageToken?: string };
    all.push(...(body.files ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return all;
}

/** Look up one folder by id (for verifying a manifest-recorded `folderId`
 * still exists and isn't trashed). Returns null when it's gone. */
export async function getFolderById(
  fetchImpl: typeof fetch,
  accessToken: string,
  folderId: string,
): Promise<DriveFolder | null> {
  const res = await driveFetch(fetchImpl, `${DRIVE_API_BASE}/files/${encodeURIComponent(folderId)}?fields=id,name,trashed,mimeType`, {
    method: "GET",
    headers: authHeaders(accessToken),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw await driveFailure(res, "Couldn't look up the Google Drive folder");
  const body = (await res.json()) as { id: string; name: string; trashed?: boolean; mimeType?: string };
  if (body.trashed || body.mimeType !== FOLDER_MIME) return null;
  return { id: body.id, name: body.name };
}

/** Create a folder at My Drive root. */
export async function createFolder(
  fetchImpl: typeof fetch,
  accessToken: string,
  name: string,
): Promise<DriveFolder> {
  const res = await driveFetch(fetchImpl, `${DRIVE_API_BASE}/files?fields=id,name`, {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
  });
  if (!res.ok) throw await driveFailure(res, `Couldn't create the Google Drive folder "${name}"`);
  return (await res.json()) as DriveFolder;
}

/** Look up one app-visible folder by exact name with a single server-side
 * query — the same `q=` pattern as {@link findFileInFolder} — rather than
 * paginating through every app-created folder client-side. `orderBy` keeps
 * the same "most recently modified match wins" tie-break `ensureFolder` had
 * when it picked the first hit from {@link listFolders}'s already-sorted
 * list. */
async function findFolderByName(
  fetchImpl: typeof fetch,
  accessToken: string,
  name: string,
): Promise<DriveFolder | null> {
  const q = `name='${escapeDriveQueryValue(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  const params = new URLSearchParams({
    q,
    fields: "files(id,name)",
    orderBy: "modifiedTime desc",
    pageSize: "1",
  });
  const res = await driveFetch(fetchImpl, `${DRIVE_API_BASE}/files?${params.toString()}`, {
    method: "GET",
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw await driveFailure(res, `Couldn't look up the Google Drive folder "${name}"`);
  const body = (await res.json()) as { files?: DriveFolder[] };
  return body.files?.[0] ?? null;
}

/** Find-or-create a folder by name at My Drive root (D5's name-resolution
 * path, used when the manifest has no recorded `folderId` yet). One query,
 * not a client-side scan of every app-created folder — see
 * {@link findFolderByName}. */
export async function ensureFolder(
  fetchImpl: typeof fetch,
  accessToken: string,
  name: string,
): Promise<DriveFolder> {
  const found = await findFolderByName(fetchImpl, accessToken, name);
  if (found) return found;
  return createFolder(fetchImpl, accessToken, name);
}

// ── Files ────────────────────────────────────────────────────────────────────

export interface DriveFile {
  id: string;
  name: string;
  webViewLink?: string;
}

/** Find a file by exact basename inside one folder (app-visible files only,
 * not trashed) — the D6 update-in-place lookup. */
export async function findFileInFolder(
  fetchImpl: typeof fetch,
  accessToken: string,
  folderId: string,
  name: string,
): Promise<DriveFile | null> {
  const q =
    `name='${escapeDriveQueryValue(name)}' and '${escapeDriveQueryValue(folderId)}' in parents and trashed=false`;
  const res = await driveFetch(
    fetchImpl,
    `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&pageSize=1`,
    { method: "GET", headers: authHeaders(accessToken) },
  );
  if (!res.ok) throw await driveFailure(res, "Couldn't search the Google Drive folder");
  const body = (await res.json()) as { files?: DriveFile[] };
  return body.files?.[0] ?? null;
}

// ── Resumable upload (D7) ────────────────────────────────────────────────────

/** Must be a multiple of 256 KiB (Drive's resumable-upload chunk requirement). */
export const RESUMABLE_CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_CHUNK_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

export interface ResumableUploadOptions {
  /** Existing file id → update (PATCH); omitted → create (POST). */
  fileId?: string;
  /** Only used on create — the file's Drive name and parent folder. */
  name: string;
  parentFolderId?: string;
  /** Local path to read the artifact from — read incrementally, never
   * loaded whole into memory. */
  filePath: string;
  totalBytes: number;
  mimeType?: string;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  /** Bytes per chunk. Default {@link RESUMABLE_CHUNK_SIZE}; must stay a
   * multiple of 256 KiB (Drive requirement) for any override (tests only). */
  chunkSize?: number;
  maxRetriesPerChunk?: number;
  /** Injectable sleep for tests (so backoff tests run instantly). */
  sleepImpl?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startResumableSession(
  fetchImpl: typeof fetch,
  accessToken: string,
  opts: ResumableUploadOptions,
): Promise<string> {
  const mimeType = opts.mimeType ?? "application/pdf";
  const url = opts.fileId
    ? `${DRIVE_UPLOAD_BASE}/${encodeURIComponent(opts.fileId)}?uploadType=resumable&fields=id,name,webViewLink`
    : `${DRIVE_UPLOAD_BASE}?uploadType=resumable&fields=id,name,webViewLink`;
  const res = await driveFetch(fetchImpl, url, {
    method: opts.fileId ? "PATCH" : "POST",
    headers: {
      ...authHeaders(accessToken),
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType,
      "X-Upload-Content-Length": String(opts.totalBytes),
    },
    body: JSON.stringify(
      opts.fileId ? {} : { name: opts.name, parents: opts.parentFolderId ? [opts.parentFolderId] : undefined },
    ),
  });
  const session = res.headers.get("location");
  if (!res.ok || !session) throw await driveFailure(res, "Couldn't start the Google Drive upload");
  return session;
}

/**
 * Query a resumable upload session's real status with an empty PUT +
 * `Content-Range: bytes *\/<total>` (per Drive's resumable-upload protocol):
 * Drive answers with a `308` + `Range` header naming exactly what it has
 * already received, or a `200`/`201` if the session actually completed.
 * Used to recover the true resume point after a thrown network exception,
 * where we don't know whether the dropped connection happened before or
 * after Drive received the bytes. Returns `null` when the query itself
 * can't be answered (network still down, unexpected status) so the caller
 * can fall back to re-sending the same range.
 */
async function queryUploadStatus(
  fetchImpl: typeof fetch,
  sessionUrl: string,
  total: number,
): Promise<{ kind: "progress"; receivedBytes: number } | { kind: "done"; file: DriveFile } | null> {
  let res: Response;
  try {
    res = await driveFetch(
      fetchImpl,
      sessionUrl,
      { method: "PUT", headers: { "Content-Range": `bytes */${total}` } },
      CHUNK_TIMEOUT_MS,
    );
  } catch {
    return null;
  }
  if (res.status === 308) {
    const range = res.headers.get("range");
    return { kind: "progress", receivedBytes: range ? Number(range.split("-")[1]) + 1 : 0 };
  }
  if (res.status === 200 || res.status === 201) {
    return { kind: "done", file: (await res.json()) as DriveFile };
  }
  return null;
}

/**
 * Upload one chunk with retry/backoff on 429/5xx (honoring `Retry-After`),
 * returning either the next offset to resume from (a 308) or the final file.
 */
async function putChunkWithRetry(
  fetchImpl: typeof fetch,
  sessionUrl: string,
  buf: Buffer,
  start: number,
  total: number,
  maxRetries: number,
  sleep: (ms: number) => Promise<void>,
): Promise<{ done: false; nextOffset: number } | { done: true; file: DriveFile }> {
  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await driveFetch(
        fetchImpl,
        sessionUrl,
        {
          method: "PUT",
          headers: {
            "Content-Range": `bytes ${start}-${start + buf.length - 1}/${total}`,
            "Content-Length": String(buf.length),
          },
          body: buf,
        },
        CHUNK_TIMEOUT_MS,
      );
    } catch (e) {
      if (attempt >= maxRetries) throw e;
      attempt++;
      // A thrown exception (e.g. connection reset) means we don't know
      // whether Drive received this chunk before the connection dropped.
      // Query the session's real status instead of blindly re-sending the
      // same byte range — this is the protocol-correct resume the explicit
      // 308-response path below already implements.
      const status = await queryUploadStatus(fetchImpl, sessionUrl, total);
      if (status?.kind === "done") return { done: true, file: status.file };
      if (status?.kind === "progress" && status.receivedBytes > start) {
        const chunkEnd = start + buf.length;
        if (status.receivedBytes >= chunkEnd) {
          // Drive already has this whole chunk; resume the outer loop from
          // the server-reported offset instead of re-sending anything.
          return { done: false, nextOffset: status.receivedBytes };
        }
        buf = buf.subarray(status.receivedBytes - start);
        start = status.receivedBytes;
      }
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      continue;
    }
    if (res.status === 308) {
      const range = res.headers.get("range");
      const nextOffset = range ? Number(range.split("-")[1]) + 1 : start + buf.length;
      return { done: false, nextOffset };
    }
    if (res.status === 200 || res.status === 201) {
      return { done: true, file: (await res.json()) as DriveFile };
    }
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      attempt++;
      const retryAfter = res.headers.get("retry-after");
      const delayMs = retryAfter
        ? Number(retryAfter) * 1000
        : RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      await sleep(Number.isFinite(delayMs) && delayMs > 0 ? delayMs : RETRY_BASE_DELAY_MS);
      continue;
    }
    throw await driveFailure(res, "Google Drive upload failed");
  }
}

/**
 * Resumable upload: start a session, PUT chunks read incrementally from disk,
 * follow `308 Resume Incomplete` + `Range` resumes, retry a failed chunk with
 * backoff, and report progress. Used both for creating a new file (no
 * `fileId`) and updating one in place (D6).
 */
export async function resumableUpload(
  fetchImpl: typeof fetch,
  accessToken: string,
  opts: ResumableUploadOptions,
): Promise<DriveFile> {
  const chunkSize = opts.chunkSize ?? RESUMABLE_CHUNK_SIZE;
  const maxRetries = opts.maxRetriesPerChunk ?? MAX_CHUNK_RETRIES;
  const sleep = opts.sleepImpl ?? defaultSleep;
  const sessionUrl = await startResumableSession(fetchImpl, accessToken, opts);

  const fh = await open(opts.filePath, "r");
  try {
    let offset = 0;
    for (;;) {
      const len = Math.min(chunkSize, opts.totalBytes - offset);
      // allocUnsafe, not alloc: the bytesRead !== len guard right below
      // throws before any byte of this buffer is ever sent, so there is no
      // uninitialized-memory-disclosure risk from skipping the zero-fill —
      // and zero-filling an 8 MiB buffer per chunk is real, wasted work.
      const buf = Buffer.allocUnsafe(len);
      const { bytesRead } = await fh.read(buf, 0, len, offset);
      if (bytesRead !== len) {
        throw new FriendlyHttpError(
          `Couldn't read "${opts.filePath}" while uploading to Google Drive: expected ${len} bytes at offset ${offset} but only read ${bytesRead}. The file may have changed on disk during publish.`,
        );
      }
      const result = await putChunkWithRetry(
        fetchImpl,
        sessionUrl,
        buf,
        offset,
        opts.totalBytes,
        maxRetries,
        sleep,
      );
      if (result.done) {
        opts.onProgress?.(opts.totalBytes, opts.totalBytes);
        return result.file;
      }
      offset = result.nextOffset;
      opts.onProgress?.(Math.min(offset, opts.totalBytes), opts.totalBytes);
      if (offset >= opts.totalBytes) {
        // Every byte acknowledged but Drive hasn't returned a final 200/201
        // yet — extremely unlikely (each PUT of the LAST chunk should finish
        // the session), but avoid spinning forever on a protocol surprise.
        throw new FriendlyHttpError(
          "Google Drive accepted every byte but never confirmed the upload. Try publishing again.",
        );
      }
    }
  } finally {
    await fh.close();
  }
}
