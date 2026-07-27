/**
 * The installers must verify what they download.
 *
 * Publishing SHA256SUMS.txt only makes verification possible — it does nothing
 * on its own. These tests cover the consuming half: install.sh's behavior is
 * exercised for real (via scripts/check-install-checksum.sh), and both scripts
 * are checked against the manifest tools/prepare-release-assets.mjs actually
 * writes, so the installer ↔ release contract cannot silently drift.
 *
 * install.ps1 is asserted statically: no PowerShell runtime is available on the
 * Linux CI runner, so its behavior is covered by contract assertions here plus
 * the real-world Scoop/winget install validation in package-managers.yml.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

const SH = "packages/cli/scripts/install.sh";
const PS1 = "packages/cli/scripts/install.ps1";

/** The filename prepare-release-assets.mjs writes the hashes to. */
function publishedChecksumFilename(): string {
  const mjs = read("tools/prepare-release-assets.mjs");
  const name = mjs.match(/writeFileSync\(join\(outputDir,\s*"([^"]+)"\)/)?.[1];
  expect(name).toBeDefined();
  return name!;
}

describe("installer checksum verification", () => {
  test("install.sh behavior (scripts/check-install-checksum.sh)", () => {
    const script = join(REPO_ROOT, "packages/cli/scripts/check-install-checksum.sh");
    chmodSync(script, 0o755);
    const result = spawnSync("bash", [script], { encoding: "utf8" });
    // Surface the sub-test output when it fails, so CI shows which case broke.
    if (result.status !== 0) throw new Error(result.stdout + result.stderr);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("0 failed");
  });

  test("both installers look for the checksum file the release actually publishes", () => {
    const published = publishedChecksumFilename();
    expect(read(SH)).toContain(`PRINTMD_CHECKSUM_ASSET="${published}"`);
    expect(read(PS1)).toContain(`$ChecksumAsset = "${published}"`);
  });

  test("install.sh verifies before installing, and discards a bad download", () => {
    const sh = read(SH);
    // Verification must happen while the file is still at the .download path.
    const verifyAt = sh.indexOf("if ! verify_checksum");
    const chmodAt = sh.indexOf('chmod +x "$tmp"');
    const moveAt = sh.indexOf('mv -f "$tmp" "$PRINTMD_BIN"');
    expect(verifyAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeLessThan(chmodAt);
    expect(verifyAt).toBeLessThan(moveAt);
    // A failed verification removes the temp file rather than installing it.
    expect(sh).toMatch(/if ! verify_checksum "\$tmp"; then\s*\n\s*rm -f "\$tmp"/);
  });

  test("install.ps1 verifies before installing, and discards a bad download", () => {
    const ps1 = read(PS1);
    const verifyAt = ps1.indexOf("Test-Checksum -Release $Release");
    const moveAt = ps1.indexOf("Move-Item -Path $tempPath");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeLessThan(moveAt);
    expect(ps1).toContain("Remove-Item $tempPath -Force -ErrorAction SilentlyContinue");
  });

  test("a hash mismatch is fatal in both installers", () => {
    expect(read(SH)).toContain("Refusing to install: the download is corrupt");
    expect(read(PS1)).toContain("Refusing to install: the download is corrupt");
  });

  test("an unavailable hash warns but still installs, so older releases work", () => {
    const sh = read(SH);
    const ps1 = read(PS1);
    // The skip reason is recorded...
    expect(sh).toContain("PRINTMD_UNVERIFIED=");
    expect(ps1).toContain("$script:Unverified =");
    // ...and reprinted as a warning at the end of the run.
    expect(sh).toContain("WARNING: this download was NOT verified against a checksum.");
    expect(ps1).toContain("WARNING: this download was NOT verified against a checksum.");
  });
});
