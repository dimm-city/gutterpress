/**
 * Handler-level coverage for #273's copy-switching surface
 * (`electron/api/vcs.ts`'s `vcsListBranches` / `vcsSwitchBranch`), which
 * vcs-ipc.test.ts only covers for the project-path guard. Ported from the
 * route-level suite upstream wrote against `src/routes/api/vcs/{list-branches,
 * switch-branch}/+server.ts` (deleted with the local server, SFE-P5d); IPC has
 * no HTTP status, so every rejection is asserted by its message. This file
 * covers:
 *  - happy-path forwarding to the lib, including `listBranches`' `null`
 *    passthrough (nothing to switch between);
 *  - `switchBranch`'s rejection of a missing/blank branch name;
 *  - `switchBranch` pauses the host's auto-snapshot/auto-sync timers around
 *    the checkout and always resumes them, success or failure (VcsHooks
 *    `pauseTimers`/`resumeTimers`);
 *  - `switchBranch` clears the crash-recovery draft for every path the lib
 *    reports as changed - the mechanism recovery.ts's header (#273) documents
 *    for "a draft from the old copy must never be offered over the new
 *    copy's version of the same file", and does so best-effort (a recovery
 *    failure never turns a successful switch into a reported error).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getHostServices,
  registerHostServices,
  type HostServices,
} from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { vcsListBranches, vcsSwitchBranch } from "../../electron/api/vcs";

let base: string;
let projectDir: string;
let savedHostServices: HostServices | null;

/** The rejection message of a promise, or null when it resolved. */
async function messageOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function openProject(overrides: Parameters<typeof makeHostServices>[0] = {}): void {
  registerHostServices(
    makeHostServices({
      fsGuard: { projectRoots: () => [projectDir], readOnlyRoots: () => [] as string[] },
      ...overrides,
    }),
  );
}

beforeEach(async () => {
  savedHostServices = getHostServices();
  base = await mkdtemp(path.join(tmpdir(), "gutterpress-vcs-copy-switch-"));
  projectDir = path.join(base, "project");
  await mkdir(projectDir, { recursive: true });
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  registerHostServices(savedHostServices as HostServices);
});

describe("vcs:listBranches", () => {
  test("fails closed when vcs hooks are not registered", async () => {
    openProject({ vcs: undefined });
    expect(await messageOf(vcsListBranches(projectDir))).toBe("VCS hooks not registered");
  });

  test("forwards to lib.listLocalBranches and returns its result", async () => {
    const calls: string[] = [];
    openProject({
      vcs: {
        loadLib: async () => ({
          listLocalBranches: async (dir: string) => {
            calls.push(dir);
            return { current: "main", branches: ["main", "second-copy"], remoteOnly: [] };
          },
        }),
      } as never,
    });
    expect(await vcsListBranches(projectDir)).toEqual({
      current: "main",
      branches: ["main", "second-copy"],
      remoteOnly: [],
    });
    expect(calls).toEqual([projectDir]);
  });

  test("passes a null result straight through (nothing to switch between)", async () => {
    openProject({
      vcs: { loadLib: async () => ({ listLocalBranches: async () => null }) } as never,
    });
    expect(await vcsListBranches(projectDir)).toBeNull();
  });
});

describe("vcs:switchBranch", () => {
  test("fails closed when vcs hooks are not registered", async () => {
    openProject({ vcs: undefined });
    expect(await messageOf(vcsSwitchBranch(projectDir, "main"))).toBe("VCS hooks not registered");
  });

  test("rejects a missing or blank branch name before touching the lib", async () => {
    openProject({ vcs: { loadLib: async () => ({}) } as never });
    for (const branch of [undefined, "", "   "]) {
      expect(await messageOf(vcsSwitchBranch(projectDir, branch))).toBe(
        "vcs:switchBranch requires a branch name",
      );
    }
  });

  test("pauses timers before the checkout, resumes after, and clears recovery for every changed path", async () => {
    const order: string[] = [];
    const recoveryCleared: string[] = [];
    const changed = [path.join(projectDir, "chapter-01.md"), path.join(projectDir, "chapter-02.md")];
    openProject({
      vcs: {
        loadLib: async () => ({
          switchBranch: async (opts: { projectDir: string; branch: string }) => {
            order.push(`switchBranch(${opts.branch})`);
            return { current: opts.branch, changedFiles: changed };
          },
        }),
        pauseTimers: (dir: string) => order.push(`pause(${dir})`),
        resumeTimers: (dir: string) => order.push(`resume(${dir})`),
      } as never,
      recovery: {
        write: async () => ({ ok: true }),
        list: async () => [],
        clear: async (filePath: string) => {
          recoveryCleared.push(filePath);
          return { ok: true };
        },
      },
    });

    expect(await vcsSwitchBranch(projectDir, "second-copy")).toEqual({
      current: "second-copy",
      changedFiles: changed,
    });
    expect(order).toEqual([`pause(${projectDir})`, "switchBranch(second-copy)", `resume(${projectDir})`]);
    expect(recoveryCleared.sort()).toEqual([...changed].sort());
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
      recovery: {
        write: async () => ({ ok: true }),
        list: async () => [],
        clear: async () => {
          recoveryCalled = true;
          return { ok: true };
        },
      },
    });

    // The lib's own friendly message passes through friendlyVcsError verbatim.
    expect(await messageOf(vcsSwitchBranch(projectDir, "second-copy"))).toBe(
      "no version history yet. Enable version history first.",
    );
    expect(order).toEqual([`pause(${projectDir})`, "switchBranch:throw", `resume(${projectDir})`]);
    expect(recoveryCalled).toBe(false);
  });

  test("a recovery-clear failure never turns a successful switch into a reported error", async () => {
    const changed = [path.join(projectDir, "chapter-01.md")];
    openProject({
      vcs: {
        loadLib: async () => ({
          switchBranch: async () => ({ current: "second-copy", changedFiles: changed }),
        }),
      } as never,
      recovery: {
        write: async () => ({ ok: true }),
        list: async () => [],
        clear: async () => {
          throw new Error("disk full");
        },
      },
    });
    expect(await vcsSwitchBranch(projectDir, "second-copy")).toEqual({
      current: "second-copy",
      changedFiles: changed,
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
    expect(await vcsSwitchBranch(projectDir, "second-copy")).toEqual({
      current: "second-copy",
      changedFiles: [],
    });
  });
});
