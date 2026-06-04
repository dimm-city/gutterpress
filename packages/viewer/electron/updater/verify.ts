// ──────────────────────────────────────────────────────────────────────────
// verify.ts — integrity and signature verification for web-UI bundles
//
// Uses only node:crypto.  No third-party deps.
// ──────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import { WEB_UI_PUBLIC_KEY } from "./contract.js";
import type { BundleAsset } from "./contract.js";

/**
 * Return the lowercase hex SHA-256 digest of `buf`.
 */
export function sha256Hex(buf: Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Verify the Ed25519 signature over the raw manifest bytes.
 *
 * The CI pipeline signs the EXACT bytes of `update-manifest.json` and stores
 * the raw signature base64-encoded in `update-manifest.json.sig`.
 *
 * @param manifestBytes - The raw file bytes of `update-manifest.json`.
 * @param sigBase64     - The contents of `update-manifest.json.sig` (base64).
 * @param publicKeyPem  - Ed25519 SPKI PEM; defaults to `WEB_UI_PUBLIC_KEY`.
 * @returns `true` if the signature is valid, `false` on any verification
 *          failure or error (malformed key, malformed signature, etc.).
 */
export function verifyManifestSignature(
  manifestBytes: Buffer,
  sigBase64: string,
  publicKeyPem: string = WEB_UI_PUBLIC_KEY
): boolean {
  try {
    const publicKey = crypto.createPublicKey(publicKeyPem);
    const signature = Buffer.from(sigBase64, "base64");
    // Ed25519 uses null as the algorithm identifier.
    return crypto.verify(null, manifestBytes, publicKey, signature);
  } catch {
    return false;
  }
}

/**
 * Verify the integrity of a downloaded zip against the manifest's bundle asset
 * descriptor.  Checks both the SHA-256 hash and the exact byte length.
 *
 * @param zipBytes - The raw bytes of the downloaded zip.
 * @param expected - The `BundleAsset` record from a validated UpdateManifest.
 * @returns `{ ok: true }` on success, or `{ ok: false, reason: string }` on
 *          failure with a human-readable explanation.
 */
export function verifyBundle(
  zipBytes: Buffer,
  expected: BundleAsset
): { ok: boolean; reason?: string } {
  const actualSha256 = sha256Hex(zipBytes);
  if (actualSha256 !== expected.sha256) {
    return {
      ok: false,
      reason: `SHA-256 mismatch: expected ${expected.sha256}, got ${actualSha256}`,
    };
  }

  if (zipBytes.length !== expected.size) {
    return {
      ok: false,
      reason: `size mismatch: expected ${expected.size} bytes, got ${zipBytes.length} bytes`,
    };
  }

  return { ok: true };
}
