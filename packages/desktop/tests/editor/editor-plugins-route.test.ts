import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { POST as editorPlugins } from "../../src/routes/api/project/editor-plugins/+server";
import { GET as pluginModule } from "../../src/routes/api/project/plugin-module/[...path]/+server";
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
 *
 * The property these exist to protect, learned the hard way on a real book:
 * **the editor must load exactly the plugins the PDF loads.** An editor that
 * refuses one of them is not a degraded editor, it is an editor showing a
 * different book — the author's branded components come out as raw marker
 * lines. So the resolution rule here is the loader's rule
 * (`resolve(projectDir, path)`, free to leave the project directory), and
 * fail-closed is enforced by the MANIFEST being the authority over which
 * files exist, not by a directory box the loader never had.
 */
type PostHandler = (event: { request: Request }) => Promise<Response>;
type GetHandler = (event: { params: { path: string } }) => Promise<Response>;

const dirs: string[] = [];
const HOST_KEY = "__gutterpressHost__";
const priorHost = (globalThis as Record<string, unknown>)[HOST_KEY];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  const g = globalThis as Record<string, unknown>;
  if (priorHost === undefined) delete g[HOST_KEY];
  else g[HOST_KEY] = priorHost;
});

function approve(dir: string): void {
  registerHostServices(
    makeHostServices({
      desktop: { getUserDataPath: () => dir },
      fsGuard: { projectRoots: () => [dir], readOnlyRoots: () => [] as string[] },
    }),
  );
}

async function write(root: string, files: Record<string, string>): Promise<void> {
  for (const [name, text] of Object.entries(files)) {
    if (name.includes("/")) await mkdir(join(root, name, ".."), { recursive: true });
    await writeFile(join(root, name), text, "utf-8");
  }
}

/** A project directory, host-approved as the open project. */
async function project(files: Record<string, string>): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "gp-eplugins-")));
  dirs.push(dir);
  await write(dir, files);
  approve(dir);
  return dir;
}

/**
 * The shape a shared design system takes on disk: several books beside a
 * folder of common plugins, referenced as `../shared/plugins/x.js`. This is
 * what the loader accepts, so it is what the editor must accept.
 */
async function siblingProject(
  bookFiles: Record<string, string>,
  siblingFiles: Record<string, string>,
): Promise<string> {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "gp-eplugins-tree-")));
  dirs.push(parent);
  const book = join(parent, "book");
  await mkdir(book, { recursive: true });
  await write(book, bookFiles);
  await write(parent, siblingFiles);
  approve(book);
  return book;
}

const PLUGIN = "export default function (md) { /* no-op */ }\n";

async function list(dir: string) {
  const res = await (editorPlugins as PostHandler)({ request: request({ projectDir: dir }) });
  return (await res.json()) as {
    plugins: Array<{ ref: string; url?: string; exportName?: string; error?: string }>;
  };
}

/** Fetch a module by the URL the list route handed out. */
const getUrl = (url: string) =>
  (pluginModule as GetHandler)({
    params: { path: url.replace("/api/project/plugin-module/", "") },
  });

describe("api/project/editor-plugins", () => {
  test("a local plugin resolves to a path-shaped module URL", async () => {
    const dir = await project({
      "manifest.yaml": "title: T\nplugins:\n  - ./plugins/p.js\n",
      "plugins/p.js": PLUGIN,
      "a.md": "# A\n",
    });
    const { plugins } = await list(dir);
    expect(plugins).toHaveLength(1);
    expect(plugins[0]!.error).toBeUndefined();
    // Path-shaped, not a query: a plugin's own relative imports resolve
    // against this URL, and a query string would be dropped by that.
    expect(plugins[0]!.url).toStartWith("/api/project/plugin-module/");
    expect(plugins[0]!.url).not.toContain("?");
    expect(plugins[0]!.url).toEndWith("/p.js");
  });

  test("a plugin BESIDE the project loads — the shape that shipped broken", async () => {
    // `../shared/plugins/dc.js`: the loader accepts it, so preview and PDF
    // render the book's components and the editor used to refuse them,
    // showing the author raw marker lines instead of their own book.
    const book = await siblingProject(
      { "manifest.yaml": "title: T\nplugins:\n  - ../shared/plugins/dc.js\n", "a.md": "# A\n" },
      { "shared/plugins/dc.js": PLUGIN },
    );
    const { plugins } = await list(book);
    expect(plugins[0]!.error).toBeUndefined();
    expect(plugins[0]!.url).toBeDefined();
    const res = await getUrl(plugins[0]!.url!);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PLUGIN);
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

  test("a missing plugin file is reported by name", async () => {
    const dir = await project({
      "manifest.yaml": "title: T\nplugins:\n  - ./gone.js\n",
    });
    const { plugins } = await list(dir);
    expect(plugins[0]!.error).toContain("./gone.js");
  });

  test("a non-module path is reported rather than served", async () => {
    const dir = await project({
      "manifest.yaml": "title: T\nplugins:\n  - ./notes.md\n",
      "notes.md": "# hi\n",
    });
    const { plugins } = await list(dir);
    expect(plugins[0]!.url).toBeUndefined();
    expect(plugins[0]!.error).toContain(".js");
  });

  test("a project with no manifest lists no plugins", async () => {
    const dir = await project({ "a.md": "# A\n" });
    expect((await list(dir)).plugins).toEqual([]);
  });
});

describe("api/project/plugin-module", () => {
  /** Build a URL by hand, the way an invented request would. */
  const seg = (value: string) => Buffer.from(value, "utf8").toString("base64url");
  const path = (dir: string, root: string, file: string) =>
    (pluginModule as GetHandler)({ params: { path: `${seg(dir)}/${seg(root)}/${file}` } });

  test("serves the module bytes as JavaScript, uncached", async () => {
    const dir = await project({
      "manifest.yaml": "title: T\nplugins:\n  - ./plugins/p.js\n",
      "plugins/p.js": PLUGIN,
    });
    const { plugins } = await list(dir);
    const res = await getUrl(plugins[0]!.url!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe(PLUGIN);
  });

  test("a plugin's own relative import resolves to a servable sibling", async () => {
    // A plugin split across files is ordinary. The browser resolves
    // `./rules/callout.js` against the module's URL, so the resolved URL must
    // land on the sibling file — no source rewriting anywhere.
    const dir = await project({
      "manifest.yaml": "title: T\nplugins:\n  - ./plugins/p.js\n",
      "plugins/p.js": "import './rules/callout.js';\nexport default function (md) {}\n",
      "plugins/rules/callout.js": "export const callout = 1;\n",
    });
    const { plugins } = await list(dir);
    const resolved = new URL(plugins[0]!.url!, "http://local.test");
    const sub = new URL("./rules/callout.js", resolved).pathname;
    const res = await getUrl(sub);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("callout");
  });

  test("refuses a directory the manifest does not declare", async () => {
    // The fail-closed edge: an approved PROJECT is not an approved plugin
    // directory. Only folders the book's own manifest points into are served.
    const dir = await project({
      "manifest.yaml": "title: T\nplugins:\n  - ./plugins/p.js\n",
      "plugins/p.js": PLUGIN,
      "secrets/keys.js": "export const key = 'nope';\n",
    });
    const { status } = await caught(path(dir, join(dir, "secrets"), "keys.js"));
    expect(status).toBe(403);
  });

  test("refuses a file that escapes its plugin directory", async () => {
    const dir = await project({
      "manifest.yaml": "title: T\nplugins:\n  - ./plugins/p.js\n",
      "plugins/p.js": PLUGIN,
      "elsewhere.js": "export const x = 1;\n",
    });
    const { status } = await caught(path(dir, join(dir, "plugins"), "..%2Felsewhere.js"));
    expect(status).toBe(400);
  });

  test("refuses a non-module extension inside an approved plugin directory", async () => {
    const dir = await project({
      "manifest.yaml": "title: T\nplugins:\n  - ./plugins/p.js\n",
      "plugins/p.js": PLUGIN,
      "plugins/notes.md": "# hi\n",
    });
    const { status } = await caught(path(dir, join(dir, "plugins"), "notes.md"));
    expect(status).toBe(400);
  });

  test("404s a missing module", async () => {
    const dir = await project({
      "manifest.yaml": "title: T\nplugins:\n  - ./plugins/p.js\n",
      "plugins/p.js": PLUGIN,
    });
    const { status, message } = await caught(path(dir, join(dir, "plugins"), "gone.js"));
    expect(status).toBe(404);
    expect(String(message)).toContain("gone.js");
  });

  test("refuses a project dir that is not an approved project root", async () => {
    const dir = await project({
      "manifest.yaml": "title: T\nplugins:\n  - ./plugins/p.js\n",
      "plugins/p.js": PLUGIN,
    });
    // Same plugin directory, a project root the host never approved.
    const { status } = await caught(
      path(join("/definitely/not", basename(dir)), join(dir, "plugins"), "p.js"),
    );
    expect([400, 403]).toContain(status);
  });

  test("refuses an incomplete or malformed path", async () => {
    await project({ "manifest.yaml": "title: T\n" });
    expect((await caught(path("", "", ""))).status).toBe(400);
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
