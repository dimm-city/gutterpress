import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST as normalize } from "../../src/routes/api/project/normalize/+server";
import { registerHostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";

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

async function run(dir: string, apply: boolean) {
  const res = await (normalize as Handler)({
    request: new Request("http://localhost/api/project/normalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectDir: dir, apply }),
    }),
  });
  return (await res.json()) as {
    applied: boolean;
    changed: Array<{ path: string; before: string; after: string }>;
    unchanged: string[];
    refused: Array<{ path: string; reason: string }>;
  };
}

describe("project/normalize", () => {
  test("planning writes NOTHING", async () => {
    const dir = await project({ "a.md": "+ one\n" });
    const plan = await run(dir, false);

    expect(plan.applied).toBe(false);
    expect(plan.changed).toHaveLength(1);
    expect(plan.changed[0]!.after).toBe("* one\n");
    // The file on disk is untouched — the author has not agreed yet.
    expect(await readFile(join(dir, "a.md"), "utf-8")).toBe("+ one\n");
  });

  test("the plan carries before AND after, so a diff can be shown", async () => {
    const dir = await project({ "a.md": "+ one\n" });
    const plan = await run(dir, false);
    expect(plan.changed[0]!.before).toBe("+ one\n");
    expect(plan.changed[0]!.after).toBe("* one\n");
  });

  test("applying writes exactly the planned files", async () => {
    const dir = await project({
      "a.md": "+ one\n",
      "b.md": "# Already canonical\n",
    });
    const result = await run(dir, true);

    expect(result.applied).toBe(true);
    expect(await readFile(join(dir, "a.md"), "utf-8")).toBe("* one\n");
    // Untouched: it was already canonical, so it must not be rewritten at all.
    expect(await readFile(join(dir, "b.md"), "utf-8")).toBe("# Already canonical\n");
    expect(result.unchanged).toContain("b.md");
  });

  test("a file the model cannot represent is left byte-for-byte alone", async () => {
    const withFootnote = "Text[^1]\n\n[^1]: A note.\n";
    const dir = await project({ "notes.md": withFootnote, "ok.md": "+ one\n" });
    const result = await run(dir, true);

    expect(result.refused.map((r) => r.path)).toEqual(["notes.md"]);
    expect(await readFile(join(dir, "notes.md"), "utf-8")).toBe(withFootnote);
    // and one bad file does not stop the rest
    expect(await readFile(join(dir, "ok.md"), "utf-8")).toBe("* one\n");
  });

  test("non-markdown files are never touched", async () => {
    const css = "body { color: red }\n";
    const dir = await project({ "a.md": "+ one\n", "style.css": css });
    await run(dir, true);
    expect(await readFile(join(dir, "style.css"), "utf-8")).toBe(css);
  });

  test("applying twice is a no-op the second time", async () => {
    // The property that makes "one deliberate change" true.
    const dir = await project({ "a.md": "+ one\n" });
    await run(dir, true);
    const second = await run(dir, true);
    expect(second.changed).toEqual([]);
    expect(await readFile(join(dir, "a.md"), "utf-8")).toBe("* one\n");
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
