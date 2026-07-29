import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isHttpError } from "@sveltejs/kit";

import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { POST as addNpmRoute } from "../../src/routes/api/plugin/add-npm/+server";
import { makeHostServices } from "../support/host-services-fake";

function request(projectDir: string, packageName: string): Request {
  return new Request("http://local.test/api/plugin/add-npm", {
    method: "POST",
    body: JSON.stringify({ projectDir, packageName }),
    headers: { "content-type": "application/json" },
  });
}

async function caught(promise: Promise<unknown>): Promise<{ status: number; message: unknown }> {
  try {
    await promise;
    throw new Error("expected the promise to reject, but it resolved");
  } catch (error) {
    if (!isHttpError(error)) throw error;
    return { status: error.status, message: (error.body as { message?: unknown }).message };
  }
}

describe("POST /api/plugin/add-npm", () => {
  let root: string;
  let projectDir: string;
  let outsideDir: string;
  let confirmations: string[];

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "Gutterpress-plugin-route-"));
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
    const result = await caught(addNpmRoute({
      request: request(outsideDir, "markdown-it-highlightjs"),
    } as Parameters<typeof addNpmRoute>[0]));

    expect(result).toEqual({
      status: 403,
      message: "plugin:addNpm: path is outside the open project",
    });
    expect(confirmations).toEqual([]);
  });

  test("returns null and performs no install when native confirmation is cancelled", async () => {
    const response = await addNpmRoute({
      request: request(projectDir, "markdown-it-highlightjs@4.3.0"),
    } as Parameters<typeof addNpmRoute>[0]);

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(confirmations).toEqual(["markdown-it-highlightjs@4.3.0"]);
    await expect(readFile(path.join(projectDir, "manifest.yaml"), "utf8")).rejects.toThrow();
  });

  test("enables a bundled recommendation without a third-party install prompt", async () => {
    const response = await addNpmRoute({
      request: request(projectDir, "markdown-it-mark"),
    } as Parameters<typeof addNpmRoute>[0]);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ref: "markdown-it-mark", enabled: true });
    expect(confirmations).toEqual([]);
    expect(await readFile(path.join(projectDir, "manifest.yaml"), "utf8")).toContain("markdown-it-mark");
  });

  test("fails closed when the native confirmation hook is unavailable", async () => {
    registerHostServices(makeHostServices({
      fsGuard: { projectRoots: () => [projectDir] },
      desktop: undefined,
    }));

    const result = await caught(addNpmRoute({
      request: request(projectDir, "markdown-it-highlightjs"),
    } as Parameters<typeof addNpmRoute>[0]));
    expect(result).toEqual({ status: 503, message: "Desktop hooks not registered" });
  });
});
