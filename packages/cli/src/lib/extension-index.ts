/**
 * Extension discovery index (#246) — fetch and search the curated,
 * committed-to-this-repo list of extensions published at
 * `site/extensions.json` (https://dimm-city.github.io/gutterpress/extensions.json
 * via the existing GitHub Pages workflow).
 *
 * Curation is a PR to this repo adding one entry — no registry service, no
 * accounts, no install infrastructure. This module is reached ONLY on demand,
 * by `gutterpress ext search` and the desktop's "More extensions" list: it is
 * never imported by the loader, build, preview, or validate paths, so the
 * loader's no-network rule (CLAUDE.md §5) stands.
 *
 * An entry's `use` is exactly the specifier `gutterpress ext add` takes — a
 * bundled name, an npm `name@version`, or a `./`/`../` path (#265's one
 * install verb). There is no `kind` field and no install URL: #265 already
 * decides how each specifier shape is installed.
 */
import { FriendlyHttpError, withFetchTimeout } from "./fetch-timeout.ts";

/** The published index's public URL. */
export const EXTENSION_INDEX_URL = "https://dimm-city.github.io/gutterpress/extensions.json";

/** Env override for tests and self-hosted mirrors — same http(s)-only rule as every other CLI fetch. */
const ENV_OVERRIDE = "GUTTERPRESS_EXTENSION_INDEX";

/** Total fetch deadline. The index is a short curated list, not a package registry. */
const FETCH_TIMEOUT_MS = 15_000;

/** Reject a response larger than this before parsing (the index stays curated and small). */
export const MAX_INDEX_BYTES = 1024 * 1024;

const CARRY_KINDS = ["markdown", "styles", "snippets", "components"] as const;
export type ExtensionIndexCarry = (typeof CARRY_KINDS)[number];

/** One curated extension, as published in the index. */
export interface ExtensionIndexEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  /** The specifier `gutterpress ext add` takes verbatim. */
  use: string;
  carries: ExtensionIndexCarry[];
  homepage?: string;
}

export interface FetchExtensionIndexOptions {
  /** Dependency injection for tests; production uses global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Override the index URL. Defaults to `GUTTERPRESS_EXTENSION_INDEX`, else {@link EXTENSION_INDEX_URL}. */
  url?: string;
  signal?: AbortSignal;
}

function resolveUrl(explicit: string | undefined): string {
  const url = explicit ?? process.env[ENV_OVERRIDE] ?? EXTENSION_INDEX_URL;
  let scheme: string;
  try {
    scheme = new URL(url).protocol;
  } catch {
    throw new Error(`Invalid extension index URL "${url}".`);
  }
  if (scheme !== "http:" && scheme !== "https:") {
    throw new Error(`The extension index URL must be http(s) — got "${scheme}".`);
  }
  return url;
}

function invalid(reason: string): never {
  throw new Error(`Malformed extension index: ${reason}.`);
}

function asEntry(raw: unknown, i: number): ExtensionIndexEntry {
  if (typeof raw !== "object" || raw === null) invalid(`extensions[${i}] is not an object`);
  const entry = raw as Record<string, unknown>;
  for (const field of ["id", "name", "description", "author", "use"] as const) {
    const value = entry[field];
    if (typeof value !== "string" || !value.trim()) {
      invalid(`extensions[${i}].${field} must be a non-empty string`);
    }
  }
  if (
    !Array.isArray(entry.carries) ||
    entry.carries.length === 0 ||
    entry.carries.some((c) => !(CARRY_KINDS as readonly string[]).includes(c as string))
  ) {
    invalid(`extensions[${i}].carries must be a non-empty array of ${CARRY_KINDS.join("/")}`);
  }
  if (entry.homepage !== undefined && typeof entry.homepage !== "string") {
    invalid(`extensions[${i}].homepage must be a string`);
  }
  return {
    id: entry.id as string,
    name: entry.name as string,
    description: entry.description as string,
    author: entry.author as string,
    use: entry.use as string,
    carries: entry.carries as ExtensionIndexCarry[],
    ...(entry.homepage ? { homepage: entry.homepage as string } : {}),
  };
}

/** Parse + strictly validate the index's raw JSON text into its entry list. */
export function parseExtensionIndex(text: string): ExtensionIndexEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    invalid("not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    invalid("root is not an object");
  }
  const root = parsed as Record<string, unknown>;
  if (root.schema !== 1) invalid('"schema" must be 1');
  if (!Array.isArray(root.extensions)) invalid('"extensions" must be an array');
  return root.extensions.map((entry, i) => asEntry(entry, i));
}

/**
 * Fetch and validate the curated extension index. Throws a friendly,
 * author-facing error on any failure (offline, timeout, bad HTTP status,
 * oversize body, malformed JSON, or a shape that doesn't match the schema).
 */
export async function fetchExtensionIndex(
  options: FetchExtensionIndexOptions = {},
): Promise<ExtensionIndexEntry[]> {
  const url = resolveUrl(options.url);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const text = await withFetchTimeout(
    {
      timeoutMs: FETCH_TIMEOUT_MS,
      signal: options.signal,
      timeoutMessage: "Fetching the extension index timed out. Check your connection and try again.",
      offlineMessage: "Couldn't reach the extension index. Check your connection and try again.",
    },
    async (signal) => {
      const res = await fetchImpl(url, { signal });
      if (!res.ok) {
        throw new FriendlyHttpError(`Failed to fetch the extension index (HTTP ${res.status}).`);
      }
      const body = await res.text();
      if (Buffer.byteLength(body, "utf8") > MAX_INDEX_BYTES) {
        throw new FriendlyHttpError(
          `The extension index is too large (limit ${MAX_INDEX_BYTES} bytes).`,
        );
      }
      return body;
    },
  );
  return parseExtensionIndex(text);
}

/** Case-insensitive substring search over id/name/description/author. Empty query returns every entry. */
export function searchExtensionIndex(
  entries: ExtensionIndexEntry[],
  query: string,
): ExtensionIndexEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((entry) =>
    [entry.id, entry.name, entry.description, entry.author].some((field) =>
      field.toLowerCase().includes(q),
    ),
  );
}
