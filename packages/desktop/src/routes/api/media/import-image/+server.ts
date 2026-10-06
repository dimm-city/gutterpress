import { error } from '@sveltejs/kit';
import { mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { defineRoute, getHostServices, requireAbsolute, requireWithinProjectRoot } from '../../_lib/route';
import { isWithinRootCanonical } from '../../../../../electron/server-bridge/fs-guard';
import type { RequestHandler } from './$types';

// This route is the ONE place that decides how an author-picked image file
// (from ANYWHERE on disk, via the native file dialog — same policy as
// `fs/copy-file`'s `src`) becomes a project-relative markdown `src`. Both
// EditorToolbar and MediaPanel call it through `api.media.importImage` and
// contain zero path/fs logic of their own (CLAUDE.md §8).
//
// "Author-picked, via the native file dialog" is enforced: `src` outside the
// project must be a one-time "picked-file" capability
// (`../../../../../electron/server-bridge/picked-files.ts`), registered ONLY
// by `dialog:pickImageFile[s]` when the native dialog itself returns a path,
// and consumed here on first use — see the `call` below. Without it any
// same-origin script could POST an arbitrary absolute `src`, have it copied
// into the project by THIS route, then read it back out through the scoped
// `fs:readFile` route.
export const POST: RequestHandler = defineRoute<{ projectDir: string; src: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; src?: string };
    const projectDir = await requireWithinProjectRoot(
      requireAbsolute(body.projectDir, 'media:importImage'),
      'media:importImage',
    );
    // `src` is not confined to the open project (same policy as
    // fs/copy-file's `src` — see that route's comment): it's meant to come
    // from a native file dialog and may point anywhere on disk. That "meant
    // to" is enforced in `call` below (the picked-file capability check),
    // not here — this only validates shape (absolute).
    const src = requireAbsolute(body.src, 'media:importImage');
    return { projectDir, src };
  },
  call: async ({ body }) => {
    const projectRoot = path.resolve(body.projectDir);
    const srcResolved = path.resolve(body.src);

    // Already inside the project: no copy, just compute the project-relative
    // src. `isWithinRootCanonical` realpaths both sides before the
    // separator-aware containment compare (candidate === root, or nested
    // under `root + path.sep`) — never a bare `startsWith` (a sibling dir that
    // merely shares a string prefix is not inside), and never a lexical-only
    // compare either: a
    // native-file-dialog `src` that is itself a symlink pointing outside the
    // project must not be treated as "already inside" just because its alias
    // happens to live under the project root. No picker
    // capability is required for this branch: nothing is copied, and reading
    // a path already inside the open project reveals nothing the scoped
    // fs:readFile route wouldn't already allow.
    if (await isWithinRootCanonical(srcResolved, projectRoot)) {
      const rel = path.relative(projectRoot, srcResolved).split(path.sep).join('/');
      return { src: rel, copied: false };
    }

    // Outside the project: this is the escape the capability closes —
    // copying an arbitrary host path INTO the scoped project tree, then
    // being able to read it back out via fs:readFile. Require a one-time
    // picked-file capability, consumed here, so only a `src` the native
    // dialog itself just returned (via dialog:pickImageFile[s]) can be
    // copied in; a `src` no picker call produced — or one already spent —
    // is rejected.
    if (!getHostServices().pickedFiles.consume(srcResolved)) {
      error(403, 'media:importImage: src was not returned by a recent file picker');
    }

    // Outside the project: copy it in. Destination policy (ONE rule): prefer
    // an EXISTING top-level `images/` directory, otherwise use `assets/`,
    // created on demand — so it doesn't fight an author who already organized
    // images under `images/`, while an empty/new project still gets the
    // simple `assets/` default.
    let destName = 'assets';
    try {
      const entries = await readdir(projectRoot, { withFileTypes: true });
      if (entries.some((e) => e.isDirectory() && e.name === 'images')) destName = 'images';
    } catch {
      // Project root unreadable — fall through to the assets/ default.
    }
    // `destDir` is assembled AFTER `validate` (projectRoot + a literal
    // 'assets'/'images' segment), so it is NOT covered by `validate`'s
    // canonicalizing check on `projectDir` itself. If the project's `assets/`
    // (or `images/`) is a symlink aliasing a directory OUTSIDE the project,
    // an uncontained `mkdir`/`copyFile` here would silently write the picked
    // image outside the project tree while still reporting success with a
    // project-relative `src` (PR #98). Re-run the same
    // realpath-based containment guard on this call-computed destination —
    // exactly the "join of an already-validated dir + a name segment" case
    // `requireWithinProjectRoot`'s own doc comment calls out.
    const destDir = await requireWithinProjectRoot(
      path.join(projectRoot, destName),
      'media:importImage',
    );
    await mkdir(destDir, { recursive: true });

    const uniqueName = await uniqueBasename(destDir, path.basename(srcResolved));
    const destPath = path.join(destDir, uniqueName);
    // `uniqueBasename`'s `stat`-based collision check treats a DANGLING symlink
    // at `destDir/uniqueName` as "doesn't exist" (`stat` follows the link and
    // gets ENOENT for the missing target), so it can hand back that exact
    // occupied name as the "unique" one. `copyFile` then follows that same
    // symlink on write, planting the imported image at the symlink's target
    // instead of creating a new file (PR #98). Canonically confining this FINAL
    // write path — same fix as `fs/copy-file` — closes it:
    // `requireWithinProjectRoot` resolves through the symlink (dangling or not,
    // see `realpathTolerant`'s doc comment) and rejects once that resolves
    // outside the project, before `copyFile` ever runs.
    await requireWithinProjectRoot(destPath, 'media:importImage');
    await copyFile(srcResolved, destPath);
    return { src: `${destName}/${uniqueName}`, copied: true };
  },
});

/** True if `p` exists (any type), false on any stat error (including ENOENT). */
async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find a basename that doesn't already exist in `destDir`, so importing two
 * different source files that happen to share a name (e.g. two different
 * `cover.png` files picked on separate occasions) never silently overwrites
 * the earlier one. Appends `-2`, `-3`, … before the extension.
 */
async function uniqueBasename(destDir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  let n = 2;
  while (await pathExists(path.join(destDir, candidate))) {
    candidate = `${stem}-${n}${ext}`;
    n++;
  }
  return candidate;
}
