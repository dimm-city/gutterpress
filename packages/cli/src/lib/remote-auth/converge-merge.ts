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
 *     plus `.svg`, which is text but whose XML markers would corrupt) → BOTH
 *     versions are kept, byte-exact, as two files: ours stays at `path`, the
 *     online one lands beside it at `path.online.<ext>`. Reported as
 *     {@link ConvergeResult.keptBothFiles} so the host can name the pair.
 *     Owner ruling: "we are fine with keeping both changes on a merge and
 *     calling them out for manual fixing."
 *   - Deleted on one side, edited on the other → the EDIT survives (a
 *     deletion is trivially re-doable; a lost edit is not).
 *   - Added on both sides with different content (isomorphic-git throws
 *     MergeNotSupportedError for this — no merge base to diff against) →
 *     same policy as binary: both versions kept, theirs as the `.online`
 *     sibling.
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
 * THE WORKING TREE MOVES WHILE WE RUN. An author is typing into the same files
 * a background sync is merging, and the desktop editor's autosave lands 500 ms
 * after the last keystroke — so a write can arrive at any point between the
 * caller's snapshot-first commit and the checkout that ends this function.
 * Two rules keep that from costing a paragraph: commit anything already on
 * disk right before merging (so it merges rather than being overwritten), and
 * check out WITHOUT `force` (so a write that arrives later is left alone or
 * loudly refused, never silently replaced). Both are marked in the body.
 *
 * Used by `syncProject` (every sync) and by `repairRepo`'s salvage step
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
import { isCheckoutConflict, isMergeConflictError } from "./recovery/classify.ts";
import type { GitCache, KeptBothFile } from "./sync-types.ts";

export type { KeptBothFile };

export interface ConvergeResult {
  /** The branch tip after the merge (the merge commit, or the ff/no-op tip). */
  oid: string;
  /**
   * Files whose text now contains BOTH versions inside git conflict markers —
   * the writer should blend these. Empty when everything merged cleanly.
   */
  combinedFiles: string[];
  /** Files kept as a pair: ours at `path`, theirs at `onlinePath`. */
  keptBothFiles: KeptBothFile[];
}

/** Snapshot message for the equalization commit (driver-unreachable cases). */
export const CONVERGE_PREPARE_MESSAGE =
  "Getting your changes ready to combine with the online version";
/** Snapshot message for the post-merge restore commit (kept-both/edits). */
export const CONVERGE_RESTORE_MESSAGE =
  "Kept both versions of the files that can't be combined";
/** The merge commit message (same wording the old sync used). */
export const CONVERGE_MERGE_MESSAGE =
  "Combined your changes with the online version";

/**
 * Extensions the NUL-byte sniff below cannot catch but that conflict markers
 * would still destroy: SVG is plain text, so no NUL appears, yet `<<<<<<<`
 * lines make the XML unparseable. Every raster format carries NULs in its
 * header and is caught by the sniff, so this list stays at the one exception.
 */
const MARKER_UNSAFE_EXT = /\.svg$/i;

/**
 * Where the online version of a file that cannot carry conflict markers is
 * kept: the same name with `.online` before the extension
 * (`art/cover.png` -> `art/cover.online.png`). Repo-relative, always posix.
 */
export function onlineSiblingPath(filepath: string): string {
  const ext = path.posix.extname(filepath);
  return ext ? `${filepath.slice(0, -ext.length)}.online${ext}` : `${filepath}.online`;
}

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

  const snapshot = (message: string) =>
    snapshotWorkingTreeUnlocked({
      projectDir: dir,
      repoRoot: dir,
      message,
      authorName: params.authorName,
      authorEmail: params.authorEmail,
      // Share the merge's cache so the checkout below reads the index these
      // equalization commits wrote — see SnapshotOptions.cache.
      cache,
    });

  const ourTip = await git.resolveRef({ fs, dir, ref: branch });

  const combined = new Set<string>();
  const driverBinary = new Set<string>();
  const keptBothFiles: KeptBothFile[] = [];

  // The branch tip each merge attempt started from — the point the rollback
  // below returns to when the working tree moves under us mid-merge.
  let tipBeforeMerge = ourTip;
  const attempt = async () => {
    tipBeforeMerge = await git.resolveRef({ fs, dir, ref: branch });
    return git.merge({
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
          MARKER_UNSAFE_EXT.test(filepath) ||
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
  };

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
      // Equalize to THEIR bytes (makes both sides identical → clean merge),
      // then after the merge put OUR bytes back at `p` and drop THEIR bytes
      // beside it as the `.online` sibling: a file that can't carry conflict
      // markers keeps both versions as two files instead. Never route binary
      // bytes through the string driver.
      await writeTreeFile(dir, p, theirBlob.blob);
      const onlinePath = onlineSiblingPath(p);
      postRestore.push({ path: p, bytes: ourBlob.blob });
      postRestore.push({ path: onlinePath, bytes: theirBlob.blob });
      keptBothFiles.push({ path: p, onlinePath });
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
  //
  // NOT `force: true`. A forced checkout rewrites every tracked file from the
  // merge result, including one an editor wrote to disk after we committed the
  // tree — and those bytes are in no commit, so forcing DESTROYS them (0.10.0
  // regression: the pre-0.10.0 pull returned early on an already-merged no-op
  // and never reached this line, so a solo author's every-2-minute auto-sync
  // never touched the tree; converging made the checkout unconditional).
  // Plain checkout instead: it leaves alone any file the merge did not change
  // (so a late edit simply survives, and the next snapshot commits it) and
  // REFUSES — before writing anything — on a file the merge changed that also
  // moved on disk. That refusal is handled below; it is never a silent
  // overwrite.
  try {
    await git.checkout({ fs, dir, cache, ref: branch, force: false });
  } catch (e) {
    if (!isCheckoutConflict(e)) throw e;
    // Something wrote to a merge-affected file in the few milliseconds between
    // the merge and this checkout. Put the branch back where the merge started
    // (the merge commit becomes unreferenced) so HEAD, the index and the
    // working tree stay consistent and the late edit stays on disk,
    // uncommitted. The caller reports a plain "try again"; the next sync
    // snapshots that edit first and converges it properly. Never force here —
    // "try again in two minutes" is always better than a lost paragraph.
    // `writeRef` does NOT expand a short name (it would create `.git/main`),
    // so expand it the way `git.merge` did when it moved the ref.
    await git.writeRef({
      fs,
      dir,
      ref: await git.expandRef({ fs, dir, ref: branch }),
      value: tipBeforeMerge,
      force: true,
    });
    throw e;
  }

  // Write the surviving content for the equalized-the-other-way files (our
  // binaries plus their `.online` siblings, edits that beat a deletion) as a
  // visible, honestly-labeled snapshot on top of the merge.
  if (postRestore.length > 0) {
    for (const r of postRestore) await writeTreeFile(dir, r.path, r.bytes);
    if (await hasPendingChanges(dir)) await snapshot(CONVERGE_RESTORE_MESSAGE);
  }

  return {
    oid: await git.resolveRef({ fs, dir, ref: branch }),
    combinedFiles: [...combined].sort(),
    keptBothFiles,
  };
}
