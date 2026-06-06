// ──────────────────────────────────────────────────────────────────────────
// semver.ts — dependency-free semver comparison shared by the updater
// (index.ts: pick newest web-v* release) and web-runtime.ts (decide whether a
// promoted bundle out-ranks the baked baseline). Kept as a leaf module (no
// electron/fs imports) so both can use it without an import cycle.
//
// Compares dotted numeric cores; a prerelease tag sorts BEFORE its release
// (standard semver precedence, simplified).
// ──────────────────────────────────────────────────────────────────────────

function parseSemver(v: string): { core: number[]; pre: string | null } | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?$/.exec(v.trim());
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ?? null,
  };
}

/** Returns >0 if a>b, <0 if a<b, 0 if equal. Unparseable versions sort low. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i]! !== pb.core[i]!) return pa.core[i]! - pb.core[i]!;
  }
  // A version with a prerelease has LOWER precedence than one without.
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return comparePrerelease(pa.pre, pb.pre);
}

/**
 * Compare prerelease strings by dot-separated identifiers (semver §11): numeric
 * identifiers compare numerically (so beta.2 < beta.10), and a numeric
 * identifier has lower precedence than an alphanumeric one. Avoids the naive
 * lexicographic bug where "beta.10" < "beta.2".
 */
function comparePrerelease(a: string, b: string): number {
  const as = a.split(".");
  const bs = b.split(".");
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const x = as[i];
    const y = bs[i];
    if (x === undefined) return -1; // shorter set of fields has lower precedence
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (xn !== yn) {
      return xn ? -1 : 1; // numeric < alphanumeric
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}
