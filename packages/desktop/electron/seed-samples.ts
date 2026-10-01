// ──────────────────────────────────────────────────────────────────────────
// seed-samples.ts — first-launch copy of the bundled user guide + examples.
//
// The installer ships `examples/` books as extraResources (`samples/`). On the
// first launch we copy them to `<Documents>/Gutterpress/` — a folder the
// existing project discovery already scans — so they appear under
// "Discovered" on the start screen and open like any other book.
//
// Never overwrites: a book whose folder already exists is left untouched, and
// the one-shot `samplesSeeded` pref means a book the author deletes does not
// come back on the next launch. Best-effort: a failure is logged by the
// caller and never blocks startup.
// ──────────────────────────────────────────────────────────────────────────

import { cp, readdir } from "node:fs/promises";
import path from "node:path";

/** Copy each book dir in `srcDir` into `destDir` unless it already exists. */
export async function seedSamples(srcDir: string, destDir: string): Promise<string[]> {
  const copied: string[] = [];
  for (const entry of await readdir(srcDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dest = path.join(destDir, entry.name);
    // force:false + errorOnExist:false → existing files are skipped, not replaced.
    await cp(path.join(srcDir, entry.name), dest, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
    copied.push(entry.name);
  }
  return copied;
}
