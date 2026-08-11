import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";
import { getAssetPath } from "./embedded-assets";

/**
 * `--format html`: ship the self-contained `book.html` (already fully
 * inlined — see `lib/asset-inline.ts`) alongside a copy of the native engine's
 * viewer bundle, with one `<script src="engine/gutterpress-viewer.js">`
 * injected before `</head>`. The viewer paginates the document in the
 * browser on load — no headless Chromium at build time, no DOM
 * serialization (see the "Not snapshotting the viewer's fragmented DOM" note
 * in the migration plan).
 */
export async function shipViewerHtml(
  htmlFile: string,
  outDir: string
): Promise<void> {
  await fsp.mkdir(path.join(outDir, "engine"), { recursive: true });
  await fsp.copyFile(
    await getAssetPath("engine/gutterpress-viewer.js"),
    path.join(outDir, "engine/gutterpress-viewer.js")
  );
  const tag = '  <script src="engine/gutterpress-viewer.js"></script>\n';
  const html = await fsp.readFile(htmlFile, "utf-8");
  await fsp.writeFile(
    htmlFile,
    /<\/head>/i.test(html) ? html.replace(/<\/head>/i, tag + "</head>") : tag + html,
    "utf-8"
  );
}

/**
 * Create a unique scratch directory under the OS temp dir. Used only for
 * PDF/X intermediates (`raw.pdf`, Ghostscript work files) — never for staging
 * assets. Must not be resolved against `process.cwd()`: `runBuild` is exported
 * and called by the desktop host, so writing scratch dirs into the caller's
 * directory is a hidden side effect. Callers remove it in a `finally`.
 */
export async function createStageRoot(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), "gutterpress-stage-"));
}
