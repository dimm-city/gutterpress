/**
 * POST /api/extension/search: the Extensions tab's npm search (#246). It runs
 * the lib's `searchNpmExtensions` (what `gutterpress ext search` prints) and
 * answers with data, never an HTTP error: `{ ok: true, matches, total }`, or
 * `{ ok: false, message }` in plain words for offline, a bad status or a
 * malformed reply.
 *
 * The real lib runs; only the network is faked (a stubbed `globalThis.fetch`
 * answering the registry's search API), so nothing here can reach npm.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { POST as searchRoute } from "../../src/routes/api/extension/search/+server";
import { request } from "../support/route-test-helpers";

const realFetch = globalThis.fetch;

/** One row in the registry's search-response shape. */
const row = (name: string, keywords: string[], extra: { description?: string; searchScore?: number } = {}) => ({
  searchScore: extra.searchScore ?? 1,
  package: {
    name,
    version: "1.0.0",
    keywords,
    ...(extra.description ? { description: extra.description } : {}),
    links: { npm: `https://www.npmjs.com/package/${name}` },
  },
});

/** A registry that answers each keyword query from `pages`, recording the URLs it was asked. */
function stubRegistry(pages: Record<string, unknown[]>, urls: string[] = []) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    const keyword = Object.keys(pages).find((k) => decodeURIComponent(url).includes(`keywords:${k}`));
    const objects = pages[keyword ?? ""] ?? [];
    return new Response(JSON.stringify({ objects, total: objects.length }));
  }) as typeof globalThis.fetch;
}

const call = (body: unknown) => searchRoute({ request: request(body) } as Parameters<typeof searchRoute>[0]);

describe("POST /api/extension/search", () => {
  beforeEach(() => {
    delete process.env.GUTTERPRESS_NPM_REGISTRY;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("answers with the matches for both keyword conventions, Gutterpress packages first, each with its kind and keywords", async () => {
    const urls: string[] = [];
    stubRegistry(
      {
        gutterpress: [row("gp-house", ["gutterpress", "gutterpress-look"], { description: "A house look", searchScore: 1 })],
        "markdown-it-plugin": [row("markdown-it-emoji", ["markdown-it-plugin"], { description: "Emoji", searchScore: 9 })],
      },
      urls,
    );
    const body = await (await call({ query: "  house  " })).json();
    expect(body.ok).toBe(true);
    expect(body.matches.map((m: { name: string; kind: string }) => [m.name, m.kind])).toEqual([
      ["gp-house", "gutterpress"],
      ["markdown-it-emoji", "markdown-it"],
    ]);
    expect(body.matches[0]).toMatchObject({ description: "A house look", keywords: ["gutterpress", "gutterpress-look"] });
    expect(body.total).toBe(2);
    // One request per keyword, each carrying the trimmed words.
    expect(urls.map((u) => decodeURIComponent(u))).toEqual([
      expect.stringContaining("text=house keywords:gutterpress"),
      expect.stringContaining("text=house keywords:markdown-it-plugin"),
    ]);
  });

  test("a query that is missing or not a string searches with nothing typed, for the most relevant", async () => {
    const urls: string[] = [];
    stubRegistry({ gutterpress: [row("gp-house", ["gutterpress"])] }, urls);
    for (const query of [undefined, 42, null]) {
      urls.length = 0;
      const body = await (await call({ query })).json();
      expect(body.ok).toBe(true);
      expect(decodeURIComponent(urls[0]!)).toContain("text=keywords:gutterpress");
    }
  });

  test("nothing found is ok with no matches, not an error", async () => {
    stubRegistry({});
    expect(await (await call({ query: "zzzz" })).json()).toEqual({ ok: true, matches: [], total: 0 });
  });

  test("a registry that cannot be reached is data in plain words, never an HTTP error", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    const res = await call({ query: "emoji" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      message: "Couldn't reach the npm registry. Check your connection and try again.",
    });
  });

  test("a bad registry status or a reply that is not search results is data too", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 503 })) as typeof globalThis.fetch;
    expect(await (await call({ query: "emoji" })).json()).toEqual({ ok: false, message: "Failed to search npm (HTTP 503)." });
    globalThis.fetch = (async () => new Response("<html>")) as typeof globalThis.fetch;
    expect(await (await call({ query: "emoji" })).json()).toEqual({
      ok: false,
      message: "Malformed npm search response: not valid JSON.",
    });
  });
});
