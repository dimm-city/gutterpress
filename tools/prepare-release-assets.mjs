#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve, sep } from "node:path";

function collectFiles(dir, files) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`release artifacts must not contain symlinks: ${path}`);
    }
    if (entry.isDirectory()) collectFiles(path, files);
    else if (entry.isFile()) files.push(path);
  }
}

function sha256(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

async function main() {
  const [inputArg, outputArg] = process.argv.slice(2);
  if (!inputArg || !outputArg || process.argv.length !== 4) {
    throw new Error(
      "usage: node tools/prepare-release-assets.mjs <artifact-download-dir> <release-dir>",
    );
  }

  const inputDir = resolve(inputArg);
  const outputDir = resolve(outputArg);
  if (!existsSync(inputDir) || !statSync(inputDir).isDirectory()) {
    throw new Error(`artifact download directory not found: ${inputDir}`);
  }
  if (inputDir === outputDir || outputDir.startsWith(`${inputDir}${sep}`)) {
    throw new Error("release directory must be outside the artifact download directory");
  }

  if (existsSync(outputDir)) {
    if (!statSync(outputDir).isDirectory() || readdirSync(outputDir).length > 0) {
      throw new Error(`release directory must be absent or empty: ${outputDir}`);
    }
  } else {
    mkdirSync(outputDir, { recursive: true });
  }

  const sourceFiles = [];
  collectFiles(inputDir, sourceFiles);
  if (sourceFiles.length === 0) throw new Error(`no release files found under ${inputDir}`);

  const byName = new Map();
  for (const source of sourceFiles) {
    const name = basename(source);
    if (name === "SHA256SUMS.txt") {
      throw new Error(`reserved release filename found in downloaded artifacts: ${source}`);
    }
    if (name.includes("\n") || name.includes("\r")) {
      throw new Error(`release filename contains a newline: ${source}`);
    }
    const duplicate = byName.get(name);
    if (duplicate) {
      throw new Error(`duplicate release filename '${name}': ${duplicate} and ${source}`);
    }
    byName.set(name, source);
  }

  const names = [...byName.keys()].sort((a, b) => a.localeCompare(b));
  for (const name of names) copyFileSync(byName.get(name), join(outputDir, name));

  const checksumLines = [];
  for (const name of names) {
    checksumLines.push(`${await sha256(join(outputDir, name))}  ${name}`);
  }
  writeFileSync(join(outputDir, "SHA256SUMS.txt"), `${checksumLines.join("\n")}\n`);

  console.log(
    `prepare-release-assets: staged ${names.length} file(s) and SHA256SUMS.txt in ${outputDir}`,
  );
}

main().catch((error) => {
  console.error(`prepare-release-assets: ${error.message}`);
  process.exit(1);
});
