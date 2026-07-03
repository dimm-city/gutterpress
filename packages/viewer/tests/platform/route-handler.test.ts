import { expect, test } from "bun:test";
import { isHttpError } from "@sveltejs/kit";
import { error } from "@sveltejs/kit";
import { jsonRoute, requireAbsolute } from "../../src/routes/api/_lib/handler";

function event(body: unknown): Parameters<ReturnType<typeof jsonRoute>>[0] {
  return {
    request: new Request("http://local.test", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  } as Parameters<ReturnType<typeof jsonRoute>>[0];
}

async function caught(p: Promise<unknown>): Promise<{ status: number; message: unknown }> {
  try {
    await p;
    throw new Error("expected the promise to reject, but it resolved");
  } catch (e) {
    if (!isHttpError(e)) throw e;
    return { status: e.status, message: (e.body as { message?: unknown }).message };
  }
}

test("jsonRoute serializes the handler result as JSON", async () => {
  const handler = jsonRoute(async (body: { name?: string }) => ({ hello: body.name }));
  const res = await handler(event({ name: "world" }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ hello: "world" });
});

test("jsonRoute passes a safely-parsed empty body when JSON is missing/invalid", async () => {
  const handler = jsonRoute(async (body: Record<string, unknown>) => ({ keys: Object.keys(body) }));
  const res = await handler({
    request: new Request("http://local.test", { method: "POST" }),
  } as Parameters<typeof handler>[0]);
  expect(await res.json()).toEqual({ keys: [] });
});

test("jsonRoute maps a thrown plain Error to a 500 with its message", async () => {
  const handler = jsonRoute(async () => {
    throw new Error("boom");
  });
  const { status, message } = await caught(handler(event({})));
  expect(status).toBe(500);
  expect(message).toBe("boom");
});

test("jsonRoute maps a thrown non-Error value to a 500 with String(value)", async () => {
  const handler = jsonRoute(async () => {
    throw "kaboom";
  });
  const { status, message } = await caught(handler(event({})));
  expect(status).toBe(500);
  expect(message).toBe("kaboom");
});

test("jsonRoute lets a thrown HttpError propagate with its own status", async () => {
  const handler = jsonRoute(async () => {
    error(400, "need a thing");
  });
  const { status, message } = await caught(handler(event({})));
  expect(status).toBe(400);
  expect(message).toBe("need a thing");
});

test("requireAbsolute returns the path when absolute", () => {
  expect(requireAbsolute("/abs/book", "fs:test")).toBe("/abs/book");
});

test("requireAbsolute throws a 400 for a relative path", async () => {
  const { status, message } = await caught(
    Promise.resolve().then(() => requireAbsolute("rel/book", "fs:test")),
  );
  expect(status).toBe(400);
  expect(message).toBe("fs:test requires an absolute path, got: rel/book");
});

test("requireAbsolute throws a 400 for a non-string value", async () => {
  const { status, message } = await caught(
    Promise.resolve().then(() => requireAbsolute(undefined, "fs:test")),
  );
  expect(status).toBe(400);
  expect(message).toBe("fs:test requires an absolute path, got: ");
});
