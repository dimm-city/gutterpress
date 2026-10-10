/**
 * POST /api/remote/set-up-backup (#358): body validation, the host wiring
 * (project guard, saved-connection store, git identity) and that the lib's
 * result — including its plain-language failures — reaches the renderer
 * untouched. The lib itself is faked; its behaviour is covered by the lib's
 * online-backup.test.ts.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { isHttpError } from "@sveltejs/kit";
import {
  registerHostServices,
  type HostServices,
} from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { setLibForTests, type LibModule } from "../../src/routes/api/_lib/route";
import { POST as setUpBackup } from "../../src/routes/api/remote/set-up-backup/+server";

function request(body?: unknown): Request {
  return new Request("http://local.test", {
    method: "POST",
    body: JSON.stringify(body ?? {}),
    headers: { "content-type": "application/json" },
  });
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

const tokenStore = { marker: "token-store" };

function openProject(): void {
  registerHostServices(
    makeHostServices({
      fsGuard: { projectRoots: () => ["/abs/project"], readOnlyRoots: () => [] as string[] },
      remote: { tokenStore, GITHUB_HOST: "github.com" } as never,
    }),
  );
}

afterEach(() => {
  registerHostServices(undefined as unknown as HostServices);
  setLibForTests(null);
});

describe("POST /api/remote/set-up-backup", () => {
  test("400 for a missing or malformed target", async () => {
    openProject();
    for (const target of [undefined, { kind: "create" }, { kind: "existing", owner: "o" }, { kind: "other", name: "x" }]) {
      const { status } = await caught(
        setUpBackup({ request: request({ projectDir: "/abs/project", target }) } as never),
      );
      expect(status).toBe(400);
    }
  });

  test("403 for a project outside the open book", async () => {
    openProject();
    const { status } = await caught(
      setUpBackup({ request: request({ projectDir: "/elsewhere", target: { kind: "create", name: "x" } }) } as never),
    );
    expect(status).toBe(403);
  });

  test("forwards a create target with the saved-connection store", async () => {
    const calls: Array<Record<string, unknown>> = [];
    openProject();
    setLibForTests({
      setUpOnlineBackup: async (opts: Record<string, unknown>) => {
        calls.push(opts);
        return { status: "connected", repository: { fullName: "me/my-book" } };
      },
    } as unknown as Partial<LibModule>);
    const res = await setUpBackup({
      request: request({ projectDir: "/abs/project", target: { kind: "create", name: "my-book", private: false, extra: 1 } }),
    } as never);
    expect(await res.json()).toEqual({ status: "connected", repository: { fullName: "me/my-book" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      projectDir: "/abs/project",
      target: { kind: "create", name: "my-book", private: false },
      tokenStore,
    });
    expect(calls[0]!.target).not.toHaveProperty("extra");
  });

  test("forwards an existing-repository target", async () => {
    const calls: Array<Record<string, unknown>> = [];
    openProject();
    setLibForTests({
      setUpOnlineBackup: async (opts: Record<string, unknown>) => {
        calls.push(opts);
        return { status: "connected", repository: { fullName: "me/empty" } };
      },
    } as unknown as Partial<LibModule>);
    await setUpBackup({
      request: request({ projectDir: "/abs/project", target: { kind: "existing", owner: "me", name: "empty" } }),
    } as never);
    expect(calls[0]!.target).toEqual({ kind: "existing", owner: "me", name: "empty" });
  });

  test("a failed set-up comes back as data with its plain message intact", async () => {
    openProject();
    const failure = {
      status: "failed",
      reason: "name-taken",
      message: 'You already have a repository named "my-book" on GitHub.',
    };
    setLibForTests({ setUpOnlineBackup: async () => failure } as unknown as Partial<LibModule>);
    const res = await setUpBackup({
      request: request({ projectDir: "/abs/project", target: { kind: "create", name: "my-book" } }),
    } as never);
    expect(await res.json()).toEqual(failure);
  });
});
