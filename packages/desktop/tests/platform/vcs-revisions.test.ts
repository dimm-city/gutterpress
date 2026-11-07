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
import { POST as restoreRepairCopy } from "../../src/routes/api/vcs/restore-repair-copy/+server";
import { POST as discardRepairCopy } from "../../src/routes/api/vcs/discard-repair-copy/+server";
import { POST as keepUnfinishedSwitch } from "../../src/routes/api/vcs/keep-unfinished-switch/+server";
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
  setLibForTests({
    repairInterruptedSwitch: async () => null,
    takeSwitchRepairNotice: async () => null,
    unfinishedSwitchState: async () => null,
    lastOnlineCheck: async () => null,
    ...lib,
  } as Partial<LibModule>);
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
    expect(await res.json()).toEqual({ ...revisions, checkedAt: null, checkedOnline: false });
    expect(calls).toEqual([`list(${DIR})`]);
  });

  test("repairs an interrupted switch first and passes its message on once", async () => {
    const order: string[] = [];
    openProject();
    fakeLib({
      repairInterruptedSwitch: async () => {
        order.push("repair");
        return "put back";
      },
      takeSwitchRepairNotice: async () => "put back",
      listRevisions: async () => {
        order.push("list");
        return revisions;
      },
    });
    const res = await listRevisions({ request: request({ projectDir: DIR }) } as never);
    expect(await res.json()).toEqual({ ...revisions, checkedAt: null, checkedOnline: false, repairNotice: "put back" });
    expect(order).toEqual(["repair", "list"]);
  });

  test("refresh: true checks the online copy first, with the host's sign-ins, and reports it worked", async () => {
    const order: string[] = [];
    let refreshArgs: { projectDir: string; tokenStore: unknown; maxAgeMs: number } | undefined;
    openProject();
    fakeLib({
      refreshRemoteCopies: async (args: { projectDir: string; tokenStore: unknown; maxAgeMs: number }) => {
        order.push("refresh");
        refreshArgs = args;
        return { refreshed: true, checkedAt: "2026-11-07T10:00:00.000Z" };
      },
      listRevisions: async () => {
        order.push("list");
        return revisions;
      },
    });
    const res = await listRevisions({ request: request({ projectDir: DIR, refresh: true }) } as never);
    expect(await res.json()).toEqual({ ...revisions, checkedAt: "2026-11-07T10:00:00.000Z", checkedOnline: true });
    expect(order).toEqual(["refresh", "list"]);
    // A check this recent is reused (the versions list shares it).
    expect(refreshArgs).toEqual({ projectDir: DIR, tokenStore, maxAgeMs: 20_000 });
  });

  test("maxAgeMs is the caller's to choose: 0 forces a real check", async () => {
    let seen: number | undefined;
    openProject();
    fakeLib({
      refreshRemoteCopies: async (args: { maxAgeMs: number }) => {
        seen = args.maxAgeMs;
        return { refreshed: true, checkedAt: null };
      },
      listRevisions: async () => revisions,
    });
    await listRevisions({ request: request({ projectDir: DIR, refresh: true, maxAgeMs: 0 }) } as never);
    expect(seen).toBe(0);
  });

  test("without refresh, checkedAt is when the online copy was last asked", async () => {
    openProject();
    fakeLib({ lastOnlineCheck: async () => "2026-11-07T09:59:00.000Z", listRevisions: async () => revisions });
    const res = await listRevisions({ request: request({ projectDir: DIR }) } as never);
    expect(await res.json()).toMatchObject({ checkedAt: "2026-11-07T09:59:00.000Z", checkedOnline: false });
  });

  test("a refresh that could not reach the online copy still lists, as last known", async () => {
    openProject();
    fakeLib({
      refreshRemoteCopies: async () => ({ refreshed: false, reason: "offline", checkedAt: null }),
      listRevisions: async () => revisions,
    });
    const res = await listRevisions({ request: request({ projectDir: DIR, refresh: true }) } as never);
    expect(await res.json()).toEqual({ ...revisions, checkedAt: null, checkedOnline: false, reason: "offline" });
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

describe("repair copies (#508)", () => {
  test("list-revisions passes the lib's repair copies through", async () => {
    openProject();
    const copies = [{ id: "20261107000000001", savedAt: 1, saved: true }];
    fakeLib({ listRevisions: async () => ({ ...revisions, repairCopies: copies }) });
    const res = await listRevisions({ request: request({ projectDir: DIR }) } as never);
    expect((await res.json()).repairCopies).toEqual(copies);
  });

  test("restore and discard refuse anything but a copy id (400), and hand the lib exactly the id", async () => {
    const calls: string[] = [];
    openProject();
    fakeLib({
      restoreRepairCopy: async (o: { id: string }) => (calls.push(`restore ${o.id}`), { restoredId: "x" }),
      discardRepairCopy: async (_dir: string, id: string, o: { unsaved: boolean }) => void calls.push(`discard ${id} unsaved=${o.unsaved}`),
    });
    for (const id of [undefined, "", "../heads/main", "abc", 5]) {
      expect((await caught(restoreRepairCopy({ request: request({ projectDir: DIR, id }) } as never))).status).toBe(400);
      expect((await caught(discardRepairCopy({ request: request({ projectDir: DIR, id, confirm: true }) } as never))).status).toBe(400);
    }
    await restoreRepairCopy({ request: request({ projectDir: DIR, id: "20261107000000001" }) } as never);
    // Discard says so explicitly: no confirm, no delete.
    expect((await caught(discardRepairCopy({ request: request({ projectDir: DIR, id: "20261107000000001" }) } as never))).status).toBe(400);
    const res = await discardRepairCopy({ request: request({ projectDir: DIR, id: "20261107000000001", confirm: true }) } as never);
    expect(await res.json()).toEqual({ discarded: true });
    await discardRepairCopy({ request: request({ projectDir: DIR, id: "20261107000000001", confirm: true, discardUnsaved: true }) } as never);
    expect(calls).toEqual(["restore 20261107000000001", "discard 20261107000000001 unsaved=false", "discard 20261107000000001 unsaved=true"]);
  });
});

describe("an unresolved switch (#507)", () => {
  test("list-revisions survives a repair that keeps failing and reports the unfinished switch", async () => {
    openProject();
    const unfinishedSwitch = { message: "part-way", copy: "20261107000000001" };
    fakeLib({
      repairInterruptedSwitch: async () => {
        throw new Error("cannot check out");
      },
      unfinishedSwitchState: async () => unfinishedSwitch,
      listRevisions: async () => ({ ...revisions, repairCopies: [] }),
    });
    const body = await (await listRevisions({ request: request({ projectDir: DIR }) } as never)).json();
    expect(body.unfinishedSwitch).toEqual(unfinishedSwitch);
    expect(body.revisions.length).toBe(1);
  });

  test("with a refresh, a failing repair still returns the list with unfinishedSwitch and the online-check fields", async () => {
    openProject();
    const unfinishedSwitch = { message: "part-way", copy: "20261107000000001" };
    fakeLib({
      repairInterruptedSwitch: async () => {
        throw new Error("cannot check out");
      },
      takeSwitchRepairNotice: async () => {
        throw new Error("no notice");
      },
      unfinishedSwitchState: async () => unfinishedSwitch,
      refreshRemoteCopies: async () => ({ refreshed: true, checkedAt: "2026-11-07T10:00:00.000Z" }),
      listRevisions: async () => ({ ...revisions, repairCopies: [] }),
    });
    const body = await (await listRevisions({ request: request({ projectDir: DIR, refresh: true }) } as never)).json();
    expect(body).toMatchObject({ unfinishedSwitch, checkedOnline: true, checkedAt: "2026-11-07T10:00:00.000Z" });
    expect(body.repairCopies).toEqual([]);
  });

  test("keep-unfinished-switch hands the lib the folder", async () => {
    const calls: string[] = [];
    openProject();
    fakeLib({ keepUnfinishedSwitchAsIs: async (dir: string) => void calls.push(dir) });
    const res = await keepUnfinishedSwitch({ request: request({ projectDir: DIR }) } as never);
    expect(await res.json()).toEqual({ kept: true });
    expect(calls).toEqual([DIR]);
  });
});
