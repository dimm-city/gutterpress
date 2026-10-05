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
 * SCOPE. Git's mutable metadata AND its object store (loose objects and
 * packs) are redirected. Objects were once left on the plain write on the
 * theory that a torn object is a new file that merely fails to inflate — but
 * isomorphic-git never rewrites an object file that already exists
 * (`writeObjectLoose` skips it), and it reads a loose object BEFORE the packs,
 * so one empty object file from a quit mid-write permanently shadows the good
 * copy and fails every later merge with a masked "buffer error" (0.11.6
 * field report). The working tree is the author's own files, which `rename`
 * semantics would not improve, so it keeps the plain write.
 *
 * SELF-HEAL. Repositories damaged before this fix still hold such empty loose
 * objects. A zero-byte loose object carries no data, so `readFile` deletes it
 * and reports it missing: isomorphic-git then falls through to the packs, and
 * the next write of that object can recreate it.
 *
 * NOT A DURABILITY BARRIER. There is deliberately no `fsync`: this closes the
 * PROCESS-DEATH window, where the page cache survives and `rename` is atomic
 * to every reader. Surviving sudden power loss would mean fsync-ing the temp
 * file and its directory on every ref write, which is a real cost on the
 * snapshot hot path and guards a failure the app does not cause.
 *
 * Everything not named below passes through to `node:fs` unchanged, so
 * `import { gitFs as fs }` is a drop-in for `import * as fs from "node:fs"`.
 */
import * as nodeFs from "node:fs";

/**
 * Git's mutable metadata, matched INSIDE a `.git` directory so a working-tree
 * file that happens to be named `index` or `HEAD` can never match: git does
 * not track files inside `.git`, so this cannot collide with author content.
 */
const ATOMIC_GIT_FILES =
  /(?:^|[\\/])\.git[\\/](?:index|HEAD|packed-refs|refs[\\/].+|objects[\\/].+)$/;

/** A loose object: `.git/objects/<2 hex>/<38 hex>`. */
const LOOSE_OBJECT = /(?:^|[\\/])\.git[\\/]objects[\\/][0-9a-f]{2}[\\/][0-9a-f]{38}$/;

/** True when `file` is a git file that must be replaced, never truncated. */
export function needsAtomicWrite(file: unknown): file is string {
  return typeof file === "string" && ATOMIC_GIT_FILES.test(file);
}

let tempCounter = 0;

/**
 * A sibling temp path — same directory, so `rename` stays within one device.
 * Inside the object store it uses git's own `tmp_obj_` prefix: isomorphic-git
 * lists `objects/<xx>/` to expand short ids, and a non-hex name can never
 * match one, even if a crash leaves the temp behind.
 */
function tempPathFor(file: string): string {
  const unique = `${process.pid.toString(36)}-${(tempCounter++).toString(36)}`;
  if (/[\\/]\.git[\\/]objects[\\/]/.test(file)) {
    return file.replace(/[^\\/]+$/, `tmp_obj_gp${unique}`);
  }
  return `${file}.gp${unique}.tmp`;
}

/** The error `readFile` reports for a missing file. */
function notFound(file: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`ENOENT: no such file or directory, open '${file}'`), {
    code: "ENOENT",
    errno: -2,
    syscall: "open",
    path: file,
  });
}

/**
 * True when `file` is a loose object and `data` is empty: a torn write's
 * remains. Such a file is removed (best-effort) so the object reads as
 * missing and can be written again — see SELF-HEAL above.
 */
function isTornLooseObject(file: unknown, data: { length: number }): file is string {
  return typeof file === "string" && data.length === 0 && LOOSE_OBJECT.test(file);
}

/**
 * Promise-style `readFile` — reports a torn loose object as missing. This is
 * the reader isomorphic-git actually binds: `gitFs.promises` is an enumerable
 * own property, and isomorphic-git prefers an enumerable `promises`.
 */
async function readFilePromise(file: never, options?: never): Promise<string | Buffer> {
  const data = (await nodeFs.promises.readFile(file, options)) as string | Buffer;
  if (isTornLooseObject(file, data)) {
    await nodeFs.promises.unlink(file).catch(() => {});
    throw notFound(file);
  }
  return data;
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

const promises: typeof nodeFs.promises = {
  ...nodeFs.promises,
  readFile: readFilePromise as typeof nodeFs.promises.readFile,
  writeFile: writeFilePromise as typeof nodeFs.promises.writeFile,
};

/**
 * `node:fs` with the two writers above swapped in — the object callers import
 * as `fs` and hand to isomorphic-git. Everything else passes through
 * untouched.
 *
 * WHY an object and not `export * from "node:fs"`: bun build with
 * `--packages=external` compiles a star re-export of a BUILTIN into a
 * `__reExport(exports, node_fs)` call whose `node_fs` binding is never
 * emitted, so the built lib throws `ReferenceError: node_fs is not defined`
 * on import. A plain spread has no such hazard.
 */
export const gitFs: typeof nodeFs = {
  ...nodeFs,
  writeFile: writeFile as typeof nodeFs.writeFile,
  promises,
};
