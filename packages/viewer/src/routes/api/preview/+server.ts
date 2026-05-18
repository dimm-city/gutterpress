import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  startPreviewServer,
  type PreviewServerHandle,
} from "@dimm-city/print-md";

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

  return json({ url: active.url, port: active.port, input: active.inputPath });
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
