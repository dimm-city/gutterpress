#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSET_METADATA = join(ROOT, "packaging", "package-manager-assets.json");
const WINGET_ROOT = join(
  ROOT,
  "packaging",
  "winget",
  "manifests",
  "d",
  "DimmCity",
  "Gutterpress",
);
const REPOSITORY = "dimm-city/gutterpress";
const HASH = /^[0-9a-f]{64}$/;
const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
const WINDOWS_INSTALLER = "Gutterpress-setup-win-x64.exe";

function expectedAssetNames(windowsInstaller) {
  return [
    "gutterpress-cli-linux-arm64",
    "gutterpress-cli-linux-x64",
    "gutterpress-cli-macos-arm64",
    "gutterpress-cli-macos-x64",
    "gutterpress-cli-windows-x64.exe",
    windowsInstaller,
  ];
}

function validateMetadata(metadata) {
  if (!metadata || !STABLE_VERSION.test(metadata.version)) {
    throw new Error(`package-manager version must be stable semver, got '${metadata?.version}'`);
  }
  if (metadata.windowsInstaller !== WINDOWS_INSTALLER) {
    throw new Error(`Windows installer must use the stable basename '${WINDOWS_INSTALLER}'`);
  }
  const expected = expectedAssetNames(metadata.windowsInstaller);
  const actual = Object.keys(metadata.assets ?? {}).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error(`package-manager asset set is wrong: expected ${expected.join(", ")}`);
  }
  for (const name of expected) {
    if (!HASH.test(metadata.assets[name])) throw new Error(`invalid SHA-256 for ${name}`);
  }
  return metadata;
}

function parseChecksums(path) {
  const checksums = new Map();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line) continue;
    const match = /^([0-9a-fA-F]{64})  (.+)$/.exec(line);
    if (!match) throw new Error(`invalid SHA256SUMS line: ${line}`);
    if (checksums.has(match[2])) throw new Error(`duplicate checksum entry: ${match[2]}`);
    checksums.set(match[2], match[1].toLowerCase());
  }
  return checksums;
}

function metadataFromChecksums(version, path) {
  if (!STABLE_VERSION.test(version)) {
    throw new Error(`package-manager releases require stable semver, got '${version}'`);
  }
  const checksums = parseChecksums(path);
  const assets = {};
  for (const name of expectedAssetNames(WINDOWS_INSTALLER)) {
    const hash = checksums.get(name);
    if (!hash) throw new Error(`SHA256SUMS.txt has no entry for ${name}`);
    assets[name] = hash;
  }
  return validateMetadata({
    version,
    windowsInstaller: WINDOWS_INSTALLER,
    assets,
  });
}

function formula(metadata) {
  const { version, assets } = metadata;
  const release = `https://github.com/${REPOSITORY}/releases/download/v${version}`;
  return `class Gutterpress < Formula
  desc "Convert Markdown and CSS into print-ready PDFs"
  homepage "https://github.com/${REPOSITORY}"
  version "${version}"
  license "MPL-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "${release}/gutterpress-cli-macos-arm64"
      sha256 "${assets["gutterpress-cli-macos-arm64"]}"
    else
      url "${release}/gutterpress-cli-macos-x64"
      sha256 "${assets["gutterpress-cli-macos-x64"]}"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "${release}/gutterpress-cli-linux-arm64"
      sha256 "${assets["gutterpress-cli-linux-arm64"]}"
    else
      url "${release}/gutterpress-cli-linux-x64"
      sha256 "${assets["gutterpress-cli-linux-x64"]}"
    end
  end

  def install
    artifact = Dir["gutterpress-cli-*"].first
    odie "gutterpress release artifact is missing" unless artifact
    chmod 0755, artifact
    bin.install artifact => "gutterpress"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/gutterpress --version")
  end
end
`;
}

function scoopManifest(metadata) {
  const { version, assets } = metadata;
  const release = `https://github.com/${REPOSITORY}/releases/download/v${version}`;
  return `${JSON.stringify(
    {
      version,
      description: "Convert Markdown and CSS into print-ready PDFs.",
      homepage: `https://github.com/${REPOSITORY}`,
      license: {
        identifier: "MPL-2.0",
        url: `https://github.com/${REPOSITORY}/blob/v${version}/LICENSE`,
      },
      architecture: {
        "64bit": {
            url: `${release}/gutterpress-cli-windows-x64.exe#/gutterpress.exe`,
            hash: assets["gutterpress-cli-windows-x64.exe"],
        },
      },
      bin: "gutterpress.exe",
      notes: "PDF generation requires Chrome, Chromium, Edge, or another supported Chromium browser.",
      checkver: { github: `https://github.com/${REPOSITORY}` },
      autoupdate: {
        architecture: {
          "64bit": {
            url: `https://github.com/${REPOSITORY}/releases/download/v$version/gutterpress-cli-windows-x64.exe#/gutterpress.exe`,
          },
        },
      },
    },
    null,
    2,
  )}\n`;
}

function wingetManifest(metadata) {
  const { version, assets } = metadata;
  const installer = metadata.windowsInstaller;
  return `# Generated by tools/update-package-managers.mjs. Submit this file to microsoft/winget-pkgs.
PackageIdentifier: DimmCity.Gutterpress
PackageVersion: ${version}
PackageLocale: en-US
Publisher: itlackey
PublisherUrl: https://github.com/dimm-city
PublisherSupportUrl: https://github.com/${REPOSITORY}/issues
PackageName: Gutterpress
PackageUrl: https://github.com/${REPOSITORY}
License: MPL-2.0
LicenseUrl: https://github.com/${REPOSITORY}/blob/v${version}/LICENSE
ShortDescription: Write books in Markdown and export professionally typeset PDFs.
Moniker: gutterpress
Tags:
  - markdown
  - pdf
  - publishing
InstallerType: nullsoft
Scope: user
UpgradeBehavior: install
Installers:
  - Architecture: x64
    InstallerUrl: https://github.com/${REPOSITORY}/releases/download/v${version}/${installer}
    InstallerSha256: ${assets[installer]}
ManifestType: singleton
ManifestVersion: 1.12.0
`;
}

function generatedFiles(metadata) {
  return new Map([
    [join(ROOT, "Formula", "gutterpress.rb"), formula(metadata)],
    [join(ROOT, "bucket", "gutterpress.json"), scoopManifest(metadata)],
    [
      join(WINGET_ROOT, metadata.version, "DimmCity.Gutterpress.yaml"),
      wingetManifest(metadata),
    ],
  ]);
}

function writeMetadata(metadata) {
  mkdirSync(dirname(ASSET_METADATA), { recursive: true });
  writeFileSync(ASSET_METADATA, `${JSON.stringify(metadata, null, 2)}\n`);

  rmSync(WINGET_ROOT, { recursive: true, force: true });
  for (const [path, content] of generatedFiles(metadata)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

function collectRelativeFiles(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collectRelativeFiles(path, files);
    else if (entry.isFile()) files.push(relative(ROOT, path));
  }
  return files;
}

function checkMetadata() {
  const metadata = validateMetadata(JSON.parse(readFileSync(ASSET_METADATA, "utf8")));
  const expectedFiles = generatedFiles(metadata);
  const errors = [];
  for (const [path, expected] of expectedFiles) {
    if (!existsSync(path)) errors.push(`missing generated file: ${relative(ROOT, path)}`);
    else if (readFileSync(path, "utf8") !== expected) {
      errors.push(`stale generated file: ${relative(ROOT, path)}`);
    }
  }

  const expectedWinget = [...expectedFiles.keys()]
    .filter((path) => path.startsWith(WINGET_ROOT))
    .map((path) => relative(ROOT, path))
    .sort();
  const actualWinget = collectRelativeFiles(WINGET_ROOT).sort();
  if (JSON.stringify(actualWinget) !== JSON.stringify(expectedWinget)) {
    errors.push("stale or unexpected winget manifest files");
  }

  if (errors.length > 0) throw new Error(errors.join("\n"));
  console.log(`update-package-managers: metadata for ${metadata.version} is current`);
}

function main() {
  const [command, version, checksumPath] = process.argv.slice(2);
  if (command === "--check" && !version && !checksumPath) {
    checkMetadata();
    return;
  }
  if (command === "--update" && version && checksumPath && process.argv.length === 5) {
    const metadata = metadataFromChecksums(version, resolve(checksumPath));
    writeMetadata(metadata);
    checkMetadata();
    return;
  }
  throw new Error(
    "usage: node tools/update-package-managers.mjs --check\n" +
      "   or: node tools/update-package-managers.mjs --update <version> <SHA256SUMS.txt>",
  );
}

try {
  main();
} catch (error) {
  console.error(`update-package-managers: ${error.message}`);
  process.exit(1);
}
