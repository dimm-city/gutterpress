/**
 * Route-level coverage for the revision surface (#448): `vcs/list-revisions`,
 * `vcs/create-revision`, `vcs/rename-revision` and `vcs/delete-revision`.
 * The lib is faked (its behaviour is covered in the lib's own tests); this file
 * covers what the routes add:
 *  - body validation (400s) and that the lib gets exactly what the renderer sent;
 *  - the refresh-first behaviour of `list-revisions` and its `checkedOnline` flag;
 *  - create and rename pause the host timers around the lib call and always
 *    resume them; delete never touches them;
 *  - the lib's plain-language errors reach the renderer verbatim (422), while
 *    anything else becomes the generic message, and no sign-in ever appears in
 *    a response or a log line.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { isHttpError } from "@sveltejs/kit";
import {
  registerHostServices,
  type HostServices,
} from "../../electron/server-bridge/host-services";
import type { TokenStore } from "../../electron/server-bridge/remote-hooks";
import { makeHostServices } from "../support/host-services-fake";
import { setLibForTests, type LibModule } from "../../src/routes/api/_lib/route";
import { POST as listRevisions } from "../../src/routes/api/vcs/list-revisions/+server";
import { POST as createRevision } from "../../src/routes/api/vcs/create-revision/+server";
import { POST as renameRevision } from "../../src/routes/api/vcs/rename-revision/+server";
import { POST as deleteRevision } from "../../src/routes/api/vcs/delete-revision/+server";

const DIR = "/abs/project";
const tokenStore = { get: async () => null } as unknown as TokenStore;

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

function openProject(overrides: Parameters<typeof makeHostServices>[0] = {}): HostServices {
  const services = makeHostServices({
    fsGuard: { projectRoots: () => [DIR], readOnlyRoots: () => [] as string[] },
    remote: { tokenStore },
    ...overrides,
  });
  registerHostServices(services);
  return services;
}

function fakeLib(lib: Record<string, unknown>): void {
  setLibForTests(lib as Partial<LibModule>);
}

afterEach(() => {
  registerHostServices(undefined as unknown as HostServices);
  setLibForTests(null);
});

const revisions = {
  current: "main",
  revisions: [{ name: "main", current: true, where: "online", notBackedUp: false }],
};

describe("POST /api/vcs/list-revisions", () => {
  test("lists without refreshing unless asked, and says it did not check online", async () => {
    const calls: string[] = [];
    openProject();
    fakeLib({
      refreshRemoteCopies: async () => {
        calls.push("refresh");
        return { refreshed: true };
      },
      listRevisions: async (dir: string) => {
        calls.push(`list(${dir})`);
        return revisions;
      },
    });
    const res = await listRevisions({ request: request({ projectDir: DIR }) } as never);
    expect(await res.json()).toEqual({ ...revisions, checkedOnline: false });
    expect(calls).toEqual([`list(${DIR})`]);
  });

  test("refresh: true checks the online copy first, with the host's sign-ins, and reports it worked", async () => {
    const order: string[] = [];
    let refreshArgs: { projectDir: string; tokenStore: unknown } | undefined;
    openProject();
    fakeLib({
      refreshRemoteCopies: async (args: { projectDir: string; tokenStore: unknown }) => {
        order.push("refresh");
        refreshArgs = args;
        return { refreshed: true };
      },
      listRevisions: async () => {
        order.push("list");
        return revisions;
      },
    });
    const res = await listRevisions({ request: request({ projectDir: DIR, refresh: true }) } as never);
    expect(await res.json()).toEqual({ ...revisions, checkedOnline: true });
    expect(order).toEqual(["refresh", "list"]);
    expect(refreshArgs).toEqual({ projectDir: DIR, tokenStore });
  });

  test("a refresh that could not reach the online copy still lists, as last known", async () => {
    openProject();
    fakeLib({
      refreshRemoteCopies: async () => ({ refreshed: false, reason: "offline" }),
      listRevisions: async () => revisions,
    });
    const res = await listRevisions({ request: request({ projectDir: DIR, refresh: true }) } as never);
    expect(await res.json()).toEqual({ ...revisions, checkedOnline: false });
  });

  test("passes null straight through (a plain folder has no revisions)", async () => {
    openProject();
    fakeLib({ refreshRemoteCopies: async () => ({ refreshed: false }), listRevisions: async () => null });
    const res = await listRevisions({ request: request({ projectDir: DIR, refresh: true }) } as never);
    expect(await res.json()).toBeNull();
  });

  test("refused outside the open book", async () => {
    openProject();
    fakeLib({});
    const { status } = await caught(listRevisions({ request: request({ projectDir: "/elsewhere" }) } as never));
    expect(status).toBe(403);
  });
});

describe("POST /api/vcs/create-revision", () => {
  test("400 when the name is not text", async () => {
    openProject();
    fakeLib({});
    for (const name of [undefined, 3, null]) {
      const { status, message } = await caught(createRevision({ request: request({ projectDir: DIR, name }) } as never));
      expect(status).toBe(400);
      expect(message).toBe("vcs/create-revision requires a name");
    }
  });

  test("pauses the timers around the lib call, resumes after, and refreshes the online status", async () => {
    const order: string[] = [];
    openProject({
      vcs: {
        pauseTimers: (dir: string) => order.push(`pause(${dir})`),
        resumeTimers: (dir: string) => order.push(`resume(${dir})`),
        refreshOnlineStatus: (dir: string) => order.push(`status(${dir})`),
      },
    });
    fakeLib({
      createRevision: async (o: { projectDir: string; name: string }) => {
        order.push(`create(${o.name})`);
        return { current: "Second-edition" };
      },
    });
    const res = await createRevision({
      request: request({ projectDir: DIR, name: "Second edition" }),
    } as never);
    expect(await res.json()).toEqual({ current: "Second-edition" });
    expect(order).toEqual([`pause(${DIR})`, "create(Second edition)", `status(${DIR})`, `resume(${DIR})`]);
  });

  test("resumes the timers even when the lib refuses, and the plain-words reason reaches the author", async () => {
    const order: string[] = [];
    openProject({
      vcs: {
        pauseTimers: () => order.push("pause"),
        resumeTimers: () => order.push("resume"),
        refreshOnlineStatus: () => order.push("status"),
      },
    });
    fakeLib({
      createRevision: async () => {
        throw new Error(`There's already a revision called "Second-edition". Pick a different name.`);
      },
    });
    const { status, message } = await caught(
      createRevision({ request: request({ projectDir: DIR, name: "Second edition" }) } as never),
    );
    expect(status).toBe(422);
    expect(message).toBe(`There's already a revision called "Second-edition". Pick a different name.`);
    expect(order).toEqual(["pause", "resume"]);
  });

  test("works without the optional host hooks", async () => {
    openProject();
    fakeLib({ createRevision: async () => ({ current: "x" }) });
    const res = await createRevision({ request: request({ projectDir: DIR, name: "x" }) } as never);
    expect(await res.json()).toEqual({ current: "x" });
  });
});

describe("POST /api/vcs/rename-revision", () => {
  test("400 when either name is not text", async () => {
    openProject();
    fakeLib({});
    for (const body of [{ from: "a" }, { to: "b" }, { from: 1, to: "b" }]) {
      const { status } = await caught(renameRevision({ request: request({ projectDir: DIR, ...body }) } as never));
      expect(status).toBe(400);
    }
  });

  test("pauses the timers around the rename, hands the lib the host's sign-ins, and returns its result", async () => {
    const order: string[] = [];
    let args: Record<string, unknown> | undefined;
    openProject({
      vcs: {
        pauseTimers: (dir: string) => order.push(`pause(${dir})`),
        resumeTimers: (dir: string) => order.push(`resume(${dir})`),
      },
    });
    fakeLib({
      renameRevision: async (o: Record<string, unknown>) => {
        order.push("rename");
        args = o;
        return { current: "Third", name: "Third" };
      },
    });
    const res = await renameRevision({
      request: request({ projectDir: DIR, from: "Second-edition", to: "Third" }),
    } as never);
    expect(await res.json()).toEqual({ current: "Third", name: "Third" });
    expect(order).toEqual([`pause(${DIR})`, "rename", `resume(${DIR})`]);
    expect(args).toEqual({ projectDir: DIR, from: "Second-edition", to: "Third", tokenStore });
  });

  test("offline, the plain error reaches the author and the timers still resume", async () => {
    const order: string[] = [];
    openProject({
      vcs: { pauseTimers: () => order.push("pause"), resumeTimers: () => order.push("resume") },
    });
    const text = `Couldn't reach the online copy, so "Second-edition" wasn't renamed. Try again when you're back online.`;
    fakeLib({
      renameRevision: async () => {
        throw new Error(text);
      },
    });
    const { status, message } = await caught(
      renameRevision({ request: request({ projectDir: DIR, from: "Second-edition", to: "Third" }) } as never),
    );
    expect(status).toBe(422);
    expect(message).toBe(text);
    expect(order).toEqual(["pause", "resume"]);
  });
});

describe("POST /api/vcs/delete-revision", () => {
  test("400 without a name", async () => {
    openProject();
    fakeLib({});
    for (const name of [undefined, "", "  ", 7]) {
      const { status } = await caught(deleteRevision({ request: request({ projectDir: DIR, name }) } as never));
      expect(status).toBe(400);
    }
  });

  test("defaults to this computer only and asks before discarding; only a literal true opts in", async () => {
    const calls: Record<string, unknown>[] = [];
    openProject();
    fakeLib({
      deleteRevision: async (o: Record<string, unknown>) => {
        calls.push(o);
        return { deleted: false, versionsOnlyHere: 3 };
      },
    });
    const first = await deleteRevision({ request: request({ projectDir: DIR, name: "Experiment" }) } as never);
    expect(await first.json()).toEqual({ deleted: false, versionsOnlyHere: 3 });
    await deleteRevision({
      request: request({ projectDir: DIR, name: "Experiment", everywhere: "yes", discard: 1 }),
    } as never);
    await deleteRevision({
      request: request({ projectDir: DIR, name: "Experiment", everywhere: true, discard: true }),
    } as never);
    expect(calls).toEqual([
      { projectDir: DIR, name: "Experiment", everywhere: false, discard: false, tokenStore },
      { projectDir: DIR, name: "Experiment", everywhere: false, discard: false, tokenStore },
      { projectDir: DIR, name: "Experiment", everywhere: true, discard: true, tokenStore },
    ]);
  });

  test("returns deleted: true, and leaves the host timers alone (the open book is untouched)", async () => {
    const order: string[] = [];
    openProject({
      vcs: { pauseTimers: () => order.push("pause"), resumeTimers: () => order.push("resume") },
    });
    fakeLib({ deleteRevision: async () => ({ deleted: true }) });
    const res = await deleteRevision({ request: request({ projectDir: DIR, name: "Scratch" }) } as never);
    expect(await res.json()).toEqual({ deleted: true });
    expect(order).toEqual([]);
  });

  test("refusing the open revision is a plain 422", async () => {
    openProject();
    fakeLib({
      deleteRevision: async () => {
        throw new Error(`You're working on "main" right now. Switch to another revision first, then delete it.`);
      },
    });
    const { status, message } = await caught(
      deleteRevision({ request: request({ projectDir: DIR, name: "main" }) } as never),
    );
    expect(status).toBe(422);
    expect(message).toMatch(/switch to another revision first/i);
  });
});

describe("what the author and the logs can see", () => {
  test("an unexpected failure becomes the generic message, and no sign-in is in the response or the log", async () => {
    const logged: string[] = [];
    const base = makeHostServices();
    openProject({ app: { ...base.app, logFailure: (line: string) => logged.push(line) } });
    fakeLib({
      renameRevision: async () => {
        throw new Error("push failed for https://writer:ghp_secret@github.com/o/book.git");
      },
    });
    const { status, message } = await caught(
      renameRevision({ request: request({ projectDir: DIR, from: "a", to: "b" }) } as never),
    );
    expect(status).toBe(500);
    expect(message).toBe("Couldn't finish that. Your work is safe — see the app log for details.");
    expect(String(message)).not.toContain("ghp_secret");
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join("\n")).not.toContain("ghp_secret");
    expect(logged.join("\n")).toContain("//(redacted)@github.com");
  });
});
