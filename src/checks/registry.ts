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

export function resolveCheckSelectors(selectors: string[]): string[] {
  const allChecks = Array.from(checks.values());
  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const rawSelector of selectors) {
    const selector = rawSelector.trim();
    if (!selector) continue;

    const matcher = selector.includes("*")
      ? selectorToRegex(selector)
      : undefined;

    for (const check of allChecks) {
      const matched = matcher ? matcher.test(check.id) : check.id === selector;
      if (!matched || seen.has(check.id)) continue;
      seen.add(check.id);
      resolved.push(check.id);
    }
  }

  return resolved;
}

function selectorToRegex(selector: string): RegExp {
  const escaped = selector
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
