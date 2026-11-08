import { describe, expect, test } from "bun:test";
import { createRepoListCache, dedupeByFullName } from "../../src/lib/routes/repo-list-cache";

const repo = (n: string) => ({ fullName: `a/${n}`, owner: "a", name: n }) as never;

describe("repo list cache", () => {
  test("peek is empty until read, then holds the account's list; reads are shared", async () => {
    let reads = 0;
    const c = createRepoListCache(async () => (reads++, [repo("x")]));
    expect(c.peek("ada")).toBeNull();
    const [a, b] = await Promise.all([c.refresh("ada"), c.refresh("ada")]);
    expect(reads).toBe(1);
    expect(a).toBe(b);
    expect(c.peek("ada")).toHaveLength(1);
  });

  test("lists are per account: another sign-in never sees the first one's", async () => {
    const c = createRepoListCache(async () => [repo("x")]);
    await c.refresh("ada");
    expect(c.peek("grace")).toBeNull();
  });

  test("prefetch fills once and never throws; clear forgets every account", async () => {
    let reads = 0;
    const c = createRepoListCache(async () => (reads++, [repo("x")]));
    c.prefetch("ada");
    await c.refresh("ada");
    c.prefetch("ada");
    expect(reads).toBe(1);
    createRepoListCache(async () => { throw new Error("offline"); }).prefetch("ada");
    c.clear();
    expect(c.peek("ada")).toBeNull();
  });

  test("a repository that arrives on two pages is listed once", () => {
    expect(dedupeByFullName([repo("x"), repo("y"), repo("x")])).toHaveLength(2);
  });
});

import { readAllPages, type ReadPage } from "../../src/lib/routes/repo-list-cache";

describe("paged repo read (the real api signature: page number first)", () => {
  test("reads every page in order and stops when there is no more", async () => {
    const calls: Array<[number, unknown]> = [];
    const readPage: ReadPage = async (page, options) => {
      calls.push([page, options]);
      return { repos: [repo(`p${page}a`), repo(`p${page}b`)], page, hasMore: page < 2 };
    };
    const all = await readAllPages(readPage)();
    expect(all.map((r) => r.fullName)).toEqual(["a/p1a", "a/p1b", "a/p2a", "a/p2b"]);
    expect(calls).toEqual([[1, undefined], [2, undefined]]);
  });

  test("a refresh asks the host to skip its cache on the first page only", async () => {
    const calls: Array<[number, unknown]> = [];
    const readPage: ReadPage = async (page, options) => (calls.push([page, options]), { repos: [repo("x")], page, hasMore: page < 2 });
    await readAllPages(readPage)({ refresh: true });
    expect(calls).toEqual([[1, { refresh: true }], [2, undefined]]);
  });
});
