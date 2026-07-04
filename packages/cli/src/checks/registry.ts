import type { Check, CheckCategory, CheckPhase } from "./types";

const checks = new Map<string, Check>();

export function registerCheck(check: Check): void {
  checks.set(check.id, check);
}

export interface CheckFilter {
  category?: CheckCategory | CheckCategory[];
  phase?: CheckPhase;
  ids?: string[];
}

export function getChecks(filter?: CheckFilter): Check[] {
  let result = Array.from(checks.values());

  if (filter?.category) {
    const cats = Array.isArray(filter.category)
      ? filter.category
      : [filter.category];
    result = result.filter((c) => cats.includes(c.category));
  }

  if (filter?.phase) {
    result = result.filter((c) => c.phase === filter.phase);
  }

  if (filter?.ids) {
    const idSet = new Set(filter.ids);
    result = result.filter((c) => idSet.has(c.id));
  }

  return result;
}

export function getCheckById(id: string): Check | undefined {
  return checks.get(id);
}

export function getAllCheckIds(): string[] {
  return Array.from(checks.keys());
}

export interface ResolvedSelectors {
  /** Check IDs matched by the selectors (deduplicated, in match order). */
  resolved: string[];
  /**
   * Selectors that matched no registered check — almost always a typo. Callers
   * MUST surface these; a mistyped `--only`/`--skip` selector silently dropped
   * would otherwise resolve to nothing and report a false "PASSED".
   */
  unmatched: string[];
}

export function resolveCheckSelectors(selectors: string[]): ResolvedSelectors {
  const allChecks = Array.from(checks.values());
  const resolved: string[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();

  for (const rawSelector of selectors) {
    const selector = rawSelector.trim();
    if (!selector) continue;

    const matcher = selector.includes("*")
      ? selectorToRegex(selector)
      : undefined;

    let matchedAny = false;
    for (const check of allChecks) {
      const matched = matcher ? matcher.test(check.id) : check.id === selector;
      if (!matched) continue;
      matchedAny = true;
      if (seen.has(check.id)) continue;
      seen.add(check.id);
      resolved.push(check.id);
    }
    if (!matchedAny) unmatched.push(selector);
  }

  return { resolved, unmatched };
}

function selectorToRegex(selector: string): RegExp {
  const escaped = selector
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
