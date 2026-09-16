/**
 * Route-level coverage for #273's copy-switching surface (`vcs/list-branches`
 * and `vcs/switch-branch`), which route-scoping.test.ts only covers for the
 * project-path guard. This file covers:
 *  - happy-path forwarding to the lib, including `list-branches`' `null`
 *    passthrough (nothing to switch between);
 *  - `switch-branch`'s 400 on a missing/blank branch name;
 *  - `switch-branch` pauses the host's auto-snapshot/auto-sync timers around
 *    the checkout and always resumes them, success or failure (VcsHooks
 *    `pauseTimers`/`resumeTimers`);
 *  - `switch-branch` clears the crash-recovery draft for every path the lib
 *    reports as changed — the mechanism recovery.ts's header (#273) documents
 *    for "a draft from the old copy must never be offered over the new
 *    copy's version of the same file", and does so best-effort (a recovery
 *    failure never turns a successful switch into a reported error).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { isHttpError } from "@sveltejs/kit";
import {
  registerHostServices,
  type HostServices,
} from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { POST as vcsListBranches } from "../../src/routes/api/vcs/list-branches/+server";
import { POST as vcsSwitchBranch } from "../../src/routes/api/vcs/switch-branch/+server";

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
    fsGuard: { projectRoots: () => ["/abs/project"], readOnlyRoots: () => [] as string[] },
    ...overrides,
  });
  registerHostServices(services);
  return services;
}

afterEach(() => {
  registerHostServices(undefined as unknown as HostServices);
});

describe("POST /api/vcs/list-branches", () => {
  test("503 when vcs hooks are not registered", async () => {
    openProject({ vcs: undefined });
    const { status, message } = await caught(
      vcsListBranches({ request: request({ projectDir: "/abs/project" }) } as never),
    );
    expect(status).toBe(503);
    expect(message).toBe("VCS hooks not registered");
  });

  test("forwards to lib.listLocalBranches and returns its result", async () => {
    const calls: string[] = [];
    openProject({
      vcs: {
        loadLib: async () => ({
          listLocalBranches: async (dir: string) => {
            calls.push(dir);
            return { current: "main", branches: ["main", "second-copy"] };
          },
        }),
      } as never,
    });
    const res = await vcsListBranches({ request: request({ projectDir: "/abs/project" }) } as never);
    expect(await res.json()).toEqual({ current: "main", branches: ["main", "second-copy"] });
    expect(calls).toEqual(["/abs/project"]);
  });

  test("passes a null result straight through (nothing to switch between)", async () => {
    openProject({
      vcs: { loadLib: async () => ({ listLocalBranches: async () => null }) } as never,
    });
    const res = await vcsListBranches({ request: request({ projectDir: "/abs/project" }) } as never);
    expect(await res.json()).toBeNull();
  });
});

describe("POST /api/vcs/switch-branch", () => {
  test("503 when vcs hooks are not registered", async () => {
    openProject({ vcs: undefined });
    const { status, message } = await caught(
      vcsSwitchBranch({ request: request({ projectDir: "/abs/project", branch: "main" }) } as never),
    );
    expect(status).toBe(503);
    expect(message).toBe("VCS hooks not registered");
  });

  test("400 when branch is missing or blank", async () => {
    openProject({ vcs: { loadLib: async () => ({}) } as never });
    for (const branch of [undefined, "", "   "]) {
      const { status, message } = await caught(
        vcsSwitchBranch({ request: request({ projectDir: "/abs/project", branch }) } as never),
      );
      expect(status).toBe(400);
      expect(message).toBe("vcs/switch-branch requires a branch name");
    }
  });

  test("pauses timers before the checkout, resumes after, and clears recovery for every changed path", async () => {
    const order: string[] = [];
    const recoveryCleared: string[] = [];
    openProject({
      vcs: {
        loadLib: async () => ({
          switchBranch: async (opts: { projectDir: string; branch: string }) => {
            order.push(`switchBranch(${opts.branch})`);
            return {
              current: opts.branch,
              changedFiles: ["/abs/project/chapter-01.md", "/abs/project/chapter-02.md"],
            };
          },
        }),
        pauseTimers: (dir: string) => order.push(`pause(${dir})`),
        resumeTimers: (dir: string) => order.push(`resume(${dir})`),
      } as never,
      recovery: {
        clear: async (filePath: string) => {
          recoveryCleared.push(filePath);
          return { ok: true };
        },
      },
    });

    const res = await vcsSwitchBranch({
      request: request({ projectDir: "/abs/project", branch: "second-copy" }),
    } as never);
    expect(await res.json()).toEqual({
      current: "second-copy",
      changedFiles: ["/abs/project/chapter-01.md", "/abs/project/chapter-02.md"],
    });
    expect(order).toEqual([
      "pause(/abs/project)",
      "switchBranch(second-copy)",
      "resume(/abs/project)",
    ]);
    expect(recoveryCleared.sort()).toEqual(
      ["/abs/project/chapter-01.md", "/abs/project/chapter-02.md"].sort(),
    );
  });

  test("resumes timers even when the lib call fails, and never clears recovery", async () => {
    const order: string[] = [];
    let recoveryCalled = false;
    openProject({
      vcs: {
        loadLib: async () => ({
          switchBranch: async () => {
            order.push("switchBranch:throw");
            throw new Error("no version history yet. Enable version history first.");
          },
        }),
        pauseTimers: (dir: string) => order.push(`pause(${dir})`),
        resumeTimers: (dir: string) => order.push(`resume(${dir})`),
      } as never,
      recovery: { clear: async () => { recoveryCalled = true; return { ok: true }; } },
    });

    const { status } = await caught(
      vcsSwitchBranch({ request: request({ projectDir: "/abs/project", branch: "second-copy" }) } as never),
    );
    expect(status).toBe(422); // the lib's own friendly message passes through
    expect(order).toEqual(["pause(/abs/project)", "switchBranch:throw", "resume(/abs/project)"]);
    expect(recoveryCalled).toBe(false);
  });

  test("a recovery-clear failure never turns a successful switch into a reported error", async () => {
    openProject({
      vcs: {
        loadLib: async () => ({
          switchBranch: async () => ({
            current: "second-copy",
            changedFiles: ["/abs/project/chapter-01.md"],
          }),
        }),
      } as never,
      recovery: {
        clear: async () => {
          throw new Error("disk full");
        },
      },
    });
    const res = await vcsSwitchBranch({
      request: request({ projectDir: "/abs/project", branch: "second-copy" }),
    } as never);
    expect(await res.json()).toEqual({
      current: "second-copy",
      changedFiles: ["/abs/project/chapter-01.md"],
    });
  });

  test("works without pauseTimers/resumeTimers (optional hooks)", async () => {
    openProject({
      vcs: {
        loadLib: async () => ({
          switchBranch: async () => ({ current: "second-copy", changedFiles: [] }),
        }),
      } as never,
    });
    const res = await vcsSwitchBranch({
      request: request({ projectDir: "/abs/project", branch: "second-copy" }),
    } as never);
    expect(await res.json()).toEqual({ current: "second-copy", changedFiles: [] });
  });
});
