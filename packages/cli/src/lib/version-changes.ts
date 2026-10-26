/**
 * version-changes.ts — the Versions view's three questions (#408), answered
 * from the book's own history with isomorphic-git (CLAUDE.md §7: nothing
 * shells out, nothing needs installing):
 *
 *   1. What did a version change? A walk over the version's tree and its
 *      parent's; each differing file gets a plain size hint
 *      ("3 paragraphs changed", "1 rule changed", "replaced") from a
 *      two-way diff of the two blobs, and the page says whether the version
 *      is backed up online (an ancestor of the remote-tracking tip) or on
 *      this computer only.
 *   2. What is online, not yet on this computer? A fetch of the book's
 *      branch (refs only move; nothing is merged or checked out) and the
 *      commits on the fetched tip above the merge base with the local tip,
 *      described the same way.
 *   3. A version's files: one text file at that version beside the file as
 *      it is now, lines aligned and changed lines marked (the compare view);
 *      or the whole tree written to a folder for the preview to render
 *      read-only.
 *
 * Shared by the desktop's vcs routes. Nothing here writes to the project.
 */
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import git, { type WalkerEntry } from "isomorphic-git";
import postcss from "postcss";
import { gitFs as fs } from "./git-fs.ts";
import { detectProjectSource, syncRemoteFor } from "./project-source.ts";
import { gitScopeFor, type SnapshotEntry } from "./source-provider.ts";
import { currentBranchOrThrow, onAuthFor, repoDirFor, resolveTransport } from "./remote-auth/transport.ts";
import { defaultGitHttp } from "./remote-auth/git-http.ts";
import { MSG_NO_REMOTE, MSG_SSH_REMOTE } from "./remote-auth/sync-messages.ts";
import type { HostCredential, TokenStore } from "./remote-auth/token-store.ts";
import { alignRows, countChanged, diffSequences, textLines, type CompareRow } from "./text-diff.ts";

export type { CompareRow };

export interface VersionFileChange {
  /** Repo-relative path, forward slashes. */
  path: string;
  kind: "added" | "removed" | "changed";
  /** Plain size hint: "3 paragraphs changed", "1 rule changed", "replaced", "added", "removed". */
  hint: string;
  /** Both sides are text, so the compare view can show them. */
  text: boolean;
}

export interface VersionChanges {
  files: VersionFileChange[];
  /** Changed files beyond the ones listed (the list is capped). */
  more: number;
}

/** A history entry with what it changed and where it is kept. */
export interface VersionEntry extends SnapshotEntry {
  changes: VersionFileChange[];
  moreChanges: number;
  /** True = online too; false = on this computer only; null = no online copy to compare with. */
  backedUp: boolean | null;
}

/** How many changed files a version card lists before "and N more". */
export const VERSION_CHANGES_SHOWN = 8;

const decoder = new TextDecoder();

/** NUL in the first 8 KB ⇒ binary (git's own test). */
function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Blank-line-separated blocks, trimmed — a prose paragraph, a heading, a list. */
function paragraphs(text: string): string[] {
  return text
    .split(/\r?\n[ \t]*\r?\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Top-level rules and at-rules; mid-edit CSS that will not parse diffs by line. */
function cssRules(text: string): string[] {
  try {
    return postcss
      .parse(text)
      .nodes.map((node) => node.toString().trim())
      .filter((rule) => rule.length > 0);
  } catch {
    return textLines(text);
  }
}

/** The size hint for a text file that changed between two versions. */
export function changeHint(filepath: string, before: string, after: string): string {
  const ext = path.extname(filepath).toLowerCase();
  let count: number;
  let unit: string;
  if (ext === ".md" || ext === ".markdown") {
    count = countChanged(diffSequences(paragraphs(before), paragraphs(after)));
    unit = "paragraph";
  } else if (ext === ".css") {
    count = countChanged(diffSequences(cssRules(before), cssRules(after)));
    unit = "rule";
  } else {
    count = countChanged(diffSequences(textLines(before), textLines(after)));
    unit = "line";
  }
  // Only spacing or line endings moved: nothing a reader would count.
  return count > 0 ? `${plural(count, unit)} changed` : "changed";
}

async function firstParent(dir: string, cache: object, oid: string): Promise<string | null> {
  const { commit } = await git.readCommit({ fs, dir, cache, oid });
  return commit.parent[0] ?? null;
}

/**
 * The files `oid` changed against its first parent (every file, for a
 * version with no parent), sorted by path and capped to
 * {@link VERSION_CHANGES_SHOWN}.
 */
export async function listVersionChanges(
  dir: string,
  oid: string,
  options: { cache?: object } = {},
): Promise<VersionChanges> {
  const cache = options.cache ?? {};
  const parent = await firstParent(dir, cache, oid);
  const found: VersionFileChange[] = [];
  await git.walk({
    fs,
    dir,
    cache,
    trees: [git.TREE({ ref: oid }), ...(parent ? [git.TREE({ ref: parent })] : [])],
    map: async (filepath: string, entries: Array<WalkerEntry | null>) => {
      if (filepath === ".") return true;
      const now = entries[0] ?? null;
      const before = entries[1] ?? null;
      const types = await Promise.all([now, before].map((e) => (e ? e.type() : Promise.resolve(undefined))));
      // Recurse into directories; anything that is neither file nor directory
      // (a submodule) has no versions to compare.
      if (types.some((t) => t === "tree")) return true;
      if (types.some((t) => t !== undefined && t !== "blob")) return null;
      const [nowOid, beforeOid] = await Promise.all([now?.oid(), before?.oid()]);
      if (nowOid === beforeOid) return null;
      const [nowBytes, beforeBytes] = await Promise.all([now?.content(), before?.content()]);
      if (!beforeBytes) {
        found.push({ path: filepath, kind: "added", hint: "added", text: !!nowBytes && !looksBinary(nowBytes) });
      } else if (!nowBytes) {
        found.push({ path: filepath, kind: "removed", hint: "removed", text: !looksBinary(beforeBytes) });
      } else if (looksBinary(nowBytes) || looksBinary(beforeBytes)) {
        found.push({ path: filepath, kind: "changed", hint: "replaced", text: false });
      } else {
        found.push({
          path: filepath,
          kind: "changed",
          hint: changeHint(filepath, decoder.decode(beforeBytes), decoder.decode(nowBytes)),
          text: true,
        });
      }
      return null;
    },
  });
  found.sort((a, b) => a.path.localeCompare(b.path));
  return {
    files: found.slice(0, VERSION_CHANGES_SHOWN),
    more: Math.max(0, found.length - VERSION_CHANGES_SHOWN),
  };
}

function toEntry(c: { oid: string; commit: { message: string; author: { timestamp: number; name: string } } }): SnapshotEntry {
  return {
    id: c.oid,
    message: c.commit.message.trim(),
    timestamp: c.commit.author.timestamp * 1000,
    author: c.commit.author.name,
  };
}

async function resolveOrNull(dir: string, ref: string): Promise<string | null> {
  try {
    return await git.resolveRef({ fs, dir, ref });
  } catch {
    return null;
  }
}

/** The last tip of the book's branch this copy fetched or pushed, if it has an online copy. */
async function trackingTip(dir: string): Promise<string | null> {
  const remote = await syncRemoteFor(dir);
  if (!remote) return null;
  let branch: string;
  try {
    branch = await currentBranchOrThrow(dir);
  } catch {
    return null;
  }
  return resolveOrNull(dir, `refs/remotes/${remote.remote}/${branch}`);
}

async function isAncestor(dir: string, cache: object, oid: string, ancestor: string): Promise<boolean> {
  if (oid === ancestor) return true;
  try {
    return await git.isDescendent({ fs, dir, cache, oid, ancestor });
  } catch {
    return false;
  }
}

/**
 * A history page with each version's changes and whether it is backed up.
 * Versions come newest-first, and everything older than the first backed-up
 * one is backed up too, so the ancestry walk runs only over the versions
 * that are on this computer only.
 */
export async function describeVersions(projectDir: string, entries: SnapshotEntry[]): Promise<VersionEntry[]> {
  const dir = await repoDirFor(projectDir);
  const cache = {};
  const tip = await trackingTip(dir);
  const out: VersionEntry[] = [];
  let olderAreBackedUp = false;
  for (const entry of entries) {
    const { files, more } = await listVersionChanges(dir, entry.id, { cache });
    let backedUp: boolean | null = null;
    if (tip) {
      backedUp = olderAreBackedUp || (await isAncestor(dir, cache, tip, entry.id));
      if (backedUp) olderAreBackedUp = true;
    }
    out.push({ ...entry, changes: files, moreChanges: more, backedUp });
  }
  return out;
}

/**
 * The commits reachable from `fromOid` that `baseOid`'s history does not
 * have, newest first, down to (not including) their merge base. None when
 * the two share no history.
 */
export async function commitsAhead(
  dir: string,
  fromOid: string,
  baseOid: string,
  cache: object = {},
  limit = 100,
): Promise<SnapshotEntry[]> {
  if (fromOid === baseOid) return [];
  const bases = await git.findMergeBase({ fs, dir, cache, oids: [fromOid, baseOid] });
  const stopAt = new Set<string>(bases as string[]);
  if (stopAt.size === 0) return [];
  const commits = await git.log({ fs, dir, cache, ref: fromOid, depth: limit });
  const seen = new Set<string>();
  const out: SnapshotEntry[] = [];
  for (const c of commits) {
    if (stopAt.has(c.oid)) break;
    if (seen.has(c.oid)) continue;
    seen.add(c.oid);
    out.push(toEntry(c));
  }
  return out;
}

/**
 * What is online that this computer has not got: fetch the book's branch
 * (remote-tracking ref only — no merge, no checkout, safe on a dirty tree)
 * and describe the commits above the merge base. Quiet on every failure,
 * reporting why, like `checkRemoteUpdates`.
 */
export async function listOnlineVersions(options: {
  projectDir: string;
  credential?: HostCredential;
  tokenStore?: TokenStore;
  httpClient?: typeof defaultGitHttp;
}): Promise<{ entries: VersionEntry[]; reason?: "no-remote" | "auth" | "offline" }> {
  const http = options.httpClient ?? defaultGitHttp;
  try {
    const dir = await repoDirFor(options.projectDir);
    const transport = await resolveTransport(dir, {
      ...(options.credential ? { credential: options.credential } : {}),
      ...(options.tokenStore ? { tokenStore: options.tokenStore } : {}),
    });
    const branch = await currentBranchOrThrow(dir);
    const cache = {};
    await git.fetch({
      fs,
      http,
      dir,
      cache,
      remote: transport.remote,
      ref: branch,
      singleBranch: true,
      tags: false,
      ...onAuthFor(transport.credential),
      // One shot: never loop on a rejected credential.
      ...(transport.credential ? { onAuthFailure: () => ({ cancel: true }) } : {}),
    });
    const tip = await resolveOrNull(dir, `refs/remotes/${transport.remote}/${branch}`);
    const local = await resolveOrNull(dir, branch);
    if (!tip || !local) return { entries: [] };
    const entries: VersionEntry[] = [];
    for (const entry of await commitsAhead(dir, tip, local, cache)) {
      const { files, more } = await listVersionChanges(dir, entry.id, { cache });
      entries.push({ ...entry, changes: files, moreChanges: more, backedUp: true });
    }
    return { entries };
  } catch (e) {
    const message = (e as { message?: string })?.message ?? "";
    if (message === MSG_NO_REMOTE || message === MSG_SSH_REMOTE) return { entries: [], reason: "no-remote" };
    const status = (e as { data?: { statusCode?: number } })?.data?.statusCode;
    if (status === 401 || status === 403 || status === 404) return { entries: [], reason: "auth" };
    return { entries: [], reason: "offline" };
  }
}

function assertRepoRelative(filepath: string): void {
  if (path.isAbsolute(filepath) || filepath.split(/[\\/]/).includes("..")) {
    throw new Error("A file path inside the book is required");
  }
}

/**
 * One file at version `id` beside the same file as it is on disk now, as
 * aligned rows for the compare view. `binary` when either side is not text.
 * A side that does not exist (the file was added since, or removed) is an
 * empty column.
 */
export async function compareVersionFile(
  projectDir: string,
  id: string,
  filepath: string,
): Promise<{ binary: true } | { binary: false; rows: CompareRow[] }> {
  assertRepoRelative(filepath);
  const dir = await repoDirFor(projectDir);
  let thenBytes: Uint8Array | null = null;
  try {
    thenBytes = (await git.readBlob({ fs, dir, oid: id, filepath })).blob;
  } catch (e) {
    if ((e as { code?: string })?.code !== "NotFoundError") throw e;
  }
  let nowBytes: Uint8Array | null = null;
  try {
    nowBytes = new Uint8Array(await readFile(path.join(dir, filepath)));
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
  }
  if ((thenBytes && looksBinary(thenBytes)) || (nowBytes && looksBinary(nowBytes))) return { binary: true };
  const then = thenBytes ? decoder.decode(thenBytes) : "";
  const now = nowBytes ? decoder.decode(nowBytes) : "";
  return { binary: false, rows: alignRows(diffSequences(textLines(then), textLines(now))) };
}

/**
 * Write every file of version `id` under `destDir` (the whole repository
 * tree, so a book inside a larger repository still finds its shared
 * stylesheets) and return the folder the preview should render — the
 * book's own subfolder of it.
 */
export async function exportVersionTree(
  projectDir: string,
  id: string,
  destDir: string,
): Promise<{ inputDir: string }> {
  const source = await detectProjectSource(projectDir);
  const dir = source.type === "local-git-folder" ? gitScopeFor(source) : projectDir;
  const subPath = source.type === "local-git-folder" ? source.subPath || "" : "";
  await git.walk({
    fs,
    dir,
    cache: {},
    trees: [git.TREE({ ref: id })],
    map: async (filepath: string, entries: Array<WalkerEntry | null>) => {
      if (filepath === ".") return true;
      const entry = entries[0];
      if (!entry) return null;
      const type = await entry.type();
      if (type === "tree") return true;
      if (type !== "blob") return null;
      const content = await entry.content();
      if (!content) return null;
      const abs = path.join(destDir, filepath);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content);
      return null;
    },
  });
  return { inputDir: path.join(destDir, subPath) };
}
