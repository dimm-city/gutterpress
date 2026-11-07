import { describe, expect, test } from "bun:test";
import { createRepoListCache } from "../../src/lib/routes/repo-list-cache";

const repo = (n: string) => ({ fullName: `a/${n}`, owner: "a", name: n }) as never;

describe("repo list cache", () => {
  test("peek is empty until read, then holds the last list; reads are shared", async () => {
    let reads = 0;
    const c = createRepoListCache(async () => (reads++, [repo("x")]));
    expect(c.peek()).toBeNull();
    const [a, b] = await Promise.all([c.refresh(), c.refresh()]);
    expect(reads).toBe(1);
    expect(a).toBe(b);
    expect(c.peek()).toHaveLength(1);
  });

  test("prefetch fills once and never throws", async () => {
    let reads = 0;
    const c = createRepoListCache(async () => (reads++, [repo("x")]));
    c.prefetch();
    await c.refresh();
    c.prefetch();
    expect(reads).toBe(1);
    createRepoListCache(async () => { throw new Error("offline"); }).prefetch();
  });

  test("accepts a paged answer shape and clear forgets the list", async () => {
    const c = createRepoListCache(async () => ({ repositories: [repo("x"), repo("y")] }));
    expect(await c.refresh()).toHaveLength(2);
    c.clear();
    expect(c.peek()).toBeNull();
  });
});
