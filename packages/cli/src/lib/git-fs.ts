/**
 * `node:fs`, with crash-atomic writes for git's MUTABLE metadata.
 *
 * WHY THIS EXISTS. isomorphic-git writes `.git/index`, `HEAD`, `packed-refs`
 * and loose refs with a plain `fs.writeFile` — an open-truncate-write. If the
 * process dies between the truncate and the write (the writer force-quits the
 * app, the OS kills it, the machine sleeps badly) the file is left EMPTY or
 * half-written, and the repository can no longer be read. That is the one
 * class of history damage Gutterpress itself causes; every other class needs
 * an outside actor. Since isomorphic-git takes `fs` as a parameter, replacing
 * the write with temp-file + `rename` removes the truncation window entirely
 * — a reader sees either the old file or the new one, never a torn one.
 *
 * SCOPE. Only git's mutable metadata is redirected. Working-tree files and
 * content-addressed objects keep the plain write: objects are written once
 * under a hash of their contents (a torn object is a NEW file that simply
 * fails to inflate, it never destroys a good one), and the working tree is
 * the author's own files, which `rename` semantics would not improve.
 *
 * NOT A DURABILITY BARRIER. There is deliberately no `fsync`: this closes the
 * PROCESS-DEATH window, where the page cache survives and `rename` is atomic
 * to every reader. Surviving sudden power loss would mean fsync-ing the temp
 * file and its directory on every ref write, which is a real cost on the
 * snapshot hot path and guards a failure the app does not cause.
 *
 * Everything not named below is re-exported from `node:fs` unchanged, so this
 * module is a drop-in replacement for `import * as fs from "node:fs"`.
 */
import * as nodeFs from "node:fs";

/**
 * Git's mutable metadata, matched INSIDE a `.git` directory so a working-tree
 * file that happens to be named `index` or `HEAD` can never match: git does
 * not track files inside `.git`, so this cannot collide with author content.
 */
const MUTABLE_GIT_METADATA =
  /(?:^|[\\/])\.git[\\/](?:index|HEAD|packed-refs|refs[\\/].+)$/;

/** True when `file` is git metadata that must be replaced, never truncated. */
export function needsAtomicWrite(file: unknown): file is string {
  return typeof file === "string" && MUTABLE_GIT_METADATA.test(file);
}

let tempCounter = 0;

/** A sibling temp path — same directory, so `rename` stays within one device. */
function tempPathFor(file: string): string {
  return `${file}.gp${process.pid.toString(36)}-${(tempCounter++).toString(36)}.tmp`;
}

/**
 * Callback-style `writeFile` — the form isomorphic-git binds when it is handed
 * the `node:fs` namespace (its `bindFs` probes `readFile()` and treats a
 * callback API as callback-style). Atomic for git metadata, plain otherwise.
 */
function writeFile(
  file: nodeFs.PathOrFileDescriptor,
  data: string | NodeJS.ArrayBufferView,
  options: unknown,
  callback?: (err: NodeJS.ErrnoException | null) => void,
): void {
  const cb = (typeof options === "function" ? options : callback) as (
    err: NodeJS.ErrnoException | null,
  ) => void;
  const opts = (typeof options === "function" ? undefined : options) as never;

  if (!needsAtomicWrite(file)) {
    nodeFs.writeFile(file, data, opts, cb);
    return;
  }

  const temp = tempPathFor(file);
  // Fail-safe cleanup: a temp left behind by a crash is inert (it is never
  // read), but removing it on OUR error paths keeps `.git` tidy.
  const failed = (err: NodeJS.ErrnoException) => nodeFs.unlink(temp, () => cb(err));
  nodeFs.writeFile(temp, data, opts, (writeErr) => {
    // Propagate the error rather than cleaning up first: isomorphic-git
    // reacts to a failed write by creating the parent dir and retrying, and
    // the retry needs to see the same failure it would have seen.
    if (writeErr) return failed(writeErr);
    nodeFs.rename(temp, file, (renameErr) => {
      if (renameErr) return failed(renameErr);
      cb(null);
    });
  });
}

/** Promise-style `writeFile`, for a caller that binds `fs.promises` instead. */
async function writeFilePromise(
  file: nodeFs.PathLike | nodeFs.promises.FileHandle,
  data: never,
  options?: never,
): Promise<void> {
  if (!needsAtomicWrite(file)) {
    return nodeFs.promises.writeFile(file, data, options);
  }
  const temp = tempPathFor(file);
  try {
    await nodeFs.promises.writeFile(temp, data, options);
    await nodeFs.promises.rename(temp, file);
  } catch (err) {
    await nodeFs.promises.unlink(temp).catch(() => {});
    throw err;
  }
}

export const promises: typeof nodeFs.promises = {
  ...nodeFs.promises,
  writeFile: writeFilePromise as typeof nodeFs.promises.writeFile,
};

// Everything else passes through untouched. An explicit local export shadows
// the same name coming from `export *`, so `writeFile`/`promises` above are
// the ones callers get.
export * from "node:fs";
export { writeFile };
