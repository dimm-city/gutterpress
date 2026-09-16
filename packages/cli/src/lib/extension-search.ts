/**
 * Extension discovery (#246) — search the npm registry for things a book can
 * install with `gutterpress ext add`.
 *
 * There is no curated index and no registry service of our own: npm already
 * is the registry, and the convention is a keyword. A Gutterpress extension
 * (a plugin, a look, a component library) tags itself `gutterpress`; a plain
 * markdown-it plugin is found by the ecosystem's existing `markdown-it-plugin`
 * tag, and works in Gutterpress unchanged (CLAUDE.md §5). Publishing is
 * `npm publish` with a keyword — no PR to this repo, no accounts, nothing to
 * moderate.
 *
 * Reached ONLY on demand, by `gutterpress ext search` and the desktop's "Find
 * more on npm" box: never by the loader, build, preview, or validate paths, so
 * the loader's no-network rule stands.
 *
 * The registry's `keywords:a,b` form is an AND, not an OR (it returns nothing
 * for our pair), so this issues ONE request per keyword and merges — see
 * {@link searchNpmExtensions}.
 *
 * Bundle-safe (CLAUDE.md §1/§3): global `fetch` (injectable for tests), no
 * http client, no deps.
 */
import { FriendlyHttpError, withFetchTimeout } from "./fetch-timeout.ts";
import { npmRegistryUrl } from "./npm-registry.ts";

/** Total fetch deadline, shared by both keyword requests. */
const FETCH_TIMEOUT_MS = 15_000;

/** Reject a response larger than this before parsing. */
export const MAX_SEARCH_BYTES = 2 * 1024 * 1024;

/** What a match was found BY — the two conventions, in precedence order. */
export const SEARCH_KEYWORDS = ["gutterpress", "markdown-it-plugin"] as const;
export type ExtensionSearchKind = "gutterpress" | "markdown-it";

const KIND_FOR_KEYWORD: Record<(typeof SEARCH_KEYWORDS)[number], ExtensionSearchKind> = {
  gutterpress: "gutterpress",
  "markdown-it-plugin": "markdown-it",
};

/** One npm package a book could install. */
export interface NpmExtensionMatch {
  name: string;
  version: string;
  description?: string;
  /** `gutterpress` when the package tags itself as an extension; otherwise a
   *  plain markdown-it plugin found by the ecosystem keyword. */
  kind: ExtensionSearchKind;
  keywords: string[];
  homepage?: string;
  /** The package's page on the registry's website, when it published one. */
  npmUrl?: string;
  /** Last publish date, as the registry reported it. */
  date?: string;
}

export interface NpmExtensionSearchResult {
  matches: NpmExtensionMatch[];
  /** What the registry said it had, summed over both keyword queries — the
   *  "showing N of M" denominator, not a count of `matches`. */
  total: number;
}

export interface SearchNpmExtensionsOptions {
  /** Dependency injection for tests; production uses global fetch. */
  fetch?: typeof globalThis.fetch;
  /** How many matches to return, and the `size` of each registry query. */
  limit?: number;
  signal?: AbortSignal;
}

function invalid(reason: string): never {
  throw new Error(`Malformed npm search response: ${reason}.`);
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

interface RegistryPage {
  packages: NpmExtensionMatch[];
  /** Registry-reported relevance, parallel to `packages` — the sort key. */
  scores: number[];
  total: number;
}

/**
 * Parse + strictly validate one registry search page, keeping only packages
 * that genuinely carry `keyword`. The registry's text search matches
 * descriptions too, so `keywords:x` is a ranking hint rather than a filter —
 * without this check a search for "gutterpress" would list every package that
 * merely mentions the word.
 */
function parseSearchPage(text: string, keyword: (typeof SEARCH_KEYWORDS)[number]): RegistryPage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    invalid("not valid JSON");
  }
  const root = object(parsed);
  if (!root) invalid("root is not an object");
  if (!Array.isArray(root.objects)) invalid('"objects" must be an array');
  if (typeof root.total !== "number") invalid('"total" must be a number');

  const packages: NpmExtensionMatch[] = [];
  const scores: number[] = [];
  root.objects.forEach((raw, i) => {
    const entry = object(raw);
    if (!entry) invalid(`objects[${i}] is not an object`);
    const pkg = object(entry.package);
    if (!pkg) invalid(`objects[${i}].package is not an object`);
    const name = str(pkg.name);
    const version = str(pkg.version);
    if (!name) invalid(`objects[${i}].package.name must be a non-empty string`);
    if (!version) invalid(`objects[${i}].package.version must be a non-empty string`);
    const keywords = Array.isArray(pkg.keywords)
      ? pkg.keywords.filter((k): k is string => typeof k === "string")
      : [];
    if (!keywords.includes(keyword)) return;
    // markdown-it itself carries the ecosystem keyword, and `@types/*` are
    // type declarations, not plugins — neither is installable as an extension.
    if (name === "markdown-it" || name.startsWith("@types/")) return;
    const links = object(pkg.links) ?? {};
    packages.push({
      name,
      version,
      ...(str(pkg.description) ? { description: str(pkg.description) } : {}),
      kind: KIND_FOR_KEYWORD[keyword],
      keywords,
      ...(str(links.homepage) ? { homepage: str(links.homepage) } : {}),
      ...(str(links.npm) ? { npmUrl: str(links.npm) } : {}),
      ...(str(pkg.date) ? { date: str(pkg.date) } : {}),
    });
    scores.push(typeof entry.searchScore === "number" ? entry.searchScore : 0);
  });
  return { packages, scores, total: root.total };
}

/**
 * Search npm for installable extensions.
 *
 * One request per keyword (`gutterpress`, then `markdown-it-plugin`), merged
 * and de-duplicated by package name — a package carrying BOTH keywords is one
 * row, reported as a Gutterpress extension. Ordering puts Gutterpress-tagged
 * packages first (they are the ones built for this tool), then the registry's
 * own relevance score.
 *
 * Throws a friendly, author-facing error on any failure (offline, timeout, bad
 * HTTP status, oversize body, malformed JSON, or a shape that doesn't match).
 */
export async function searchNpmExtensions(
  query: string,
  options: SearchNpmExtensionsOptions = {},
): Promise<NpmExtensionSearchResult> {
  const limit = options.limit ?? 20;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const registry = npmRegistryUrl();
  const trimmed = query.trim();

  // Both requests share ONE deadline; parsing happens after it, so a
  // malformed response reads as "malformed", not as "you are offline"
  // (withFetchTimeout maps everything thrown inside to its offline message).
  const bodies = await withFetchTimeout(
    {
      timeoutMs: FETCH_TIMEOUT_MS,
      signal: options.signal,
      timeoutMessage: "Searching npm timed out. Check your connection and try again.",
      offlineMessage: "Couldn't reach the npm registry. Check your connection and try again.",
    },
    async (signal) => {
      const out: string[] = [];
      for (const keyword of SEARCH_KEYWORDS) {
        const text = [trimmed, `keywords:${keyword}`].filter(Boolean).join(" ");
        const url = `${registry}/-/v1/search?text=${encodeURIComponent(text)}&size=${limit}`;
        const res = await fetchImpl(url, { signal });
        if (!res.ok) {
          throw new FriendlyHttpError(`Failed to search npm (HTTP ${res.status}).`);
        }
        const body = await res.text();
        if (Buffer.byteLength(body, "utf8") > MAX_SEARCH_BYTES) {
          throw new FriendlyHttpError(
            `The npm search response is too large (limit ${MAX_SEARCH_BYTES} bytes).`,
          );
        }
        out.push(body);
      }
      return out;
    },
  );
  const pages = bodies.map((body, i) => parseSearchPage(body, SEARCH_KEYWORDS[i]!));

  const byName = new Map<string, { match: NpmExtensionMatch; score: number }>();
  for (const page of pages) {
    page.packages.forEach((match, i) => {
      const existing = byName.get(match.name);
      if (!existing) {
        byName.set(match.name, { match, score: page.scores[i] ?? 0 });
        return;
      }
      // Both keywords found it: keep the Gutterpress identity and the higher
      // relevance, so a package is never listed twice.
      if (match.kind === "gutterpress") existing.match = match;
      existing.score = Math.max(existing.score, page.scores[i] ?? 0);
    });
  }

  const matches = [...byName.values()]
    .sort((a, b) => {
      if (a.match.kind !== b.match.kind) return a.match.kind === "gutterpress" ? -1 : 1;
      return b.score - a.score;
    })
    .slice(0, limit)
    .map((entry) => entry.match);

  return { matches, total: pages.reduce((sum, page) => sum + page.total, 0) };
}
