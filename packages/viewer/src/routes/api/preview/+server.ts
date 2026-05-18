import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  startPreviewServer,
  loadManifestWithPath,
  type PreviewServerHandle,
} from "@dimm-city/print-md";
import { basename } from "node:path";

// One active preview per app session for v1. Stored on the module so it
// survives across requests in the same Node/Bun process.
let active: PreviewServerHandle | null = null;

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { input?: string };
  if (!body.input) {
    error(400, "Missing 'input' field (absolute path to a project directory)");
  }

  // Replace any existing preview before starting a new one.
  if (active) {
    await active.stop().catch(() => {});
    active = null;
  }

  try {
    active = await startPreviewServer({
      input: body.input,
      port: 0,
      host: "127.0.0.1",
      noWatch: false,
      openBrowser: false,
      verbose: false,
      debug: false,
      installSignalHandlers: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[preview] startPreviewServer error:", e);
    error(500, `Preview server failed to start: ${msg}`);
  }

  // Read the document title from the manifest (fall back to dir basename).
  let title: string = basename(body.input);
  try {
    const { manifest } = await loadManifestWithPath(body.input);
    if (manifest.title) title = manifest.title;
  } catch {
    // Not a manifest project; keep the dir name.
  }

  return json({ url: active!.url, port: active!.port, input: active!.inputPath, title });
};

export const DELETE: RequestHandler = async () => {
  if (active) {
    await active.stop();
    active = null;
  }
  return json({ ok: true });
};

export const GET: RequestHandler = async () => {
  if (!active) return json({ active: false });
  return json({
    active: true,
    url: active.url,
    port: active.port,
    input: active.inputPath,
  });
};
