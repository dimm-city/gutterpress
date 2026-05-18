import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async () => {
  return json({
    name: "@dimm-city/print-md-viewer",
    runtime:
      typeof (globalThis as any).Bun !== "undefined" ? "bun" : "node",
    ok: true,
  });
};
