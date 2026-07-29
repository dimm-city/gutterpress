import { expect, test } from "bun:test";
import { isHttpError } from "@sveltejs/kit";
import { defineRoute, loadLib, loadApiLib, requireAbsolute } from "../../src/routes/api/_lib/route";

// defineRoute (#35/#36/#38): the declarative route factory that owns body
// parsing, absolute-path validation, error mapping, and the
// hooks-not-registered 503 in one place, so the ~91 +server.ts route files
// don't each hand-roll the same 4-6 line skeleton.

function event(body: unknown): Parameters<ReturnType<typeof defineRoute>>[0] {
  return {
    request: new Request("http://local.test", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  } as Parameters<ReturnType<typeof defineRoute>>[0];
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

test("defineRoute with no hooks/validate calls `call` with the parsed body and wraps the result as JSON", async () => {
  const handler = defineRoute<{ name?: string }>({
    call: async ({ body }) => ({ hello: body.name }),
  });
  const res = await handler(event({ name: "world" }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ hello: "world" });
});

test("defineRoute's validate runs before call and can reject with a 400", async () => {
  let callRan = false;
  const handler = defineRoute<{ projectDir: string }>({
    validate: (body) => {
      const b = body as { projectDir?: unknown };
      return { projectDir: requireAbsolute(b.projectDir, "test:route") };
    },
    call: async ({ body }) => {
      callRan = true;
      return { projectDir: body.projectDir };
    },
  });
  const { status, message } = await caught(handler(event({ projectDir: "rel/path" })));
  expect(status).toBe(400);
  expect(message).toBe("test:route requires an absolute path, got: rel/path");
  expect(callRan).toBe(false);
});

test("defineRoute's validate passing through lets call run and returns its result", async () => {
  const handler = defineRoute<{ projectDir: string }>({
    validate: (body) => {
      const b = body as { projectDir?: unknown };
      return { projectDir: requireAbsolute(b.projectDir, "test:route") };
    },
    call: async ({ body }) => ({ ok: true, projectDir: body.projectDir }),
  });
  const res = await handler(event({ projectDir: "/abs/path" }));
  expect(await res.json()).toEqual({ ok: true, projectDir: "/abs/path" });
});

test("defineRoute returns a 503 with the given message when hooks() is not registered", async () => {
  const handler = defineRoute<Record<string, never>, { ping(): string }>({
    hooks: () => null,
    hooksUnavailableMessage: "Widget hooks not registered",
    call: async ({ hooks }) => hooks.ping(),
  });
  const { status, message } = await caught(handler(event({})));
  expect(status).toBe(503);
  expect(message).toBe("Widget hooks not registered");
});

test("defineRoute falls back to a generic 503 message when none is given", async () => {
  const handler = defineRoute({
    hooks: () => null,
    call: async () => "unreachable",
  });
  const { status, message } = await caught(handler(event({})));
  expect(status).toBe(503);
  expect(message).toBe("Hooks not registered");
});

test("defineRoute passes the live hooks object through to call when registered", async () => {
  const hooksObj = { ping: () => "pong" };
  const handler = defineRoute<Record<string, never>, typeof hooksObj>({
    hooks: () => hooksObj,
    call: async ({ hooks }) => ({ result: hooks.ping() }),
  });
  const res = await handler(event({}));
  expect(await res.json()).toEqual({ result: "pong" });
});

test("defineRoute maps a thrown plain Error to a 500 with its message (no onError given)", async () => {
  const handler = defineRoute({
    call: async () => {
      throw new Error("boom");
    },
  });
  const { status, message } = await caught(handler(event({})));
  expect(status).toBe(500);
  expect(message).toBe("boom");
});

test("defineRoute's onError classifier can reclassify a caught error to a specific status", async () => {
  const handler = defineRoute({
    call: async () => {
      throw new Error("no changes since the last snapshot");
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (/no changes since the last snapshot/.test(msg)) return { status: 422, message: msg };
      return null;
    },
  });
  const { status, message } = await caught(handler(event({})));
  expect(status).toBe(422);
  expect(message).toBe("no changes since the last snapshot");
});

test("defineRoute's onError returning null falls through to the generic 500", async () => {
  const handler = defineRoute({
    call: async () => {
      throw new Error("totally unexpected");
    },
    onError: () => null,
  });
  const { status, message } = await caught(handler(event({})));
  expect(status).toBe(500);
  expect(message).toBe("totally unexpected");
});

test("defineRoute lets a thrown HttpError from inside call propagate unchanged, bypassing onError", async () => {
  const { error } = await import("@sveltejs/kit");
  let onErrorCalled = false;
  const handler = defineRoute({
    call: async () => {
      error(409, "conflict");
    },
    onError: () => {
      onErrorCalled = true;
      return { status: 500, message: "should not be used" };
    },
  });
  const { status, message } = await caught(handler(event({})));
  expect(status).toBe(409);
  expect(message).toBe("conflict");
  expect(onErrorCalled).toBe(false);
});

test("defineRoute serializes a GET-style route (no request body) the same way", async () => {
  const handler = defineRoute({
    call: async () => ({ ok: true }),
  });
  const res = await handler({
    request: new Request("http://local.test", { method: "GET" }),
  } as Parameters<typeof handler>[0]);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

// ── loadLib / loadApiLib (#35: one canonical accessor for the lib) ──────────

test("loadLib resolves the real lib module and caches the same promise across calls", async () => {
  const p1 = loadLib();
  const p2 = loadLib();
  expect(p1).toBe(p2); // same cached promise instance — not re-imported per call
  const lib = await p1;
  expect(typeof lib.applyTheme).toBe("function");
  expect(typeof lib.listBuiltInThemes).toBe("function");
});

  test("loadApiLib resolves the narrower 'gutterpress/api' surface and caches it", async () => {
  const p1 = loadApiLib();
  const p2 = loadApiLib();
  expect(p1).toBe(p2);
  const lib = await p1;
  expect(typeof lib.readManifestFields).toBe("function");
  expect(typeof lib.setActiveStyles).toBe("function");
});
