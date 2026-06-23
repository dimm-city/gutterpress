// ──────────────────────────────────────────────────────────────────────────
// npm-source.ts — resolve the latest runtime package from the npm registry
// (main process only).
//
// The viewer's runtime (UI + engine) is distributed as the single published
// package `@dimm-city/print-md`. Instead of a hand-rolled signed GitHub-release
// manifest, the registry IS the version index + CDN: we read the packument,
// pick the dist-tag for the configured channel, and resolve that version's
// tarball URL + `dist.integrity` (the trust anchor — see integrity.ts) and its
// `printmd.requiresDesktopApi` compat field. No `npm install`; the tarball is
// downloaded and extracted directly (tar.ts). See docs/runtime-lib-update-plan.md.
// ──────────────────────────────────────────────────────────────────────────

export const RUNTIME_PACKAGE = "@dimm-city/print-md";

/** Stable channel → dist-tag mapping. "next" is the opt-in prerelease line. */
export type Channel = "stable" | "beta";
const CHANNEL_DIST_TAG: Record<Channel, string> = { stable: "latest", beta: "next" };

const FETCH_TIMEOUT_MS = 30_000;
const MAX_PACKUMENT_BYTES = 8 * 1024 * 1024; // packuments are large but bounded

/** Subset of an npm version's metadata we rely on. */
interface VersionMeta {
  version?: string;
  dist?: { tarball?: string; integrity?: string };
  printmd?: { requiresDesktopApi?: number };
}

/** Subset of an npm packument (GET registry/<pkg>). */
interface Packument {
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, VersionMeta>;
}

export interface UpdateCandidate {
  version: string;
  tarball: string;
  integrity: string;
  /** From the version's package.json `printmd.requiresDesktopApi` (0 if absent). */
  requiresDesktopApi: number;
}

const DEFAULT_REGISTRY = "https://registry.npmjs.org";

// Test/diagnostic override for the registry base URL. When set, the updater
// fetches `<override>/<encoded-package>` instead of the real registry, so the
// full check→download→verify→extract→promote pipeline can run against a local
// fixture server. Integrity is still verified (the override does NOT weaken it).
// Never set in production; the loud warning makes accidental use visible.
let warnedRegistryOverride = false;
function registryBase(): string {
  const override = process.env.PRINT_MD_UPDATER_FEED_URL;
  if (override) {
    if (!warnedRegistryOverride) {
      warnedRegistryOverride = true;
      console.warn(`[updater] PRINT_MD_UPDATER_FEED_URL override active: ${override}`);
    }
    return override.replace(/\/+$/, "");
  }
  return DEFAULT_REGISTRY;
}

/** Registry URL for the runtime package's packument (scoped name is encoded). */
export function packumentUrl(): string {
  // Encode the scope slash (%2f) but keep the leading @ — the npm registry's
  // canonical form for a scoped packument. replaceAll guards a malformed name.
  return `${registryBase()}/${RUNTIME_PACKAGE.replace(/\//g, "%2f")}`;
}

async function fetchPackument(): Promise<Packument> {
  const res = await fetch(packumentUrl(), {
    headers: {
      "User-Agent": "print-md-viewer-updater",
      // Abbreviated packument: smaller, still carries dist + dist-tags. NOTE:
      // npmjs.com includes custom package.json fields (printmd.requiresDesktopApi)
      // in this format; a proxy that strips them makes requiresDesktopApi default
      // to 0 (= "compatible with any shell") — fail-open on compat by design.
      Accept: "application/vnd.npm.install-v1+json, application/json",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`registry request failed: ${res.status} ${res.statusText}`);
  }
  // Cap the body BEFORE parsing: an absent/mendacious Content-Length must not let
  // a hostile registry stream an unbounded packument into the heap (mirrors the
  // post-buffer cap on the tarball download).
  const declared = Number(res.headers?.get?.("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_PACKUMENT_BYTES) {
    throw new Error(`packument too large: ${declared} bytes`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_PACKUMENT_BYTES) {
    throw new Error(`packument too large: ${buf.byteLength} bytes`);
  }
  return JSON.parse(new TextDecoder().decode(buf)) as Packument;
}

/**
 * Resolve the update candidate for `channel` from the registry. Returns null
 * (with a benign reason) when the channel has no published version or the
 * version metadata is incomplete — callers treat null as "nothing to do".
 */
export async function resolveCandidate(
  channel: Channel = "stable",
): Promise<{ candidate: UpdateCandidate | null; reason?: string }> {
  const pack = await fetchPackument();
  const tag = CHANNEL_DIST_TAG[channel];
  const version = pack["dist-tags"]?.[tag];
  if (!version) return { candidate: null, reason: `no '${tag}' dist-tag` };

  const meta = pack.versions?.[version];
  const tarball = meta?.dist?.tarball;
  const integrity = meta?.dist?.integrity;
  if (!meta || !tarball || !integrity) {
    return { candidate: null, reason: `incomplete metadata for ${version}` };
  }
  return {
    candidate: {
      version,
      tarball,
      integrity,
      requiresDesktopApi: meta.printmd?.requiresDesktopApi ?? 0,
    },
  };
}
