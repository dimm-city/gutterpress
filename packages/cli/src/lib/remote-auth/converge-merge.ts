/**
 * converge-merge.ts — the ONE merge Gutterpress performs. It always succeeds.
 *
 * Owner ruling (2026-08-14): sync never asks and never blocks. When the local
 * copy and the online copy both changed, the merge CONVERGES with a fixed
 * policy instead of surfacing a chooser:
 *
 *   - Text passage edited on both sides → BOTH versions land in the one file,
 *     wrapped in standard git conflict markers (`<<<<<<< your version` /
 *     `=======` / `>>>>>>> online version`) — the format every tool
 *     understands, visible in the editor and loud in the preview until the
 *     writer blends them. This is exactly what `git merge` produces; we just
 *     don't stop the world over it.
 *   - Binary file changed on both sides (NUL-byte sniff — git's own test —
 *     or an image extension; SVG counts as an image, markers would corrupt
 *     its XML) → the NEWER side wins (tip commit timestamps), byte-exact.
 *     The older version stays reachable in history (it is a parent of the
 *     merge commit). Clashing IMAGES are additionally reported so the
 *     desktop can offer its non-blocking side-by-side picker afterwards.
 *   - Deleted on one side, edited on the other → the EDIT survives (a
 *     deletion is trivially re-doable; a lost edit is not).
 *   - Added on both sides with different content (isomorphic-git throws
 *     MergeNotSupportedError for this — no merge base to diff against) →
 *     same policy as binary: newer side wins, other version in history.
 *
 * WHY the two-phase shape (attempt → equalize → re-attempt) instead of
 * isomorphic-git's `abortOnConflict: false`: that mode writes the ENTIRE
 * merged tree to the working dir through a UTF-8 TextDecoder
 * (isomorphic-git 1.38.4 index.js:7981), corrupting every binary file in the
 * tree — committing from that state would commit the corruption. With
 * `abortOnConflict: true` (the default) a conflicted merge leaves the tree
 * and index COMPLETELY untouched, so we equalize the handful of
 * driver-unreachable cases (deletes, binaries, both-adds) with an ordinary
 * commit and re-run the merge, which is then clean by construction.
 *
 * Used by `pullChanges` (every sync) and by `repairRepo`'s salvage step
 * (merging a rescued old branch tip back into the repaired history).
 */
import * as fs from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";
// WHY diff3: the SAME tiny (~100-line, zero-dependency) module
// isomorphic-git's own default merge driver uses, so clean hunks merge
// byte-identically to a plain `git.merge`. Pinned exact in package.json.
import diff3Merge from "diff3";

import {
  hasPendingChanges,
  snapshotWorkingTreeUnlocked,
} from "../source-provider.ts";
import { clearCheckoutPending, writeCheckoutPending } from "./checkout-journal.ts";
import { isMergeConflictError } from "./recovery/classify.ts";
import type { GitCache, ImageClash } from "./sync-types.ts";

export type { ImageClash };

export interface ConvergeResult {
  /** The branch tip after the merge (the merge commit, or the ff/no-op tip). */
  oid: string;
  /**
   * Files whose text now contains BOTH versions inside git conflict markers —
   * the writer should blend these. Empty when everything merged cleanly.
   */
  combinedFiles: string[];
  /** Clashing images (newer version kept) for the non-blocking picker. */
  imageClashes: ImageClash[];
}

/** Snapshot message for the equalization commit (driver-unreachable cases). */
export const CONVERGE_PREPARE_MESSAGE =
  "Getting your changes ready to combine with the online version";
/** Snapshot message for the post-merge restore commit (newer-wins/edits). */
export const CONVERGE_RESTORE_MESSAGE =
  "Kept the newest version of files that can't be combined";
/** The merge commit message (same wording the old sync used). */
export const CONVERGE_MERGE_MESSAGE =
  "Combined your changes with the online version";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;

/** Marker labels — author language, never git jargon. */
const OUR_LABEL = "your version";
const THEIR_LABEL = "online version";

/** NUL in a decoded string ⇒ the underlying bytes are binary (git's test). */
function stringLooksBinary(s: string): boolean {
  return s.includes("\u0000");
}

function blobLooksBinary(b: Uint8Array): boolean {
  return b.subarray(0, 8192).includes(0);
}

const LINEBREAKS = /^.*(\r?\n|$)/gm;

/**
 * diff3 merge that NEVER reports a conflict: clean hunks merge exactly like
 * git's default driver; clashing hunks keep BOTH versions inside standard
 * git conflict markers. Exported for tests.
 */
export function mergeWithMarkers(
  baseContent: string,
  ourContent: string,
  theirContent: string,
): string {
  const result = diff3Merge(
    ourContent.match(LINEBREAKS) ?? [],
    baseContent.match(LINEBREAKS) ?? [],
    theirContent.match(LINEBREAKS) ?? [],
  );
  let merged = "";
  for (const item of result) {
    if (item.ok) merged += item.ok.join("");
    if (item.conflict) {
      merged += `<<<<<<< ${OUR_LABEL}\n`;
      merged += item.conflict.a.join("");
      merged += `=======\n`;
      merged += item.conflict.b.join("");
      merged += `>>>>>>> ${THEIR_LABEL}\n`;
    }
  }
  return merged;
}

async function readBlobOrNull(
  dir: string,
  cache: GitCache,
  oid: string,
  filepath: string,
): Promise<{ oid: string; blob: Uint8Array } | null> {
  try {
    const r = await git.readBlob({ fs, dir, cache, oid, filepath });
    return { oid: r.oid, blob: r.blob };
  } catch {
    return null;
  }
}

async function writeTreeFile(dir: string, filepath: string, content: Uint8Array): Promise<void> {
  const abs = path.join(dir, filepath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

/**
 * Paths ADDED (relative to the merge base) on BOTH sides with different
 * content — the case isomorphic-git's mergeTree cannot represent
 * (MergeNotSupportedError). Walks the two tip trees against the merge base.
 *
 * Returns null when the tips share NO merge base at all: that is the
 * unrelated-histories case (a wrong online address), and the caller must
 * rethrow rather than equalize — equalizing first would commit another
 * project's file contents into this book before the error surfaced.
 */
async function bothAddedPaths(
  dir: string,
  cache: GitCache,
  ourTip: string,
  theirTip: string,
  allowUnrelated: boolean,
): Promise<string[] | null> {
  const bases = await git.findMergeBase({ fs, dir, cache, oids: [ourTip, theirTip] });
  const base = bases[0] as string | undefined;
  if (!base && !allowUnrelated) return null;
  const out: string[] = [];
  await git.walk({
    fs,
    dir,
    cache,
    trees: [
      git.TREE({ ref: ourTip }),
      git.TREE({ ref: theirTip }),
      ...(base ? [git.TREE({ ref: base })] : []),
    ],
    map: async (filepath, entries) => {
      if (filepath === ".") return true;
      const [ours, theirs, inBase] = entries;
      const types = await Promise.all(
        [ours, theirs, inBase].map((e) => (e ? e.type() : Promise.resolve(undefined))),
      );
      // Recurse into directories.
      if (types.some((t) => t === "tree")) return true;
      if (!ours || !theirs || inBase) return null;
      const [a, b] = await Promise.all([ours.oid(), theirs.oid()]);
      if (a !== b) out.push(filepath);
      return null;
    },
  });
  return out;
}

/**
 * Merge `theirs` into `branch` so that the merge ALWAYS lands, applying the
 * fixed converge policy documented in the module header. The working tree is
 * synced to the result. Caller holds the repo lock and passes its
 * function-scoped object cache.
 *
 * Throws only for genuinely unmergeable situations that the caller maps to a
 * plain error outcome (e.g. unrelated histories when `allowUnrelated` is
 * false — a wrong online address must not silently splice two books).
 */
export async function convergeMerge(params: {
  dir: string;
  cache: GitCache;
  branch: string;
  theirs: string;
  author: { name: string; email: string };
  authorName?: string;
  authorEmail?: string;
  allowUnrelatedHistories?: boolean;
}): Promise<ConvergeResult> {
  const { dir, cache, branch, theirs, author } = params;

  const ourTip = await git.resolveRef({ fs, dir, ref: branch });
  // Crash-window journal: git.merge below moves the branch REF; the forced
  // git.checkout that materializes the result into the working folder is a
  // separate, later step. Dying between the two leaves a structurally-healthy
  // repo whose folder silently reverts the merge the moment snapshot-first
  // commits it (the dc-op-manual c84d16e clobber). The marker (written before
  // the ref can move, cleared only after checkout) makes the state detectable,
  // and healPendingCheckout() reconciles it before any snapshot can run.
  writeCheckoutPending(dir, { branch, preMergeTip: ourTip });
  const [ourCommit, theirCommit] = await Promise.all([
    git.readCommit({ fs, dir, cache, oid: ourTip }),
    git.readCommit({ fs, dir, cache, oid: theirs }),
  ]);
  // Newer-wins policy input: which TIP was committed more recently.
  const localNewer =
    ourCommit.commit.committer.timestamp >= theirCommit.commit.committer.timestamp;

  const combined = new Set<string>();
  const driverBinary = new Set<string>();
  const imageClashes: ImageClash[] = [];

  const attempt = () =>
    git.merge({
      fs,
      dir,
      cache,
      ours: branch,
      theirs,
      author,
      message: CONVERGE_MERGE_MESSAGE,
      allowUnrelatedHistories: params.allowUnrelatedHistories ?? false,
      mergeDriver: ({ contents, path: filepath }) => {
        const [base, ours, theirsContent] = contents as [string, string, string];
        if (
          IMAGE_EXT.test(filepath) ||
          stringLooksBinary(ours) ||
          stringLooksBinary(theirsContent) ||
          stringLooksBinary(base)
        ) {
          // Binary/image: markers would corrupt it and the driver's
          // string round-trip would garble the bytes — flag it unclean so
          // the merge aborts UNTOUCHED and the equalization pass below
          // settles it byte-exactly. The returned text is never committed.
          driverBinary.add(filepath);
          return { cleanMerge: false, mergedText: ours };
        }
        combined.add(filepath);
        return {
          cleanMerge: true,
          mergedText: mergeWithMarkers(base, ours, theirsContent),
        };
      },
    });

  const snapshot = (message: string) =>
    snapshotWorkingTreeUnlocked({
      projectDir: dir,
      repoRoot: dir,
      message,
      authorName: params.authorName,
      authorEmail: params.authorEmail,
      // These snapshots run deliberately INSIDE the guarded merge→checkout
      // window (equalize/restore) — healing here would clear the journal
      // while the window is still open.
      skipCheckoutHeal: true,
    });

  /**
   * Equalize the driver-unreachable clashes with an ordinary commit on OUR
   * side so the re-merge is clean, remembering what to restore afterwards
   * when the surviving content is not what the equalization wrote.
   */
  const postRestore: Array<{ path: string; bytes: Uint8Array }> = [];
  const equalize = async (paths: {
    binary: string[];
    deleteByUs: string[];
    deleteByTheirs: string[];
  }): Promise<void> => {
    for (const p of paths.binary) {
      const [ourBlob, theirBlob] = await Promise.all([
        readBlobOrNull(dir, cache, ourTip, p),
        readBlobOrNull(dir, cache, theirs, p),
      ]);
      if (!ourBlob || !theirBlob) continue; // settled by a delete list instead
      // Equalize to THEIR bytes (makes both sides identical → clean merge);
      // if the LOCAL side is newer it is restored after the merge, so the
      // final content is always the newer side and BOTH blobs are parents'
      // history. Never route binary bytes through the string driver.
      await writeTreeFile(dir, p, theirBlob.blob);
      if (localNewer) postRestore.push({ path: p, bytes: ourBlob.blob });
      if (IMAGE_EXT.test(p)) {
        imageClashes.push({
          path: p,
          localOid: ourBlob.oid,
          remoteOid: theirBlob.oid,
          kept: localNewer ? "local" : "online",
        });
      }
    }
    for (const p of paths.deleteByUs) {
      // We deleted it; the online copy edited it → the EDIT survives.
      const theirBlob = await readBlobOrNull(dir, cache, theirs, p);
      if (theirBlob) await writeTreeFile(dir, p, theirBlob.blob);
    }
    for (const p of paths.deleteByTheirs) {
      // We edited it; the online copy deleted it → agree to the deletion so
      // the merge is clean, then restore our EDIT right after it.
      const ourBlob = await readBlobOrNull(dir, cache, ourTip, p);
      await unlink(path.join(dir, p)).catch((e: unknown) => {
        if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
      });
      if (ourBlob) postRestore.push({ path: p, bytes: ourBlob.blob });
    }
    if (await hasPendingChanges(dir)) await snapshot(CONVERGE_PREPARE_MESSAGE);
  };

  try {
    await attempt();
  } catch (e) {
    if (isMergeConflictError(e)) {
      // Text clashes were already converged by the driver (cleanMerge:true),
      // so ONLY binaries and delete-vs-edit remain in the lists.
      await equalize({
        binary: (e.data.bothModified ?? []).filter((p) => driverBinary.has(p)),
        deleteByUs: e.data.deleteByUs ?? [],
        deleteByTheirs: e.data.deleteByTheirs ?? [],
      });
      await attempt();
    } else if ((e as { code?: string })?.code === "MergeNotSupportedError") {
      // Added on both sides with different content — no merge base for the
      // driver to work from. Newer side wins; the other stays in history.
      // (null = truly unrelated histories → rethrow untouched.)
      const added = await bothAddedPaths(
        dir,
        cache,
        ourTip,
        theirs,
        params.allowUnrelatedHistories ?? false,
      );
      if (added === null || added.length === 0) throw e; // unmergeable — surface it
      await equalize({ binary: added, deleteByUs: [], deleteByTheirs: [] });
      await attempt();
    } else {
      throw e;
    }
  }

  // merge() moves the ref only — sync the working tree to the result.
  await git.checkout({ fs, dir, cache, ref: branch, force: true });
  // The folder now matches the ref — close the crash window. A throw above
  // leaves the marker in place on purpose: the next operation's
  // healPendingCheckout() finishes the materialization before anything can
  // snapshot the half-updated folder.
  clearCheckoutPending(dir);

  // Restore the surviving content for the equalized-the-other-way files
  // (newer local binaries, edits that beat a deletion) as a visible,
  // honestly-labeled snapshot on top of the merge.
  if (postRestore.length > 0) {
    for (const r of postRestore) await writeTreeFile(dir, r.path, r.bytes);
    if (await hasPendingChanges(dir)) await snapshot(CONVERGE_RESTORE_MESSAGE);
  }

  return {
    oid: await git.resolveRef({ fs, dir, ref: branch }),
    combinedFiles: [...combined].sort(),
    imageClashes,
  };
}
