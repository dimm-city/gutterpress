/**
 * Route-level coverage for `vcs/switch-branch` (switching revisions), which
 * route-scoping.test.ts only covers for the project-path guard:
 *  - the 400 on a missing/blank revision name;
 *  - it pauses the host's auto-snapshot/auto-sync timers around the checkout
 *    and always resumes them, success or failure (VcsHooks
 *    `pauseTimers`/`resumeTimers`);
 *  - it clears the crash-recovery draft for every path the lib reports as
 *    changed (recovery.ts's header: a draft from the revision just left must
 *    never be offered over the new revision's version of the same file), and
 *    does so best-effort (a recovery failure never turns a successful switch
 *    into a reported error).
 * The other revision routes are covered by vcs-revisions.test.ts.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { isHttpError } from "@sveltejs/kit";
import {
  registerHostServices,
  type HostServices,
} from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { setLibForTests, type LibModule } from "../../src/routes/api/_lib/route";
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

/** The lib fake every test hands the routes through `loadLib()`. */
function fakeLib(lib: Record<string, unknown>): void {
  setLibForTests(lib as Partial<LibModule>);
}

afterEach(() => {
  registerHostServices(undefined as unknown as HostServices);
  setLibForTests(null);
});

describe("POST /api/vcs/switch-branch", () => {
  test("400 when branch is missing or blank", async () => {
    openProject();
    fakeLib({});
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
        pauseTimers: (dir: string) => order.push(`pause(${dir})`),
        resumeTimers: (dir: string) => order.push(`resume(${dir})`),
      },
      recovery: {
        clear: async (filePath: string) => {
          recoveryCleared.push(filePath);
          return { ok: true };
        },
      },
    });
    fakeLib({
      switchBranch: async (opts: { projectDir: string; branch: string }) => {
        order.push(`switchBranch(${opts.branch})`);
        return {
          current: opts.branch,
          changedFiles: ["/abs/project/chapter-01.md", "/abs/project/chapter-02.md"],
        };
      },
    });

    const res = await vcsSwitchBranch({
      request: request({ projectDir: "/abs/project", branch: "second-revision" }),
    } as never);
    expect(await res.json()).toEqual({
      current: "second-revision",
      changedFiles: ["/abs/project/chapter-01.md", "/abs/project/chapter-02.md"],
    });
    expect(order).toEqual([
      "pause(/abs/project)",
      "switchBranch(second-revision)",
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
        pauseTimers: (dir: string) => order.push(`pause(${dir})`),
        resumeTimers: (dir: string) => order.push(`resume(${dir})`),
      },
      recovery: { clear: async () => { recoveryCalled = true; return { ok: true }; } },
    });
    fakeLib({
      switchBranch: async () => {
        order.push("switchBranch:throw");
        throw new Error("This book isn't keeping version history yet. Turn on version history first.");
      },
    });

    const { status } = await caught(
      vcsSwitchBranch({ request: request({ projectDir: "/abs/project", branch: "second-revision" }) } as never),
    );
    expect(status).toBe(422); // the lib's own friendly message passes through
    expect(order).toEqual(["pause(/abs/project)", "switchBranch:throw", "resume(/abs/project)"]);
    expect(recoveryCalled).toBe(false);
  });

  test("a recovery-clear failure never turns a successful switch into a reported error", async () => {
    openProject({
      recovery: {
        clear: async () => {
          throw new Error("disk full");
        },
      },
    });
    fakeLib({
      switchBranch: async () => ({
        current: "second-revision",
        changedFiles: ["/abs/project/chapter-01.md"],
      }),
    });
    const res = await vcsSwitchBranch({
      request: request({ projectDir: "/abs/project", branch: "second-revision" }),
    } as never);
    expect(await res.json()).toEqual({
      current: "second-revision",
      changedFiles: ["/abs/project/chapter-01.md"],
    });
  });

  test("works without pauseTimers/resumeTimers (optional hooks)", async () => {
    openProject();
    fakeLib({ switchBranch: async () => ({ current: "second-revision", changedFiles: [] }) });
    const res = await vcsSwitchBranch({
      request: request({ projectDir: "/abs/project", branch: "second-revision" }),
    } as never);
    expect(await res.json()).toEqual({ current: "second-revision", changedFiles: [] });
  });
});
