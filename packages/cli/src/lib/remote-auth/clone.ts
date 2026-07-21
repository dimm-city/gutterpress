/**
 * Clone-and-open for remote-backed projects (#15, ADR 0006 D2).
 *
 * A managed remote project IS a local clone: after `cloneRepository`, the
 * folder classifies as a plain `local-git-folder` (hasRemote: true) and every
 * existing feature — preview, watcher, snapshots, restore — works unchanged.
 * What makes it "managed" is the host-keyed credential plus the provenance
 * sidecar written here.
 *
 * Pure isomorphic-git over smart HTTPS (CLAUDE.md §7) — no system git, no gh.
 */
import * as fs from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";
import { defaultGitHttp } from "./git-http.ts";

import { withRepoLock } from "../source-provider.ts";
import {
  extractUrlCredential,
  type HostCredential,
  type TokenStore,
} from "./token-store.ts";
import { OFFLINE_MESSAGE } from "./github-auth.ts";
import { isInsecureTransportError } from "./recovery/classify.ts";
import { onAuthFor } from "./transport.ts";

/** Coarse clone progress for host UIs. */
export interface CloneProgressEvent {
  /** Human-readable phase from the git transport (e.g. "Receiving objects"). */
  phase: string;
  loaded: number;
  total?: number;
}

/**
 * Provider provenance recorded next to a cloned project (ADR 0006 D4):
 * metadata for the repo picker / re-auth UX, never consulted by the
 * editing/preview/build paths.
 */
export interface ProjectProvenance {
  provider: "github";
  owner: string;
  repo: string;
  /**
   * Legacy GitHub-App installation id. New clones never write it (the OAuth
   * App model has no installations — ADR 0006 D1 amendment 2026-06-10); kept
   * optional so provenance files written by 0.4.x betas still parse.
   */
  installationId?: string;
}

export interface CloneRepositoryOptions {
  /** HTTPS clone URL. Tokens embedded in the URL are stripped (D7). */
  url: string;
  /** Absolute destination directory (created; must be absent or empty). */
  dir: string;
  /** Credential used for transport auth, if the remote needs one. */
  credential?: HostCredential;
  /** Branch to check out; the remote's default branch when omitted. */
  branch?: string;
  /**
   * History depth. Defaults to a FULL clone (`undefined`).
   *
   * WHY full and not the ADR's `depth: 1` preference: the shallow-clone spike
   * (clone.test.ts, "shallow clone spike") showed isomorphic-git CAN shallow
   * clone and the existing source-provider ops (listHistory, snapshot) keep
   * working on the shallow result — but `git.log` stops silently at the
   * shallow boundary, so View History (#13) would show a single commit with no
   * indication more history exists, and there is no deepen-on-demand surface
   * yet. Until that lands, full clone is the honest default; pass `depth` to
   * opt in to shallow (the plumbing is tested and works).
   */
  depth?: number;
  /** Coarse progress callback for host UIs. */
  onProgress?: (event: CloneProgressEvent) => void;
  /** When provided, credentials embedded in `url` are migrated into it (D7). */
  tokenStore?: TokenStore;
  /** Provider provenance to record beside the clone (ADR 0006 D4). */
  provenance?: ProjectProvenance;
  /**
   * Injectable git HTTP transport for tests (isomorphic-git's `http` client
   * shape). Defaults to isomorphic-git's node client.
   */
  httpClient?: typeof httpNode;
}

export interface CloneRepositoryResult {
  /** The directory the project was cloned into (same as options.dir). */
  projectDir: string;
  /** The checked-out branch. */
  branch?: string;
}

/**
 * Where provider provenance lives: INSIDE `.git/` (untracked by definition,
 * travels with the clone, invisible to the author's files). A tracked sidecar
 * in the worktree was rejected — it would dirty the repo and leak app metadata
 * into the user's published content. The viewer's `viewer-prefs.json` was also
 * rejected: provenance must be written by the LIB (shared by CLI + viewer) and
 * stay attached to the project folder itself.
 */
const PROVENANCE_FILE = "print-md-remote.json";

export function provenancePath(projectDir: string): string {
  return path.join(projectDir, ".git", PROVENANCE_FILE);
}

/** Read recorded provider provenance for a project, if any. Never throws. */
export async function readProjectProvenance(
  projectDir: string,
): Promise<ProjectProvenance | null> {
  try {
    const raw = await readFile(provenancePath(projectDir), "utf8");
    const parsed = JSON.parse(raw) as ProjectProvenance;
    return parsed && parsed.provider ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Reduce a (possibly renderer-/user-supplied) project folder name to a single
 * safe path segment: path separators become dashes and leading dots are
 * stripped, so `path.join(parentDir, sanitizeCloneFolderName(name))` can never
 * escape `parentDir` (no `..` segments, no absolute paths, no hidden dirs).
 * Returns `""` when nothing usable remains — callers must reject that.
 */
export function sanitizeCloneFolderName(name: string): string {
  return String(name ?? "")
    .replace(/[\\/]/g, "-")
    .replace(/^\.+/, "")
    .trim();
}

async function assertCloneTarget(dir: string): Promise<void> {
  try {
    const entries = await readdir(dir);
    if (entries.length > 0) {
      throw new Error(
        "That folder already has files in it. Choose an empty folder for the project.",
      );
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return; // will be created
    throw e;
  }
}

/** Map raw transport failures to author-friendly messages (never the token). */
function friendlyCloneError(e: unknown): Error {
  // FIRST: the typed withheld-credential error from onAuthFor — an https-vs-
  // http problem no retry can fix, so it must never fall through to the
  // generic "try again" arm. (No literal scheme tokens in the copy: the
  // viewer redacts /https?:\/\/\S+/ matches, which would garble the message.)
  if (isInsecureTransportError(e)) {
    return new Error(
      "That repository address isn't secure, so the saved connection wasn't sent — connections are never sent over an insecure address. Use a secure address (starting with https), or a local loopback address for a server on this computer.",
      { cause: e },
    );
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/401|403|auth|credential/i.test(msg)) {
    return new Error(
      "GitHub didn't accept the connection for this repository. Reconnect GitHub and try again.",
      { cause: e },
    );
  }
  if (/404|not found/i.test(msg)) {
    return new Error(
      "That repository couldn't be found. It may have been renamed or you may no longer have access.",
      { cause: e },
    );
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network|fetch failed/i.test(msg)) {
    return new Error(OFFLINE_MESSAGE, { cause: e });
  }
  if (e instanceof Error && /already has files/i.test(e.message)) {
    return e;
  }
  return new Error(
    "The project couldn't be downloaded from GitHub. Please try again.",
    { cause: e },
  );
}

/**
 * Clone a remote repository over smart HTTPS into `dir` (ADR 0006 D2).
 *
 * - HTTPS only (isomorphic-git has no SSH — ADR 0006 D6).
 * - `singleBranch` always; `depth` opts into shallow (full by default — see
 *   the WHY on {@link CloneRepositoryOptions.depth}).
 * - Tokens embedded in the URL are stripped and (when a `tokenStore` is
 *   given) migrated into the store; the token never reaches logs (D7).
 * - Serialized through the same per-repo lock as snapshot/restore.
 */
export async function cloneRepository(
  options: CloneRepositoryOptions,
): Promise<CloneRepositoryResult> {
  const { dir, onProgress, tokenStore, provenance } = options;
  if (!path.isAbsolute(dir)) {
    throw new Error("cloneRepository requires an absolute destination path.");
  }
  let parsed: URL;
  try {
    parsed = new URL(options.url);
  } catch {
    throw new Error("That repository address is not a valid web URL.");
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(
      "Only HTTPS repository addresses are supported. SSH addresses (git@…) can't be used here.",
    );
  }

  // D7: strip any user:token@ embedded in the URL; prefer it for auth if no
  // explicit credential was supplied, and migrate it into the store.
  const { cleanUrl, credential: urlCredential } = extractUrlCredential(
    options.url,
  );
  const credential = options.credential ?? urlCredential;
  if (urlCredential && tokenStore && !(await tokenStore.get(urlCredential.host))) {
    await tokenStore.set(urlCredential.host, urlCredential);
  }

  return withRepoLock(dir, async () => {
    await assertCloneTarget(dir);
    // Record whether the target existed BEFORE we mkdir it: on clone failure
    // we delete the directory only if we created it (never a user's folder).
    const dirExistedBefore = fs.existsSync(dir);
    await mkdir(dir, { recursive: true });
    try {
      await git.clone({
        fs,
        http: options.httpClient ?? defaultGitHttp,
        dir,
        url: cleanUrl,
        singleBranch: true,
        ...(options.branch ? { ref: options.branch } : {}),
        ...(options.depth ? { depth: options.depth } : {}),
        // Credential → { username, password } via the ONE canonical mapping
        // (transport.onAuthFor); returns {} when there is no credential.
        ...onAuthFor(credential),
        ...(onProgress
          ? {
              onProgress: (p: { phase: string; loaded: number; total?: number }) =>
                onProgress({
                  phase: p.phase,
                  loaded: p.loaded,
                  ...(p.total ? { total: p.total } : {}),
                }),
            }
          : {}),
      });
    } catch (e) {
      const friendly = friendlyCloneError(e);
      if (!dirExistedBefore) {
        // We created the directory — remove the partial download so a retry
        // starts clean and the user isn't left with a half-written .git.
        try {
          await rm(dir, { recursive: true, force: true });
        } catch {
          // Cleanup itself failed: tell the user a partial download remains.
          throw new Error(
            `${friendly.message} A partial download was left at ${dir} — delete that folder before trying again.`,
            { cause: e },
          );
        }
      }
      throw friendly;
    }

    if (provenance) {
      // Best-effort metadata (ADR 0006 D4) — never fail the clone over it.
      try {
        await writeFile(
          provenancePath(dir),
          JSON.stringify(provenance, null, 2),
          "utf8",
        );
      } catch {
        /* non-fatal */
      }
    }

    let branch: string | undefined;
    try {
      branch = (await git.currentBranch({ fs, dir })) ?? undefined;
    } catch {
      branch = undefined;
    }
    return { projectDir: dir, ...(branch ? { branch } : {}) };
  });
}
