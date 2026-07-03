/**
 * Shared, PWA-clean formatting helpers.
 *
 * Pure functions — NO `node:*` imports (§8 / ADR 0004).
 */

/**
 * Coarse "time ago" rendering for a timestamp (ms since epoch), e.g. snapshot
 * times in the history panel. Rounds to the largest sensible unit and falls back
 * to a locale date once past two weeks. Single source of truth, shared across the
 * renderer.
 */
export function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  try { return new Date(ms).toLocaleDateString(); } catch { return ""; }
}
