// ──────────────────────────────────────────────────────────────────────────
// verify.test.ts — unit tests for verify.ts (sha256Hex, verifyManifestSignature,
// verifyBundle).  No electron, no network, no filesystem.
// ──────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { sha256Hex, verifyManifestSignature, verifyBundle } from "../../electron/updater/verify.js";
import type { BundleAsset } from "../../electron/updater/contract.js";

// ── sha256Hex ─────────────────────────────────────────────────────────────

describe("sha256Hex", () => {
  test("empty buffer produces known SHA-256", () => {
    // SHA-256 of an empty string is well-known.
    const result = sha256Hex(Buffer.alloc(0));
    expect(result).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("ascii string produces known SHA-256", () => {
    // SHA-256("abc") is well-documented.
    const result = sha256Hex(Buffer.from("abc", "utf8"));
    expect(result).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("returns lowercase hex of length 64", () => {
    const result = sha256Hex(Buffer.from("hello world"));
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  test("accepts Uint8Array input", () => {
    const bytes = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]); // "hello"
    const result = sha256Hex(bytes);
    expect(typeof result).toBe("string");
    expect(result.length).toBe(64);
  });

  test("different inputs produce different digests", () => {
    const a = sha256Hex(Buffer.from("foo"));
    const b = sha256Hex(Buffer.from("bar"));
    expect(a).not.toBe(b);
  });
});

// ── verifyManifestSignature ───────────────────────────────────────────────

describe("verifyManifestSignature", () => {
  // Generate a real Ed25519 keypair once for all tests in this describe block.
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;

  const sampleManifestBytes = Buffer.from(
    JSON.stringify({ schemaVersion: 1, kind: "web-ui-bundle", version: "1.0.0" })
  );

  function sign(bytes: Buffer): string {
    const sig = crypto.sign(null, bytes, privateKey);
    return sig.toString("base64");
  }

  test("valid signature over correct bytes returns true", () => {
    const sigBase64 = sign(sampleManifestBytes);
    expect(verifyManifestSignature(sampleManifestBytes, sigBase64, publicKeyPem)).toBe(true);
  });

  test("valid signature but tampered bytes returns false", () => {
    const sigBase64 = sign(sampleManifestBytes);
    const tampered = Buffer.from(sampleManifestBytes);
    tampered[0] = tampered[0]! ^ 0x01; // flip one bit
    expect(verifyManifestSignature(tampered, sigBase64, publicKeyPem)).toBe(false);
  });

  test("garbage base64 signature returns false", () => {
    expect(verifyManifestSignature(sampleManifestBytes, "not-valid-base64!@#$%", publicKeyPem)).toBe(false);
  });

  test("empty signature string returns false", () => {
    expect(verifyManifestSignature(sampleManifestBytes, "", publicKeyPem)).toBe(false);
  });

  test("signature from wrong key returns false", () => {
    const { privateKey: otherKey } = crypto.generateKeyPairSync("ed25519");
    const wrongSig = crypto.sign(null, sampleManifestBytes, otherKey).toString("base64");
    expect(verifyManifestSignature(sampleManifestBytes, wrongSig, publicKeyPem)).toBe(false);
  });

  test("malformed public key PEM returns false", () => {
    const sigBase64 = sign(sampleManifestBytes);
    expect(
      verifyManifestSignature(sampleManifestBytes, sigBase64, "-----BEGIN PUBLIC KEY-----\nBAD\n-----END PUBLIC KEY-----")
    ).toBe(false);
  });

  test("works with different manifest content", () => {
    const other = Buffer.from('{"schemaVersion":1,"version":"2.0.0"}');
    const sigBase64 = sign(other);
    expect(verifyManifestSignature(other, sigBase64, publicKeyPem)).toBe(true);
    // Original manifest bytes should fail with the sig for `other`
    expect(verifyManifestSignature(sampleManifestBytes, sigBase64, publicKeyPem)).toBe(false);
  });
});

// ── verifyBundle ──────────────────────────────────────────────────────────

describe("verifyBundle", () => {
  const zipBytes = Buffer.from("fake zip content for testing 12345");
  const correctHash = sha256Hex(zipBytes);
  const correctSize = zipBytes.length;

  const correctAsset: BundleAsset = {
    name: "web-ui-bundle.zip",
    sha256: correctHash,
    size: correctSize,
  };

  test("correct bytes and hash returns ok:true", () => {
    const result = verifyBundle(zipBytes, correctAsset);
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test("wrong hash returns ok:false with reason", () => {
    const badAsset: BundleAsset = {
      ...correctAsset,
      sha256: "a".repeat(64), // wrong hash
    };
    const result = verifyBundle(zipBytes, badAsset);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("SHA-256 mismatch");
  });

  test("wrong size returns ok:false with reason", () => {
    const badAsset: BundleAsset = {
      ...correctAsset,
      size: correctSize + 1, // wrong size
    };
    const result = verifyBundle(zipBytes, badAsset);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("size mismatch");
  });

  test("wrong hash takes priority over wrong size (hash check comes first)", () => {
    // Per the implementation: sha256 is checked first.
    const badBothAsset: BundleAsset = {
      ...correctAsset,
      sha256: "b".repeat(64),
      size: correctSize + 99,
    };
    const result = verifyBundle(zipBytes, badBothAsset);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("SHA-256 mismatch");
  });

  test("empty bytes with correct empty hash and size=0 returns ok:true", () => {
    const emptyBytes = Buffer.alloc(0);
    const emptyAsset: BundleAsset = {
      name: "bundle.zip",
      sha256: sha256Hex(emptyBytes),
      size: 0,
    };
    const result = verifyBundle(emptyBytes, emptyAsset);
    expect(result.ok).toBe(true);
  });
});
