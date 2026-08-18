import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST as editorPlugins } from "../../src/routes/api/project/editor-plugins/+server";
import { GET as pluginModule } from "../../src/routes/api/project/plugin-module/+server";
import { registerHostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { request, caught } from "../support/route-test-helpers";
import { pickPluginExport } from "../../src/lib/editor/project-plugins";

/**
 * The two routes that carry a PROJECT'S plugins into the rich editor's
 * dialect (`$lib/editor/project-renderer`). One resolves manifest entries to
 * same-origin module URLs (or stated reasons); the other serves the module
 * bytes. Both enumerate/serve files, so their guards get the same scrutiny
 * as the fs routes.
 */
type PostHandler = (event: { request: Request }) => Promise<Response>;
type GetHandler = (event: { url: URL }) => Promise<Response>;

const dirs: string[] = [];
const HOST_KEY = "__gutterpressHost__";
const priorHost = (globalThis as Record<string, unknown>)[HOST_KEY];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  const g = globalThis as Record<string, unknown>;
  if (priorHost === undefined) delete g[HOST_KEY];
  else g[HOST_KEY] = priorHost;
});

async function project(files: Record<string, string>): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "gp-eplugins-")));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    if (name.includes("/")) await mkdir(join(dir, name, ".."), { recursive: true });
    await writeFile(join(dir, name), text, "utf-8");
  }
  registerHostServices(
    makeHostServices({
      desktop: { getUserDataPath: () => dir },
      fsGuard: { projectRoots: () => [dir], readOnlyRoots: () => [] as string[] },
    }),
  );
  return dir;
}

const PLUGIN = "export default function (md) { /* no-op */ }\n";

async function list(dir: string) {
  const res = await (editorPlugins as PostHandler)({ request: request({ projectDir: dir }) });
  return (await res.json()) as {
    plugins: Array<{ ref: string; url?: string; exportName?: string; error?: string }>;
  };
}

describe("api/project/editor-plugins", () => {
  test("a local plugin resolves to a same-origin module URL", async () => {
    const dir = await project({
      "manifest.yaml": "title: T\nplugins:\n  - ./plugins/p.js\n",
      "plugins/p.js": PLUGIN,
      "a.md": "# A\n",
    });
    const { plugins } = await list(dir);
    expect(plugins).toHaveLength(1);
    expect(plugins[0]!.error).toBeUndefined();
    expect(plugins[0]!.url).toContain("/api/project/plugin-module?");
    expect(plugins[0]!.url).toContain(encodeURIComponent("./plugins/p.js"));
  });

  test("a named export selection is carried through", async () => {
    const dir = await project({
      "manifest.yaml": "title: T\nplugins:\n  - path: ./p.js\n    export: sidebar\n",
      "p.js": "export function sidebar(md) {}\n",
    });
    const { plugins } = await list(dir);
    expect(plugins[0]!.exportName).toBe("sidebar");
  });

  test("an npm plugin is reported as not-loadable, never guessed at", async () => {
    const dir = await project({
      "manifest.yaml": "title: T\nplugins:\n  - name: some-npm-plugin\n",
    });
    const { plugins } = await list(dir);
    expect(plugins[0]!.url).toBeUndefined();
    expect(plugins[0]!.error).toContain("npm");
  });

  test("a plugin path escaping the project is refused with a reason", async () => {
    const dir = await project({
      "manifest.yaml": "title: T\nplugins:\n  - ../outside.js\n",
    });
    const { plugins } = await list(dir);
    expect(plugins[0]!.url).toBeUndefined();
    expect(plugins[0]!.error).toContain("outside the project");
  });

  test("a missing plugin file is reported by name", async () => {
    const dir = await project({
      "manifest.yaml": "title: T\nplugins:\n  - ./gone.js\n",
    });
    const { plugins } = await list(dir);
    expect(plugins[0]!.error).toContain("./gone.js");
  });

  test("a project with no manifest lists no plugins", async () => {
    const dir = await project({ "a.md": "# A\n" });
    expect((await list(dir)).plugins).toEqual([]);
  });
});

describe("api/project/plugin-module", () => {
  const get = (dir: string, rel: string) =>
    (pluginModule as GetHandler)({
      url: new URL(
        `http://local.test/api/project/plugin-module?dir=${encodeURIComponent(dir)}&rel=${encodeURIComponent(rel)}`,
      ),
    });

  test("serves the module bytes as JavaScript, uncached", async () => {
    const dir = await project({ "plugins/p.js": PLUGIN });
    const res = await get(dir, "./plugins/p.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe(PLUGIN);
  });

  test("refuses a path that resolves outside the project", async () => {
    const dir = await project({});
    const { status } = await caught(get(dir, "../evil.js"));
    expect(status).toBe(400);
  });

  test("refuses a non-module extension", async () => {
    const dir = await project({ "notes.md": "# hi\n" });
    const { status } = await caught(get(dir, "notes.md"));
    expect(status).toBe(400);
  });

  test("404s a missing module by its relative name", async () => {
    const dir = await project({});
    const { status, message } = await caught(get(dir, "gone.js"));
    expect(status).toBe(404);
    expect(String(message)).toContain("gone.js");
  });

  test("refuses a dir that is not an approved project root", async () => {
    await project({}); // registers a DIFFERENT root
    const { status } = await caught(get("/definitely/not/approved", "p.js"));
    expect([400, 403]).toContain(status);
  });
});

describe("pickPluginExport", () => {
  const fn = () => {};
  test("default export", () => expect(pickPluginExport({ default: fn })).toBe(fn));
  test("module IS the function", () => expect(pickPluginExport(fn)).toBe(fn));
  test("named export when selected", () =>
    expect(pickPluginExport({ sidebar: fn }, "sidebar")).toBe(fn));
  test("double-wrapped default", () =>
    expect(pickPluginExport({ default: { default: fn } })).toBe(fn));
  test("missing named export names what IS there", () => {
    expect(() => pickPluginExport({ other: fn }, "sidebar")).toThrow('"sidebar"');
  });
  test("no function at all is an error, not a guess", () => {
    expect(() => pickPluginExport({ css: "x" })).toThrow("plugin function");
  });
});
