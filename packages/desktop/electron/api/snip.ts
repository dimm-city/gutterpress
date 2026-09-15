/**
 * Snippet IPC handlers for the "project-config" capability (SFE-P5c2).
 * Ports `src/routes/api/snip/{list,read,read-extension,save,delete}/
 * +server.ts` verbatim.
 */
import { loadLib } from "./lib-loader";
import { requireProjectDir } from "./validation";
import type { SecureHandle } from "../server-bridge/secure-handle";

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string") throw new Error(message);
  return value;
}

/**
 * List the open project's snippets, MERGED with every installed, active
 * extension's own `snippets` folder (#242) - each entry's `source` says
 * which. See `snippets.ts`'s `listMergedSnippets` for precedence and
 * provenance.
 */
export async function snipList(rawProjectDir: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "snip:list");
  const lib = await loadLib();
  return lib.listMergedSnippets(projectDir);
}

/** Read one snippet's raw body. */
export async function snipRead(rawProjectDir: unknown, rawFileName: unknown): Promise<string> {
  const projectDir = await requireProjectDir(rawProjectDir, "snip:read");
  const fileName = requireString(rawFileName, "snip:read requires { projectDir: string, fileName: string }");
  const lib = await loadLib();
  return lib.readSnippet(projectDir, fileName);
}

/**
 * Read one EXTENSION-provided snippet's raw body (#242) - the read-only
 * counterpart to `snip:read` for a `source.kind === "extension"` entry.
 * `ref` is the extension's manifest specifier the list already handed back;
 * the host (`readExtensionSnippet`) re-derives the extension's own folder
 * from it rather than trusting any filesystem path from the renderer.
 */
export async function snipReadExtension(
  rawProjectDir: unknown,
  rawSource: unknown,
  rawFileName: unknown,
): Promise<string> {
  const projectDir = await requireProjectDir(rawProjectDir, "snip:readExtension");
  const source = rawSource as { kind?: unknown; ref?: unknown } | undefined;
  if (!source || source.kind !== "extension" || typeof source.ref !== "string") {
    throw new Error('snip:readExtension requires a source { kind: "extension", ref: string }');
  }
  const fileName = requireString(rawFileName, "snip:readExtension requires a fileName string");
  const lib = await loadLib();
  return lib.readExtensionSnippet(projectDir, { kind: "extension", ref: source.ref }, fileName);
}

/** Save a snippet body under the project's snippets/ folder. Always the PROJECT's - an extension's folder is unreachable here (#242). */
export async function snipSave(rawProjectDir: unknown, rawName: unknown, rawBody: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "snip:save");
  const name = requireString(rawName, "snip:save requires { projectDir: string, name: string, body: string }");
  const body = requireString(rawBody, "snip:save requires { projectDir: string, name: string, body: string }");
  const lib = await loadLib();
  return lib.saveSnippet(projectDir, name, body);
}

/** Delete a snippet by filename. */
export async function snipDelete(rawProjectDir: unknown, rawFileName: unknown): Promise<{ ok: true }> {
  const projectDir = await requireProjectDir(rawProjectDir, "snip:delete");
  const fileName = requireString(rawFileName, "snip:delete requires { projectDir: string, fileName: string }");
  const lib = await loadLib();
  await lib.deleteSnippet(projectDir, fileName);
  return { ok: true };
}

/** Register the snip:* IPC channels (SFE-P6b). */
export function registerSnipHandlers(secureHandle: SecureHandle): void {
  secureHandle("snip:list", (_e, projectDir: unknown) => snipList(projectDir));
  secureHandle("snip:read", (_e, projectDir: unknown, fileName: unknown) => snipRead(projectDir, fileName));
  secureHandle("snip:readExtension", (_e, projectDir: unknown, source: unknown, fileName: unknown) =>
    snipReadExtension(projectDir, source, fileName),
  );
  secureHandle("snip:save", (_e, projectDir: unknown, name: unknown, body: unknown) =>
    snipSave(projectDir, name, body),
  );
  secureHandle("snip:delete", (_e, projectDir: unknown, fileName: unknown) =>
    snipDelete(projectDir, fileName),
  );
}
