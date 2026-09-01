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
import { zipSync, type Zippable } from "fflate";
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

/** Recursively collect every FILE under `dir` into `out`, keyed by its path
 * relative to `root` with forward slashes (the zip-entry name Drive/most
 * unzip tools expect regardless of host OS). */
async function collectZipEntries(
  root: string,
  dir: string,
  out: Zippable,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectZipEntries(root, full, out);
    } else if (entry.isFile()) {
      const rel = path.relative(root, full).split(path.sep).join("/");
      out[rel] = await readFile(full);
    }
  }
}

/**
 * Package the HTML export directory into a single ZIP (D8: Drive is file
 * delivery, not web hosting — no N-file folder mirroring). Built with
 * fflate (already a dependency, see theme-import.ts for the sibling
 * unzip-side usage), written to a temp file so the existing file-based
 * `resumableUpload` (google-drive.ts) can read it incrementally like any
 * other artifact — never held whole in memory alongside the network layer.
 */
async function zipHtmlExport(exportDir: string, title: string): Promise<UploadSource> {
  const entries: Zippable = {};
  await collectZipEntries(exportDir, exportDir, entries);
  const zipped = zipSync(entries, { level: 6 });
  const fileName = `${bookSlug(title)}-website.zip`;
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "gutterpress-gdrive-"));
  const filePath = path.join(tmpRoot, fileName);
  await writeFile(filePath, zipped);
  return {
    filePath,
    fileName,
    mimeType: "application/zip",
    cleanup: () => rm(tmpRoot, { recursive: true, force: true }),
  };
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
      ? await zipHtmlExport(req.artifact.path, req.project.title)
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
