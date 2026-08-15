/**
 * image-clash.ts — host support for the desktop's non-blocking image picker
 * (the ONE chooser left after the 2026-08-14 convergence simplification).
 *
 * When both sides changed the same image, the converge merge keeps the NEWER
 * side and reports both blob oids (`ImageClash`). These two helpers let a
 * host show both versions and apply the writer's pick:
 *
 *  - {@link readImageVersion} — the exact bytes of one version, by blob oid
 *    (both oids are pinned by the merge commit's parents, so this can never
 *    go stale).
 *  - {@link keepImageVersion} — write the chosen version's bytes back to the
 *    file and snapshot; the normal auto-sync publishes it.
 *
 * Pure isomorphic-git + node:fs (CLAUDE.md §7).
 */
import * as fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";

import {
  snapshotWorkingTreeUnlocked,
  withRepoLock,
} from "../source-provider.ts";
import { repoDirFor } from "./transport.ts";

const OID = /^[0-9a-f]{40}$/;

/** Reject absolute or parent-escaping repo-relative paths. */
function assertSafeRelativePath(filepath: string): void {
  if (
    path.isAbsolute(filepath) ||
    filepath.split(/[\\/]/).some((seg) => seg === "..")
  ) {
    throw new Error("Invalid file path.");
  }
}

/** Read one version's exact bytes by BLOB oid. */
export async function readImageVersion(options: {
  projectDir: string;
  oid: string;
}): Promise<Uint8Array> {
  if (!OID.test(options.oid)) throw new Error("Invalid version id.");
  const dir = await repoDirFor(options.projectDir);
  const { blob } = await git.readBlob({ fs, dir, oid: options.oid });
  return blob;
}

/**
 * Keep a specific version of a clashing image: write the blob's exact bytes
 * to the file and snapshot. Serialized on the per-repo lock like every other
 * mutating operation.
 */
export async function keepImageVersion(options: {
  projectDir: string;
  path: string;
  oid: string;
  authorName?: string;
  authorEmail?: string;
}): Promise<void> {
  if (!OID.test(options.oid)) throw new Error("Invalid version id.");
  assertSafeRelativePath(options.path);
  const dir = await repoDirFor(options.projectDir);
  await withRepoLock(dir, async () => {
    const { blob } = await git.readBlob({ fs, dir, oid: options.oid });
    const abs = path.join(dir, options.path);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, blob);
    await snapshotWorkingTreeUnlocked({
      projectDir: dir,
      repoRoot: dir,
      message: `Kept your chosen version of ${path.posix.basename(options.path)}`,
      authorName: options.authorName,
      authorEmail: options.authorEmail,
    }).catch((e: unknown) => {
      // "No changes" = the chosen version was already on disk — fine.
      if (!(e instanceof Error && /nothing new to save/i.test(e.message))) throw e;
    });
  });
}
