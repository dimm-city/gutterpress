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
 * The host serves the open project under `/api/editor/project-file/`,
 * confined to the open book by the same guard every fs route uses. This
 * rewrites a relative `src` to that base, and leaves alone
 * anything already absolute (http(s):, data:, file:, app:) — an author who
 * wrote a full URL meant it.
 */
/**
 * Route the host serves the open book's files from (see
 * `routes/api/editor/project-file`): `<base64url(projectDir)>/<relative path>`,
 * made absolute against the app's own origin so `new URL(src, base)` resolves
 * a chapter's relative references the way the book does.
 */
export const PROJECT_FILE_ROUTE = "/api/editor/project-file/";

function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function appOrigin(): string {
  return typeof location !== "undefined" ? location.origin : "app://local";
}

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
  if (!projectDir || !filePath) return `${appOrigin()}${PROJECT_FILE_ROUTE}`;
  const normalize = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const dir = normalize(projectDir);
  const file = normalize(filePath);
  const origin = `${appOrigin()}${PROJECT_FILE_ROUTE}${base64url(dir)}/`;
  if (!file.startsWith(`${dir}/`)) return origin;
  const relativeDir = file.slice(dir.length + 1).replace(/\/[^/]*$/, "");
  if (!relativeDir || relativeDir === file.slice(dir.length + 1)) return origin;
  return `${origin}${relativeDir.split("/").map(encodeURIComponent).join("/")}/`;
}
