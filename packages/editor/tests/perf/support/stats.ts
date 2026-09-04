/**
 * SFE-P3d-sweep Lane B — percentile/summary helpers shared by the D13
 * evidence sweep and its sabotage control, so the percentile method is
 * defined exactly once rather than reimplemented per test file.
 */

export interface Summary {
  readonly n: number;
  readonly min: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly mean: number;
}

/**
 * Nearest-rank percentile: `sortedAsc` must already be sorted ascending.
 * `p` is 0..100. For `p95` with n=60, rank = ceil(0.95*60) = 57, i.e. the
 * 57th-smallest of 60 samples (0-based index 56) — a standard, easily
 * audited method that needs no interpolation policy.
 */
function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) throw new Error("percentile: empty sample set");
  const rank = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[rank]!;
}

/** Summarizes a raw (unsorted) sample array. Throws on an empty array — an
 * empty result set is a fixture/harness error (AP-21), never silently
 * "zero" statistics. */
export function summarize(samples: readonly number[]): Summary {
  if (samples.length === 0) throw new Error("summarize: empty sample set");
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((total, value) => total + value, 0) / n;
  return {
    n,
    min: sorted[0]!,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[n - 1]!,
    mean,
  };
}

export function formatSummary(summary: Summary): string {
  return (
    `p50=${summary.p50.toFixed(1)}ms p95=${summary.p95.toFixed(1)}ms ` +
    `max=${summary.max.toFixed(1)}ms min=${summary.min.toFixed(1)}ms ` +
    `mean=${summary.mean.toFixed(1)}ms (n=${summary.n})`
  );
}
