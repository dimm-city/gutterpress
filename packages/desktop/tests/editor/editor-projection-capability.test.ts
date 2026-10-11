import { afterEach, expect, test } from "bun:test";
import { buildEditorProjection } from "../../src/lib/editor-host/editor-projection-capability";

// The rich editor's one host call goes through the `api` wrapper like every
// other capability: a POST to `/api/editor/projection` carrying the args as
// JSON, whose JSON reply IS the outcome (ok:true with the projection, or
// ok:false with a classified code) — never a rejection for a classified
// failure.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("buildEditorProjection posts the args to /api/editor/projection and resolves the reply", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const reply = { ok: true, projection: { blocks: [] }, pluginCss: "", pluginErrors: [], bookCss: "" };
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const out = await buildEditorProjection({ projectDir: "/book", content: "# Hi", sourceVersion: 3 });

  expect(calls.length).toBe(1);
  expect(calls[0]!.url).toBe("/api/editor/projection");
  expect(calls[0]!.init?.method).toBe("POST");
  expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ projectDir: "/book", content: "# Hi", sourceVersion: 3 });
  expect(out).toEqual(reply);
});

test("a classified failure is a resolved ok:false outcome, not a rejection", async () => {
  const reply = { ok: false, code: "EDITOR_FILE_TOO_LARGE", message: "too big" };
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  await expect(buildEditorProjection({ projectDir: "/book", content: "x", sourceVersion: 0 })).resolves.toEqual(reply);
});

test("a transport failure rejects with the host's message", async () => {
  globalThis.fetch = (async () => new Response("editor/projection: path is outside the open book", { status: 403 })) as typeof fetch;
  await expect(buildEditorProjection({ projectDir: "/elsewhere", content: "x", sourceVersion: 0 })).rejects.toThrow(/outside the open book/);
});
