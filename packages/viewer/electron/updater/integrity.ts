// ──────────────────────────────────────────────────────────────────────────
// integrity.ts — verify an npm tarball against its registry `dist.integrity`
// (main process only).
//
// The npm registry publishes a Subresource Integrity (SSRI) string for every
// version's tarball: `dist.integrity = "sha512-<base64>"` (occasionally a
// space-separated list of `<algo>-<base64>` hashes). This is the trust anchor
// for the npm-sourced runtime updater (docs/runtime-lib-update-plan.md): it
// proves the downloaded bytes match what the registry served, over HTTPS, with
// publish protected by 2FA. We verify the STRONGEST hash present and fail
// closed on anything we can't check.
// ──────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";

const ALGO_STRENGTH: Record<string, number> = { sha512: 3, sha384: 2, sha256: 1 };

export interface IntegrityResult {
  ok: boolean;
  reason?: string;
  /** The algorithm actually verified (e.g. "sha512"). */
  algorithm?: string;
}

/** Parse an SSRI string into [{ algorithm, base64 }] for algorithms we support. */
function parseSsri(integrity: string): { algorithm: string; base64: string }[] {
  return integrity
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const dash = tok.indexOf("-");
      if (dash <= 0) return null;
      const algorithm = tok.slice(0, dash);
      const base64 = tok.slice(dash + 1);
      if (!(algorithm in ALGO_STRENGTH) || !base64) return null;
      return { algorithm, base64 };
    })
    .filter((x): x is { algorithm: string; base64: string } => x !== null);
}

/**
 * Verify `bytes` against an SSRI `integrity` string. Picks the strongest hash
 * present (sha512 > sha384 > sha256), recomputes it, and constant-comparison is
 * unnecessary here (the expected digest is public), so a plain string compare of
 * the base64 digests is used. Fails closed: unknown/empty integrity → not ok.
 */
export function verifyIntegrity(
  bytes: Uint8Array,
  integrity: string,
): IntegrityResult {
  const hashes = parseSsri(integrity ?? "");
  if (hashes.length === 0) {
    return { ok: false, reason: "no supported hash in integrity string" };
  }
  hashes.sort(
    (a, b) => (ALGO_STRENGTH[b.algorithm] ?? 0) - (ALGO_STRENGTH[a.algorithm] ?? 0),
  );
  const { algorithm, base64 } = hashes[0]!;
  let actual: string;
  try {
    actual = createHash(algorithm).update(bytes).digest("base64");
  } catch (e) {
    return { ok: false, reason: `hash failed: ${(e as Error).message}` };
  }
  if (actual !== base64) {
    return { ok: false, reason: `${algorithm} mismatch`, algorithm };
  }
  return { ok: true, algorithm };
}
