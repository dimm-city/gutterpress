/**
 * Snippet IPC handlers for the "project-config" capability (SFE-P5c2).
 * Ports `src/routes/api/snip/{list,read,save,delete}/+server.ts` verbatim.
 */
import { loadLib } from "./lib-loader";
import { requireProjectDir } from "./validation";

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string") throw new Error(message);
  return value;
}

/** List the open project's snippets. */
export async function snipList(rawProjectDir: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "snip:list");
  const lib = await loadLib();
  return lib.listSnippets(projectDir);
}

/** Read one snippet's raw body. */
export async function snipRead(rawProjectDir: unknown, rawFileName: unknown): Promise<string> {
  const projectDir = await requireProjectDir(rawProjectDir, "snip:read");
  const fileName = requireString(rawFileName, "snip:read requires { projectDir: string, fileName: string }");
  const lib = await loadLib();
  return lib.readSnippet(projectDir, fileName);
}

/** Save a snippet body under the project's snippets/ folder. */
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
