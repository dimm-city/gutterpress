// ──────────────────────────────────────────────────────────────────────────
// contract.ts — shared types and constants for the web-UI update system
//
// This module is the single source of truth for the update-manifest schema,
// the IPC surface version, and the public key used to verify manifests.
// Import from here; never duplicate the shape elsewhere.
//
// Main-process only (it touches node:crypto). The preload mirrors the few
// values it needs as local literals; the renderer never imports this.
// ──────────────────────────────────────────────────────────────────────────

import { createPublicKey } from "node:crypto";

/**
 * Integer IPC-surface contract version shared between the Electron shell and
 * the SvelteKit SPA.  Bump ONLY when an ipcMain.handle() method that the SPA
 * calls is added or removed.  The SPA reads this via the preload bridge and
 * refuses to run if the shell version is lower than what it was built against.
 */
export const DESKTOP_API = 1;

export interface BundleAsset {
  /** Filename of the distributable zip (e.g. "web-ui-bundle.zip"). */
  name: string;
  /** Lowercase hex SHA-256 of the zip bytes. */
  sha256: string;
  /** Exact byte length of the zip. */
  size: number;
}

/**
 * Shape of `update-manifest.json` produced by CI and verified by this package.
 * The CI agent signs the EXACT bytes of this file; the signature is stored
 * alongside it as `update-manifest.json.sig` (raw bytes, base64-encoded).
 */
export interface UpdateManifest {
  /** Must be 1.  Reserved for future breaking schema changes. */
  schemaVersion: 1;
  /** Discriminator — must be "web-ui-bundle". */
  kind: "web-ui-bundle";
  /** Semver string for the SPA bundle (e.g. "0.2.1"). */
  version: string;
  /**
   * Minimum DESKTOP_API version the shell must expose before loading this
   * bundle.  Increment in CI when the SPA starts calling a new ipcMain handle.
   */
  requiresDesktopApi: number;
  assets: {
    bundle: BundleAsset;
  };
  /** ISO 8601 UTC timestamp of the release (e.g. "2026-06-04T00:00:00Z"). */
  releasedAt: string;
}

// Ed25519 public key that verifies update-manifest.json signatures. The
// matching PRIVATE key is held only as the GitHub Actions secret
// WEB_UI_SIGNING_KEY (never committed). To rotate: run
// `bash scripts/gen-web-ui-signing-key.sh`, replace this block with the new
// public key, and update the secret. Rotating invalidates older releases'
// signatures, so ship a shell update carrying the new key before publishing
// web-v* releases signed with it.
export const WEB_UI_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAHS2Cdyk8gIcf1NkhbiFrk3x4PRQb0VmmjLfENvhruF8=
-----END PUBLIC KEY-----`;

/**
 * True only when WEB_UI_PUBLIC_KEY has been replaced with a real Ed25519 key.
 * The shipped default is an all-zero placeholder; until it is replaced no real
 * signature can verify, so the updater is inert. Callers use this to emit a
 * clear "signing key not configured" diagnostic instead of a misleading
 * "signature verification failed" on every check.
 */
export function isSigningKeyConfigured(): boolean {
  try {
    const der = createPublicKey(WEB_UI_PUBLIC_KEY).export({
      type: "spki",
      format: "der",
    });
    // Ed25519 SPKI = 12-byte header + 32-byte raw key. Placeholder key is all-zero.
    const raw = der.subarray(der.length - 32);
    return !raw.every((b) => b === 0);
  } catch {
    return false;
  }
}
