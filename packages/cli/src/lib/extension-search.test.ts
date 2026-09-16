/**
 * #246 — `searchNpmExtensions` is the whole discovery surface: npm's search
 * API, filtered to the two keyword conventions. These tests pin it with an
 * injected fetch (no network, ever): the two requests it issues, the merge and
 * ordering across them, the exclusions that keep unusable packages out, the
 * failure shapes an author sees, and the registry override both it and the
 * installer read.
 */
import { describe, test, expect, afterEach } from "bun:test";

import {
  MAX_SEARCH_BYTES,
  SEARCH_KEYWORDS,
  searchNpmExtensions,
} from "./extension-search.ts";
import { DEFAULT_NPM_REGISTRY, npmRegistryUrl } from "./npm-registry.ts";

const ENV_KEY = "GUTTERPRESS_NPM_REGISTRY";
const originalRegistry = process.env[ENV_KEY];

afterEach(() => {
  if (originalRegistry === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = originalRegistry;
});

/** One row in the registry's search-response shape. */
function object(
  name: string,
  keywords: string[],
  extra: { description?: string; searchScore?: number; links?: Record<string, string>; date?: string } = {},
) {
  return {
    searchScore: extra.searchScore ?? 1,
    package: {
      name,
      version: "1.0.0",
      keywords,
      ...(extra.description ? { description: extra.description } : {}),
      ...(extra.date ? { date: extra.date } : {}),
      links: extra.links ?? { npm: `https://www.npmjs.com/package/${name}` },
    },
  };
}

/** A fake fetch that answers each keyword query from `pages`, recording URLs. */
function fakeFetch(pages: Record<string, unknown>, urls: string[] = []) {
  const impl = (async (input: string | URL) => {
    const url = String(input);
    urls.push(url);
    const keyword = Object.keys(pages).find((k) =>
      decodeURIComponent(url).includes(`keywords:${k}`),
    );
    const body = JSON.stringify(pages[keyword ?? ""] ?? { objects: [], total: 0 });
    return new Response(body, { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { impl, urls };
}

describe("npmRegistryUrl", () => {
  test("defaults to the public registry", () => {
    delete process.env[ENV_KEY];
    expect(npmRegistryUrl()).toBe(DEFAULT_NPM_REGISTRY);
  });

  test("an override is used verbatim, minus any trailing slash", () => {
    process.env[ENV_KEY] = "http://127.0.0.1:4873/";
    expect(npmRegistryUrl()).toBe("http://127.0.0.1:4873");
  });

  test("rejects a non-http(s) or unparseable override", () => {
    process.env[ENV_KEY] = "file:///etc";
    expect(() => npmRegistryUrl()).toThrow(/must be an http\(s\) URL/);
    process.env[ENV_KEY] = "not a url";
    expect(() => npmRegistryUrl()).toThrow(/Invalid GUTTERPRESS_NPM_REGISTRY URL/);
  });
});

describe("searchNpmExtensions", () => {
  test("issues ONE request per keyword — the comma form is an AND, not an OR", async () => {
    const { impl, urls } = fakeFetch({});
    process.env[ENV_KEY] = "https://registry.example";
    await searchNpmExtensions("footnote", { fetch: impl, limit: 5 });

    expect(urls).toHaveLength(SEARCH_KEYWORDS.length);
    expect(decodeURIComponent(urls[0]!)).toBe(
      "https://registry.example/-/v1/search?text=footnote keywords:gutterpress&size=5",
    );
    expect(decodeURIComponent(urls[1]!)).toContain("text=footnote keywords:markdown-it-plugin");
  });

  test("an empty query searches the keyword alone", async () => {
    const { impl, urls } = fakeFetch({});
    process.env[ENV_KEY] = "https://registry.example";
    await searchNpmExtensions("   ", { fetch: impl });
    expect(decodeURIComponent(urls[0]!)).toContain("text=keywords:gutterpress&");
  });

  test("merges both pages, maps the fields, and sums the reported totals", async () => {
    const { impl } = fakeFetch({
      gutterpress: {
        objects: [
          object("dimm-city-components", ["gutterpress", "components"], {
            description: "A component library",
            links: { npm: "https://www.npmjs.com/package/dimm-city-components", homepage: "https://dimm.city" },
            date: "2026-09-01T00:00:00.000Z",
          }),
        ],
        total: 1,
      },
      "markdown-it-plugin": {
        objects: [object("markdown-it-footnote", ["markdown-it-plugin"], { description: "Footnotes" })],
        total: 883,
      },
    });
    const { matches, total } = await searchNpmExtensions("", { fetch: impl });

    expect(total).toBe(884);
    expect(matches).toEqual([
      {
        name: "dimm-city-components",
        version: "1.0.0",
        description: "A component library",
        kind: "gutterpress",
        keywords: ["gutterpress", "components"],
        homepage: "https://dimm.city",
        npmUrl: "https://www.npmjs.com/package/dimm-city-components",
        date: "2026-09-01T00:00:00.000Z",
      },
      {
        name: "markdown-it-footnote",
        version: "1.0.0",
        description: "Footnotes",
        kind: "markdown-it",
        keywords: ["markdown-it-plugin"],
        npmUrl: "https://www.npmjs.com/package/markdown-it-footnote",
      },
    ]);
  });

  test("a package carrying BOTH keywords is one row, reported as a gutterpress extension", async () => {
    const both = ["gutterpress", "markdown-it-plugin"];
    const { impl } = fakeFetch({
      gutterpress: { objects: [object("field-notes", both)], total: 1 },
      "markdown-it-plugin": { objects: [object("field-notes", both)], total: 1 },
    });
    const { matches } = await searchNpmExtensions("", { fetch: impl });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.kind).toBe("gutterpress");
  });

  test("orders gutterpress-tagged first, then by the registry's searchScore", async () => {
    const { impl } = fakeFetch({
      gutterpress: {
        objects: [object("gp-low", ["gutterpress"], { searchScore: 1 }), object("gp-high", ["gutterpress"], { searchScore: 9 })],
        total: 2,
      },
      "markdown-it-plugin": {
        objects: [
          object("mi-high", ["markdown-it-plugin"], { searchScore: 100 }),
          object("mi-low", ["markdown-it-plugin"], { searchScore: 2 }),
        ],
        total: 2,
      },
    });
    const { matches } = await searchNpmExtensions("", { fetch: impl });
    expect(matches.map((m) => m.name)).toEqual(["gp-high", "gp-low", "mi-high", "mi-low"]);
  });

  test("drops a package whose keywords do not actually carry the tag (the text search matches prose)", async () => {
    const { impl } = fakeFetch({
      gutterpress: {
        objects: [
          object("mentions-gutterpress", ["pdf"], { description: "Works great with gutterpress" }),
          object("really-tagged", ["gutterpress"]),
        ],
        total: 2,
      },
    });
    const { matches } = await searchNpmExtensions("gutterpress", { fetch: impl });
    expect(matches.map((m) => m.name)).toEqual(["really-tagged"]);
  });

  test("drops markdown-it itself and @types/* packages", async () => {
    const { impl } = fakeFetch({
      "markdown-it-plugin": {
        objects: [
          object("markdown-it", ["markdown-it-plugin"]),
          object("@types/markdown-it-footnote", ["markdown-it-plugin"]),
          object("markdown-it-mark", ["markdown-it-plugin"]),
        ],
        total: 3,
      },
    });
    const { matches } = await searchNpmExtensions("", { fetch: impl });
    expect(matches.map((m) => m.name)).toEqual(["markdown-it-mark"]);
  });

  test("caps the result list at `limit`", async () => {
    const { impl } = fakeFetch({
      "markdown-it-plugin": {
        objects: [1, 2, 3, 4].map((n) => object(`markdown-it-${n}`, ["markdown-it-plugin"])),
        total: 4,
      },
    });
    const { matches } = await searchNpmExtensions("", { fetch: impl, limit: 2 });
    expect(matches).toHaveLength(2);
  });

  test("malformed JSON and a wrong shape are author-facing errors, not crashes", async () => {
    const bad = (body: string) =>
      (async () => new Response(body, { status: 200 })) as unknown as typeof globalThis.fetch;
    await expect(searchNpmExtensions("", { fetch: bad("{ not json") })).rejects.toThrow(
      /Malformed npm search response: not valid JSON/,
    );
    await expect(
      searchNpmExtensions("", { fetch: bad(JSON.stringify({ objects: [{}], total: 0 })) }),
    ).rejects.toThrow(/objects\[0\]\.package is not an object/);
    await expect(
      searchNpmExtensions("", { fetch: bad(JSON.stringify({ objects: [] })) }),
    ).rejects.toThrow(/"total" must be a number/);
  });

  test("an oversize response is refused before it is parsed", async () => {
    const huge = "x".repeat(MAX_SEARCH_BYTES + 1);
    const impl = (async () => new Response(huge, { status: 200 })) as unknown as typeof globalThis.fetch;
    await expect(searchNpmExtensions("", { fetch: impl })).rejects.toThrow(/too large/);
  });

  test("a bad HTTP status names the status", async () => {
    const impl = (async () => new Response("nope", { status: 503 })) as unknown as typeof globalThis.fetch;
    await expect(searchNpmExtensions("", { fetch: impl })).rejects.toThrow(
      /Failed to search npm \(HTTP 503\)/,
    );
  });

  test("a network failure reads as offline, not as a stack trace", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    await expect(searchNpmExtensions("", { fetch: impl })).rejects.toThrow(
      /Couldn't reach the npm registry/,
    );
  });

  test("an invalid registry override fails before any request is made", async () => {
    process.env[ENV_KEY] = "ftp://mirror.example";
    const { impl, urls } = fakeFetch({});
    await expect(searchNpmExtensions("", { fetch: impl })).rejects.toThrow(/must be an http\(s\) URL/);
    expect(urls).toEqual([]);
  });
});
