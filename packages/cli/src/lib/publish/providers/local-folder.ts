/**
 * Local folder target — a folder on this computer.
 *
 * Its one setting (`publish.local.dir`, relative to the book or absolute)
 * rides the same manifest section and settings as every other target.
 * `upload` copies the book's file into the folder, in the terminal and the
 * app alike.
 */
import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";

import type {
  PreflightIssue,
  PublishProvider,
  PublishProviderInfo,
  PublishRequest,
} from "../types.ts";
import { targetInfo } from "../target-info.ts";

/** The folder used when `publish.local.dir` is unset — inside the book. */
export const LOCAL_PUBLISH_DEFAULT_DIR = "dist";

const info: PublishProviderInfo = {
  ...targetInfo("local"),
  kind: "api",
  description: "Save the finished file to a folder you choose.",
  configFields: [
    { key: "dir", label: "Folder", placeholder: LOCAL_PUBLISH_DEFAULT_DIR, kind: "folder" },
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
