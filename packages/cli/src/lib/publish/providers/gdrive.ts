/**
 * Google Drive publish provider (#221, docs/gdrive-publish-plan.md).
 *
 * Uploads the finished PDF to a folder in the author's Google Drive.
 * Connects via browser OAuth consent (`google-auth.ts` — no pasted key);
 * uploads via the plain-fetch resumable protocol (`google-drive.ts`, D7).
 * Publishing again finds the previous file by name in the target folder and
 * updates it in place (D6), so a shared `webViewLink` stays valid across
 * republishes.
 */
import { stat } from "node:fs/promises";
import path from "node:path";
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
  description:
    "Upload the finished PDF to a folder in your Google Drive — publishing again updates the same file, so shared links stay current.",
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

    // Quota fail-fast BEFORE any bytes move (D7).
    const artifactStat = await stat(req.artifact.path);
    const about = await driveAbout(fetchImpl, accessToken);
    if (about.quota.limitBytes != null && about.quota.freeBytes != null) {
      if (artifactStat.size > about.quota.freeBytes) {
        throw new Error(
          `Your Google Drive is full — this PDF needs ${formatBytes(artifactStat.size)} but only ${formatBytes(about.quota.freeBytes)} is free.`,
        );
      }
    }

    req.deps.onProgress?.("Resolving the Drive folder…");
    const folder = await resolveFolder(fetchImpl, accessToken, cfg);

    const fileName = path.basename(req.artifact.path);
    const existing = await findFileInFolder(fetchImpl, accessToken, folder.id, fileName);

    req.deps.onProgress?.(
      existing ? `Updating "${fileName}" in "${folder.name}"…` : `Uploading "${fileName}" to "${folder.name}"…`,
    );

    let lastReported = -1;
    const file = await resumableUpload(fetchImpl, accessToken, {
      ...(existing ? { fileId: existing.id } : {}),
      name: fileName,
      parentFolderId: folder.id,
      filePath: req.artifact.path,
      totalBytes: artifactStat.size,
      mimeType: "application/pdf",
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
        cfg.folderId
          ? undefined
          : `Tip (CLI): record the folder id in the manifest (publish.gdrive.folderId: "${folder.id}") so renaming the folder in Drive can never break publishing.`,
      ].filter((s): s is string => !!s),
    };
  },
};
