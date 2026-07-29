/**
 * Drift guard: the asset names the installers download MUST match the asset
 * names the release workflow uploads.
 *
 * This caught a ship-breaking bug where the release uploaded
 * `gutterpress-cli-<os>-<arch>` but install.sh/install.ps1 fetched
 * `gutterpress-<os>-<arch>` — every real download 404'd, and CI masked it by
 * installing from a local binary instead of the release. Keep this test green
 * so the installer ↔ release contract can never silently diverge again.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

/** CLI binary asset names uploaded by the release workflow's build-cli matrix. */
function releaseCliArtifacts(): string[] {
  const yml = read(".github/workflows/release.yml");
  // Match the `artifact: gutterpress-cli-...` lines under the build-cli matrix.
  return [...yml.matchAll(/^\s*artifact:\s*(gutterpress-cli-\S+)\s*$/gm)].map(
    (m) => m[1]!
  );
}

describe("installer ↔ release asset-name contract", () => {
  const artifacts = releaseCliArtifacts();

  test("release uploads the five expected CLI binaries", () => {
    expect(new Set(artifacts)).toEqual(
      new Set([
        "gutterpress-cli-linux-x64",
        "gutterpress-cli-linux-arm64",
        "gutterpress-cli-macos-x64",
        "gutterpress-cli-macos-arm64",
        "gutterpress-cli-windows-x64.exe",
      ])
    );
  });

  test("install.sh expands to release asset names for every os/arch", () => {
    const sh = read("packages/cli/scripts/install.sh");
    const tmpl = sh.match(/GUTTERPRESS_ASSET="([^"]+)"/)?.[1];
    expect(tmpl).toBeDefined();
    // Every (os, arch) the script supports must resolve to an uploaded asset.
    for (const os of ["linux", "macos"]) {
      for (const arch of ["x64", "arm64"]) {
        const expanded = tmpl!
          .replace("${os}", os)
          .replace("${arch}", arch);
        expect(artifacts).toContain(expanded);
      }
    }
  });

  test("install.ps1 returns an uploaded Windows asset name", () => {
    const ps1 = read("packages/cli/scripts/install.ps1");
    const name = ps1.match(/return\s+"(gutterpress-cli-[^"]+\.exe)"/)?.[1];
    expect(name).toBeDefined();
    expect(artifacts).toContain(name!);
  });
});
