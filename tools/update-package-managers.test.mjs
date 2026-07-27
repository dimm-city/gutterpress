import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "update-package-managers.mjs");
let failures = 0;

function check(name, condition, detail = "") {
  if (condition) console.log(`ok - ${name}`);
  else {
    failures++;
    console.error(`NOT OK - ${name}${detail ? `: ${detail}` : ""}`);
  }
}

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

const root = mkdtempSync(join(tmpdir(), "package-managers-"));
try {
  const toolsDir = join(root, "tools");
  mkdirSync(toolsDir);
  const script = join(toolsDir, "update-package-managers.mjs");
  copyFileSync(SOURCE_SCRIPT, script);

  const version = "1.2.3";
  const hash = "a".repeat(64);
  const stableInstaller = "print-md-viewer-setup-win-x64.exe";
  const portableZip = `print-md-viewer-${version}-win-x64.zip`;
  const checksums = join(root, "SHA256SUMS.txt");
  writeFileSync(
    checksums,
    [
      "print-md-cli-linux-arm64",
      "print-md-cli-linux-x64",
      "print-md-cli-macos-arm64",
      "print-md-cli-macos-x64",
      "print-md-cli-windows-x64.exe",
      stableInstaller,
      portableZip,
    ]
      .map((name) => `${hash}  ${name}`)
      .join("\n") + "\n",
  );

  const update = run(script, ["--update", version, checksums]);
  check("stable release checksums generate metadata", update.status === 0, update.stderr);

  const verify = run(script, ["--check"]);
  check("freshly generated metadata passes the drift check", verify.status === 0, verify.stderr);

  const metadata = JSON.parse(
    readFileSync(join(root, "packaging", "package-manager-assets.json"), "utf8"),
  );
  check("asset metadata records the release version", metadata.version === version);
  check(
    "asset metadata records the stable Windows installer basename",
    metadata.windowsViewerInstaller === stableInstaller,
  );
  check(
    "portable ZIP remains separate from package-manager installer metadata",
    metadata.assets[portableZip] === undefined,
  );
  check(
    "Homebrew formula is generated",
    readFileSync(join(root, "Formula", "print-md.rb"), "utf8").includes(`version "${version}"`),
  );
  check(
    "Scoop manifest is generated",
    JSON.parse(readFileSync(join(root, "bucket", "print-md.json"), "utf8")).version === version,
  );
  check(
    "submission-ready winget manifest is generated",
    existsSync(
      join(
        root,
        "packaging",
        "winget",
        "manifests",
        "d",
        "DimmCity",
        "PrintMdViewer",
        version,
        "DimmCity.PrintMdViewer.yaml",
      ),
    ),
  );
  const winget = readFileSync(
    join(
      root,
      "packaging",
      "winget",
      "manifests",
      "d",
      "DimmCity",
      "PrintMdViewer",
      version,
      "DimmCity.PrintMdViewer.yaml",
    ),
    "utf8",
  );
  check(
    "winget keeps a versioned release URL with the stable installer basename",
    winget.includes(`/releases/download/v${version}/${stableInstaller}`),
  );
  check(
    "winget does not regress to the old versioned installer basename",
    !winget.includes(`print-md-viewer-${version}-win-x64.exe`),
  );

  const prerelease = run(script, ["--update", "1.2.4-beta.1", checksums]);
  check("prereleases cannot replace stable package-manager metadata", prerelease.status === 1);

  const oldInstallerChecksums = join(root, "old-installer-SHA256SUMS.txt");
  writeFileSync(
    oldInstallerChecksums,
    readFileSync(checksums, "utf8").replace(
      stableInstaller,
      `print-md-viewer-${version}-win-x64.exe`,
    ),
  );
  const oldInstaller = run(script, ["--update", version, oldInstallerChecksums]);
  check("new releases reject a versioned Windows installer basename", oldInstaller.status === 1);

  const legacyInstaller = "print-md-viewer-0.8.3-win-x64.exe";
  writeFileSync(
    oldInstallerChecksums,
    readFileSync(checksums, "utf8").replace(stableInstaller, legacyInstaller),
  );
  const legacyUpdate = run(script, ["--update", "0.8.3", oldInstallerChecksums]);
  check("v0.8.3 can regenerate immutable legacy metadata", legacyUpdate.status === 0);
  const legacyMetadata = JSON.parse(
    readFileSync(join(root, "packaging", "package-manager-assets.json"), "utf8"),
  );
  check(
    "v0.8.3 records its historical installer basename",
    legacyMetadata.windowsViewerInstaller === legacyInstaller,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall tests passed");
