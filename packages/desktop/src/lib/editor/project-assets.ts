/**
 * Make the editor's document able to see the book's own art.
 *
 * A chapter refers to its images the way the book does — `images/art.png`,
 * relative to the project. The editor renders that chapter inside the app's
 * own origin, where the same reference resolves to `app://local/images/…`
 * and 404s, so every image collapsed to a broken-image box: on the field
 * guide's first chapter a 502px plate rendered as 24px, and the editor
 * paginated a document that was missing most of its content.
 *
 * The host serves the open project under `app://local/__project/`
 * (`electron/app-protocol.ts`), authorized against the same roots the fs IPC
 * guard uses. This rewrites a relative `src` to that base, and leaves alone
 * anything already absolute (http(s):, data:, file:, app:) — an author who
 * wrote a full URL meant it.
 */
export const PROJECT_ASSET_ORIGIN = "app://local/__project/";

/** True for a reference that already names its own origin/scheme. */
function isAbsoluteReference(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//");
}

/**
 * Point every relative `<img src>` under `root` at the open project.
 *
 * `baseUrl` is the project-asset URL the current document's own directory
 * maps to, so a chapter in a subfolder resolves its art the way the book
 * does. Idempotent: a src already under the project origin is left as is,
 * which matters because the editor re-renders blocks as the author types.
 */
export function resolveProjectAssets(root: ParentNode, baseUrl: string): void {
  for (const img of root.querySelectorAll("img")) {
    const src = img.getAttribute("src");
    if (!src || isAbsoluteReference(src)) continue;
    try {
      img.src = new URL(src, baseUrl).href;
    } catch {
      // An unparsable reference stays exactly as the author wrote it.
    }
  }
}

/**
 * The project-asset base URL for a file at `filePath` inside `projectDir` —
 * the directory the file's own relative references resolve against.
 */
export function projectAssetBase(projectDir: string | null, filePath: string | null): string {
  if (!projectDir || !filePath) return PROJECT_ASSET_ORIGIN;
  const normalize = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const dir = normalize(projectDir);
  const file = normalize(filePath);
  if (!file.startsWith(`${dir}/`)) return PROJECT_ASSET_ORIGIN;
  const relativeDir = file.slice(dir.length + 1).replace(/\/[^/]*$/, "");
  if (!relativeDir || relativeDir === file.slice(dir.length + 1)) return PROJECT_ASSET_ORIGIN;
  return `${PROJECT_ASSET_ORIGIN}${relativeDir.split("/").map(encodeURIComponent).join("/")}/`;
}
