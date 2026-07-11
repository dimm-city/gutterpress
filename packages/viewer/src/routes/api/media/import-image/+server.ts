import { mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { defineRoute, requireAbsolute, requireWithinProjectRoot } from '../../_lib/route';
import { isWithinRoot } from '../../../../../electron/server-bridge/fs-guard';
import type { RequestHandler } from './$types';

// ARCH/UX review M10: the toolbar's "Insert Image" dialog and MediaPanel's
// "Add images…" used to each hand-roll their own project-relative path math
// in the renderer (separator sniffing, trailing-slash trimming) and disagreed
// on the destination folder — the toolbar always copied to `assets/` while
// MediaPanel preferred an existing `images/` dir, despite a comment claiming
// parity. Worse, the toolbar's "is this already inside the project" check was
// a raw `startsWith` prefix match, so a sibling directory that merely SHARES a
// string prefix (`/home/u/proj2` vs `/home/u/proj`) was treated as "inside"
// and silently skipped the copy, emitting a bare basename that pointed at a
// file that doesn't exist in the project → a broken image in the built PDF.
//
// This route is the ONE place that decides how an author-picked image file
// (from ANYWHERE on disk, via the native file dialog — same policy as
// `fs/copy-file`'s `src`) becomes a project-relative markdown `src`. Both
// EditorToolbar and MediaPanel call it through `api.media.importImage` and
// contain zero path/fs logic of their own (CLAUDE.md §8).
export const POST: RequestHandler = defineRoute<{ projectDir: string; src: string }>({
  validate: (raw) => {
    const body = raw as { projectDir?: string; src?: string };
    const projectDir = requireWithinProjectRoot(
      requireAbsolute(body.projectDir, 'media:importImage'),
      'media:importImage',
    );
    // `src` is DELIBERATELY NOT confined to the open project (same policy as
    // fs/copy-file's `src` — see that route's comment): it comes from a
    // native file dialog and may point anywhere on disk.
    const src = requireAbsolute(body.src, 'media:importImage');
    return { projectDir, src };
  },
  call: async ({ body }) => {
    const projectRoot = path.resolve(body.projectDir);
    const srcResolved = path.resolve(body.src);

    // Already inside the project: no copy, just compute the project-relative
    // src. `isWithinRoot` is separator-aware containment (candidate === root,
    // or nested under `root + path.sep`) — never a bare `startsWith`, which is
    // exactly the sibling-prefix bug this route replaces.
    if (isWithinRoot(srcResolved, projectRoot)) {
      const rel = path.relative(projectRoot, srcResolved).split(path.sep).join('/');
      return { src: rel, copied: false };
    }

    // Outside the project: copy it in. Destination policy (ONE rule,
    // replacing the two renderer implementations that disagreed): prefer an
    // EXISTING top-level `images/` directory — the convention MediaPanel
    // already used for projects that have one — otherwise use `assets/`,
    // created on demand. Chosen over always-`assets/` (the toolbar's old
    // behavior) because it doesn't fight an author who already organized
    // images under `images/`, and it's the strictly more general of the two
    // pre-existing behaviors (an empty/new project has no `images/` dir, so
    // it still gets the simple `assets/` default).
    let destName = 'assets';
    try {
      const entries = await readdir(projectRoot, { withFileTypes: true });
      if (entries.some((e) => e.isDirectory() && e.name === 'images')) destName = 'images';
    } catch {
      // Project root unreadable — fall through to the assets/ default.
    }
    const destDir = path.join(projectRoot, destName);
    await mkdir(destDir, { recursive: true });

    const uniqueName = await uniqueBasename(destDir, path.basename(srcResolved));
    const destPath = path.join(destDir, uniqueName);
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
