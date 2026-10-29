/**
 * Route-level coverage for the routes that save a version or open another
 * revision (#448): the message each records in the book's history, and that
 * each tells the host to re-check whether versions are waiting to go online.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { isHttpError } from "@sveltejs/kit";
import {
  registerHostServices,
  type HostServices,
} from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { setLibForTests, type LibModule } from "../../src/routes/api/_lib/route";
import { POST as saveSnapshot } from "../../src/routes/api/vcs/save-snapshot/+server";
import { POST as enableVersionHistory } from "../../src/routes/api/vcs/enable-version-history/+server";
import { POST as restoreSnapshot } from "../../src/routes/api/vcs/restore-snapshot/+server";
import { POST as switchBranch } from "../../src/routes/api/vcs/switch-branch/+server";

const DIR = "/abs/project";

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

describe("routes that save a version or open another revision", () => {
  /** A lib whose provider records the message of every version it is asked to save. */
  function versionLib(messages: string[]): Record<string, unknown> {
    return {
      detectProjectSource: async () => ({ type: "local-git-folder", repoRoot: DIR }),
      repoRootForSource: () => DIR,
      ensureProjectGitignore: async () => ({}),
      capabilitiesFor: () => ({}),
      providerFor: () => ({
        snapshot: async (o: { message: string }) => {
          messages.push(o.message);
          return { id: "a".repeat(40) };
        },
        initVersionHistory: async (o: { initialMessage: string }) => {
          messages.push(o.initialMessage);
        },
      }),
    };
  }

  test("Save a version says 'Saved a version' unless the author wrote a note, then re-checks the online status", async () => {
    const messages: string[] = [];
    const checked: string[] = [];
    openProject({ vcs: { refreshOnlineStatus: (dir: string) => checked.push(dir) } });
    fakeLib(versionLib(messages));
    await saveSnapshot({ request: request({ projectDir: DIR }) } as never);
    await saveSnapshot({ request: request({ projectDir: DIR, message: "  Before the edit pass " }) } as never);
    expect(messages).toEqual(["Saved a version", "Before the edit pass"]);
    expect(checked).toEqual([DIR, DIR]);
  });

  test("a version that could not be saved does not re-check the status", async () => {
    const checked: string[] = [];
    openProject({ vcs: { refreshOnlineStatus: (dir: string) => checked.push(dir) } });
    fakeLib({
      ...versionLib([]),
      providerFor: () => ({
        snapshot: async () => {
          throw new Error("Nothing new to save — your last version already has everything.");
        },
      }),
    });
    const { status } = await caught(saveSnapshot({ request: request({ projectDir: DIR }) } as never));
    expect(status).toBe(422);
    expect(checked).toEqual([]);
  });

  test("turning on version history saves a 'First version'", async () => {
    const messages: string[] = [];
    openProject();
    fakeLib(versionLib(messages));
    await enableVersionHistory({ request: request({ projectDir: DIR }) } as never);
    expect(messages).toEqual(["First version"]);
  });

  test("going back to a version re-checks the status only when it saved a safety version first", async () => {
    const checked: string[] = [];
    openProject({ vcs: { refreshOnlineStatus: (dir: string) => checked.push(dir) } });
    const id = "b".repeat(40);
    fakeLib({ restoreVersionWithBackup: async () => ({ restoredId: id }) });
    await restoreSnapshot({ request: request({ projectDir: DIR, id }) } as never);
    expect(checked).toEqual([]);
    fakeLib({ restoreVersionWithBackup: async () => ({ restoredId: id, backupId: "c".repeat(40) }) });
    await restoreSnapshot({ request: request({ projectDir: DIR, id }) } as never);
    expect(checked).toEqual([DIR]);
  });

  test("opening another revision re-checks the status, after the switch", async () => {
    const order: string[] = [];
    openProject({ vcs: { refreshOnlineStatus: () => order.push("status") } });
    fakeLib({
      switchBranch: async () => {
        order.push("switch");
        return { current: "Second-edition", changedFiles: [] };
      },
    });
    await switchBranch({ request: request({ projectDir: DIR, branch: "Second-edition" }) } as never);
    expect(order).toEqual(["switch", "status"]);
  });
});
