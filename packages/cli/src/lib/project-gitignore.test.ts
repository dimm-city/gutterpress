import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import git from "isomorphic-git";

import { ensureProjectGitignore } from "./project-gitignore.ts";
import { detectProjectSource } from "./project-source.ts";
import { listWorkdirChanges, providerFor } from "./source-provider.ts";

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "gutterpress-gitignore-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const read = (dir: string) => readFile(path.join(dir, ".gitignore"), "utf8");

describe("ensureProjectGitignore", () => {
  test("creates the file with both entries", async () => {
    const dir = await tmp();
    expect(await ensureProjectGitignore(dir)).toEqual({ negated: [] });
    expect(await read(dir)).toBe("dist/\nplugins/npm/\n");
  });

  test("appends to an existing file without touching what is there, even with no trailing newline", async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, ".gitignore"), "*.log\n# mine\nnotes/", "utf8");
    await ensureProjectGitignore(dir);
    expect(await read(dir)).toBe("*.log\n# mine\nnotes/\ndist/\nplugins/npm/\n");
  });

  test("appends only the entry that is missing", async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, ".gitignore"), "/dist\n", "utf8");
    await ensureProjectGitignore(dir);
    expect(await read(dir)).toBe("/dist\nplugins/npm/\n");
  });

  test.each([
    "dist/\nplugins/npm/\n",
    "dist\r\nplugins/npm\r\n",
    "/dist/\n/plugins/npm/\n",
    "dist/\nplugins/\n",
    "dist/\nplugins/*\n",
    "dist/\n**/plugins/npm/\n",
    "dist/\nplugins/npm/**\n",
  ])("leaves a file that already covers both entries alone: %j", async (content) => {
    const dir = await tmp();
    await writeFile(path.join(dir, ".gitignore"), content, "utf8");
    expect(await ensureProjectGitignore(dir)).toEqual({ negated: [] });
    expect(await read(dir)).toBe(content);
  });

  test.each(["!**/plugins/npm/**", "!plugins/npm/", "plugins/npm/\n!plugins/npm/", "plugins/*\n!plugins/npm/"])(
    "respects an author's re-include and reports it, without appending: %j",
    async (rule) => {
      const dir = await tmp();
      const content = `dist/\n${rule}\n`;
      await writeFile(path.join(dir, ".gitignore"), content, "utf8");
      expect(await ensureProjectGitignore(dir)).toEqual({ negated: ["plugins/npm/"] });
      expect(await read(dir)).toBe(content);
    },
  );

  test("a re-include that the author ignores again afterwards is not reported", async () => {
    const dir = await tmp();
    const content = "dist/\n!**/plugins/npm/**\nplugins/npm/\n";
    await writeFile(path.join(dir, ".gitignore"), content, "utf8");
    expect(await ensureProjectGitignore(dir)).toEqual({ negated: [] });
    expect(await read(dir)).toBe(content);
  });

  test("an unrelated negation does not count", async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, ".gitignore"), "*.pdf\n!keep.pdf\n", "utf8");
    expect(await ensureProjectGitignore(dir)).toEqual({ negated: [] });
    expect(await read(dir)).toBe("*.pdf\n!keep.pdf\ndist/\nplugins/npm/\n");
  });

  describe("what the desktop's auto-snapshot honours", () => {
    async function vendoredFile(book: string): Promise<void> {
      const pkg = path.join(book, "plugins", "npm", "gp-x", "1.0.0", "node_modules", "gp-x");
      await mkdir(pkg, { recursive: true });
      await writeFile(path.join(pkg, "index.js"), "export default () => {};\n", "utf8");
      await writeFile(path.join(book, "chapter.md"), "# Hi\n", "utf8");
    }

    test("a book that is its own repository", async () => {
      const book = await tmp();
      await git.init({ fs, dir: book, defaultBranch: "main" });
      await vendoredFile(book);
      await ensureProjectGitignore(book);
      const { adds } = await listWorkdirChanges(book);
      expect(adds).toContain("chapter.md");
      expect(adds.filter((p) => p.startsWith("plugins/"))).toEqual([]);
    });

    test("a book in a subfolder of a repository: the book's own .gitignore is enough", async () => {
      const repo = await tmp();
      await git.init({ fs, dir: repo, defaultBranch: "main" });
      const book = path.join(repo, "field-guide");
      await vendoredFile(book);
      await ensureProjectGitignore(book);
      expect(fs.existsSync(path.join(repo, ".gitignore"))).toBe(false);
      const { adds } = await listWorkdirChanges(repo);
      expect(adds).toContain("field-guide/chapter.md");
      expect(adds.filter((p) => p.includes("plugins/npm"))).toEqual([]);
      // The sibling folders of the book are untouched by its ignore rules.
      await vendoredFile(path.join(repo, "other-book"));
      expect((await listWorkdirChanges(repo)).adds).toContain("other-book/plugins/npm/gp-x/1.0.0/node_modules/gp-x/index.js");
    });

    test("a real snapshot commit of a book in a repository leaves plugins/npm/ out", async () => {
      const repo = await tmp();
      await git.init({ fs, dir: repo, defaultBranch: "main" });
      const book = path.join(repo, "field-guide");
      await vendoredFile(book);
      await ensureProjectGitignore(book);
      const source = await detectProjectSource(book);
      expect(source.type).toBe("local-git-folder");

      await providerFor(source).snapshot({ projectDir: book, message: "snap", authorName: "T", authorEmail: "t@example.com" });

      const tracked = await git.listFiles({ fs, dir: repo });
      expect(tracked).toContain("field-guide/chapter.md");
      expect(tracked.filter((p) => p.includes("plugins/npm"))).toEqual([]);
    });

    test("files already tracked stay tracked: ignoring does not untrack them", async () => {
      const book = await tmp();
      await git.init({ fs, dir: book, defaultBranch: "main" });
      await vendoredFile(book);
      const rel = "plugins/npm/gp-x/1.0.0/node_modules/gp-x/index.js";
      await git.add({ fs, dir: book, filepath: rel });
      await ensureProjectGitignore(book);
      const { adds, removes } = await listWorkdirChanges(book);
      expect(removes).toEqual([]);
      expect(adds).not.toContain(rel);
      expect(await git.listFiles({ fs, dir: book })).toContain(rel);
    });
  });
});
