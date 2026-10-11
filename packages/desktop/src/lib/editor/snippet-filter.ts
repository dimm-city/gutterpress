/**
 * Snippet picker filtering (pure) — what the picker's search box and chips
 * narrow the already-loaded `api.snip.list` result down to, how the survivors
 * group under level headings, and the one-line preview each card shows.
 *
 * Kept free of Svelte and host imports so it is unit-testable and PWA-clean
 * (CLAUDE.md §8). Everything here is order-preserving: the host already
 * orders the list book first, then one run per extension, then core, and the
 * picker relies on that rather than re-sorting.
 */
import type { SnippetEntry } from "$lib/api";

export type LevelFilter = "all" | SnippetEntry["source"]["kind"];

export interface SnippetFilter {
  query: string;
  level: LevelFilter;
  /** Only snippets that are a component's example (`entry.component` set). */
  componentsOnly: boolean;
}

export const NO_FILTER: SnippetFilter = { query: "", level: "all", componentsOnly: false };

export interface SnippetSection {
  /** `kind`, plus the extension's `ref` so two extensions never share a section. */
  key: string;
  kind: SnippetEntry["source"]["kind"];
  /** The extension's display name; absent for the book and core. */
  extensionName?: string;
  entries: SnippetEntry[];
}

/** First meaningful lines of a body, as one plain string, for a card preview. */
export function snippetPreview(body: string, maxChars = 200): string {
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    // blank lines, thematic breaks / front-matter fences, table rules, and
    // bare `@marker` lines (a component snippet opens with one; it says
    // nothing useful).
    .filter(
      (l) =>
        l !== "" &&
        !/^(-{3,}|\*{3,}|_{3,})$/.test(l) &&
        !/^[|:\s-]+$/.test(l) &&
        !/^@[\w-]+(\s+\S+)?$/.test(l),
    )
    // markdown lead-ins, `**`/`__` emphasis marks, table pipes, `{.class}` attrs
    .map((l) =>
      l
        .replace(/^(#{1,6}\s+|>\s*|[-*+]\s+)/, "")
        .replace(/\*\*|__/g, "")
        .replace(/\s*\{\.[^}]*\}/g, "")
        .replace(/^\||\|$/g, "")
        .replace(/\s*\|\s*/g, " · ")
        .trim(),
    );
  const text = (lines.length > 0 ? lines : [body.trim()]).join(" ");
  return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text;
}

/** Entries matching every active filter; the query is a case-insensitive
 *  substring test over the name and the preview text. */
export function filterSnippets(entries: SnippetEntry[], filter: SnippetFilter): SnippetEntry[] {
  const q = filter.query.trim().toLowerCase();
  return entries.filter((e) => {
    if (filter.level !== "all" && e.source.kind !== filter.level) return false;
    if (filter.componentsOnly && !e.component) return false;
    if (!q) return true;
    return (
      e.name.toLowerCase().includes(q) ||
      (e.component ?? "").toLowerCase().includes(q) ||
      snippetPreview(e.body).toLowerCase().includes(q)
    );
  });
}

/** The snippet Enter in the search box inserts: the first one shown. */
export function firstMatch(entries: SnippetEntry[], filter: SnippetFilter): SnippetEntry | undefined {
  return filterSnippets(entries, filter)[0];
}

/** Split an ordered list into runs by level (one run per extension). */
export function groupSnippets(entries: SnippetEntry[]): SnippetSection[] {
  const sections: SnippetSection[] = [];
  for (const entry of entries) {
    const { source } = entry;
    const key = source.kind === "extension" ? `extension:${source.ref}` : source.kind;
    let section = sections.find((s) => s.key === key);
    if (!section) {
      section = {
        key,
        kind: source.kind,
        extensionName: source.kind === "extension" ? source.name : undefined,
        entries: [],
      };
      sections.push(section);
    }
    section.entries.push(entry);
  }
  return sections;
}
