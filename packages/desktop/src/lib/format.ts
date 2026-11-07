/**
 * Shared, PWA-clean formatting helpers.
 *
 * Pure functions — NO `node:*` imports (§8).
 */

/**
 * Coarse "time ago" rendering for a timestamp (ms since epoch), e.g. snapshot
 * times in the history panel. Rounds to the largest sensible unit and falls back
 * to a locale date once past two weeks. Single source of truth, shared across the
 * renderer — don't hand-roll a second, differently-worded copy.
 *
 * @param now Reference "current" time (ms since epoch). Defaults to `Date.now()`;
 * callers pass an explicit value only for deterministic tests.
 */
export function relativeTime(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  try { return new Date(ms).toLocaleDateString(); } catch { return ""; }
}

/** "3 minutes ago", "2 hours ago": written in full, never "mins" or "hrs". */
export function agoFull(ms: number, now: number): string {
  const min = Math.round((now - ms) / 60_000);
  if (min < 1) return "just now";
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"} ago`;
  if (min < 60) return unit(min, "minute");
  const hours = Math.round(min / 60);
  if (hours < 24) return unit(hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 14) return unit(days, "day");
  try { return `on ${new Date(ms).toLocaleDateString()}`; } catch { return ""; }
}
