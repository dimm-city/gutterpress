/**
 * Default GitHub repository name for a book's online backup (#358): the book
 * title as a lowercase, hyphenated name GitHub accepts (letters, numbers,
 * hyphens). The author can edit it; the host re-validates whatever is sent.
 */
export function suggestRepositoryName(title: string | undefined | null): string {
  const slug = (title ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");
  return slug || "my-book";
}
