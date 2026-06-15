// ──────────────────────────────────────────────────────────────────────────
// manifest-validator.ts — runtime validation for UpdateManifest JSON
//
// No third-party dependencies.  Throws descriptive errors so callers can
// surface meaningful messages to the user / logs.
// ──────────────────────────────────────────────────────────────────────────

import type { BundleAsset, UpdateManifest } from "./contract.js";

/**
 * Validate an unknown value as an UpdateManifest.
 *
 * @param value - Parsed JSON (or any unknown value) to validate.
 * @returns The value cast to UpdateManifest if all required fields are present
 *          and correctly typed.
 * @throws Error with a descriptive message on the first validation failure.
 */
export function validateManifest(value: unknown): UpdateManifest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("update manifest must be a JSON object");
  }

  const m = value as Record<string, unknown>;

  // schemaVersion
  if (m["schemaVersion"] !== 1) {
    throw new Error(
      `update manifest schemaVersion must be 1, got ${JSON.stringify(m["schemaVersion"])}`
    );
  }

  // kind
  if (m["kind"] !== "web-ui-bundle") {
    throw new Error(
      `update manifest kind must be "web-ui-bundle", got ${JSON.stringify(m["kind"])}`
    );
  }

  // version
  if (typeof m["version"] !== "string" || m["version"].trim() === "") {
    throw new Error(
      `update manifest version must be a non-empty string, got ${JSON.stringify(m["version"])}`
    );
  }

  // requiresDesktopApi
  if (
    typeof m["requiresDesktopApi"] !== "number" ||
    !Number.isInteger(m["requiresDesktopApi"]) ||
    m["requiresDesktopApi"] < 1
  ) {
    throw new Error(
      `update manifest requiresDesktopApi must be a positive integer, got ${JSON.stringify(m["requiresDesktopApi"])}`
    );
  }

  // releasedAt
  if (typeof m["releasedAt"] !== "string" || m["releasedAt"].trim() === "") {
    throw new Error(
      `update manifest releasedAt must be a non-empty ISO 8601 string, got ${JSON.stringify(m["releasedAt"])}`
    );
  }

  // assets
  if (m["assets"] === null || typeof m["assets"] !== "object" || Array.isArray(m["assets"])) {
    throw new Error("update manifest assets must be an object");
  }
  const assets = m["assets"] as Record<string, unknown>;

  // assets.bundle
  if (
    assets["bundle"] === null ||
    typeof assets["bundle"] !== "object" ||
    Array.isArray(assets["bundle"])
  ) {
    throw new Error("update manifest assets.bundle must be an object");
  }
  const bundle = assets["bundle"] as Record<string, unknown>;

  // assets.bundle.name
  if (typeof bundle["name"] !== "string" || bundle["name"].trim() === "") {
    throw new Error(
      `update manifest assets.bundle.name must be a non-empty string, got ${JSON.stringify(bundle["name"])}`
    );
  }

  // assets.bundle.sha256
  if (typeof bundle["sha256"] !== "string" || !/^[0-9a-f]{64}$/.test(bundle["sha256"])) {
    throw new Error(
      `update manifest assets.bundle.sha256 must be a 64-character lowercase hex string, got ${JSON.stringify(bundle["sha256"])}`
    );
  }

  // assets.bundle.size
  if (
    typeof bundle["size"] !== "number" ||
    !Number.isInteger(bundle["size"]) ||
    bundle["size"] < 0
  ) {
    throw new Error(
      `update manifest assets.bundle.size must be a non-negative integer, got ${JSON.stringify(bundle["size"])}`
    );
  }

  const validBundle: BundleAsset = {
    name: bundle["name"] as string,
    sha256: bundle["sha256"] as string,
    size: bundle["size"] as number,
  };

  return {
    schemaVersion: 1,
    kind: "web-ui-bundle",
    version: m["version"] as string,
    requiresDesktopApi: m["requiresDesktopApi"] as number,
    assets: { bundle: validBundle },
    releasedAt: m["releasedAt"] as string,
  };
}
