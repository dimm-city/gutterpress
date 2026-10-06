/**
 * The desktop host's plugin-aware rich-editor projection builder.
 *
 * Host Node code (CLAUDE.md §8): the `/api/editor/projection` route is its
 * one caller in production, and `tests/editor/editor-projection-host.test.ts`
 * drives {@link buildHostEditorProjection} directly. Given a project
 * directory and a chapter's text, it loads that project's manifest and its
 * plugins and builds a plugin-aware, trusted projection through the SAME
 * production `createMarkdownRenderer`/`createEditorProjection` the CLI build
 * and preview path use — never a second, narrower copy.
 *
 * Plugin loading goes through `gutterpress/plugins`, the same
 * degrade-and-report loader the live preview uses (a plugin that fails to
 * load is reported in `pluginErrors`; the rest of the document still
 * projects).
 *
 * Book CSS: the project's stylesheets and the plugins' CSS are inlined and
 * scoped to the editor document ({@link EDITOR_BOOK_SCOPE_SELECTOR}). Files a
 * stylesheet references (`url("assets/…")`, fonts and images `inlineStyles`
 * copies alongside the CSS) are registered here and served by
 * `/api/editor/asset/[name]` — the registry IS the authorization: only a
 * name a listed stylesheet produced resolves, to exactly the file it came
 * from. The composed CSS is cached per project on the stylesheets' mtime/size
 * stamps; the projection itself is rebuilt on every call (a file switch or
 * entering Read, never per keystroke).
 */
import path from "node:path";
import { stat } from "node:fs/promises";
import { composeEditorCss, inlineStyles } from "gutterpress";
import { loadManifestWithPath, resolveConfig } from "gutterpress/api";
import { layerExtensionCss, loadPluginsWithCss, type PluginStyleGroup } from "gutterpress/plugins";
import {
  createEditorProjection,
  createMarkdownRenderer,
  RICH_MODE_MAX_CONTENT_BYTES,
  type GutterpressProjection,
} from "gutterpress/render";

export { RICH_MODE_MAX_CONTENT_BYTES };

export interface EditorProjectionPluginError {
  readonly pluginRef: string;
  readonly message: string;
}

export interface EditorProjectionHostResult {
  readonly projection: GutterpressProjection;
  readonly pluginCss: string;
  readonly pluginErrors: readonly EditorProjectionPluginError[];
  readonly bookCss: string;
}

export interface EditorProjectionHostArgs {
  readonly projectDir: string;
  readonly content: string;
  readonly sourceVersion: number;
}

export type EditorProjectionFailureCode = "EDITOR_FILE_TOO_LARGE" | "EDITOR_PLUGIN_LOAD_FAILED";

export type EditorProjectionOutcome =
  | ({ readonly ok: true } & EditorProjectionHostResult)
  | { readonly ok: false; readonly code: EditorProjectionFailureCode; readonly message: string };

/** The selector the book's CSS is scoped under inside the editor document. */
export const EDITOR_BOOK_SCOPE_SELECTOR = ".rich-editor-host .md-document";

// ── Stylesheet assets ───────────────────────────────────────────────────────

/** URL prefix the editor document fetches a registered stylesheet asset from. */
export const EDITOR_ASSET_ROUTE = "/api/editor/asset/";

const ASSET_NAME_RE = /^[A-Za-z0-9_-]+\.[a-z0-9]+$/;
const assetRegistry = new Map<string, string>();

/** Remember where each inlined-stylesheet asset copy came from, by its hashed name. */
export function registerEditorAssets(copies: ReadonlyArray<{ readonly from: string; readonly to: string }>): void {
  for (const copy of copies) {
    const name = path.posix.basename(copy.to);
    if (ASSET_NAME_RE.test(name)) assetRegistry.set(name, copy.from);
  }
}

/** The absolute source file a registered asset name resolves to, else undefined. */
export function editorAssetPath(name: string): string | undefined {
  if (!ASSET_NAME_RE.test(name)) return undefined;
  return assetRegistry.get(name);
}

/** Point `url("assets/NAME")` references in inlined CSS at the asset route. */
export function rewriteEditorAssetUrls(css: string): string {
  return css.replace(/url\("assets\/([A-Za-z0-9_-]+\.[a-z0-9]+)"\)/g, (whole, name: string) =>
    assetRegistry.has(name) ? `url("${EDITOR_ASSET_ROUTE}${name}")` : whole,
  );
}

// ── Book CSS (cached per project on the stylesheets' stamps) ────────────────

const bookCssCache = new Map<string, { stamp: string; pluginCss: string; css: string }>();

async function fileStamp(projectDir: string, file: string): Promise<string> {
  try {
    const st = await stat(path.resolve(projectDir, file));
    return `${file}@${st.mtimeMs}:${st.size}`;
  } catch {
    return `${file}@missing`;
  }
}

async function bookCssFor(
  projectDir: string,
  styles: readonly string[],
  pluginStyles: readonly PluginStyleGroup[],
): Promise<{ pluginCss: string; css: string }> {
  const stamps = await Promise.all([
    ...styles.map((rel) => fileStamp(projectDir, rel)),
    ...pluginStyles.flatMap((group) => group.paths.map((abs) => fileStamp(projectDir, abs))),
  ]);
  const stamp = JSON.stringify([stamps, pluginStyles.map((group) => [group.layer, group.css ?? ""])]);
  const cached = bookCssCache.get(projectDir);
  if (cached && cached.stamp === stamp) return { pluginCss: cached.pluginCss, css: cached.css };

  const groups: Array<{ name: string; layer: string; css: string }> = [];
  for (const group of pluginStyles) {
    const groupInlined = await inlineStyles(projectDir, group.paths);
    registerEditorAssets(groupInlined.copies);
    groups.push({
      name: group.name,
      layer: group.layer,
      css: [rewriteEditorAssetUrls(groupInlined.css), group.css]
        .filter((text): text is string => !!text && text.trim().length > 0)
        .join("\n\n"),
    });
  }
  const pluginCss = layerExtensionCss(groups);
  const inlined = await inlineStyles(projectDir, [...styles]);
  registerEditorAssets(inlined.copies);
  const css = composeEditorCss({
    scopeSelector: EDITOR_BOOK_SCOPE_SELECTOR,
    pluginCss,
    projectCss: rewriteEditorAssetUrls(inlined.css),
  });
  bookCssCache.set(projectDir, { stamp, pluginCss, css });
  return { pluginCss, css };
}

// ── The projection ──────────────────────────────────────────────────────────

export async function buildHostEditorProjection(args: EditorProjectionHostArgs): Promise<EditorProjectionHostResult> {
  const { manifest, manifestDir } = await loadManifestWithPath(args.projectDir);
  const config = resolveConfig({}, manifest);
  const pluginErrors: EditorProjectionPluginError[] = [];
  const { plugins, pluginStyles } = await loadPluginsWithCss(config.extensions, manifestDir, (pluginRef, error) => {
    pluginErrors.push({ pluginRef, message: error.message });
  });
  const md = createMarkdownRenderer(plugins);
  const projection = createEditorProjection(args.content, {
    sourceVersion: args.sourceVersion,
    md,
    trusted: true,
  });
  const { pluginCss, css: bookCss } = await bookCssFor(manifestDir, config.styles ?? [], pluginStyles);
  return { projection, pluginCss, pluginErrors, bookCss };
}

/**
 * The route's outcome shape: a content over the rich-mode ceiling and a
 * plugin-load failure are DATA the renderer acts on (fall back to the source
 * editor with a diagnostic), not transport errors.
 */
export async function resolveEditorProjection(args: EditorProjectionHostArgs): Promise<EditorProjectionOutcome> {
  if (Buffer.byteLength(args.content, "utf8") > RICH_MODE_MAX_CONTENT_BYTES) {
    return {
      ok: false,
      code: "EDITOR_FILE_TOO_LARGE",
      message: `content exceeds the ${RICH_MODE_MAX_CONTENT_BYTES}-byte rich-mode ceiling`,
    };
  }
  try {
    const result = await buildHostEditorProjection(args);
    return { ok: true, ...result };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, code: "EDITOR_PLUGIN_LOAD_FAILED", message };
  }
}

// ── Project files for the editor document ───────────────────────────────────

/** URL prefix the editor document fetches the open project's own files from. */
export const PROJECT_FILE_ROUTE = "/api/editor/project-file/";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  css: "text/css; charset=utf-8",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
};

export function mimeTypeFor(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}
