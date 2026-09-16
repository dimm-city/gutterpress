import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  EXTENSION_INDEX_URL,
  MAX_INDEX_BYTES,
  fetchExtensionIndex,
  parseExtensionIndex,
  searchExtensionIndex,
  type ExtensionIndexEntry,
} from "./extension-index.ts";

const ENV_KEY = "GUTTERPRESS_EXTENSION_INDEX";

function fakeFetch(handler: (url: string) => Response): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return handler(url);
  }) as typeof globalThis.fetch;
}

const VALID_BODY = JSON.stringify({
  schema: 1,
  extensions: [
    {
      id: "dimm-city-components",
      name: "Dimm City Components",
      description: "Creaturepunk TTRPG component library.",
      author: "Dimm City",
      use: "dimm-city-components",
      carries: ["markdown", "styles"],
      homepage: "https://github.com/dimm-city/dc-op-manual",
    },
  ],
});

describe("fetchExtensionIndex", () => {
  test("happy path: fetches, validates, and returns the entries", async () => {
    const fetch = fakeFetch((url) => {
      expect(url).toBe(EXTENSION_INDEX_URL);
      return new Response(VALID_BODY, { status: 200 });
    });
    const entries = await fetchExtensionIndex({ fetch });
    expect(entries).toEqual([
      {
        id: "dimm-city-components",
        name: "Dimm City Components",
        description: "Creaturepunk TTRPG component library.",
        author: "Dimm City",
        use: "dimm-city-components",
        carries: ["markdown", "styles"],
        homepage: "https://github.com/dimm-city/dc-op-manual",
      },
    ]);
  });

  test("an http error status maps to a friendly error", async () => {
    const fetch = fakeFetch(() => new Response("nope", { status: 500 }));
    await expect(fetchExtensionIndex({ fetch })).rejects.toThrow(/HTTP 500/);
  });

  test("malformed JSON is rejected with a clear message", async () => {
    const fetch = fakeFetch(() => new Response("not json{", { status: 200 }));
    await expect(fetchExtensionIndex({ fetch })).rejects.toThrow(/not valid JSON/);
  });

  test("a body that doesn't match the schema is rejected", async () => {
    const fetch = fakeFetch(() =>
      new Response(JSON.stringify({ schema: 1, extensions: [{ id: "x" }] }), { status: 200 }),
    );
    await expect(fetchExtensionIndex({ fetch })).rejects.toThrow(/Malformed extension index/);
  });

  test("wrong schema version is rejected", async () => {
    const fetch = fakeFetch(() =>
      new Response(JSON.stringify({ schema: 2, extensions: [] }), { status: 200 }),
    );
    await expect(fetchExtensionIndex({ fetch })).rejects.toThrow(/"schema" must be 1/);
  });

  test("an oversize body is rejected before parsing", async () => {
    const big = JSON.stringify({
      schema: 1,
      extensions: [],
      padding: "x".repeat(MAX_INDEX_BYTES + 1),
    });
    const fetch = fakeFetch(() => new Response(big, { status: 200 }));
    await expect(fetchExtensionIndex({ fetch })).rejects.toThrow(/too large/);
  });

  test("an offline/network failure maps to a friendly message", async () => {
    const fetch = (async (_input: string | URL | Request): Promise<Response> => {
      throw new Error("getaddrinfo ENOTFOUND example.invalid");
    }) as typeof globalThis.fetch;
    await expect(fetchExtensionIndex({ fetch })).rejects.toThrow(/Couldn't reach the extension index/);
  });

  describe("GUTTERPRESS_EXTENSION_INDEX override", () => {
    const original = process.env[ENV_KEY];
    beforeEach(() => {
      delete process.env[ENV_KEY];
    });
    afterEach(() => {
      if (original === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = original;
    });

    test("fetches from the env override instead of the default URL", async () => {
      process.env[ENV_KEY] = "http://127.0.0.1:9/extensions.json";
      const fetch = fakeFetch((url) => {
        expect(url).toBe("http://127.0.0.1:9/extensions.json");
        return new Response(VALID_BODY, { status: 200 });
      });
      const entries = await fetchExtensionIndex({ fetch });
      expect(entries[0]!.id).toBe("dimm-city-components");
    });

    test("a non-http(s) override is rejected", async () => {
      process.env[ENV_KEY] = "file:///etc/passwd";
      await expect(fetchExtensionIndex({})).rejects.toThrow(/must be http\(s\)/);
    });
  });
});

describe("parseExtensionIndex", () => {
  test("rejects a non-object root", () => {
    expect(() => parseExtensionIndex("[]")).toThrow(/root is not an object/);
  });

  test("rejects a non-array extensions field", () => {
    expect(() => parseExtensionIndex(JSON.stringify({ schema: 1, extensions: {} }))).toThrow(
      /"extensions" must be an array/,
    );
  });

  test("rejects an entry with an unknown carries value", () => {
    const body = JSON.stringify({
      schema: 1,
      extensions: [
        {
          id: "x",
          name: "X",
          description: "d",
          author: "a",
          use: "x",
          carries: ["binary"],
        },
      ],
    });
    expect(() => parseExtensionIndex(body)).toThrow(/carries must be a non-empty array/);
  });

  test("accepts an entry without a homepage", () => {
    const body = JSON.stringify({
      schema: 1,
      extensions: [
        { id: "x", name: "X", description: "d", author: "a", use: "x", carries: ["markdown"] },
      ],
    });
    const entries = parseExtensionIndex(body);
    expect(entries[0]!.homepage).toBeUndefined();
  });
});

describe("searchExtensionIndex", () => {
  const entries: ExtensionIndexEntry[] = [
    {
      id: "dimm-city-components",
      name: "Dimm City Components",
      description: "Creaturepunk TTRPG component library.",
      author: "Dimm City",
      use: "dimm-city-components",
      carries: ["markdown", "styles"],
    },
    {
      id: "other-thing",
      name: "Something Else",
      description: "Unrelated.",
      author: "Someone",
      use: "other-thing",
      carries: ["styles"],
    },
  ];

  test("empty query returns every entry", () => {
    expect(searchExtensionIndex(entries, "")).toEqual(entries);
    expect(searchExtensionIndex(entries, "   ")).toEqual(entries);
  });

  test("matches case-insensitively across id/name/description/author", () => {
    expect(searchExtensionIndex(entries, "CREATUREPUNK").map((e) => e.id)).toEqual([
      "dimm-city-components",
    ]);
    expect(searchExtensionIndex(entries, "dimm city").map((e) => e.id)).toEqual([
      "dimm-city-components",
    ]);
  });

  test("no matches returns an empty array", () => {
    expect(searchExtensionIndex(entries, "nonexistent-xyz")).toEqual([]);
  });
});
