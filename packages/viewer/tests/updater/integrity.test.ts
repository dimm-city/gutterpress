import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { verifyIntegrity } from "../../electron/updater/integrity.ts";

const bytes = new TextEncoder().encode("the tarball bytes");
const ssri = (algo: string) =>
  `${algo}-${createHash(algo).update(bytes).digest("base64")}`;

describe("verifyIntegrity (SSRI)", () => {
  test("accepts a matching sha512", () => {
    const r = verifyIntegrity(bytes, ssri("sha512"));
    expect(r.ok).toBe(true);
    expect(r.algorithm).toBe("sha512");
  });

  test("accepts a matching sha256", () => {
    expect(verifyIntegrity(bytes, ssri("sha256")).ok).toBe(true);
  });

  test("rejects tampered bytes", () => {
    const r = verifyIntegrity(new TextEncoder().encode("tampered"), ssri("sha512"));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("mismatch");
  });

  test("picks the STRONGEST hash when several are present", () => {
    // valid sha512 + deliberately-wrong sha256 → still verifies via sha512
    const combined = `sha256-AAAA ${ssri("sha512")}`;
    const r = verifyIntegrity(bytes, combined);
    expect(r.ok).toBe(true);
    expect(r.algorithm).toBe("sha512");
  });

  test("fails closed on empty / unsupported integrity", () => {
    expect(verifyIntegrity(bytes, "").ok).toBe(false);
    expect(verifyIntegrity(bytes, "md5-abc").ok).toBe(false);
    expect(verifyIntegrity(bytes, "garbage").ok).toBe(false);
  });
});
