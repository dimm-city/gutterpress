/**
 * IPC-handler tests for `electron/api/extension.ts`'s `extension:add` - the
 * one "add by specifier" channel (#265). Three specifier kinds share it
 * (bundled name, npm package, project-relative path) and the handler's job
 * is the discipline around them: the project-dir guard runs before anything
 * else, an npm install goes through the native trust gate (and a cancelled
 * gate is a null, not an install), a bundled feature never prompts, and a
 * PATH is confined - relative to the project and inside it, never absolute
 * (that is `extension:addLocal`'s job, whose absolute path comes from the
 * host's own picker, not the renderer). Ported from the deleted
 * `extension-add-route.test.ts` onto the handler function; IPC has no HTTP
 * status, so every rejection is asserted by its message.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { extensionAdd } from "../../electron/api/extension";
import { makeHostServices } from "../support/host-services-fake";

async function caught(promise: Promise<unknown>): Promise<{ message: string }> {
  try {
    await promise;
    throw new Error("expected the promise to reject, but it resolved");
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error) };
  }
}

describe("extension:add", () => {
  let root: string;
  let projectDir: string;
  let outsideDir: string;
  let confirmations: string[];

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "gutterpress-extension-ipc-"));
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
    const result = await caught(extensionAdd(outsideDir, "markdown-it-highlightjs"));
    expect(result).toEqual({ message: "extension:add: path is outside the open project" });
    expect(confirmations).toEqual([]);
  });

  test("returns null and performs no install when the native confirmation is cancelled", async () => {
    const response = await extensionAdd(projectDir, "markdown-it-highlightjs@4.3.0");
    expect(response).toBeNull();
    expect(confirmations).toEqual(["markdown-it-highlightjs@4.3.0"]);
    await expect(readFile(path.join(projectDir, "manifest.yaml"), "utf8")).rejects.toThrow();
  });

  test("adds a bundled feature without a third-party install prompt", async () => {
    const response = await extensionAdd(projectDir, "markdown-it-mark");
    expect(response).toMatchObject({ use: "markdown-it-mark", kind: "bundled", enabled: true });
    expect(confirmations).toEqual([]);
    expect(await readFile(path.join(projectDir, "manifest.yaml"), "utf8")).toContain("markdown-it-mark");
  });

  test("fails closed when the native confirmation hook is unavailable", async () => {
    registerHostServices(makeHostServices({
      fsGuard: { projectRoots: () => [projectDir] },
      desktop: undefined,
    }));
    const result = await caught(extensionAdd(projectDir, "markdown-it-highlightjs"));
    expect(result).toEqual({ message: "Desktop hooks not registered" });
  });

  test("rejects a blank or unparseable specifier with a message that says what to write instead", async () => {
    expect((await caught(extensionAdd(projectDir, "   "))).message).toBe("extension:add requires a specifier");
    // A bare `plugins/foo.js` is neither a path (no ./) nor an npm name.
    const result = await caught(extensionAdd(projectDir, "plugins/foo.js"));
    expect(result.message).toContain("./plugins/foo.js");
    expect(confirmations).toEqual([]);
  });

  test("refuses an absolute path, even one inside the project - only the picker channel may name one", async () => {
    for (const abs of [path.join(outsideDir, "plugin.js"), path.join(projectDir, "plugin.js")]) {
      const result = await caught(extensionAdd(projectDir, abs));
      expect(result.message).toContain("extension:addLocal");
    }
    expect(confirmations).toEqual([]);
  });

  test("refuses a relative path that escapes the open project", async () => {
    await writeFile(path.join(outsideDir, "plugin.js"), "export default function () {}\n", "utf8");
    const result = await caught(extensionAdd(projectDir, "../outside/plugin.js"));
    expect(result).toEqual({ message: "extension:add: path is outside the open project" });
  });

  test("references an in-project path in place - written relative, nothing copied", async () => {
    const pluginFile = path.join(projectDir, "plugins", "mark.js");
    await mkdir(path.dirname(pluginFile), { recursive: true });
    await writeFile(pluginFile, "export default function plugin(md) { md.__mark = true; }\n", "utf8");

    const response = await extensionAdd(projectDir, "./plugins/mark.js");
    expect(response).toMatchObject({ use: "./plugins/mark.js", kind: "path", enabled: true });
    expect(await readFile(path.join(projectDir, "manifest.yaml"), "utf8")).toContain("./plugins/mark.js");
    // Still exactly where the author put it; no `extensions/` copy appeared.
    expect(existsSync(pluginFile)).toBe(true);
    expect(existsSync(path.join(projectDir, "extensions"))).toBe(false);
    expect(confirmations).toEqual([]);
  });
});
