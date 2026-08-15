/**
 * Pure per-file resolution PLAN builder for {@link resolveConflicts} (#15,
 * ADR 0006 D5). Given the author's per-file choices and the two commit tips,
 * it decides — for EACH conflicted file — what the merge driver should return
 * ("mine"/"theirs"), what to write/delete on the LOCAL side before the merge
 * (delete-conflict equalization + "(online copy)" files), what to restore
 * after the merge, and which decided files need a raw-bytes binary fix.
 *
 * It is intentionally free of git/fs coupling: the only IO it needs — reading
 * a file's blob from a commit, and picking a collision-free "(online copy)"
 * name — is injected via {@link ResolutionPlanDeps}, so the whole decision
 * table is unit-testable with plain fakes. sync.ts owns the git side-effects
 * of ACTUALLY writing/deleting/merging/pushing; this module owns only the
 * decisions.
 */

/** Author's per-file decision for a conflicted file (mirror of sync.ts). */
export interface ResolutionInput {
  path: string;
  choice: "mine" | "theirs" | "both";
}

/** A file to write with exact bytes (never decoded through a string). */
export interface PlanWrite {
  path: string;
  content: Uint8Array;
}

/**
 * The decisions {@link resolveConflicts} executes, in order:
 *
 * - `driverChoice` — the side the custom mergeDriver returns per decided file.
 * - `preWrites` / `preDeletes` — applied on the LOCAL side BEFORE the merge
 *   ("(online copy)" files + delete-conflict equalization) so the merge is
 *   clean and both parents stay honest.
 * - `postWrites` / `postDeletes` — applied AFTER the merge to restore the
 *   author's chosen side for delete-involved files equalized the other way.
 * - `postBinaryFixes` — decided files overwritten with raw git-object bytes
 *   after checkout, guarding against UTF-8 round-trip corruption of binaries
 *   in the string-based merge driver (a no-op for text files).
 */
export interface ResolutionPlan {
  driverChoice: Map<string, "mine" | "theirs">;
  preWrites: PlanWrite[];
  preDeletes: string[];
  postWrites: PlanWrite[];
  postDeletes: string[];
  postBinaryFixes: PlanWrite[];
}

/** Injected IO the plan builder needs (kept out of this pure module). */
export interface ResolutionPlanDeps {
  /** Read a file's blob from a commit oid, or null when absent in that tree. */
  readBlob: (oid: string, filepath: string) => Promise<Uint8Array | null>;
  /**
   * First "(online copy)" name for `filepath` that is safe for `content`:
   * every existing occurrence (working dir, the trees given by `oids`) is
   * byte-identical to `content`, or the name is unused. Identical-bytes reuse
   * keeps retried resolutions from accumulating "(online copy N)" files.
   */
  uniqueOnlineCopyPath: (
    filepath: string,
    oids: string[],
    content: Uint8Array,
  ) => Promise<string>;
}

/**
 * Build the per-file plan. "mine" is read from `localTip` (the CURRENT local
 * tip, so edits made after the conflict was reported count as the author's
 * version); "theirs" is read from `remoteId` (the online tip). Files present
 * on BOTH sides are settled inside the merge by the driver; delete-involved
 * files are equalized before the merge and restored after.
 */
export async function buildResolutionPlan(
  resolutions: ResolutionInput[],
  localTip: string,
  remoteId: string,
  deps: ResolutionPlanDeps,
): Promise<ResolutionPlan> {
  const driverChoice = new Map<string, "mine" | "theirs">();
  const preWrites: PlanWrite[] = [];
  const preDeletes: string[] = [];
  const postWrites: PlanWrite[] = [];
  const postDeletes: string[] = [];
  // WHY postBinaryFixes: the merge driver receives file contents as UTF-8
  // decoded strings. For binary files (images, PDFs, audio — any file with
  // bytes >= 0x80 that are not valid UTF-8) this round-trip corrupts the
  // chosen side's bytes (non-UTF-8 sequences become U+FFFD replacement
  // chars). The merge driver is still called so the merge commit is honest
  // (two-parent, correct tree oid for text files), but after the forced
  // checkout we overwrite every decided binary file with the exact raw bytes
  // read directly from the git object store (Uint8Array, never decoded).
  // This has NO effect on text files (correct bytes in, correct bytes out).
  const postBinaryFixes: PlanWrite[] = [];

  for (const resolution of resolutions) {
    const filepath = resolution.path;
    const mine = await deps.readBlob(localTip, filepath);
    const theirs = await deps.readBlob(remoteId, filepath);

    if (mine && theirs) {
      // Edited in both copies → settled inside the merge by the driver.
      if (resolution.choice === "theirs") {
        driverChoice.set(filepath, "theirs");
        // Write the chosen raw bytes after checkout to guard against
        // UTF-8 round-trip corruption in the merge driver for binary files.
        postBinaryFixes.push({ path: filepath, content: theirs });
      } else {
        driverChoice.set(filepath, "mine");
        // Write the chosen raw bytes after checkout (binary safety — see
        // postBinaryFixes comment above).
        postBinaryFixes.push({ path: filepath, content: mine });
        if (resolution.choice === "both") {
          // Uniquified: a pre-existing "(online copy)" file (from an
          // earlier "Keep both") with different bytes must survive
          // untouched; an identical one (a retried resolution) is reused.
          preWrites.push({
            path: await deps.uniqueOnlineCopyPath(
              filepath,
              [localTip, remoteId],
              theirs,
            ),
            content: theirs,
          });
        }
      }
    } else if (!mine && theirs) {
      // The author deleted it; the online copy edited it. Equalize to the
      // online content so the merge is clean; if they chose "mine"
      // (stay deleted), remove it again right after the merge.
      preWrites.push({ path: filepath, content: theirs });
      if (resolution.choice === "mine") postDeletes.push(filepath);
    } else if (mine && !theirs) {
      // The online copy deleted it; the author edited it. Equalize to the
      // deletion so the merge is clean; unless they chose the online
      // version (accept the deletion), restore their file after the merge.
      preDeletes.push(filepath);
      if (resolution.choice !== "theirs") {
        postWrites.push({ path: filepath, content: mine });
      }
    }
    // (!mine && !theirs): nothing exists on either side — nothing to do.
  }

  return { driverChoice, preWrites, preDeletes, postWrites, postDeletes, postBinaryFixes };
}
