import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST as normalize } from "../../src/routes/api/project/normalize/+server";
import { registerHostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { request } from "../support/route-test-helpers";

/**
 * The normalize route REWRITES an author's book, so what it does and — more
 * importantly — what it declines to do are worth pinning down.
 *
 * `planNormalize` itself is unit-tested in `normalize-project.test.ts`; this
 * covers the parts only the route has: that planning writes nothing, that
 * applying writes exactly the planned files and no others, and that a file the
 * document model cannot represent is left byte-for-byte alone.
 */
type Handler = (event: { request: Request }) => Promise<Response>;

const dirs: string[] = [];

/**
 * `registerHostServices` writes to a globalThis slot shared by every test in
 * the process, so leaving it set leaks into whatever runs next — a test
 * asserting "hooks are not registered" then fails for a reason that has
 * nothing to do with it. Capture and restore rather than relying on file
 * ordering to hide it.
 */
const HOST_KEY = "__gutterpressHost__";
const priorHost = (globalThis as Record<string, unknown>)[HOST_KEY];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  const g = globalThis as Record<string, unknown>;
  if (priorHost === undefined) delete g[HOST_KEY];
  else g[HOST_KEY] = priorHost;
});

async function project(files: Record<string, string>): Promise<string> {
  // realpath: the guard compares resolved paths, and on some platforms the
  // temp dir is itself a symlink — an unresolved path fails the check for a
  // reason that has nothing to do with what is being tested.
  const dir = await realpath(await mkdtemp(join(tmpdir(), "gp-normalize-")));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
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

async function run(dir: string, apply: boolean, expected?: Record<string, string>) {
  const res = await (normalize as Handler)({
    request: request({ projectDir: dir, apply, expected }),
  });
  return (await res.json()) as {
    applied: boolean;
    changed: Array<{ path: string; before: string; after: string }>;
    unchanged: string[];
    refused: Array<{ path: string; reason: string }>;
    failed: Array<{ path: string; error: string }>;
    stale: string[];
  };
}

describe("project/normalize", () => {
  test("planning writes NOTHING", async () => {
    const dir = await project({ "a.md": "__one__\n" });
    const plan = await run(dir, false);

    expect(plan.applied).toBe(false);
    expect(plan.changed).toHaveLength(1);
    expect(plan.changed[0]!.after).toBe("**one**\n");
    // The file on disk is untouched — the author has not agreed yet.
    expect(await readFile(join(dir, "a.md"), "utf-8")).toBe("__one__\n");
  });

  test("the plan carries before AND after, so a diff can be shown", async () => {
    const dir = await project({ "a.md": "__one__\n" });
    const plan = await run(dir, false);
    expect(plan.changed[0]!.before).toBe("__one__\n");
    expect(plan.changed[0]!.after).toBe("**one**\n");
  });

  test("applying writes exactly the planned files", async () => {
    const dir = await project({
      "a.md": "__one__\n",
      "b.md": "# Already canonical\n",
    });
    const result = await run(dir, true);

    expect(result.applied).toBe(true);
    expect(await readFile(join(dir, "a.md"), "utf-8")).toBe("**one**\n");
    // Untouched: it was already canonical, so it must not be rewritten at all.
    expect(await readFile(join(dir, "b.md"), "utf-8")).toBe("# Already canonical\n");
    expect(result.unchanged).toContain("b.md");
  });

  test("a file the model cannot represent is left byte-for-byte alone", async () => {
    const withFootnote = "Text[^1]\n\n[^1]: A note.\n";
    const dir = await project({ "notes.md": withFootnote, "ok.md": "__one__\n" });
    const result = await run(dir, true);

    expect(result.refused.map((r) => r.path)).toEqual(["notes.md"]);
    expect(await readFile(join(dir, "notes.md"), "utf-8")).toBe(withFootnote);
    // and one bad file does not stop the rest
    expect(await readFile(join(dir, "ok.md"), "utf-8")).toBe("**one**\n");
  });

  test("non-markdown files are never touched", async () => {
    const css = "body { color: red }\n";
    const dir = await project({ "a.md": "__one__\n", "style.css": css });
    await run(dir, true);
    expect(await readFile(join(dir, "style.css"), "utf-8")).toBe(css);
  });

  test("applying twice is a no-op the second time", async () => {
    // The property that makes "one deliberate change" true.
    const dir = await project({ "a.md": "__one__\n" });
    await run(dir, true);
    const second = await run(dir, true);
    expect(second.changed).toEqual([]);
    expect(await readFile(join(dir, "a.md"), "utf-8")).toBe("**one**\n");
  });

  test("markdown-it-attrs and table alignment survive the rewrite", async () => {
    // The two things that were silently destroyed before 4caf041. If this
    // route ever loses them again it is rewriting an author's whole book.
    const src = "# Title {#anchor}\n\n![Art](a.png){.gp-bleed}\n\n| A | B |\n| --- | ---: |\n| 1 | 2 |\n";
    const dir = await project({ "a.md": src });
    await run(dir, true);
    const out = await readFile(join(dir, "a.md"), "utf-8");
    expect(out).toContain("{#anchor}");
    expect(out).toContain("{.gp-bleed}");
    expect(out).toContain("---:");
  });
});

describe("project/normalize: only what the author reviewed", () => {
  test("a file that changed since the plan is skipped and named", async () => {
    const dir = await project({ "a.md": "# A\n\n__one__\n", "b.md": "# B\n\n__two__\n" });
    const plan = await run(dir, false);
    expect(plan.changed.length).toBeGreaterThan(0);

    // Someone else edits a.md while the dialog is open.
    await writeFile(join(dir, "a.md"), "# A changed elsewhere\n\n__one__\n", "utf-8");

    const expected = Object.fromEntries(plan.changed.map((c) => [c.path, c.before]));
    const applied = await run(dir, true, expected);

    expect(applied.stale).toEqual(["a.md"]);
    // The out-of-date file keeps the text that arrived, not the reviewed one.
    expect(await readFile(join(dir, "a.md"), "utf-8")).toBe("# A changed elsewhere\n\n__one__\n");
  });

  test("matching files still apply normally", async () => {
    const dir = await project({ "a.md": "# A\n\n__one__\n" });
    const plan = await run(dir, false);
    const expected = Object.fromEntries(plan.changed.map((c) => [c.path, c.before]));
    const applied = await run(dir, true, expected);
    expect(applied.stale).toEqual([]);
    for (const c of plan.changed) {
      expect(await readFile(join(dir, c.path), "utf-8")).toBe(c.after);
    }
  });

  test("an apply with no expectations still works (nothing to compare against)", async () => {
    const dir = await project({ "a.md": "# A\n\n__one__\n" });
    const applied = await run(dir, true);
    expect(applied.stale).toEqual([]);
  });
});

describe("project/normalize: the files it enumerates", () => {
  test("follows the manifest's source.files, including nested paths", async () => {
    // The renderer's own resolver decides what the book contains; a hand-rolled
    // top-level readdir missed nested chapters entirely and still let the
    // project be recorded as normalized.
    const dir = await project({
      "manifest.yaml": "title: T\nsource:\n  files:\n    - chapters/intro.md\n",
    });
    await mkdir(join(dir, "chapters"), { recursive: true });
    await writeFile(join(dir, "chapters", "intro.md"), "# Intro\n\n- one\n", "utf-8");

    const plan = await run(dir, false);
    const seen = [...plan.changed.map((c) => c.path), ...plan.unchanged];
    expect(seen).toContain("chapters/intro.md");
  });
});

describe("project/normalize: the PROJECT'S dialect, plugins included", () => {
  test("a plugin-marker chapter is planned with the plugin loaded, markers verbatim", async () => {
    // Without the manifest's plugins, `@sidebar` tokenizes as a plain
    // paragraph — content-safe, but the plan would be judging a different
    // document than the one that prints. With them, the wrapper round-trips
    // as a structural node and its authored lines survive exactly.
    const dir = await project({
      "manifest.yaml": "title: T\nplugins:\n  - ./plugins/marks.js\n",
      "a.md": '@sidebar .tip "Note"\n\nKeep **both** hands on the rail.\n\n@end-sidebar\n',
    });
    await mkdir(join(dir, "plugins"), { recursive: true });
    await writeFile(
      join(dir, "plugins", "marks.js"),
      `export default function (md) {
  md.block.ruler.before("paragraph", "gp_test_marks", (state, startLine, _end, silent) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    const line = state.src.slice(pos, state.eMarks[startLine]).trim();
    const m = /^@(sidebar|end-sidebar)\\b/.exec(line);
    if (!m) return false;
    if (silent) return true;
    const t = state.push(m[1] === "sidebar" ? "sb_open" : "sb_close", "aside", m[1] === "sidebar" ? 1 : -1);
    t.markup = line;
    t.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  });
}
`,
      "utf-8",
    );

    const plan = await run(dir, false);
    expect(plan.refused).toEqual([]);
    // Already-canonical, so unchanged — the strongest form of "not damaged".
    expect(plan.unchanged).toContain("a.md");
  });

  test("a plugin that cannot load ABORTS the plan instead of writing with the wrong dialect", async () => {
    const dir = await project({
      "manifest.yaml": "title: T\nplugins:\n  - ./plugins/broken.js\n",
      "a.md": "# A\n",
    });
    await mkdir(join(dir, "plugins"), { recursive: true });
    await writeFile(join(dir, "plugins", "broken.js"), "throw new Error('boom at import');\n", "utf-8");

    const res = await (normalize as Handler)({ request: request({ projectDir: dir, apply: false }) })
      .then((r) => ({ ok: true as const, r }))
      .catch((e: unknown) => ({ ok: false as const, e }));
    // defineRoute surfaces the throw as an HTTP error; either shape is fine —
    // what matters is that NO plan is produced.
    if (res.ok) expect(res.r.status).toBeGreaterThanOrEqual(500);
  });
});
