/**
 * IPC-handler tests for `electron/api/plugin.ts` (SFE-P5c2 — migrated off
 * `src/routes/api/plugin/{add-npm,list,set-enabled,add-local,validate,
 * recommended}/+server.ts`, all deleted). `pluginAddNpm` gets its own
 * focused suite (ported from the deleted `plugin-add-npm-route.test.ts`)
 * because it has the most SPECIAL WEIGHT of the nine namespaces this run
 * migrates: the native trust-confirmation gate for non-bundled packages, and
 * (unchanged) the vendored-install pipeline underneath it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { pluginAddNpm } from "../../electron/api/plugin";
import { makeHostServices } from "../support/host-services-fake";

async function caught(promise: Promise<unknown>): Promise<{ message: string }> {
  try {
    await promise;
    throw new Error("expected the promise to reject, but it resolved");
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error) };
  }
}

describe("plugin:addNpm", () => {
  let root: string;
  let projectDir: string;
  let outsideDir: string;
  let confirmations: string[];

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "gutterpress-plugin-ipc-"));
    projectDir = path.join(root, "project");
    outsideDir = path.join(root, "outside");
    confirmations = [];
    await Promise.all([
      mkdir(projectDir, { recursive: true }),
      mkdir(outsideDir, { recursive: true }),
    ]);
    registerHostServices(makeHostServices({
      fsGuard: { projectRoots: () => [projectDir] },
      desktop: {
        confirmNpmPluginInstall: async (packageName) => {
          confirmations.push(packageName);
          return false;
        },
      },
    }));
  });

  afterEach(async () => {
    registerHostServices(undefined as unknown as HostServices);
    await rm(root, { recursive: true, force: true });
  });

  test("rejects an outside directory before showing the trust prompt", async () => {
    const result = await caught(pluginAddNpm(outsideDir, "markdown-it-highlightjs"));
    expect(result).toEqual({ message: "plugin:addNpm: path is outside the open project" });
    expect(confirmations).toEqual([]);
  });

  test("returns null and performs no install when native confirmation is cancelled", async () => {
    const response = await pluginAddNpm(projectDir, "markdown-it-highlightjs@4.3.0");
    expect(response).toBeNull();
    expect(confirmations).toEqual(["markdown-it-highlightjs@4.3.0"]);
    await expect(readFile(path.join(projectDir, "manifest.yaml"), "utf8")).rejects.toThrow();
  });

  test("enables a bundled recommendation without a third-party install prompt", async () => {
    const response = await pluginAddNpm(projectDir, "markdown-it-mark");
    expect(response).toMatchObject({ ref: "markdown-it-mark", enabled: true });
    expect(confirmations).toEqual([]);
    expect(await readFile(path.join(projectDir, "manifest.yaml"), "utf8")).toContain("markdown-it-mark");
  });

  test("fails closed when the native confirmation hook is unavailable", async () => {
    registerHostServices(makeHostServices({
      fsGuard: { projectRoots: () => [projectDir] },
      desktop: undefined,
    }));

    const result = await caught(pluginAddNpm(projectDir, "markdown-it-highlightjs"));
    expect(result).toEqual({ message: "Desktop hooks not registered" });
  });
});
