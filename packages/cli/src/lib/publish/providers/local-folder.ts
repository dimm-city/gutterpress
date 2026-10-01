/**
 * Local folder "publish" provider — a folder on this computer.
 *
 * The first destination the desktop's Publish wizard offers, and the one it
 * BUILDS INTO: the wizard renders the book straight into the configured
 * folder and then hands that artifact to every other selected destination.
 * It is listed here, beside the online providers, so its one setting
 * (`publish.local.dir`, relative to the book or absolute) rides the same
 * manifest section, the same settings route and the same provider cards as
 * everything else — no special case anywhere downstream.
 *
 * `upload` is what the CLI uses (`gutterpress publish --provider local`): copy
 * the built artifact into the folder. The desktop never calls it for a folder
 * it just built into.
 */
import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";

import type {
  PreflightIssue,
  PublishProvider,
  PublishProviderInfo,
  PublishRequest,
} from "../types.ts";

/** The folder used when `publish.local.dir` is unset — inside the book. */
export const LOCAL_PUBLISH_DEFAULT_DIR = "dist";

const info: PublishProviderInfo = {
  id: "local",
  label: "A folder on this computer",
  kind: "api",
  format: "pdf",
  formats: ["pdf", "html"],
  description: "Save the finished file to a folder you choose.",
  configFields: [
    { key: "dir", label: "Folder", placeholder: LOCAL_PUBLISH_DEFAULT_DIR },
  ],
  credential: { required: false, host: "" },
};

/** The absolute folder for a request: `publish.local.dir` (relative to the book) or the default. */
export function localPublishDir(req: Pick<PublishRequest, "project" | "config">): string {
  const dir = typeof req.config.dir === "string" && req.config.dir.trim()
    ? req.config.dir.trim()
    : LOCAL_PUBLISH_DEFAULT_DIR;
  return path.resolve(req.project.projectDir, dir);
}

export const localFolderProvider: PublishProvider = {
  info,

  async authenticate() {
    return { ok: true as const };
  },

  async preflight(req: PublishRequest): Promise<PreflightIssue[]> {
    const dir = localPublishDir(req);
    try {
      const s = await stat(dir);
      if (!s.isDirectory()) {
        return [
          { severity: "error", id: "local/not-a-folder", message: `${dir} exists but is not a folder.` },
        ];
      }
    } catch {
      // Created on publish.
    }
    return [];
  },

  async upload(req: PublishRequest) {
    const dir = localPublishDir(req);
    await mkdir(dir, { recursive: true });
    const dest =
      req.artifact.format === "html" ? dir : path.join(dir, path.basename(req.artifact.path));
    if (path.resolve(dest) !== path.resolve(req.artifact.path)) {
      await cp(req.artifact.path, dest, { recursive: true });
    }
    return { kind: "published" as const, detail: `Saved to ${dest}` };
  },
};
