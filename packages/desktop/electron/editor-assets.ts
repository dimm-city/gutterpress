/**
 * The files a book's stylesheets reference, served to the paged editor.
 *
 * `inlineStyles` (packages/cli, asset-inline.ts) rewrites every local
 * `url(...)` in the book's CSS to a hashed name under `assets/` and plans a
 * copy of the file for the BUILD to make. The editor takes the same inlined
 * CSS into the app's own document, where `url("assets/<hash>.png")` resolves
 * against `app://local/` and finds nothing: every background image the book
 * paints was missing from the pages the editor showed. The copies are never
 * made for the editor, so this keeps the plan instead -  hashed name to the
 * file on disk -  and `app-protocol.ts` serves those files, and only those,
 * under {@link EDITOR_ASSET_PREFIX}.
 *
 * The registry is the whole authorization: a name is served only if a
 * stylesheet the open project's manifest lists put it here, which is the
 * same trust the build extends to those stylesheets. That is also why a
 * shared theme's art in a sibling directory of the book works here without
 * widening the project-root guard the fs IPC uses.
 */
import path from "node:path";

/** One planned copy from `inlineStyles`: the file on disk and its hashed build destination. */
interface AssetCopy {
  readonly from: string;
  readonly to: string;
}

export const EDITOR_ASSET_PREFIX = "/__asset/";

/** The hashed names `inlineStyles` writes: a content hash and the file's extension. */
const ASSET_NAME_RE = /^[A-Za-z0-9_-]+\.[a-z0-9]+$/;

const registry = new Map<string, string>();

/** Remember where each hashed asset name came from. */
export function registerEditorAssets(copies: readonly AssetCopy[]): void {
  for (const copy of copies) {
    const name = path.posix.basename(copy.to);
    if (ASSET_NAME_RE.test(name)) registry.set(name, copy.from);
  }
}

/** The file behind a hashed asset name, or undefined for a name no stylesheet produced. */
export function editorAssetPath(name: string): string | undefined {
  if (!ASSET_NAME_RE.test(name)) return undefined;
  return registry.get(name);
}

/** Point the inlined CSS's `url("assets/...")` references at the editor asset route. */
export function rewriteEditorAssetUrls(css: string): string {
  return css.replace(/url\("assets\/([A-Za-z0-9_-]+\.[a-z0-9]+)"\)/g, (whole, name: string) =>
    registry.has(name) ? `url("app://local${EDITOR_ASSET_PREFIX}${name}")` : whole,
  );
}
